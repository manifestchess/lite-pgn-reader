/**
 * One engine session: the UCI state machine. The single place engine state
 * is tracked, so no consumer can forget to apply the user's Threads and Hash
 * settings.
 *
 * Two rules keep this honest:
 *   - The engine is only ever sent a new search while it is idle. Every
 *     transition that needs the engine to stop first goes through `pending`,
 *     never through a timer.
 *   - `isready` is tracked with a FIFO of waiters, because `readyok` is
 *     emitted both after the handshake and after every option change, and
 *     nothing in the protocol distinguishes them.
 */
import { randomUUID } from "crypto";

import {
  ENGINE_STATE,
  type EngineInfo,
  type EngineState,
  type GoParams,
  type UciOption,
  type UciOptionValues,
} from "../../types/engine";

import {
  UCI_CMD,
  parseBestMove,
  parseIdName,
  parseInfoLine,
  parseOptionLine,
  sideToMoveFromFen,
  splitLines,
  type SideToMove,
} from "./uci";

/** How long an engine gets to answer `uci` before we call it broken. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * How often coalesced info is flushed to the renderer. Not about throughput:
 * measured line rates are around 9/s for WASM at MultiPV 5. It is about not
 * waking React more often than a frame.
 */
export const INFO_FLUSH_MS = 60;

/** What the engine transport must provide. It is the WASM worker in the
 *  engine host window; this small interface keeps the worker wiring behind
 *  one seam. */
export interface EngineTransport {
  send(line: string): void;
  dispose(): void;
}

/** Creates a transport already wired to this session's callbacks. */
export type TransportFactory = (
  sessionId: string,
  handlers: {
    onChunk(text: string): void;
    onError(message: string): void;
  },
) => Promise<EngineTransport>;

export interface SessionEvents {
  onInfo(sessionId: string, batch: EngineInfo[]): void;
  onBestMove(sessionId: string, bestMove: string | null): void;
  onState(sessionId: string, state: EngineState): void;
  onError(sessionId: string, message: string): void;
}

export class EngineSession {
  readonly id: string;
  readonly engineId: string;

  private transport: EngineTransport | null = null;
  private state: EngineState = ENGINE_STATE.IDLE;

  /** Reassembly buffer: transports deliver chunks, not lines. */
  private carry = "";

  /** Options advertised by the engine, captured during the handshake. */
  private advertised: UciOption[] = [];
  private engineName: string | null = null;

  /** Values we have applied, so a later partial update can be merged. */
  private applied: UciOptionValues = {};

  /** FIFO of things waiting on the next `readyok`. */
  private readyWaiters: Array<() => void> = [];

  /** A search requested while the engine was busy. */
  private pending: { fen: string; go: GoParams } | null = null;
  /** Options requested while the engine was busy. */
  private pendingOptions: UciOptionValues | null = null;
  /** Button-type options pressed while the engine was busy. */
  private pendingButtons: string[] = [];

  /** Perspective for the search in flight, so scores flip correctly. */
  private sideToMove: SideToMove = "w";

  /** Latest info per multipv index, flushed on a timer. */
  private infoBuffer = new Map<number, EngineInfo>();
  private flushTimer: NodeJS.Timeout | null = null;

  private disposed = false;

  constructor(
    engineId: string,
    private readonly events: SessionEvents,
  ) {
    this.id = randomUUID();
    this.engineId = engineId;
  }

  getState(): EngineState {
    return this.state;
  }

  getCapabilities(): UciOption[] {
    return this.advertised;
  }

  getEngineName(): string | null {
    return this.engineName;
  }

