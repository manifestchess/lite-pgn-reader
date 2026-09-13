/**
 * About and legal: the app is fully offline, with no accounts and no
 * analytics. The GPL notice and the bundled component list satisfy GPLv3
 * sections 4 and 6 for the exact artifacts the app conveys; the full
 * licence texts render in-app from the bundled copies.
 *
 * The app has no network entitlement, so URLs are shown as selectable
 * text rather than hyperlinks.
 */

import { useEffect, useState } from "react";

import { api } from "../../lib/renderer/api";
import { LicenceText } from "../legal/LicenceText";

/**
 * The engine entry names nmrugg/stockfish.js and Chess.com deliberately:
 * the bundled WebAssembly is that port, not upstream Stockfish, and GPLv3
 * section 6 requires source corresponding to what we actually ship.
 */
const BUNDLED = [
  {
    name: "Stockfish.js 18",
    licence: "GNU General Public License v3",
    role: "Chess engine, compiled to WebAssembly and run locally. Copyright Chess.com, LLC and the Stockfish authors.",
    sourceUrl: "github.com/nmrugg/stockfish.js",
  },
  {
    name: "chessops",
    licence: "GNU General Public License v3",
    role: "Move generation, SAN and FEN handling.",
    sourceUrl: "github.com/niklasf/chessops",
  },
  {
    name: "Chessground",
    licence: "GNU General Public License v3",
    role: "Board rendering and piece interaction.",
    sourceUrl: "github.com/lichess-org/chessground",
  },
  {
    name: "Electron",
    licence: "MIT",
    role: "Application runtime.",
    sourceUrl: "github.com/electron/electron",
  },
];

interface AppInfo {
  name: string;
  version: string;
  electron: string;
}

export function AboutSettings(): React.ReactElement {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let alive = true;

    void api()
      .appInfo()
      .then((i) => {
        if (alive) setInfo(i as AppInfo);
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col items-center gap-2 py-2 text-center">
        <h2 className="text-lg font-bold text-txt-clear">
          {info?.name ?? "Manifest Chess Lite"}
        </h2>
        <p className="text-[13px] text-txt-dim">
          {info ? `Version ${info.version} · Electron ${info.electron}` : "..."}
        </p>
        <p className="max-w-sm text-[13px] leading-relaxed text-txt-dim">
          A fast, careful reader for a single PGN file. Your files never
          leave this Mac: the app makes no network connections, has no
          account, and collects nothing.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-txt-clear">Licenses</h3>
          {/*
            Licence terms, not marketing copy: the grant is "v3 or later",
            the entries below cover the bundled components, and source for
            Manifest Chess Lite itself is offered from www.manifestchess.com.
          */}
          <p className="mt-1 text-[13px] leading-relaxed text-txt-dim">
            Manifest Chess Lite is free software under the GNU General
            Public License v3 or later. Source is available from
            www.manifestchess.com. It includes the open source components below,
            each with its own source and licence, readable in full here:
          </p>
          <LicenceText />
        </div>

        <ul className="flex flex-col gap-3">
          {BUNDLED.map((item) => (
            <li
              key={item.name}
              className="flex flex-col gap-1 rounded-lg bg-low/40 px-3 py-2.5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium text-txt-clear">
                  {item.name}
                </span>
                <span className="shrink-0 text-[11px] text-txt-dimmer">
                  {item.licence}
                </span>
              </div>
              <p className="text-[12px] leading-relaxed text-txt-dim">
                {item.role}
              </p>
              <p className="select-text text-[12px] text-txt-dimmer">
                {item.sourceUrl}
              </p>
            </li>
          ))}
        </ul>

        <p className="text-[12px] leading-relaxed text-txt-dimmer">
          Bundled chess art, the figurine font, and the board sounds carry
          their own licences, listed under "Bundled assets and their
          licences" above.
        </p>
      </section>
    </div>
  );
}
