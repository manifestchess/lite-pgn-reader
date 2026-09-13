/**
 * PGN tag (header) editor. Edits commit per tag on blur/Enter through
 * api().setTag / deleteTag; every edit returns the refreshed WireGame and a
 * refusal comes back as a toast, never a silent drop.
 *
 * Read-only games open in view-only mode: fields render but cannot be
 * changed, with a calm explanation. Games flagged with malformed tag lines
 * carry a note: those lines are read leniently and are preserved exactly
 * as written in the file.
 */

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@heroui/react";

import { api, type EditResult } from "../../lib/renderer/api";
import { useDocumentStore } from "../../store/document-store";
import { useTagEditorStore } from "../../store/tag-editor-store";
import { useToastStore } from "../../store/toast-store";
import { GFLAG } from "../../electron/wire";

interface TagDef {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "select";
  /** Values written into the PGN itself, exactly as the format spells them. */
  options?: string[];
}

const GAME_TAGS: TagDef[] = [
  { key: "Event", label: "Event", placeholder: "Tournament or match" },
  { key: "Site", label: "Site", placeholder: "City, region or site" },
  { key: "Date", label: "Date", placeholder: "YYYY.MM.DD" },
  { key: "Round", label: "Round", placeholder: "Round number" },
  {
    key: "Result",
    label: "Result",
    type: "select",
    options: ["*", "1-0", "0-1", "1/2-1/2"],
  },
];

const PLAYER_TAGS: TagDef[] = [
  { key: "White", label: "White", placeholder: "Player name" },
  { key: "Black", label: "Black", placeholder: "Player name" },
  { key: "WhiteElo", label: "White rating", placeholder: "Rating" },
  { key: "BlackElo", label: "Black rating", placeholder: "Rating" },
  { key: "WhiteTitle", label: "White title", placeholder: "GM, IM, FM" },
  { key: "BlackTitle", label: "Black title", placeholder: "GM, IM, FM" },
];

const OPENING_TAGS: TagDef[] = [
  { key: "ECO", label: "ECO", placeholder: "B33" },
  { key: "Opening", label: "Opening", placeholder: "Opening name" },
  { key: "Variation", label: "Variation", placeholder: "Variation name" },
  { key: "SubVariation", label: "Sub-variation" },
];

const TIME_TAGS: TagDef[] = [
  { key: "TimeControl", label: "Time control", placeholder: "300+3" },
  { key: "UTCDate", label: "UTC date", placeholder: "YYYY.MM.DD" },
  { key: "UTCTime", label: "UTC time", placeholder: "HH:MM:SS" },
  {
    key: "Termination",
    label: "Termination",
    type: "select",
    options: [
      "Normal",
      "Time forfeit",
      "Abandoned",
      "Adjudication",
      "Rules infraction",
      "Unterminated",
    ],
  },
];

const SETUP_TAGS: TagDef[] = [
  { key: "FEN", label: "FEN", placeholder: "Starting position" },
  { key: "Variant", label: "Variant", placeholder: "Standard" },
];

// Lichess's own tag vocabulary, quoted rather than renamed: these names
// exist only in a Lichess export.
const LICHESS_TAGS: TagDef[] = [
  {
    key: "Orientation",
    label: "Orientation",
    type: "select",
    options: ["white", "black"],
  },
  { key: "StudyName", label: "Study Name" },
  { key: "ChapterName", label: "Chapter Name" },
  { key: "Annotator", label: "Annotator" },
  { key: "ChapterURL", label: "Chapter URL", placeholder: "https://..." },
];

interface Category {
  key: string;
  label: string;
  tags: TagDef[];
}

const CATEGORIES: Category[] = [
  { key: "game", label: "Game", tags: GAME_TAGS },
  { key: "players", label: "Players", tags: PLAYER_TAGS },
  { key: "opening", label: "Opening", tags: OPENING_TAGS },
  { key: "time", label: "Time", tags: TIME_TAGS },
  { key: "setup", label: "Setup", tags: SETUP_TAGS },
  { key: "lichess", label: "Lichess", tags: LICHESS_TAGS },
  { key: "custom", label: "Custom", tags: [] },
];

// Any header outside this set is treated as a custom tag.
const KNOWN_KEYS = new Set(CATEGORIES.flatMap((c) => c.tags.map((t) => t.key)));

/**
 * The tag editor rejects newlines and control characters at input time;
 * a paste that carries them gets them stripped, visibly.
 */
