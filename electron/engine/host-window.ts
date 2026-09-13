/**
 * Owns the hidden, cross-origin-isolated window that runs WASM engines. One
 * window hosts every session, created lazily on the first engine request —
 * never during launch — and torn down when the last session is disposed or
 * the app quits. Its `isolated` flag reports whether multi-threading is
 * actually available, which picks between the engine builds.
 *
 * The host always loads from the pgnreader:// protocol handler (there is no
 * dev server): app-protocol.ts sets COOP/COEP on /engine-host/ and
 * /stockfish/, which is what makes the document cross-origin isolated and
 * gives it SharedArrayBuffer.
 */
import path from "path";

import { BrowserWindow, ipcMain } from "electron";

import { APP_ORIGIN, ENGINE_HOST } from "../constants";

/** What the host reports about itself once its document has evaluated. */
export interface HostCapabilities {
  /** True when SharedArrayBuffer is available, so multi-threaded WASM runs. */
  isolated: boolean;
  hardwareConcurrency: number;
  /** Origin the host is served from, for building worker script URLs. */
  origin: string;
}

/** How long the host gets to load its script and report in. */
export const HOST_READY_TIMEOUT_MS = 15_000;

/**
 * Absolute document URL. The index.html is named explicitly rather than
 * relying on a directory index, so the served path is never ambiguous.
 */
export const ENGINE_HOST_URL = `${APP_ORIGIN}/engine-host/index.html`;

type OutputHandler = (sessionId: string, text: string) => void;
/**
 * A session has failed, or the host itself has. A null sessionId means
 * the host is gone and every session on it died with it, which no
 * per-session message could express: the host cannot name its sessions
 * once its renderer is no longer there to report them.
 */
type FailureHandler = (sessionId: string | null, message: string) => void;

let hostWindow: BrowserWindow | null = null;
let hostPromise: Promise<HostCapabilities> | null = null;
let capabilities: HostCapabilities | null = null;

const outputHandlers = new Set<OutputHandler>();
const failureHandlers = new Set<FailureHandler>();
let listenersBound = false;

/** Subscribe to raw engine output. Returns an unsubscribe function. */
export function onHostOutput(handler: OutputHandler): () => void {
  outputHandlers.add(handler);

  return () => outputHandlers.delete(handler);
}

/** Subscribe to session failures. Returns an unsubscribe function. */
export function onHostFailure(handler: FailureHandler): () => void {
  failureHandlers.add(handler);

  return () => failureHandlers.delete(handler);
}

/** True when `win` is the hidden engine host. Lets window-counting logic
 *  (the reopen dialog on activate) ignore it. */
export function isEngineHostWindow(win: BrowserWindow): boolean {
  return win === hostWindow;
}

function bindListeners() {
  if (listenersBound) return;
  listenersBound = true;

  // Only the host window's own renderer may speak on these channels: a
  // document window has no business posting engine output, and checking
  // the sender costs nothing.
  ipcMain.on(
    ENGINE_HOST.OUTPUT,
    (event, p: { sessionId: string; text: string }) => {
      if (!hostWindow || event.sender !== hostWindow.webContents) return;
      for (const handler of outputHandlers) handler(p.sessionId, p.text);
    },
  );

  ipcMain.on(
    ENGINE_HOST.FAILED,
    (event, p: { sessionId: string; message: string }) => {
      if (!hostWindow || event.sender !== hostWindow.webContents) return;
      for (const handler of failureHandlers) handler(p.sessionId, p.message);
    },
  );
}

/**
 * Create the host window if needed and resolve once its document reports in.
 * Readiness is a one-shot IPC message, not a poll: the document sends READY
 * last, and this resolves on it or rejects if the window dies first.
 */
