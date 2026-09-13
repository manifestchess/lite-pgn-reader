/**
 * Manifest Chess Lite — main process.
 *
 * Document-based: one window per file (identity = realpath+inode; a second
 * open of the same identity focuses the existing window), native macOS
 * window tabbing via tabbingIdentifier, no network use anywhere. Launch is
 * the hot path: the file read + index starts the moment the path is known,
 * in parallel with window creation, since most of the launch time is spent
 * by Electron itself.
 */

// Perf instrumentation: an external timer sets PGNREADER_T0 to the wall-clock
// ms it captured immediately before spawning this process; marks print as
// `PERF <name> <ms since T0>` and are silent otherwise. This statement runs
// before the imports below only in source order — module loading itself is
// part of what the launch timing measures via T0.
const PERF_T0 = process.env.PGNREADER_T0 ? Number(process.env.PGNREADER_T0) : null;
// A sandboxed app launched the real way (LaunchServices, as Finder does) has
// no observable stdout, so a mark file inside the app container can be named
// via PGNREADER_PERF_FILE. Both sinks are dead unless PGNREADER_T0 is set.
const PERF_FILE = process.env.PGNREADER_PERF_FILE || null;
const perfMark = (name: string): void => {
  if (PERF_T0 === null) return;
  const line = `PERF ${name} ${Date.now() - PERF_T0}\n`;
  process.stdout.write(line);
  if (PERF_FILE) {
    try {
      (require("node:fs") as typeof import("node:fs")).appendFileSync(PERF_FILE, line);
    } catch {
      /* optional file side channel */
    }
  }
};
perfMark("main-js-start");

import path from "node:path";
import fs from "node:fs";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
} from "electron";

import { registerAppProtocol, registerAppScheme } from "./app-protocol";
import { APP_ORIGIN, IPC_APP, IPC_DOC, IPC_DOC_EVENT, MENU_ACTION } from "./constants";
import {
  DocumentHost,
  OpenRefusedError,
  pendingRecoveryFor,
  setRecoveryDir,
  type OpenRefusal,
} from "./documents";
import {
  bindDocument,
  bindPending,
  bindingFor,
  registerDocHandlers,
  setUiStatePersister,
  unbindDocument,
  unbindByWebContentsId,
  type DocBinding,
} from "./ipc-handlers";
import { registerEngineHandlers, disposeAllEngineSessions } from "./engine/manager";
import { isEngineHostWindow } from "./engine/host-window";

const APP_NAME = "Manifest Chess Lite";
app.name = APP_NAME;

// Packaged builds run under the OS App Sandbox on the MAS dist of Electron,
// whose port-rendezvous and helper-sandbox plumbing are built for exactly
// that. The `no-sandbox` switch must NOT be applied here: it derails the MAS
// dist's child-process bootstrap (children die in bootstrap_look_up).

// Isolated user data for tests: keeps e2e runs off the real profile and
// gives each its own single-instance lock. Honoured only outside packaged
// builds.
if (!app.isPackaged && process.env.PGNREADER_USER_DATA) {
  app.setPath("userData", process.env.PGNREADER_USER_DATA);
} else if (
  app.isPackaged &&
  process.env.PGNREADER_PROFILE &&
  /^[\w.-]+$/.test(process.env.PGNREADER_PROFILE)
) {
  // Fresh-profile knob for the packaged app: a bare NAME (no separators pass
  // the regex) relocated to a sibling of the default userData, still inside
  // the app's own sandbox container. Used to launch against a profile of
  // known state.
  app.setPath(
    "userData",
    path.join(app.getPath("userData"), "..", process.env.PGNREADER_PROFILE),
  );
}

// First touch of the sandbox container's filesystem pays a ~100ms warm-up.
// Touch it fire-and-forget NOW so the cost overlaps Electron's own init
// instead of the document open path.
void fs.promises.stat(app.getPath("userData")).catch(() => {});

const isPackaged = app.isPackaged;
const projectRoot = path.join(__dirname, "../..");
const rendererRoot = path.join(projectRoot, "dist", "renderer");

registerAppScheme();

// ---------------------------------------------------------------------------
// Window / document management
// ---------------------------------------------------------------------------

interface PendingOpen {
  filePath: string;
  host: DocumentHost | null;
  refusal: OpenRefusal | null;
  error: string | null;
}

const windowsByIdentity = new Map<string, BrowserWindow>();

