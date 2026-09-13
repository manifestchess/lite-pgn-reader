/**
 * Move tree panel, over the wire model.
 * Hosts the tree plus its overlays: context menu, comment editor (node and
 * game level), glyph selector, delete confirm. Consumes one-shot requests
 * from move-tree-ui-store (⌘K comment, ⌘I annotate, ⌘D delete) and keeps
 * the current move scrolled into view.
 *
 * Every edit goes through lib/renderer/edits: the main process owns the
 * document, answers with the refreshed WireGame, and can refuse an edit —
 * refusals surface in the toast, never silently drop.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { nodeById, parentId, useDocumentStore } from "../../store/document-store";
import { useMoveTreeUIStore } from "../../store/move-tree-ui-store";
import {
  copyGamePgn,
  editDeleteFromHere,
  editPromoteVariation,
  editSetComment,
  editSetNags,
  editSetResult,
  promotedId,
} from "../../lib/renderer/edits";
import { withMoveSound } from "../../lib/sound/play-sound";
import { commentText } from "./MoveComment";
import { MoveTree } from "./MoveTree";
import {
  CONTEXT_MENU_ACTION,
  MoveContextMenu,
  type ContextMenuAction,
} from "./MoveContextMenu";
import { CommentEditor } from "./CommentEditor";
import { GlyphSelector } from "./GlyphSelector";
import { ConfirmPopover } from "./ConfirmPopover";
import { VariationPicker } from "./VariationPicker";

interface OverlayPos {
  x: number;
  y: number;
  /** Node id; "" targets the game-level comment. */
  id: string;
}

function isMainlineId(id: string): boolean {
  for (let i = 0; i < id.length; i += 2) {
    if (id.slice(i, i + 2) !== "00") return false;
  }
  return true;
}

