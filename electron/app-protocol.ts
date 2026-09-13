/**
 * The pgnreader:// scheme serving the packaged renderer and assets.
 *
 * Registered as standard+secure (secure context without claiming a real
 * scheme; SharedArrayBuffer for the engine host comes from COOP/COEP headers
 * on its routes). There is NO passthrough branch: anything outside the app
 * root is a 404 — an offline app never forwards a request anywhere.
 */

import fs from "node:fs";
import path from "node:path";
import { protocol } from "electron";

import { APP_HOST, APP_SCHEME } from "./constants";

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true,
        // V8 compiled-code cache for renderer scripts served over this
        // scheme: without it every cold launch re-parses and re-compiles
        // the whole renderer bundle.
        codeCache: true,
      },
    },
  ]);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** Paths that must be cross-origin isolated (WASM threads). */
const needsIsolation = (p: string): boolean =>
  p.startsWith("/stockfish/") || p.startsWith("/engine-host/");

/**
 * Serve from rootDir (the built renderer + public assets staged together).
 * Containment is double-checked: lexical join then a real-path prefix test.
 */
export function registerAppProtocol(rootDir: string): void {
  const realRoot = fs.realpathSync(rootDir);
  protocol.handle(APP_SCHEME, async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response("bad request", { status: 400 });
    }
    if (url.host !== APP_HOST) return new Response("not found", { status: 404 });
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response("bad request", { status: 400 });
    }
    if (pathname.includes("\0")) return new Response("bad request", { status: 400 });
    if (pathname === "/" || pathname === "") pathname = "/index.html";

    const candidate = path.join(realRoot, pathname);
    if (!candidate.startsWith(realRoot + path.sep) && candidate !== realRoot) {
      return new Response("not found", { status: 404 });
    }
    let real: string;
    try {
      real = fs.realpathSync(candidate);
    } catch {
      return new Response("not found", { status: 404 });
    }
    if (!real.startsWith(realRoot + path.sep) && real !== realRoot) {
      return new Response("not found", { status: 404 });
    }

    let data: Buffer;
    try {
      data = fs.readFileSync(real);
    } catch {
      return new Response("not found", { status: 404 });
    }
    const headers: Record<string, string> = {
      "content-type": MIME[path.extname(real).toLowerCase()] ?? "application/octet-stream",
    };
    if (needsIsolation(pathname)) {
      headers["Cross-Origin-Opener-Policy"] = "same-origin";
      headers["Cross-Origin-Embedder-Policy"] = "credentialless";
      headers["Cross-Origin-Resource-Policy"] = "cross-origin";
    }
    return new Response(data, { status: 200, headers });
  });
}