// The welcome / no-document window (Open + drag-and-drop). Deliberately NOT a
// document window: it binds no DocumentHost, so it never touches the
// document close/host-teardown path.
let welcomeWindow: BrowserWindow | null = null;

/** Close the welcome window because a document is opening. Detaching the
 *  reference first makes its `closed` handler a no-op, so it does not quit. */
function dismissWelcome(): void {
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    const w = welcomeWindow;
    welcomeWindow = null;
    w.destroy();
  } else {
    welcomeWindow = null;
  }
}

function openWelcomeWindow(): void {
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    welcomeWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 720,
    height: 560,
    resizable: false,
    fullscreenable: false,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0d0d0d" : "#f5f0e8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  welcomeWindow = win;
  win.setTitle(APP_NAME);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    // Programmatic dismissal (a document is opening) already nulled the ref.
    if (welcomeWindow !== win) return;
    welcomeWindow = null;
    // The user closed the welcome with nothing else open: honour "the app
    // should just exit". setImmediate defers the quit so the current close
    // completes first, matching the ⌘Q teardown ordering.
    if (quitting || process.platform !== "darwin") return;
    const docs = BrowserWindow.getAllWindows().filter(
      (w) => !isEngineHostWindow(w) && !w.isDestroyed(),
    );
    if (docs.length === 0) {
      quitting = true;
      setImmediate(() => app.quit());
    }
  });
  void win.loadURL(`${APP_ORIGIN}/index.html?view=welcome`);
}
const identityKey = (filePath: string): string | null => {
  try {
    const st = fs.statSync(fs.realpathSync(filePath));
    return `${st.dev}:${st.ino}`;
  } catch {
    return null;
  }
};

function uiStatePath(key: string): string {
  return path.join(app.getPath("userData"), "ui-state", `${key.replace(/[^\w]/g, "_")}.json`);
}

