/**
 * Edit plumbing: every edit endpoint returns either the refreshed WireGame
 * or a refusal message (e.g. '}' in a comment, unencodable characters).
 * Refusals surface in the toast, never silently drop, and the store is
 * refreshed from the returned game so the renderer never holds a stale tree.
 */

import { api, type EditResult } from "./api";
import { useDocumentStore } from "../../store/document-store";
import { useToastStore } from "../../store/toast-store";

/** How long a refusal stays up: long enough to read and act on. */
const REFUSAL_TOAST_MS = 5000;

/** Run one edit call; true when it applied. Refusals show in the toast. */
export async function runEdit(call: Promise<unknown>): Promise<boolean> {
  const res = (await call) as EditResult;
  if (res.ok) {
    useDocumentStore.getState().refreshGame(res.game);
    return true;
  }
  useToastStore.getState().show(res.message, REFUSAL_TOAST_MS);
  return false;
}

export function editSetComment(nodeId: string, prose: string): Promise<boolean> {
  const i = useDocumentStore.getState().gameIndex;
  return runEdit(api().setComment(i, nodeId, prose));
}

export function editSetNags(nodeId: string, nags: number[]): Promise<boolean> {
  const i = useDocumentStore.getState().gameIndex;
  return runEdit(api().setNags(i, nodeId, nags));
}

export function editPromoteVariation(nodeId: string): Promise<boolean> {
  const i = useDocumentStore.getState().gameIndex;
  return runEdit(api().promoteVariation(i, nodeId));
}

export function editDeleteFromHere(nodeId: string): Promise<boolean> {
  const i = useDocumentStore.getState().gameIndex;
  return runEdit(api().deleteFromHere(i, nodeId));
}

export function editSetResult(result: string): Promise<boolean> {
  const i = useDocumentStore.getState().gameIndex;
  return runEdit(api().setResult(i, result));
}

/** Copy the whole game's PGN (raw bytes for clean games, re-serialization
 *  for dirty ones — the main process decides). */
export async function copyGamePgn(): Promise<void> {
  const i = useDocumentStore.getState().gameIndex;
  const text = (await api().docGameText(i)) as string;
  await navigator.clipboard.writeText(text);
  useToastStore.getState().show("PGN copied");
}

/**
 * The id a promoted node lands on: promotion swaps the innermost variation
 * containing the node with its parent line, so the last non-mainline step
 * of the id becomes "00" and everything below is unchanged.
 */
export function promotedId(id: string): string {
  for (let i = id.length - 2; i >= 0; i -= 2) {
    if (id.slice(i, i + 2) !== "00") {
      return id.slice(0, i) + "00" + id.slice(i + 2);
    }
  }
  return id;
}
