/**
 * Welcome / no-document screen. Runs in its OWN window (loaded with
 * ?view=welcome) with no bound document, so it never touches the document
 * lifecycle. Shown on launch with no file and after the last document window
 * closes. Two ways in: the native picker and drag-and-drop.
 */

import { useState } from "react";

import { api } from "../../lib/renderer/api";

export function WelcomeScreen(): React.ReactElement {
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const filePath = api().getPathForFile(file);
    if (filePath) void api().openPathFromWelcome(filePath);
  };

  return (
    <div
      className="drag-region flex h-screen w-screen flex-col items-center justify-center gap-8 bg-page px-8 text-txt-clear"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className="no-drag flex flex-col items-center gap-3">
        <div aria-label="Manifest Chess Lite" role="img" className="brand-icon h-16 w-16" />
        <span className="text-lg font-semibold tracking-tight text-txt-clear">
          Manifest Chess Lite
        </span>
      </div>

      <div
        className={`no-drag flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-dashed p-8 transition-colors ${
          dragging ? "border-primary/60 bg-primary/5" : "border-line bg-box/40"
        }`}
      >
        <button
          className="cursor-pointer rounded-lg bg-primary px-5 py-2 text-sm font-medium text-page transition-opacity hover:opacity-90"
          onClick={() => void api().openFromWelcome()}
        >
          Open a PGN file…
        </button>
        <p className="text-xs text-txt-dimmer">or drop a .pgn here</p>
      </div>
    </div>
  );
}