export function ensureHost(): Promise<HostCapabilities> {
  if (capabilities) return Promise.resolve(capabilities);
  if (hostPromise) return hostPromise;

  bindListeners();

  hostPromise = (async () => {
    const win = new BrowserWindow({
      show: false,
      // Never surfaced to the user; skipTaskbar keeps it out of the switcher.
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, "host-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        // The engine can run for minutes while the app sits in the
        // background. Throttling a hidden window would stall analysis.
        backgroundThrottling: false,
      },
    });

    // Invisible and not something anybody can act on, so it has no
    // business in the Window menu's list of windows. A property rather
    // than a constructor option, which is the only place Electron
    // accepts it.
    win.excludedFromShownWindowsMenu = true;

    hostWindow = win;

    // Outlives the readiness handshake, unlike onDestroyed below. Without it
    // a host that dies after reporting ready leaves `capabilities` cached,
    // so every send() silently no-ops and the engine just stops answering.
    // Guarded on identity because destroyHost() may already have installed a
    // successor, and clearing its state would tear down a working host.
    win.on("closed", () => {
      if (hostWindow !== win) return;

      hostWindow = null;
      hostPromise = null;
      capabilities = null;
    });

    // A renderer crash is not a close: the window object survives and
    // isDestroyed() stays false, so send() keeps posting into a process
    // that is gone and every session it was running waits for a reply
    // that cannot come. Nothing else notices, because the only failure
    // signal the engine has is a message the dead renderer would have
    // had to send. Reported here as a session-less failure so the
    // manager can fail every session at once.
    win.webContents.on("render-process-gone", (_event, details) => {
      if (hostWindow !== win) return;

      hostWindow = null;
      hostPromise = null;
      capabilities = null;
      for (const handler of failureHandlers) {
        handler(null, `The engine process stopped (${details.reason}).`);
      }
      if (!win.isDestroyed()) win.destroy();
    });

    const ready = new Promise<HostCapabilities>((resolve, reject) => {
      // A missing or 404ing host.js loads fine and never runs, which would
      // otherwise leave every engine request pending in silence.
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Engine host did not report ready within ${HOST_READY_TIMEOUT_MS / 1000}s`,
          ),
        );
      }, HOST_READY_TIMEOUT_MS);

      const onReady = (
        event: Electron.IpcMainEvent,
        info: { crossOriginIsolated: boolean; hardwareConcurrency: number },
      ) => {
        if (event.sender !== win.webContents) return;
        cleanup();
        resolve({
          isolated: info.crossOriginIsolated,
          hardwareConcurrency: info.hardwareConcurrency,
          origin: APP_ORIGIN,
        });
      };

      const onDestroyed = () => {
        cleanup();
        reject(new Error("Engine host window closed before it was ready"));
      };

      const onFailLoad = (
        _e: Electron.Event,
        code: number,
        description: string,
      ) => {
        cleanup();
        reject(
          new Error(`Engine host failed to load: ${description} (${code})`),
        );
      };

      function cleanup() {
        clearTimeout(timer);
        ipcMain.removeListener(ENGINE_HOST.READY, onReady);
        // `webContents` is a native-backed getter that throws "Object has
        // been destroyed" rather than returning null, and one caller is the
        // `closed` handler, where the window is always gone. The listener
        // died with its WebContents anyway. `removeListener` on the window
        // is plain EventEmitter and stays safe after destruction.
        if (!win.isDestroyed()) {
          win.webContents.removeListener("did-fail-load", onFailLoad);
        }
        win.removeListener("closed", onDestroyed);
      }

      ipcMain.on(ENGINE_HOST.READY, onReady);
      win.webContents.on("did-fail-load", onFailLoad);
      win.on("closed", onDestroyed);
    });

    let caps: HostCapabilities;

    try {
      // Deliberately not awaited. The ready promise is the thing with a
      // deadline on it, and awaiting loadURL first put an unbounded wait
      // in front of that deadline: a load that never settles hangs here
      // while the timer fires into a promise nobody is watching yet.
      // Since hostPromise is only cleared when it rejects, that hang is
      // permanent and poisons every future engine in the app.
      //
      // Nothing is lost by not awaiting it: a load failure arrives as
      // did-fail-load, which rejects `ready` with a better message than
      // loadURL's own rejection carries.
      void win.loadURL(ENGINE_HOST_URL).catch(() => {
        // Reported through did-fail-load, which rejects `ready`.
      });

      caps = await ready;
    } catch (err) {
      // Every rejection path above leaves the BrowserWindow open, and the
      // next request overwrites `hostWindow`, so without this the old one is
      // unreachable and never closed. A leaked host is a live renderer that
      // may be running Stockfish workers.
      //
      // Claim `ready` first. When `loadURL` is what failed, `ready` is still
      // armed with its own `closed` listener, so destroying rejects it with
      // nobody awaiting, and Node reports an unhandled rejection naming the
      // destroy instead of `err`, which is the real failure.
      ready.catch(() => {});

      if (!win.isDestroyed()) win.destroy();
      if (hostWindow === win) hostWindow = null;

      throw err;
    }

    // Logged on success too: losing isolation costs roughly 15x the node
    // rate and is otherwise completely silent.
    console.log(
      `[engine-host] ready: isolated=${caps.isolated} cores=${caps.hardwareConcurrency}`,
    );

    if (!caps.isolated) {
      // A warning, not a failure: single-threaded still works. Loud because
      // the symptom is otherwise just "the engine got slower".
      console.warn(
        "[engine-host] Not cross-origin isolated. SharedArrayBuffer is " +
          "unavailable, so engines will run single-threaded.",
      );
    }

    capabilities = caps;

    return caps;
  })();

  hostPromise.catch(() => {
    // Let a later call retry from scratch rather than caching the rejection.
    hostPromise = null;
  });

  return hostPromise;
}

/** Whether the host has been created and reported in. */
export function hostCapabilities(): HostCapabilities | null {
  return capabilities;
}

function send(channel: string, payload: unknown) {
  if (!hostWindow || hostWindow.isDestroyed()) return;
  hostWindow.webContents.send(channel, payload);
}

/** Ask the host to create a Worker for a session. */
export function hostCreateWorker(sessionId: string, scriptUrl: string): void {
  send(ENGINE_HOST.CREATE, { sessionId, scriptUrl });
}

/** Send one UCI line to a session's Worker. */
export function hostPost(sessionId: string, line: string): void {
  send(ENGINE_HOST.POST, { sessionId, line });
}

/** Terminate a session's Worker. */
export function hostTerminate(sessionId: string): void {
  send(ENGINE_HOST.TERMINATE, { sessionId });
}

/**
 * Tear the host down. Called when the last session is disposed and on quit.
 * The output/failure handler sets survive on purpose (they are the
 * manager's stable subscriptions): a later ensureHost() must find them
 * still wired, or a re-enabled engine would boot, speak, and have nobody
 * listening.
 */
export function destroyHost(): void {
  if (hostWindow && !hostWindow.isDestroyed()) hostWindow.destroy();
  hostWindow = null;
  hostPromise = null;
  capabilities = null;
}