export function MoveTreePanel(): React.ReactElement {
  const game = useDocumentStore((s) => s.game);
  const gameIndex = useDocumentStore((s) => s.gameIndex);
  const currentId = useDocumentStore((s) => s.currentId);
  const navigateTo = useDocumentStore((s) => s.navigateTo);
  const panelRef = useRef<HTMLDivElement>(null);

  const [contextMenu, setContextMenu] = useState<OverlayPos | null>(null);
  const [commentEditor, setCommentEditor] = useState<OverlayPos | null>(null);
  const [glyphSelector, setGlyphSelector] = useState<OverlayPos | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<OverlayPos | null>(null);
  const [deleteHoverId, setDeleteHoverId] = useState<string | null>(null);

  const commentRequested = useMoveTreeUIStore((s) => s.commentRequested);
  const annotationRequested = useMoveTreeUIStore((s) => s.annotationRequested);
  const deleteRequested = useMoveTreeUIStore((s) => s.deleteRequested);
  const clearRequests = useMoveTreeUIStore((s) => s.clearRequests);

  const readOnly = game?.readOnly ?? true;

  // Keyboard-invoked overlays anchor near the top of the panel.
  const anchor = useCallback((): { x: number; y: number } => {
    const rect = panelRef.current?.getBoundingClientRect();
    return {
      x: rect ? rect.left + rect.width / 2 - 140 : 400,
      y: rect ? rect.top + 60 : 200,
    };
  }, []);

  useEffect(() => {
    if (!commentRequested && !annotationRequested && !deleteRequested) return;
    const { x, y } = anchor();

    if (commentRequested) {
      clearRequests();
      if (readOnly || !game) return;
      // At the start position ⌘K edits the game-level comment.
      setGlyphSelector(null);
      setCommentEditor({ x, y, id: currentId });
    } else if (annotationRequested) {
      clearRequests();
      if (readOnly || !game || currentId === "") return;
      setCommentEditor(null);
      setGlyphSelector({ x, y, id: currentId });
    } else {
      clearRequests();
      if (readOnly || !game || currentId === "") return;
      setDeleteConfirm({ x, y, id: currentId });
    }
  }, [
    commentRequested,
    annotationRequested,
    deleteRequested,
    currentId,
    game,
    readOnly,
    anchor,
    clearRequests,
  ]);

  const handleNavigate = useCallback(
    (id: string) => {
      withMoveSound(() => navigateTo(id));
    },
    [navigateTo],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setCommentEditor(null);
    setGlyphSelector(null);
    setContextMenu({ x: e.clientX, y: e.clientY, id });
  }, []);

  const handleContextAction = useCallback(
    (action: ContextMenuAction) => {
      if (!contextMenu) return;
      const { id, x, y } = contextMenu;
      setContextMenu(null);
      setDeleteHoverId(null);

      switch (action) {
        case CONTEXT_MENU_ACTION.COMMENT:
          setCommentEditor({ x, y, id });
          break;
        case CONTEXT_MENU_ACTION.ANNOTATE:
          setGlyphSelector({ x, y, id });
          break;
        case CONTEXT_MENU_ACTION.PROMOTE:
          void editPromoteVariation(id).then((ok) => {
            if (ok) navigateTo(promotedId(id));
          });
          break;
        case CONTEXT_MENU_ACTION.COPY_PGN:
          void copyGamePgn();
          break;
        case CONTEXT_MENU_ACTION.DELETE:
          setDeleteConfirm({ x, y, id });
          break;
      }
    },
    [contextMenu, navigateTo],
  );

  const handleCommentSave = useCallback(
    (nodeId: string) => (prose: string) => editSetComment(nodeId, prose),
    [],
  );

  // The selector reads live NAGs from the refreshed game; a ref keeps the
  // callback stable across those refreshes.
  const glyphSelectorRef = useRef<OverlayPos | null>(null);
  glyphSelectorRef.current = glyphSelector;

  const handleNagsChange = useCallback((nags: number[]) => {
    const sel = glyphSelectorRef.current;
    if (sel) void editSetNags(sel.id, nags);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    const target = deleteConfirm;
    setDeleteConfirm(null);
    if (!target) return;
    void editDeleteFromHere(target.id).then((ok) => {
      if (ok) navigateTo(parentId(target.id));
    });
  }, [deleteConfirm, navigateTo]);

  const handleResultChange = useCallback((result: string) => {
    void editSetResult(result);
  }, []);

  const openGameCommentEditor = useCallback(() => {
    const { x, y } = anchor();
    setCommentEditor({ x, y, id: "" });
  }, [anchor]);

  // Double rAF: the first frame commits the DOM change, the second is
  // where the new row actually has a measurable position to scroll to.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const activeEl = el.querySelector(".mv.active, .vmv.active") as HTMLElement | null;

        if (!activeEl) {
          el.scrollTo({ top: 0, behavior: "instant" });
          return;
        }

        const moveRect = activeEl.getBoundingClientRect();
        const viewRect = el.getBoundingClientRect();

        if (moveRect.top >= viewRect.top && moveRect.bottom <= viewRect.bottom) {
          return;
        }

        el.scrollTo({
          top:
            el.scrollTop +
            moveRect.top -
            viewRect.top -
            (viewRect.height - moveRect.height) / 2,
          behavior: "smooth",
        });
      });
    });

    return () => cancelAnimationFrame(raf1);
  }, [currentId, gameIndex]);

  if (!game) {
    return (
      <div className="h-full px-3 py-3">
        <p className="text-sm italic text-txt-dimmer">No game selected</p>
      </div>
    );
  }

  const commentInitial =
    commentEditor === null
      ? ""
      : commentEditor.id === ""
        ? commentText(game.rootComments)
        : commentText(nodeById(game, commentEditor.id)?.comments ?? []);

  const glyphNags =
    glyphSelector === null ? [] : (nodeById(game, glyphSelector.id)?.nags ?? []);

  return (
    <div ref={panelRef} className="h-full overflow-y-auto overflow-x-hidden whitespace-normal">
      {game.stuck.length > 0 && (
        <div className="mx-2 mb-1 mt-2 rounded bg-[color-mix(in_srgb,var(--color-warning)_18%,transparent)] px-2 py-1 text-xs">
          Couldn't fully read this game (stopped at "{game.stuck[0]?.token}"). It is shown
          as far as it parses, and editing is disabled to protect the file.
        </div>
      )}
      {game.resultConflict && (
        <div className="mx-2 mb-1 mt-2 rounded bg-[color-mix(in_srgb,var(--color-warning)_18%,transparent)] px-2 py-1 text-xs">
          The Result tag and the game's termination marker disagree. Both are preserved
          exactly as written.
        </div>
      )}

      <MoveTree
        currentId={currentId}
        deleteFromId={deleteConfirm?.id ?? deleteHoverId}
        game={game}
        onContextMenu={handleContextMenu}
        onNavigate={handleNavigate}
        onResultChange={readOnly ? undefined : handleResultChange}
        onRootCommentClick={readOnly ? undefined : openGameCommentEditor}
      />

      {contextMenu && (
        <MoveContextMenu
          isMainline={isMainlineId(contextMenu.id)}
          readOnly={readOnly}
          x={contextMenu.x}
          y={contextMenu.y}
          onAction={handleContextAction}
          onClose={() => {
            setContextMenu(null);
            setDeleteHoverId(null);
          }}
          onDeleteHover={(hovering) => setDeleteHoverId(hovering ? contextMenu.id : null)}
        />
      )}

      {commentEditor && (
        <CommentEditor
          initialComment={commentInitial}
          x={commentEditor.x}
          y={commentEditor.y}
          onClose={() => setCommentEditor(null)}
          onSave={handleCommentSave(commentEditor.id)}
        />
      )}

      {glyphSelector && (
        <GlyphSelector
          currentNags={glyphNags}
          x={glyphSelector.x}
          y={glyphSelector.y}
          onClose={() => setGlyphSelector(null)}
          onSetNags={handleNagsChange}
        />
      )}

      {deleteConfirm && (
        <ConfirmPopover
          confirmLabel="Delete"
          message="Removes this move and everything after it in this line. Nothing is written to disk until you save."
          title="Delete from here"
          x={deleteConfirm.x}
          y={deleteConfirm.y}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={handleDeleteConfirm}
        />
      )}

      <VariationPicker />
    </div>
  );
}