  /**
   * Resolves once the engine has answered `uciok` and then `readyok` with
   * the initial options applied. Rejects if it never answers, rather than
   * leaving the caller hanging.
   */
  async start(
    factory: TransportFactory,
    initialOptions: UciOptionValues,
  ): Promise<void> {
    this.setState(ENGINE_STATE.INITIALIZING);

    this.transport = await factory(this.id, {
      onChunk: (text) => this.ingest(text),
      onError: (message) => this.fail(message),
    });

    const handshake = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            "This engine did not respond to the UCI handshake within " +
              `${HANDSHAKE_TIMEOUT_MS / 1000} seconds.`,
          ),
        );
      }, HANDSHAKE_TIMEOUT_MS);

      this.handshakeResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      this.handshakeReject = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };
    });

    this.applied = { ...initialOptions };
    this.send(UCI_CMD.UCI);

    return handshake;
  }

  private handshakeResolve: (() => void) | null = null;
  private handshakeReject: ((err: Error) => void) | null = null;

  /** Apply option values. Safe to call at any time. */
  setOptions(values: UciOptionValues): void {
    if (this.disposed) return;
    this.applied = { ...this.applied, ...values };

    if (this.state === ENGINE_STATE.ANALYZING) {
      this.pendingOptions = { ...(this.pendingOptions ?? {}), ...values };
      this.stop();

      return;
    }
    if (this.state === ENGINE_STATE.STOPPING) {
      this.pendingOptions = { ...(this.pendingOptions ?? {}), ...values };

      return;
    }
    if (this.state === ENGINE_STATE.READY) {
      this.applyOptions(values);
      this.expectReadyok(() => {});
    }
  }

  /**
   * Queue the handler and only then ask. A transport that answers
   * synchronously, as a test engine can, delivers `readyok` from inside
   * `send()`; pushing the waiter afterwards drops the reply and the session
   * waits forever on a handshake that already completed.
   */
  private expectReadyok(handler: () => void): void {
    this.readyWaiters.push(handler);
    this.send(UCI_CMD.IS_READY);
  }

  /**
   * Press a button-type option, such as "Clear Hash". Waits for the engine
   * to be idle: an engine mid-search silently ignores setoption, which looks
   * to the user like the button doing nothing.
   */
  pressButton(name: string): void {
    if (this.disposed) return;

    if (this.state === ENGINE_STATE.READY) {
      this.send(UCI_CMD.pressButton(name));

      return;
    }

    this.pendingButtons.push(name);
    if (this.state === ENGINE_STATE.ANALYZING) this.stop();
  }

  /**
   * Analyze a position, replacing whatever search is running. When busy this
   * records the intent and stops; the search starts from the `bestmove`
   * handler. A newer request overwrites the pending one, so rapid arrow-key
   * navigation collapses to the last position instead of queueing a search
   * per keypress.
   */
  analyze(fen: string, go: GoParams): void {
    if (this.disposed) return;

    if (
      this.state === ENGINE_STATE.ANALYZING ||
      this.state === ENGINE_STATE.STOPPING
    ) {
      this.pending = { fen, go };
      if (this.state === ENGINE_STATE.ANALYZING) this.stop();

      return;
    }

    if (this.state === ENGINE_STATE.READY) {
      this.beginSearch(fen, go);

      return;
    }

    // Still initializing: run it as soon as the handshake lands.
    this.pending = { fen, go };
  }

  /** Halt the current search. The engine still emits `bestmove`. */
  stop(): void {
    if (this.state !== ENGINE_STATE.ANALYZING) return;
    this.setState(ENGINE_STATE.STOPPING);
    this.send(UCI_CMD.STOP);
  }

  /** Stop, quit, and release the transport. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearFlush();
    this.pending = null;
    this.pendingOptions = null;
    this.pendingButtons = [];
    this.readyWaiters = [];
    try {
      this.send(UCI_CMD.STOP);
      this.send(UCI_CMD.QUIT);
    } catch {
      // Transport may already be gone.
    }
    this.transport?.dispose();
    this.transport = null;
    this.setState(ENGINE_STATE.TERMINATED);
  }

  // ── Internals ───────────────────────────────────────────────────────

  private send(line: string): void {
    this.transport?.send(line);
  }

  private setState(next: EngineState): void {
    if (this.state === next) return;
    this.state = next;
    this.events.onState(this.id, next);
  }

  private flushButtons(): void {
    const names = this.pendingButtons;

    this.pendingButtons = [];
    for (const name of names) this.send(UCI_CMD.pressButton(name));
  }

  private applyOptions(values: UciOptionValues): void {
    for (const [name, value] of Object.entries(values)) {
      this.send(UCI_CMD.setOption(name, value));
    }
  }

  private beginSearch(fen: string, go: GoParams): void {
    this.sideToMove = sideToMoveFromFen(fen);
    this.infoBuffer.clear();
    this.setState(ENGINE_STATE.ANALYZING);
    this.send(UCI_CMD.position(fen));
    this.send(UCI_CMD.go(go));
  }

  private ingest(text: string): void {
    const { lines, carry } = splitLines(text, this.carry);

    this.carry = carry;
    for (const line of lines) this.handleLine(line);
  }

  private handleLine(line: string): void {
    if (this.disposed) return;

    // Handshake: collect identity and capabilities until uciok.
    if (this.state === ENGINE_STATE.INITIALIZING) {
      const name = parseIdName(line);

      if (name) {
        this.engineName = name;

        return;
      }

      const option = parseOptionLine(line);

      if (option) {
        this.advertised.push(option);

        return;
      }

      if (line === "uciok") {
        this.applyOptions(this.applied);
        this.expectReadyok(() => {
          this.setState(ENGINE_STATE.READY);
          this.handshakeResolve?.();
          this.handshakeResolve = null;
          this.handshakeReject = null;
          this.drainPending();
        });

        return;
      }
    }

    if (line === "readyok") {
      const waiter = this.readyWaiters.shift();

      waiter?.();

      return;
    }

    if (line.startsWith("bestmove")) {
      this.handleBestMove(line);

      return;
    }

    if (line.startsWith("info")) {
      const info = parseInfoLine(line, this.sideToMove);

      if (info) this.bufferInfo(info);
    }
  }

  private handleBestMove(line: string): void {
    const best = parseBestMove(line);

    this.flushInfo();

    // Queued options apply now that the engine is idle, and the queued
    // search waits on the resulting readyok so it cannot race them. Options
    // can ALSO land during that readyok wait (state is still STOPPING, so
    // setOptions queues them expecting a bestmove that already came) — the
    // waiter re-checks and flushes again before releasing the search, else
    // the session restarts on the intermediate value and the newest change
    // never reaches the engine (e.g. MultiPV 1→2→3 in two quick steps
    // would strand the live session on 2).
    if (this.pendingOptions || this.pendingButtons.length > 0) {
      const flushAndRelease = (): void => {
        const values = this.pendingOptions;

        this.pendingOptions = null;
        if (values) this.applyOptions(values);
        this.flushButtons();
        this.expectReadyok(() => {
          if (this.pendingOptions || this.pendingButtons.length > 0) {
            flushAndRelease();

            return;
          }
          this.setState(ENGINE_STATE.READY);
          this.drainPending();
        });
      };

      flushAndRelease();
      this.events.onBestMove(this.id, best);

      return;
    }

    this.setState(ENGINE_STATE.READY);
    this.events.onBestMove(this.id, best);
    this.drainPending();
  }

  private drainPending(): void {
    if (this.disposed) return;
    const next = this.pending;

    if (!next) return;
    this.pending = null;
    this.beginSearch(next.fen, next.go);
  }

  private bufferInfo(info: EngineInfo): void {
    this.infoBuffer.set(info.multipv, info);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushInfo();
    }, INFO_FLUSH_MS);
  }

  private flushInfo(): void {
    this.clearFlush();
    if (this.infoBuffer.size === 0) return;
    const batch = Array.from(this.infoBuffer.values()).sort(
      (a, b) => a.multipv - b.multipv,
    );

    this.infoBuffer.clear();
    this.events.onInfo(this.id, batch);
  }

  private clearFlush(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private fail(message: string): void {
    if (this.disposed) return;
    this.handshakeReject?.(new Error(message));
    this.handshakeResolve = null;
    this.handshakeReject = null;
    this.events.onError(this.id, message);
    this.setState(ENGINE_STATE.TERMINATED);
  }
}
