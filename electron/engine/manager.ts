/**
 * Owns every engine session in the application. One window per document:
 * results are pushed to the WebContents that created the session, not to a
 * single global renderer.
 *
 * The renderer never creates a Worker: it asks for a session id and
 * receives coalesced results over IPC. Only the bundled WASM engine runs,
 * inside the engine host window.
 *
 * Lifecycle: the engine host window spawns lazily on the first session
 * request, never during launch. When the last session is disposed the host
 * window is destroyed too, so an idle app holds no hidden renderer;
 * `prewarmEngineHost` lets the integration layer boot it early, after first
 * paint, on idle.
 */
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";

import { IPC_ENGINE } from "../constants";
import {
  type EngineDescriptor,
  type EngineInfo,
  type EngineState,
  type GoParams,
  type UciOptionValues,
  type UciOption,
  GO_MODE,
} from "../../types/engine";

import { bundledDescriptors, isBundledEngine, scriptFor } from "./bundled";
import {
  destroyHost,
  ensureHost,
  hostCreateWorker,
  hostPost,
  hostTerminate,
  onHostFailure,
  onHostOutput,
} from "./host-window";
import {
  EngineSession,
  type EngineTransport,
  type SessionEvents,
} from "./session";

interface Wiring {
  onChunk(text: string): void;
  onError(message: string): void;
}

/** Per-session callbacks, so host output can be routed to the right session. */
const wiring = new Map<string, Wiring>();
const sessions = new Map<string, EngineSession>();
/** Where each session's events go: the window that created it. */
const sinks = new Map<string, WebContents>();
/** Sessions per window, so one `destroyed` listener covers them all. */
const sinkSessions = new Map<WebContents, Set<string>>();

/**
 * A window that closes without unmounting cleanly (crash, force close) must
 * not leave its engine searching forever. One listener per window, however
 * many sessions it opens over its life, so toggling analysis on and off
 * never piles `destroyed` listeners onto the WebContents.
 */
function trackSink(sink: WebContents, sessionId: string): void {
  let set = sinkSessions.get(sink);

  if (!set) {
    set = new Set();
    sinkSessions.set(sink, set);
    sink.once("destroyed", () => {
      const ids = sinkSessions.get(sink);

      sinkSessions.delete(sink);
      if (ids) for (const id of ids) disposeSession(id);
    });
  }
  set.add(sessionId);
}

let hostSubscribed = false;
/** Creates in flight, so the host is not torn down under a booting session. */
let createsInFlight = 0;

function subscribeHost(): void {
  if (hostSubscribed) return;
  hostSubscribed = true;

  onHostOutput((sessionId, text) => wiring.get(sessionId)?.onChunk(text));
  onHostFailure((sessionId, message) => {
    // Host-wide: fail everything it was running. Without this each
    // session waits forever for an engine whose process is gone.
    if (sessionId === null) {
      for (const entry of [...wiring.values()]) entry.onError(message);

      return;
    }
    wiring.get(sessionId)?.onError(message);
  });
}

function push(sessionId: string, channel: string, payload: unknown): void {
  const target = sinks.get(sessionId);

  if (!target || target.isDestroyed()) return;
  target.send(channel, payload);
}

const events: SessionEvents = {
  onInfo: (sessionId, batch: EngineInfo[]) =>
    push(sessionId, IPC_ENGINE.INFO, { sessionId, batch }),
  onBestMove: (sessionId, bestMove) =>
    push(sessionId, IPC_ENGINE.BESTMOVE, { sessionId, bestMove }),
  onState: (sessionId, state: EngineState) =>
    push(sessionId, IPC_ENGINE.STATE, { sessionId, state }),
  onError: (sessionId, message) =>
    push(sessionId, IPC_ENGINE.ERROR, { sessionId, message }),
};

/**
 * Engines this build can run. Boots the host first because availability
 * depends on whether it achieved cross-origin isolation: the full Stockfish
 * build has no single-threaded variant, so without isolation it must not be
 * offered at all. Callers therefore must not invoke this on the launch
 * path — the renderer asks only once analysis is first enabled.
 */
export async function listEngines(): Promise<EngineDescriptor[]> {
  subscribeHost();

  try {
    const caps = await ensureHost();

    return bundledDescriptors(caps.isolated);
  } catch {
    // The host could not start at all. Report the conservative view rather
    // than throwing, so the UI can still render something.
    return bundledDescriptors(false);
  } finally {
    maybeReleaseHost();
  }
}

export interface CreatedSession {
  sessionId: string;
  /** The engine's own reported name, which can differ from the catalog name. */
  engineName: string | null;
  /** Options the engine advertises, for capability-driven settings UI. */
  capabilities: UciOption[];
  /** False when the host window could not be isolated, so threads are capped. */
  multiThreaded: boolean;
}

/**
 * Boot an engine and complete its handshake. Rejects rather than hanging
 * when the engine never answers.
 */