function loadUiState(key: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(uiStatePath(key), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

setUiStatePersister((b: DocBinding) => {
  const key = `${b.host.identity.dev}:${b.host.identity.ino}`;
  try {
    fs.mkdirSync(path.dirname(uiStatePath(key)), { recursive: true });
    fs.writeFileSync(uiStatePath(key), JSON.stringify(b.uiState));
  } catch {
    /* state restoration is best-effort */
  }
});

/** Open (or focus) the document window for a path. The window is created
 *  FIRST; the read+index runs on the next tick so it races the renderer
 *  load instead of delaying the first frame — a synchronous open of a large
 *  file would otherwise block window creation for over a second. Early doc
 *  IPC awaits the host via bindPending. */
export function openDocumentWindow(filePath: string, allowOverCap = false): void {
  const key = identityKey(filePath);
  if (key) {
    const existing = windowsByIdentity.get(key);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      dismissWelcome();
      return;
    }
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 860,
    minHeight: 560,
    show: false,
    tabbingIdentifier: "pgnreader-document",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0d0d0d" : "#f5f0e8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  perfMark("window-created");
  win.setTitle(path.basename(filePath));
  win.representedFilename = filePath;
  if (key) windowsByIdentity.set(key, win);
  // A document is now on screen; tear down the welcome window if it was up.
  dismissWelcome();

  const hostReady = (async () => {
    // Off the window-creation tick; still synchronous CPU work in main (the
    // window paints and its renderer loads in parallel with this).
    await new Promise((r) => setImmediate(r));
    const pending: PendingOpen = { filePath, host: null, refusal: null, error: null };
    perfMark("open-start");
    // Interrupted-save recovery: offer the journal backup first.
    const backup = pendingRecoveryFor(filePath);
    perfMark("recovery-checked");
    if (backup) {
      const res = await dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["Restore Backup", "Keep Current File"],
        defaultId: 0,
        message: `An interrupted save left a backup of ${path.basename(filePath)}.`,
        detail: `The file on disk may be incomplete. Restore the backup made before that save?

Backup: ${backup}`,
      });
      if (res.response === 0) {
        try {
          fs.copyFileSync(backup, filePath);
        } catch (e) {
          await dialog.showMessageBox(win, {
            type: "error",
            message: "Could not restore the backup",
            detail: e instanceof Error ? e.message : String(e),
          });
        }
      }
      fs.rmSync(backup, { force: true });
    }
    const t0 = Date.now();
    try {
      pending.host = DocumentHost.open(filePath, allowOverCap);
      perfMark("document-indexed");
    } catch (e) {
      if (e instanceof OpenRefusedError) pending.refusal = e.refusal;
      else pending.error = e instanceof Error ? e.message : String(e);
    }
    const indexMs = Date.now() - t0;
    if (win.isDestroyed()) {
      pending.host?.close();
      return;
    }
    if (pending.host) {
      const b: DocBinding = {
        host: pending.host,
        filePath,
        window: win,
        uiState: key ? loadUiState(key) : {},
        refusal: null,
        indexMs,
      };
      bindDocument(b);
      app.addRecentDocument(filePath);
    } else {
      // Refusal window: the renderer shows the refusal screen; "open
      // anyway" re-enters through IPC below. Each refusal gets its OWN
      // placeholder host, because a shared one would close another window's
      // watcher.
      const b: DocBinding = {
        host: placeholderHost(),
        filePath,
        window: win,
        uiState: {},
        refusal: pending.refusal ?? {
          kind: "ioError",
          byteSize: 0,
          gameCount: null,
          detectedFormat: null,
          message: pending.error ?? "could not open the file",
        },
        indexMs,
      };
      bindDocument(b);
    }
  })();
  bindPending(win.webContents.id, hostReady);

  win.once("ready-to-show", () => {
    win.show();
    perfMark("window-shown");
  });
  void win.loadURL(`${APP_ORIGIN}/index.html`);

  win.on("close", (event) => {
    const b = bindingFor(win);
    if (!b || !b.host.doc.dirty) return;
    event.preventDefault();
    void (async () => {
      const res = await dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["Save", "Discard Changes", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        message: `Save changes to ${path.basename(b.filePath)}?`,
        detail: "Your annotations have not been saved.",
      });
      if (res.response === 2) {
        quitting = false; // cancelled: a later ⌘Q must start fresh
        return;
      }
      if (res.response === 0) {
        try {
          b.host.save();
        } catch (e) {
          quitting = false; // the user needs to deal with the error
          await dialog.showMessageBox(win, {
            type: "error",
            message: "Could not save",
            detail: e instanceof Error ? e.message : String(e),
          });
          return;
        }
      }
      const binding = unbindDocument(win);
      binding?.host.close();
      win.destroy();
      // Resume the ⌘Q this prompt interrupted — but on a LATER tick. Calling
      // app.quit() synchronously here re-enters window teardown while this
      // window is still unwinding its own close, which segfaults the main
      // process (EXC_BAD_ACCESS in NSWindow __close). setImmediate lets the
      // current close fully complete first.
      if (quitting) setImmediate(() => app.quit());
    })();
  });

  // Captured now, while the window is alive. By the time `closed` runs the
  // window is destroyed, and touching win.webContents there throws "Object
  // has been destroyed" out of the handler, which Electron reports as an
  // uncaught main-process exception. The document host then never closes,
  // so its file watcher leaks for the life of the app.
  const webContentsId = win.webContents.id;

  win.on("closed", () => {
    if (key && windowsByIdentity.get(key) === win) windowsByIdentity.delete(key);
    const binding = unbindByWebContentsId(webContentsId);
    binding?.host.close();
    // Last document window gone: release the prewarmed engine host too. A
    // prewarm-only host (analysis never toggled) has no session, so nothing
    // else ever destroys it — a hidden Chromium renderer would outlive
    // every document, and window-all-closed could never fire.
    const documentWindows = BrowserWindow.getAllWindows().filter(
      (w) => !isEngineHostWindow(w) && !w.isDestroyed(),
    );
    if (documentWindows.length === 0) disposeAllEngineSessions();
  });
}

function placeholderHost(): DocumentHost {
  // One fixed per-process path: refusal windows each open their own host
  // over it (watchers are per-host), and the litter is bounded to a single
  // empty file instead of one per refusal.
  const tmp = path.join(app.getPath("temp"), `pgnreader-empty-${process.pid}.pgn`);
  fs.writeFileSync(tmp, "");
  return DocumentHost.open(tmp);
}

/** Untitled document flow: a fresh empty .pgn in the user's Documents-like
 *  location is deliberately NOT auto-created; File→New prompts for where the
 *  file lives first (a document-based app edits real files). */
