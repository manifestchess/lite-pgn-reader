/**
 * Engine host: a dumb pipe between the main process and WASM engine Workers.
 *
 * Plain JavaScript with no build step, because it is a static asset served
 * from the isolated origin rather than part of the Next.js bundle. Keep it
 * dumb. Every decision, all UCI parsing, and the whole session state machine
 * belong in the main process, so this file stays small enough to be
 * obviously correct.
 */
(function () {
  "use strict";

  var bridge = window.__engineHost;

  if (!bridge) {
    // Without the preload there is no way to report anything, so this is the
    // one place a console error is the only available channel.
    // eslint-disable-next-line no-console
    console.error("[engine-host] preload bridge missing; engines cannot run");

    return;
  }

  /** sessionId -> Worker */
  var workers = Object.create(null);

  function terminate(sessionId) {
    var worker = workers[sessionId];

    if (!worker) return;
    delete workers[sessionId];
    try {
      // Ask politely first so the engine can release its threads, then stop
      // it regardless. terminate() alone can leave pthread workers behind.
      worker.postMessage("quit");
    } catch (e) {
      /* already gone */
    }
    try {
      worker.terminate();
    } catch (e) {
      /* already gone */
    }
  }

  bridge.onCreate(function (payload) {
    var sessionId = payload.sessionId;

    // Replacing a live session id would orphan the previous worker.
    terminate(sessionId);

    var worker;

    try {
      worker = new Worker(payload.scriptUrl);
    } catch (err) {
      bridge.failed(sessionId, "Failed to start engine: " + String(err));

      return;
    }

    workers[sessionId] = worker;

    worker.onmessage = function (event) {
      var data = event.data;
      var text = typeof data === "string" ? data : String(data);

      // Not necessarily whole lines. The main process reassembles.
      bridge.output(sessionId, text.endsWith("\n") ? text : text + "\n");
    };

    worker.onerror = function (event) {
      // A worker that fails to load reports an ErrorEvent with every field
      // empty, so a bare event.message is usually "". Say something useful
      // instead of forwarding an empty string.
      var detail = (event && event.message) || "";
      // Emscripten aborts throw plain objects; Chromium reports them as
      // "Uncaught [object Object]", which tells the user nothing. Name the
      // likely cause instead.
      if (detail.indexOf("[object Object]") !== -1) {
        detail = "the engine stopped unexpectedly (usually out of memory)";
      }
      var where = event && event.filename ? " (" + event.filename + ")" : "";

      bridge.failed(
        sessionId,
        detail
          ? "Engine worker error: " + detail + where
          : "Engine worker failed to load" + where,
      );
      delete workers[sessionId];
    };

    worker.onmessageerror = function () {
      bridge.failed(sessionId, "Engine sent a message that could not be read");
    };
  });

  bridge.onPost(function (payload) {
    var worker = workers[payload.sessionId];

    if (!worker) return;
    try {
      worker.postMessage(payload.line);
    } catch (err) {
      bridge.failed(payload.sessionId, "Failed to send to engine: " + String(err));
    }
  });

  bridge.onTerminate(function (payload) {
    terminate(payload.sessionId);
  });

  window.addEventListener("pagehide", function () {
    Object.keys(workers).forEach(terminate);
  });

  bridge.ready({
    // Reported so the main process can pick the multi-threaded build only
    // when it will actually work, and log loudly when isolation regresses.
    crossOriginIsolated: window.crossOriginIsolated === true,
    hardwareConcurrency: navigator.hardwareConcurrency || 4,
  });
})();
