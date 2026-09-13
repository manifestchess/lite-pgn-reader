/** Typed access to the preload bridge. */
import type { ElectronApi } from "../../electron/preload-api";
import type { DocSummary } from "../../electron/ipc-handlers";
import { unpackWireGame, type PackedWireGame } from "../../electron/wire";
import type { WireGame, WireNode, WireRow } from "../../electron/wire";

declare global {
  interface Window {
    electronAPI: ElectronApi;
  }
}

export const api = (): ElectronApi => window.electronAPI;

export type { DocSummary, PackedWireGame, WireGame, WireNode, WireRow };
export const unpackGame = unpackWireGame;
export type EditResult =
  | { ok: true; game: PackedWireGame; dirty: boolean }
  | { ok: false; message: string };

export const docSummary = (): Promise<DocSummary> =>
  api().docSummary() as Promise<DocSummary>;
export const docRows = (start: number, count: number): Promise<WireRow[]> =>
  api().docRows(start, count) as Promise<WireRow[]>;
export const docGame = async (i: number): Promise<WireGame> =>
  unpackWireGame((await api().docGame(i)) as PackedWireGame);