async function newDocument(): Promise<void> {
  const res = await dialog.showSaveDialog({
    title: "New PGN File",
    defaultPath: "untitled.pgn",
    filters: [{ name: "PGN", extensions: ["pgn"] }],
  });
  if (res.canceled || !res.filePath) return;
  fs.writeFileSync(res.filePath, "");
  openDocumentWindow(res.filePath);
}

let openDialogUp = false;
async function openViaDialog(): Promise<void> {
  // Dock clicks with no windows land here; without the guard every click
  // stacks another native dialog.
  if (openDialogUp) return;
  openDialogUp = true;
  const res = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "PGN", extensions: ["pgn"] }],
    securityScopedBookmarks: true,
  });
  openDialogUp = false;
  if (res.canceled) return;
  for (const p of res.filePaths) openDocumentWindow(p);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

const openQueue: string[] = [];
let readyForOpens = false;
let quitting = false;

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (readyForOpens) openDocumentWindow(filePath);
  else openQueue.push(filePath);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const pgns = argv.slice(1).filter((a) => a.toLowerCase().endsWith(".pgn"));
    for (const arg of pgns) openDocumentWindow(arg);
    if (pgns.length === 0) {
      // Plain relaunch: behave like a dock click — focus or offer Open.
      const documentWindows = BrowserWindow.getAllWindows().filter(
        (w) => !isEngineHostWindow(w),
      );
      if (documentWindows.length > 0) documentWindows[0]!.focus();
      else void openViaDialog();
    }
  });
}

function sendMenuAction(action: string): void {
  BrowserWindow.getFocusedWindow()?.webContents.send(IPC_DOC_EVENT.MENU_ACTION, action);
}

