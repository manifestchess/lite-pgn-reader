/**
 * The settings surface: a category-switcher shell (left tab rail, one
 * section at a time) over nine sections: board theme, pieces, coordinates,
 * animation, sound, moves, engine, appearance, about/legal.
 *
 * Backquote toggles it, Escape closes, and openers can deep-link a section
 * (About menu item, engine chip) — the deep link picks the tab on the open
 * transition only, so in-modal navigation sticks.
 */

import { useEffect, useRef, useState } from "react";
import { Modal } from "@heroui/react";

import { AboutSettings } from "./AboutSettings";
import { AnimationSettings } from "./AnimationSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { BoardThemeSettings } from "./BoardSettings";
import { CoordinateSettings } from "./CoordinateSettings";
import { EngineSettings } from "./EngineSettings";
import { MoveSettings } from "./MoveSettings";
import { PieceSettings } from "./PieceSettings";
import { SoundSettings } from "./SoundSettings";

import {
  useSettingsModalStore,
  SETTINGS_SECTION,
  type SettingsSection,
} from "../../store/settings-modal-store";
import {
  useBoardPreferencesStore,
  DEFAULT_THEME,
  DEFAULT_PIECE_SET,
  DEFAULT_COORDINATE_POSITION,
  DEFAULT_ANIMATION_SPEED,
  DEFAULT_CUSTOM_ANIMATION_MS,
  DEFAULT_SOUND_ENABLED,
  DEFAULT_SOUND_THEME,
  DEFAULT_SOUND_VOLUME,
  DEFAULT_MOVE_INPUT,
  DEFAULT_SHOW_MOVE_HINTS,
  DEFAULT_SHOW_GHOST_PIECE,
  DEFAULT_HIGHLIGHT_LAST_MOVE,
} from "../../store/board-preferences-store";
import {
  useEngineStore,
  DEFAULT_MULTI_PV,
  DEFAULT_THREADS,
  DEFAULT_HASH,
  DEFAULT_SEARCH_TIME,
  DEFAULT_SHOW_ARROWS,
} from "../../store/engine-store";

const SECTIONS: { key: SettingsSection; label: string; content: React.ReactNode }[] = [
  { key: SETTINGS_SECTION.BOARD, label: "Board", content: <BoardThemeSettings /> },
  { key: SETTINGS_SECTION.PIECES, label: "Pieces", content: <PieceSettings /> },
  { key: SETTINGS_SECTION.COORDINATES, label: "Coordinates", content: <CoordinateSettings /> },
  { key: SETTINGS_SECTION.ANIMATION, label: "Animation", content: <AnimationSettings /> },
  { key: SETTINGS_SECTION.SOUND, label: "Sound", content: <SoundSettings /> },
  { key: SETTINGS_SECTION.MOVES, label: "Moves", content: <MoveSettings /> },
  { key: SETTINGS_SECTION.ENGINE, label: "Engine", content: <EngineSettings /> },
  { key: SETTINGS_SECTION.APPEARANCE, label: "Appearance", content: <AppearanceSettings /> },
  { key: SETTINGS_SECTION.ABOUT, label: "About", content: <AboutSettings /> },
];

export function SettingsPanel(): React.ReactElement {
  const isOpen = useSettingsModalStore((s) => s.isOpen);
  const section = useSettingsModalStore((s) => s.section);
  const close = useSettingsModalStore((s) => s.close);

  const [active, setActive] = useState<SettingsSection>(SETTINGS_SECTION.BOARD);
  const prevOpenRef = useRef(false);

  const resetBoardPreferences = useBoardPreferencesStore((s) => s.resetPreferences);
  const resetEngineOptions = useEngineStore((s) => s.resetEngineOptions);

  const isBoardDefault = useBoardPreferencesStore(
    (s) =>
      s.theme === DEFAULT_THEME &&
      s.pieceSet === DEFAULT_PIECE_SET &&
      s.coordinatePosition === DEFAULT_COORDINATE_POSITION &&
      s.animationSpeed === DEFAULT_ANIMATION_SPEED &&
      s.customAnimationMs === DEFAULT_CUSTOM_ANIMATION_MS &&
      s.soundEnabled === DEFAULT_SOUND_ENABLED &&
      s.soundTheme === DEFAULT_SOUND_THEME &&
      s.soundVolume === DEFAULT_SOUND_VOLUME &&
      s.moveInput === DEFAULT_MOVE_INPUT &&
      s.showMoveHints === DEFAULT_SHOW_MOVE_HINTS &&
      s.showGhostPiece === DEFAULT_SHOW_GHOST_PIECE &&
      s.highlightLastMove === DEFAULT_HIGHLIGHT_LAST_MOVE,
  );

  const isEngineDefault = useEngineStore(
    (s) =>
      s.multiPV === DEFAULT_MULTI_PV &&
      s.threads === DEFAULT_THREADS &&
      s.hash === DEFAULT_HASH &&
      s.searchTime === DEFAULT_SEARCH_TIME &&
      s.showArrows === DEFAULT_SHOW_ARROWS,
  );

  const isDefault = isBoardDefault && isEngineDefault;

  // Deep link adopts on the OPEN transition only — re-reading the store on
  // every render would undo the user's in-modal tab navigation.
  useEffect(() => {
    if (isOpen && !prevOpenRef.current && section) setActive(section);
    prevOpenRef.current = isOpen;
  }, [isOpen, section]);

  const activeSection = SECTIONS.find((x) => x.key === active) ?? SECTIONS[0]!;

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Modal.Backdrop isDismissable>
        <Modal.Container>
          <Modal.Dialog
            aria-label="Settings"
            className="no-drag overflow-hidden p-0 !max-w-2xl !w-[min(42rem,100vw-2rem)]"
          >
            <div className="grid h-[min(560px,85vh)] grid-cols-12">
              <div className="col-span-3 flex flex-col overflow-y-auto border-r border-line p-3">
                <h2 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-txt-dim">
                  Settings
                </h2>
                <div className="flex flex-col gap-0.5">
                  {SECTIONS.map((x) => (
                    <button
                      key={x.key}
                      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium cursor-pointer transition-colors duration-100 ${
                        active === x.key
                          ? "chip-active"
                          : "text-txt-dim hover:bg-low/50 hover:text-txt"
                      }`}
                      data-testid={`settings-tab-${x.key}`}
                      onClick={() => setActive(x.key)}
                    >
                      {x.label}
                    </button>
                  ))}
                </div>
                <div className="mt-auto border-t border-line pt-3">
                  <button
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] font-medium transition-colors duration-100 ${
                      isDefault
                        ? "cursor-default text-txt-dim/40"
                        : "cursor-pointer text-txt-dim hover:bg-low/50 hover:text-txt"
                    }`}
                    disabled={isDefault}
                    onClick={() => {
                      resetBoardPreferences();
                      resetEngineOptions();
                    }}
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
                      <path d="M3 12a9 9 0 1 1 3 6.7" />
                      <polyline points="3 7 3 13 9 13" />
                    </svg>
                    Reset to defaults
                  </button>
                </div>
              </div>
              <div
                className="col-span-9 overflow-y-auto p-5"
                data-testid="settings-content"
              >
                <section data-settings-section={activeSection.key}>
                  {activeSection.content}
                </section>
              </div>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
