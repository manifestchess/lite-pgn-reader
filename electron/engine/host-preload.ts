/**
 * Preload for the hidden engine-host window.
 *
 * A sandboxed preload cannot `require` a sibling module at runtime, so this
 * is bundled by scripts/build-preload.mjs with its imports inlined. That is
 * what lets the channel names come from electron/constants.ts rather than a
 * hand-copied second set.
 */
import { contextBridge, ipcRenderer } from "electron";

import { ENGINE_HOST } from "../constants";

interface CreatePayload {
  sessionId: string;
  scriptUrl: string;
}
interface PostPayload {
  sessionId: string;
  line: string;
}
interface TerminatePayload {
  sessionId: string;
}

contextBridge.exposeInMainWorld("__engineHost", {
  /** Host → main, once the document has evaluated. */
  ready: (info: {
    crossOriginIsolated: boolean;
    hardwareConcurrency: number;
  }) => ipcRenderer.send(ENGINE_HOST.READY, info),

  /** Host → main: raw text from a worker, not necessarily whole lines. */
  output: (sessionId: string, text: string) =>
    ipcRenderer.send(ENGINE_HOST.OUTPUT, { sessionId, text }),

  /** Host → main: the worker could not start, or died. */
  failed: (sessionId: string, message: string) =>
    ipcRenderer.send(ENGINE_HOST.FAILED, { sessionId, message }),

  onCreate: (cb: (p: CreatePayload) => void) =>
    ipcRenderer.on(ENGINE_HOST.CREATE, (_e, p: CreatePayload) => cb(p)),
  onPost: (cb: (p: PostPayload) => void) =>
    ipcRenderer.on(ENGINE_HOST.POST, (_e, p: PostPayload) => cb(p)),
  onTerminate: (cb: (p: TerminatePayload) => void) =>
    ipcRenderer.on(ENGINE_HOST.TERMINATE, (_e, p: TerminatePayload) => cb(p)),
});