export async function createSession(
  engineId: string,
  initialOptions: UciOptionValues,
  sink: WebContents,
): Promise<CreatedSession> {
  if (!isBundledEngine(engineId)) {
    throw new Error(`Unknown engine: ${engineId}`);
  }

  subscribeHost();
  createsInFlight++;

  try {
    const caps = await ensureHost();
    const script = scriptFor(engineId, caps.isolated);

    if (!script) {
      throw new Error(
        "This engine needs multi-threading, which is unavailable on this " +
          "system. Choose Stockfish 18 Lite instead.",
      );
    }

    const session = new EngineSession(engineId, events);
    const scriptUrl = `${caps.origin}${script}`;

    const factory = async (
      sessionId: string,
      handlers: Wiring,
    ): Promise<EngineTransport> => {
      // Register the routing before the worker exists, so output that
      // arrives immediately after creation is not dropped.
      wiring.set(sessionId, handlers);
      hostCreateWorker(sessionId, scriptUrl);

      return {
        send: (line: string) => hostPost(sessionId, line),
        dispose: () => {
          hostTerminate(sessionId);
          wiring.delete(sessionId);
        },
      };
    };

    // Events can arrive from the instant the worker exists.
    sinks.set(session.id, sink);

    try {
      await session.start(factory, initialOptions);
    } catch (err) {
      // A failed handshake must not leave a worker running in the host.
      session.dispose();
      wiring.delete(session.id);
      sinks.delete(session.id);
      throw err;
    }

    sessions.set(session.id, session);
    trackSink(sink, session.id);
    // The sink can die DURING the handshake await above; its "destroyed"
    // event then fired before trackSink listened, and nothing would ever
    // reap the session — the host window would live forever with a phantom
    // session count. Reap it here instead.
    if (sink.isDestroyed()) {
      disposeSession(session.id);
      throw new Error("window closed while the engine session was starting");
    }

    return {
      sessionId: session.id,
      engineName: session.getEngineName(),
      capabilities: session.getCapabilities(),
      multiThreaded: caps.isolated,
    };
  } finally {
    createsInFlight--;
    maybeReleaseHost();
  }
}

function require_(sessionId: string): EngineSession | null {
  return sessions.get(sessionId) ?? null;
}

export function analyze(sessionId: string, fen: string, go: GoParams): void {
  require_(sessionId)?.analyze(fen, go);
}

export function stop(sessionId: string): void {
  require_(sessionId)?.stop();
}

export function pressButton(sessionId: string, name: string): void {
  require_(sessionId)?.pressButton(name);
}

export function setOptions(sessionId: string, values: UciOptionValues): void {
  require_(sessionId)?.setOptions(values);
}

export function disposeSession(sessionId: string): void {
  const session = sessions.get(sessionId);

  if (!session) return;
  sessions.delete(sessionId);
  const sink = sinks.get(sessionId);

  if (sink) sinkSessions.get(sink)?.delete(sessionId);
  sinks.delete(sessionId);
  session.dispose();
  maybeReleaseHost();
}

/**
 * With no sessions left and none booting, the hidden host window has no
 * reason to exist: destroy it so an idle app carries no extra renderer.
 * Turning analysis back on pays the (lazy, sub-second) boot again, which is
 * the honest price of not idling a Chromium process.
 */
function maybeReleaseHost(): void {
  if (sessions.size === 0 && createsInFlight === 0) destroyHost();
}

/**
 * Boot the host window ahead of the first analysis request. For the
 * integration layer to call once the document window is interactive (post
 * first paint, on idle) — never on the launch path. Best-effort: a failure
 * here surfaces later, on the real request, with a real message.
 */
export function prewarmEngineHost(): void {
  subscribeHost();
  void ensureHost().catch(() => {
    /* the real createSession reports the failure with context */
  });
}

/** Payload shape guard for values crossing the IPC boundary. */
function asOptionValues(raw: unknown): UciOptionValues {
  if (typeof raw !== "object" || raw === null) return {};
  const out: UciOptionValues = {};

  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      out[k] = v;
    }
  }

  return out;
}

function asGoParams(raw: unknown): GoParams {
  if (typeof raw === "object" && raw !== null) {
    const { mode, value } = raw as { mode?: unknown; value?: unknown };
    const modes = Object.values(GO_MODE) as string[];

    if (typeof mode === "string" && modes.includes(mode)) {
      return {
        mode: mode as GoParams["mode"],
        ...(typeof value === "number" && Number.isFinite(value)
          ? { value }
          : {}),
      };
    }
  }

  return { mode: GO_MODE.INFINITE };
}

/** Register the engine IPC surface. Called once from main. */
export function registerEngineHandlers(): void {
  ipcMain.handle(IPC_ENGINE.LIST, () => listEngines());

  ipcMain.handle(
    IPC_ENGINE.CREATE_SESSION,
    async (event: IpcMainInvokeEvent, engineId: unknown, opts: unknown) => {
      try {
        const session = await createSession(
          String(engineId),
          asOptionValues(opts),
          event.sender,
        );

        return { ok: true as const, session };
      } catch (err) {
        return {
          ok: false as const,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(IPC_ENGINE.DISPOSE_SESSION, (_e, sessionId: unknown) => {
    disposeSession(String(sessionId));
  });

  ipcMain.handle(
    IPC_ENGINE.SET_OPTIONS,
    (_e, sessionId: unknown, values: unknown) => {
      setOptions(String(sessionId), asOptionValues(values));
    },
  );

  ipcMain.handle(
    IPC_ENGINE.ANALYZE,
    (_e, sessionId: unknown, fen: unknown, go: unknown) => {
      analyze(String(sessionId), String(fen), asGoParams(go));
    },
  );

  ipcMain.handle(IPC_ENGINE.STOP, (_e, sessionId: unknown) => {
    stop(String(sessionId));
  });

  ipcMain.handle(
    IPC_ENGINE.PRESS_BUTTON,
    (_e, sessionId: unknown, name: unknown) => {
      pressButton(String(sessionId), String(name));
    },
  );

  ipcMain.handle(IPC_ENGINE.PREWARM, () => {
    prewarmEngineHost();
  });
}

/**
 * Called on `before-quit`. An engine left on `go infinite` after the app
 * exits is a leaked worker eating a core; after this, no engine host
 * window remains.
 */
export function disposeAllEngineSessions(): void {
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
  sinks.clear();
  sinkSessions.clear();
  wiring.clear();
  destroyHost();
}
