/**
 * Export the current game to a .pgn file: api().docGameText gives the
 * exact bytes the document would save for this game (raw slice for clean
 * games, re-serialization for dirty ones — the main process decides), and
 * a blob download hands them to Electron's save-file flow.
 */

import { api } from "./api";
import { useDocumentStore } from "../../store/document-store";
import { useToastStore } from "../../store/toast-store";

/** A safe filename for the exported game, from the players or the event. */
export function exportFileName(tags: [string, string][]): string {
  const get = (name: string): string => tags.find(([k]) => k === name)?.[1] ?? "";
  const white = get("White");
  const black = get("Black");
  const base =
    white && black && white !== "?" && black !== "?"
      ? `${white} - ${black}`
      : get("Event") || "game";

  return `${base.replace(/[/\\:*?"<>|]/g, "_").slice(0, 80).trim() || "game"}.pgn`;
}

export async function exportCurrentGame(): Promise<void> {
  const st = useDocumentStore.getState();

  if (!st.game) return;
  try {
    const text = (await api().docGameText(st.gameIndex)) as string;
    const blob = new Blob([text], { type: "application/x-chess-pgn" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = exportFileName(st.game.tags);
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    useToastStore.getState().show("Could not export the game");
  }
}