function buildMenu(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: APP_NAME,
      submenu: [
        { label: `About ${APP_NAME}`, click: () => sendMenuAction(MENU_ACTION.ABOUT) },
        { type: "separator" },
        {
          label: "Settings…",
          accelerator: "Command+,",
          click: () => sendMenuAction(MENU_ACTION.SETTINGS),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Game", accelerator: "Command+N", click: () => sendMenuAction(MENU_ACTION.NEW_GAME) },
        { label: "New File…", accelerator: "Shift+Command+N", click: () => void newDocument() },
        { label: "Open…", accelerator: "Command+O", click: () => void openViaDialog() },
        { role: "recentDocuments", submenu: [{ role: "clearRecentDocuments" }] },
        { type: "separator" },
        { label: "Save", accelerator: "Command+S", click: () => sendMenuAction(MENU_ACTION.SAVE) },
        {
          label: "Export Game…",
          accelerator: "Command+E",
          click: () => sendMenuAction(MENU_ACTION.EXPORT_GAME),
        },
        {
          label: "Copy Game PGN",
          accelerator: "Command+Shift+C",
          click: () => sendMenuAction(MENU_ACTION.COPY_PGN),
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        // Undo/Redo as menu actions rather than roles: the stock roles
        // intercept ⌘Z before the renderer sees it, so document undo (CST
        // snapshots) would never fire. The renderer routes back to native
        // undo when a text field has focus.
        {
          label: "Undo",
          accelerator: "CommandOrControl+Z",
          click: () => sendMenuAction(MENU_ACTION.UNDO),
        },
        {
          label: "Redo",
          accelerator: "Shift+CommandOrControl+Z",
          click: () => sendMenuAction(MENU_ACTION.REDO),
        },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]);
  Menu.setApplicationMenu(menu);
}

void app.whenReady().then(() => {
  perfMark("app-ready");
  // Interrupted-save backups belong in userData, not TMPDIR (macOS purges
  // TMPDIR on reboot — exactly when the backup matters).
  setRecoveryDir(path.join(app.getPath("userData"), "recovery"));
  registerAppProtocol(isPackaged ? path.join(process.resourcesPath, "renderer") : rendererRoot);
  registerDocHandlers();
  registerEngineHandlers();

  ipcMain.handle(IPC_APP.INFO, () => ({
    name: APP_NAME,
    // In development, app.getVersion() falls back to Electron's own version
    // when there is no packaged Info.plist. The package version is the truth
    // in both modes.
    version: app.isPackaged
      ? app.getVersion()
      : (JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
          version: string;
        }).version,
    electron: process.versions.electron,
  }));

  ipcMain.handle(IPC_APP.PERF_MARK, (_event, name: string) => {
    perfMark(String(name).replace(/[^\w-]/g, "").slice(0, 64));
    return PERF_T0 !== null; // gates the renderer's synthetic keystroke to timing runs
  });

  // The app itself has no network entitlement and never will; opening the
  // homepage hands an ALLOWLISTED https URL to the user's browser via
  // LaunchServices. Anything else is refused.
  ipcMain.handle(IPC_APP.OPEN_EXTERNAL, (_event, rawUrl: unknown) => {
    const url = typeof rawUrl === "string" ? rawUrl : "";
    const allowed = ["https://www.manifestchess.com", "https://www.manifestchess.com/"];
    if (!allowed.includes(url) && !url.startsWith("https://www.manifestchess.com/")) {
      return { ok: false };
    }
    void shell.openExternal(url);
    return { ok: true };
  });

  // Welcome-window actions. Both funnel through the normal document-open path
  // (which dismisses the welcome), so they carry no document-host state.
  ipcMain.handle(IPC_APP.WELCOME_OPEN, () => {
    void openViaDialog();
    return true;
  });
  ipcMain.handle(IPC_APP.WELCOME_OPEN_PATH, (_event, rawPath: unknown) => {
    const p = typeof rawPath === "string" ? rawPath : "";
    if (!p.toLowerCase().endsWith(".pgn")) return { ok: false };
    openDocumentWindow(p);
    return { ok: true };
  });

  ipcMain.handle(IPC_APP.READY, () => {
    readyForOpens = true;
    return true;
  });

  ipcMain.handle(IPC_DOC.OPEN_ANYWAY, (event) => {
    const senderWin = event.sender ? BrowserWindow.fromWebContents(event.sender) : null;
    const b = senderWin ? bindingFor(senderWin) : undefined;
    if (!b || !b.refusal) return { ok: false };
    const filePath = b.filePath;
    // Drop the identity claim FIRST: close() is asynchronous, so the dying
    // refusal window would otherwise still be in windowsByIdentity when
    // openDocumentWindow runs, get focused as "already open", and the user
    // would watch their window vanish with no document reopening.
    const key = identityKey(filePath);
    if (key && windowsByIdentity.get(key) === b.window) windowsByIdentity.delete(key);
    b.window.close();
    openDocumentWindow(filePath, true);
    return { ok: true };
  });

  // Menu AFTER the open kick: buildMenu sits on the window-creation path
  // otherwise, and nothing needs the menu before the first frame.

  // argv opens (dev launches, `open` CLI on some paths).
  for (const arg of process.argv.slice(1)) {
    if (arg.toLowerCase().endsWith(".pgn")) openQueue.push(arg);
  }

  readyForOpens = true;
  const queued = openQueue.splice(0);
  if (queued.length > 0) {
    for (const p of queued) openDocumentWindow(p);
  } else {
    // Launched with no file: present the welcome window rather than a bare
    // native dialog, so first launch has a home screen (Open + drag-and-drop).
    openWelcomeWindow();
  }
  if (process.platform === "darwin") setImmediate(() => buildMenu());

  app.on("activate", () => {
    // Dock click: focus the welcome if it is up, otherwise (no document
    // windows — the hidden engine host does not count) present the welcome.
    if (welcomeWindow && !welcomeWindow.isDestroyed()) {
      welcomeWindow.focus();
      return;
    }
    const documentWindows = BrowserWindow.getAllWindows().filter(
      (w) => !isEngineHostWindow(w),
    );
    if (documentWindows.length === 0) openWelcomeWindow();
  });
});

// MAS guideline 2.4.5(iii): ⌘Q must actually terminate. A dirty document's
// close prompt calls preventDefault, which CANCELS the whole quit in
// Electron — the flag lets the prompt's continuation resume it, and
// Cancel/save-failure clear it so a later ⌘Q starts fresh. Engine teardown
// runs on will-quit, not before-quit: before-quit fires even for quits that
// a prompt then cancels, which would silently kill every live analysis.
app.on("before-quit", () => {
  quitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    return;
  }
  // macOS keeps the app alive after the last document closes. Rather than sit
  // invisibly, bring up the welcome window. Skipped when quitting (⌘Q, or the
  // user closed the welcome itself) so it never loops open.
  if (quitting || welcomeWindow) return;
  setImmediate(() => {
    if (!quitting && BrowserWindow.getAllWindows().length === 0) openWelcomeWindow();
  });
});

app.on("will-quit", () => {
  disposeAllEngineSessions();
});