function stripControls(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, "");
}

function TagField({
  tag,
  value,
  disabled,
  onCommit,
  onDelete,
}: {
  tag: TagDef;
  value: string;
  disabled: boolean;
  onCommit: (key: string, value: string) => void;
  onDelete?: (key: string) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState(value);

  // Re-sync when the underlying game (or its tags) change under us.
  useEffect(() => setDraft(value), [value]);

  const commit = (): void => {
    if (draft !== value) onCommit(tag.key, draft);
  };

  return (
    <div className="flex items-center gap-2">
      <label className="w-28 shrink-0 text-right text-xs font-medium text-txt-dim">
        {tag.label}
      </label>
      {tag.type === "select" ? (
        <select
          className="h-8 flex-1 rounded-md border border-line bg-low px-2 text-sm text-txt focus:border-txt-dim focus:outline-none disabled:opacity-60"
          data-testid={`tag-field-${tag.key}`}
          disabled={disabled}
          value={tag.options?.includes(value) ? value : ""}
          onChange={(e) => onCommit(tag.key, e.target.value)}
        >
          {!tag.options?.includes(value) && (
            <option value="">{value || "(not set)"}</option>
          )}
          {tag.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="input h-8 flex-1 rounded-md border border-line bg-low px-2 text-sm text-txt placeholder:text-txt-dimmer focus:border-txt-dim focus:outline-none disabled:opacity-60"
          data-testid={`tag-field-${tag.key}`}
          disabled={disabled}
          placeholder={tag.placeholder}
          type="text"
          value={draft}
          onBlur={commit}
          onChange={(e) => setDraft(stripControls(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
      )}
      {onDelete && (
        <button
          aria-label={`Remove tag ${tag.key}`}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-txt-dimmer transition-colors hover:bg-low hover:text-txt disabled:opacity-40"
          data-testid={`tag-delete-${tag.key}`}
          disabled={disabled}
          title="Remove tag"
          onClick={() => onDelete(tag.key)}
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="14"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="14"
          >
            <line x1="18" x2="6" y1="6" y2="18" />
            <line x1="6" x2="18" y1="6" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}

function CustomTagsSection({
  headers,
  disabled,
  onCommit,
  onDelete,
}: {
  headers: Map<string, string>;
  disabled: boolean;
  onCommit: (key: string, value: string) => void;
  onDelete: (key: string) => void;
}): React.ReactElement {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const customEntries: [string, string][] = [];

  for (const [k, v] of headers) {
    if (!KNOWN_KEYS.has(k)) customEntries.push([k, v]);
  }

  const handleAdd = (): void => {
    const key = newKey.trim();

    if (!key || KNOWN_KEYS.has(key) || headers.has(key)) return;
    onCommit(key, newValue);
    setNewKey("");
    setNewValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {customEntries.length === 0 && (
        <p className="text-xs text-txt-dimmer">
          No custom tags in this game.
        </p>
      )}
      {customEntries.map(([k, v]) => (
        <TagField
          key={k}
          disabled={disabled}
          tag={{ key: k, label: k }}
          value={v}
          onCommit={onCommit}
          onDelete={onDelete}
        />
      ))}

      {!disabled && (
        <div className="mt-1 flex items-center gap-2">
          <input
            className="input h-8 w-28 shrink-0 rounded-md border border-line bg-low px-2 text-right text-sm text-txt placeholder:text-txt-dimmer focus:border-txt-dim focus:outline-none"
            data-testid="custom-tag-name"
            placeholder="Name"
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(stripControls(e.target.value).replace(/[\s"[\]]/g, ""))}
            onKeyDown={handleKeyDown}
          />
          <input
            className="input h-8 flex-1 rounded-md border border-line bg-low px-2 text-sm text-txt placeholder:text-txt-dimmer focus:border-txt-dim focus:outline-none"
            data-testid="custom-tag-value"
            placeholder="Value"
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(stripControls(e.target.value))}
            onKeyDown={handleKeyDown}
          />
          <button
            className="h-8 shrink-0 rounded-md border border-line bg-low px-3 text-xs font-medium text-txt-dim transition-colors hover:bg-zebra2 hover:text-txt disabled:opacity-40"
            data-testid="custom-tag-add"
            disabled={!newKey.trim()}
            onClick={handleAdd}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

export function TagEditorModal(): React.ReactElement | null {
  const isOpen = useTagEditorStore((s) => s.isOpen);
  const close = useTagEditorStore((s) => s.close);
  const game = useDocumentStore((s) => s.game);
  const gameIndex = useDocumentStore((s) => s.gameIndex);
  const refreshGame = useDocumentStore((s) => s.refreshGame);
  const showToast = useToastStore((s) => s.show);

  const [activeCategory, setActiveCategory] = useState("game");

  const readOnly = game?.readOnly ?? false;
  const malformed = ((game?.flags ?? 0) & GFLAG.MALFORMED_TAGS) !== 0;
  // Wire tags are first-occurrence-wins, so duplicates can never appear in
  // the Map itself — the parse records them separately.
  const duplicates = (game?.duplicateTagNames.length ?? 0) > 0;

  // First occurrence wins for duplicate tags, conflict surfaced
  // via the note below.
  const headers = new Map<string, string>();

  for (const [k, v] of game?.tags ?? []) if (!headers.has(k)) headers.set(k, v);

  const commit = useCallback(
    async (key: string, value: string) => {
      const res = (key === "Result"
        ? await api().setResult(gameIndex, value)
        : await api().setTag(gameIndex, key, value)) as EditResult;

      if (!res.ok) {
        showToast(res.message);

        return;
      }
      refreshGame(res.game);
    },
    [gameIndex, refreshGame, showToast],
  );

  const remove = useCallback(
    async (key: string) => {
      const res = (await api().deleteTag(gameIndex, key)) as EditResult;

      if (!res.ok) {
        showToast(res.message);

        return;
      }
      refreshGame(res.game);
    },
    [gameIndex, refreshGame, showToast],
  );

  if (!game) return null;

  const customCount = [...headers.keys()].filter((k) => !KNOWN_KEYS.has(k)).length;
  const cat = CATEGORIES.find((c) => c.key === activeCategory);

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Modal.Backdrop isDismissable>
        <Modal.Container>
          <Modal.Dialog className="no-drag overflow-hidden p-0 !max-w-2xl !w-[min(42rem,100vw-2rem)]">
            <div className="grid h-[440px] grid-cols-12">
              <div className="col-span-3 flex flex-col border-r border-line p-3">
                <h2 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-txt-dim">
                  Tags
                </h2>
                <div className="flex flex-col gap-0.5">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.key}
                      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors duration-100 ${
                        activeCategory === c.key
                          ? "chip-active"
                          : "text-txt-dim hover:bg-low/50 hover:text-txt"
                      }`}
                      data-testid={`tag-category-${c.key}`}
                      onClick={() => setActiveCategory(c.key)}
                    >
                      {c.label}
                      {c.key === "custom" && customCount > 0 && (
                        <span className="ml-auto rounded-full bg-zebra2 px-1.5 py-0.5 text-[10px] leading-none text-txt-dim">
                          {customCount}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="col-span-9 overflow-y-auto p-5">
                {readOnly && (
                  <p className="mb-4 rounded-md bg-low/60 px-3 py-2 text-xs text-txt-dim">
                    This game could not be fully read, so its tags are shown
                    view-only to protect the file.
                  </p>
                )}
                {malformed && (
                  <p className="mb-4 rounded-md bg-[color-mix(in_srgb,var(--color-warning)_14%,transparent)] px-3 py-2 text-xs text-txt-dim">
                    Some tag lines in this game are malformed. They are shown
                    as best they can be read and stay byte-identical in the
                    file unless that exact tag is edited.
                  </p>
                )}
                {duplicates && (
                  <p className="mb-4 rounded-md bg-[color-mix(in_srgb,var(--color-warning)_14%,transparent)] px-3 py-2 text-xs text-txt-dim">
                    This game repeats a tag name. The first occurrence is
                    shown; all of them are preserved in the file.
                  </p>
                )}
                {activeCategory === "custom" ? (
                  <CustomTagsSection
                    disabled={readOnly}
                    headers={headers}
                    onCommit={(k, v) => void commit(k, v)}
                    onDelete={(k) => void remove(k)}
                  />
                ) : (
                  <div className="flex flex-col gap-3">
                    {cat?.tags.map((tag) => (
                      <TagField
                        key={`${gameIndex}-${tag.key}`}
                        disabled={readOnly}
                        tag={tag}
                        value={headers.get(tag.key) ?? ""}
                        onCommit={(k, v) => void commit(k, v)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
