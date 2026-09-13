/**
 * The window-level keyboard map. Mounted once from App.
 *
 *   navigation  ArrowRight/ArrowLeft step, ArrowUp/ArrowDown switch
 *               sibling variations, Home/End jump, f flips the board
 *   editing     ⌘K comment, ⌘I glyph selector, ⌘P promote variation,
 *               ⌘D delete from here, ⌘Z/⇧⌘Z undo/redo, ⌘S save
 *   clipboard   ⌘C copies the game PGN (outside text fields)
 *   annotation  ! and ? compose suffix NAGs within a short window
 *               (!, ?, !!, ??, !?, ?!) on the selected move
 *
 * Alt (variation picker) is handled by VariationPicker's own capture-phase
 * listeners. Menu-owned accelerators (⌘S, ⇧⌘C) also arrive as menu actions;
 * the handlers here cover the paths the menu does not intercept.
 */

import { useEffect } from "react";

import { api } from "../renderer/api";
import { nodeById, useDocumentStore } from "../../store/document-store";
import { useMoveTreeUIStore } from "../../store/move-tree-ui-store";
import { useToastStore } from "../../store/toast-store";
import {
  copyGamePgn,
  editPromoteVariation,
  editSetNags,
  promotedId,
} from "../renderer/edits";
import { createNagComposer } from "./nag-key-composer";
import { useEngineStore } from "../../store/engine-store";
import { nagForSuffix, toggleGroupNag } from "../chess/nag";
import { withMoveSound } from "../sound/play-sound";
import { MENU_ACTION } from "../../electron/constants";

function isTypingTarget(e: KeyboardEvent): boolean {
  return e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
}

function isMainlineId(id: string): boolean {
  for (let i = 0; i < id.length; i += 2) {
    if (id.slice(i, i + 2) !== "00") return false;
  }
  return true;
}

async function undoRedo(kind: "undo" | "redo"): Promise<void> {
  const res = (await (kind === "undo" ? api().undo() : api().redo())) as {
    index: number;
    game: import("../../electron/wire").PackedWireGame;
  } | null;
  if (!res) return;
  const st = useDocumentStore.getState();
  if (res.index === st.gameIndex) st.refreshGame(res.game);
}

function promoteCurrent(): void {
  const st = useDocumentStore.getState();
  const id = st.currentId;
  if (!st.game || st.game.readOnly || id === "" || isMainlineId(id)) return;
  void editPromoteVariation(id).then((ok) => {
    if (ok) useDocumentStore.getState().navigateTo(promotedId(id));
  });
}

export function useKeyboardNav(): void {
  useEffect(() => {
    // Single-key NAG entry. The target move is pinned at the first
    // keystroke, so annotating then stepping on within the window still
    // marks the move the keys were aimed at.
    let nagTargetId: string | null = null;
    const composer = createNagComposer((seq) => {
      const targetId = nagTargetId;
      nagTargetId = null;
      const nag = nagForSuffix(seq);
      if (nag === null || targetId === null) return;
      const st = useDocumentStore.getState();
      if (!st.game || st.game.readOnly) return;
      const node = nodeById(st.game, targetId);
      if (!node) return;
      void editSetNags(targetId, toggleGroupNag(node.nags, nag));
    });

    function handleKeyDown(e: KeyboardEvent): void {
      const mod = e.metaKey || e.ctrlKey;
      const st = useDocumentStore.getState();
      const editable = st.game !== null && !st.game.readOnly;

      if (mod && !e.shiftKey && e.key === "s") {
        e.preventDefault();
        void api()
          .save()
          .then((res) => {
            const r = res as { ok?: boolean; message?: string } | undefined;
            if (r && r.ok === false && r.message) useToastStore.getState().show(r.message);
          });
        return;
      }

      if (mod && !e.shiftKey && e.key === "k") {
        e.preventDefault();
        if (editable) useMoveTreeUIStore.getState().requestComment();
        return;
      }

      if (mod && !e.shiftKey && e.key === "i") {
        e.preventDefault();
        if (editable && st.currentId !== "")
          useMoveTreeUIStore.getState().requestAnnotation();
        return;
      }

      if (mod && !e.shiftKey && e.key === "d") {
        e.preventDefault();
        if (editable && st.currentId !== "")
          useMoveTreeUIStore.getState().requestDelete();
        return;
      }

      if (mod && !e.shiftKey && e.key === "p") {
        e.preventDefault();
        promoteCurrent();
        return;
      }

      if (mod && (e.key === "z" || e.key === "Z")) {
        if (isTypingTarget(e)) return;
        e.preventDefault();
        void undoRedo(e.shiftKey ? "redo" : "undo");
        return;
      }

      if (mod && !e.shiftKey && e.key === "c") {
        // In a text field, leave the system copy alone.
        if (isTypingTarget(e)) return;
        e.preventDefault();
        if (st.game) void copyGamePgn().catch(() => {});
        return;
      }

      // Everything below is suppressed while typing.
      if (isTypingTarget(e)) return;
      if (mod) return;

      if ((e.key === "!" || e.key === "?") && !e.altKey) {
        e.preventDefault();
        if (!editable || st.currentId === "") return;
        if (nagTargetId === null) nagTargetId = st.currentId;
        composer.press(e.key);
        return;
      }

      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          withMoveSound(() => st.goForward());
          break;
        case "ArrowLeft":
          e.preventDefault();
          withMoveSound(() => st.goBack());
          break;
        case "ArrowUp":
          e.preventDefault();
          // Plain Up/Down walks the game list. Sibling variation cycling
          // lives on Shift+arrows — Alt belongs to the hold-to-pick
          // VariationPicker, whose capture listeners swallow Alt+arrow chords.
          if (e.shiftKey) withMoveSound(() => st.enterVariation(-1));
          else st.stepGame(-1);
          break;
        case "ArrowDown":
          e.preventDefault();
          if (e.shiftKey) withMoveSound(() => st.enterVariation(1));
          else st.stepGame(1);
          break;
        case "Home":
          e.preventDefault();
          st.goStart();
          break;
        case "End":
          e.preventDefault();
          withMoveSound(() => st.goEnd());
          break;
        case "f":
          if (!e.altKey) st.toggleOrientation();
          break;
        case "e":
        case " ":
          // Engine toggle: space or 'e' toggles the engine.
          e.preventDefault();
          useEngineStore.getState().toggleAnalysis();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    // ⇧⌘C lives on the menu (File → Copy Game PGN); it arrives here as an
    // action rather than a keystroke.
    const unsubscribe = api().onMenuAction((action) => {
      if (action === MENU_ACTION.COPY_PGN) {
        void copyGamePgn().catch(() => {
          useToastStore.getState().show("Couldn't copy the PGN");
        });
      }
    });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      composer.cancel();
      unsubscribe();
    };
  }, []);
}
