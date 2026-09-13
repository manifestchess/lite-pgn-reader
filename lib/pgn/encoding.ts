/**
 * Encoding detection and total (byte-lossless) decoding for PGN files.
 *
 * The document's source of truth is bytes. Decoding exists only to put
 * glyphs on screen; every decoder here is total — no input byte sequence
 * can make it throw or lose information that matters for display — and the
 * bytes of unedited content are never round-tripped through it.
 */

export const PGN_ENCODING = {
  UTF8: "utf-8",
  /** WHATWG windows-1252 — what browsers mean by "latin1". Total: the five
   *  bytes CP1252 leaves undefined (0x81 0x8D 0x8F 0x90 0x9D) pass through as
   *  C1 controls, so decode is reversible for display purposes. */
  WINDOWS_1252: "windows-1252",
  UTF16LE: "utf-16le",
  UTF16BE: "utf-16be",
} as const;
export type PgnEncoding = (typeof PGN_ENCODING)[keyof typeof PGN_ENCODING];

export interface EncodingDetection {
  encoding: PgnEncoding;
  /** Byte length of a leading BOM (0 when absent). The BOM bytes stay part of
   *  the preamble span and round-trip untouched; this is display metadata. */
  bomLength: number;
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];

/**
 * Detect the file's encoding from its own bytes.
 *
 * Order matters: BOMs are unambiguous; then a full-file streaming UTF-8
 * validation (a sniff window is not enough — one invalid byte at the end of a
 * "valid-looking" file must flip the whole file to windows-1252, or the
 * decode of that one byte corrupts on display); anything else is
 * windows-1252, which never fails.
 *
 * UTF-16 is detected so it can be handled explicitly (read-only open with a
 * convert-to-edit affordance) instead of decoding as mojibake.
 */
export function detectEncoding(bytes: Uint8Array): EncodingDetection {
  if (
    bytes.length >= 3 &&
    bytes[0] === UTF8_BOM[0] &&
    bytes[1] === UTF8_BOM[1] &&
    bytes[2] === UTF8_BOM[2]
  ) {
    return { encoding: PGN_ENCODING.UTF8, bomLength: 3 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: PGN_ENCODING.UTF16LE, bomLength: 2 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: PGN_ENCODING.UTF16BE, bomLength: 2 };
  }
  if (isValidUtf8(bytes)) {
    return { encoding: PGN_ENCODING.UTF8, bomLength: 0 };
  }
  return { encoding: PGN_ENCODING.WINDOWS_1252, bomLength: 0 };
}

/**
 * Whole-buffer UTF-8 validity. TextDecoder in fatal mode throws on the first
 * invalid sequence; a trailing incomplete sequence (truncated file) is also
 * invalid here — stream mode would defer it, but a file that ends mid-
 * character cannot be decoded losslessly as UTF-8, so windows-1252 (total)
 * is the correct fallback for it.
 */
export function isValidUtf8(bytes: Uint8Array): boolean {
  // Byte-scan validation, allocation-free: the TextDecoder(fatal) form
  // materializes a throwaway UTF-16 string twice the file size on every
  // open (a 50MB transient for a 25MB file), which this avoids. Semantics
  // match fatal TextDecoder exactly: overlongs, surrogate range, > U+10FFFF
  // and truncated tails all reject.
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const b = bytes[i]!;
    if (b < 0x80) {
      i += 1;
    } else if (b < 0xc2) {
      return false; // bare continuation or overlong 2-byte lead
    } else if (b < 0xe0) {
      if (i + 1 >= n || (bytes[i + 1]! & 0xc0) !== 0x80) return false;
      i += 2;
    } else if (b < 0xf0) {
      if (i + 2 >= n) return false;
      const b1 = bytes[i + 1]!;
      if ((b1 & 0xc0) !== 0x80 || (bytes[i + 2]! & 0xc0) !== 0x80) return false;
      if (b === 0xe0 && b1 < 0xa0) return false; // overlong
      if (b === 0xed && b1 >= 0xa0) return false; // UTF-16 surrogate range
      i += 3;
    } else if (b < 0xf5) {
      if (i + 3 >= n) return false;
      const b1 = bytes[i + 1]!;
      if (
        (b1 & 0xc0) !== 0x80 ||
        (bytes[i + 2]! & 0xc0) !== 0x80 ||
        (bytes[i + 3]! & 0xc0) !== 0x80
      )
        return false;
      if (b === 0xf0 && b1 < 0x90) return false; // overlong
      if (b === 0xf4 && b1 >= 0x90) return false; // above U+10FFFF
      i += 4;
    } else {
      return false; // 0xf5-0xff never valid
    }
  }
  return true;
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
const cp1252Decoder = new TextDecoder("windows-1252", { fatal: false });
const utf16leDecoder = new TextDecoder("utf-16le", { fatal: false });
const utf16beDecoder = new TextDecoder("utf-16be", { fatal: false });

/** Total decode of a byte slice for display. Never throws. */
export function decodeSlice(bytes: Uint8Array, encoding: PgnEncoding): string {
  switch (encoding) {
    case PGN_ENCODING.UTF8:
      return utf8Decoder.decode(bytes);
    case PGN_ENCODING.WINDOWS_1252:
      return cp1252Decoder.decode(bytes);
    case PGN_ENCODING.UTF16LE:
      return utf16leDecoder.decode(bytes);
    case PGN_ENCODING.UTF16BE:
      return utf16beDecoder.decode(bytes);
  }
}

/**
 * windows-1252 code point -> byte, built once by decoding every byte. This is
 * exactly the reverse of the WHATWG decoder, so encode(decode(b)) === b for
 * every byte — the totality property the fidelity layer relies on.
 */
const CP1252_REVERSE: Map<number, number> = (() => {
  const map = new Map<number, number>();
  const one = new Uint8Array(1);
  for (let b = 0; b <= 0xff; b++) {
    one[0] = b;
    const cp = cp1252Decoder.decode(one).codePointAt(0);
    if (cp !== undefined && !map.has(cp)) map.set(cp, b);
  }
  return map;
})();

export interface EncodeResult {
  ok: boolean;
  bytes: Uint8Array;
  /** Code points the target encoding cannot represent (empty when ok). */
  unrepresentable: string[];
}

/**
 * Encode new (edited) text into the file's encoding. Unrepresentable
 * characters are reported, never substituted — the caller must block the save
 * and offer converting the whole file to UTF-8.
 */
export function encodeText(text: string, encoding: PgnEncoding): EncodeResult {
  if (encoding === PGN_ENCODING.UTF8) {
    return { ok: true, bytes: new TextEncoder().encode(text), unrepresentable: [] };
  }
  if (encoding === PGN_ENCODING.WINDOWS_1252) {
    const out = new Uint8Array(text.length);
    let n = 0;
    const bad: string[] = [];
    for (const ch of text) {
      const byte = CP1252_REVERSE.get(ch.codePointAt(0)!);
      if (byte === undefined) {
        if (!bad.includes(ch)) bad.push(ch);
        continue;
      }
      out[n++] = byte;
    }
    return bad.length > 0
      ? { ok: false, bytes: new Uint8Array(0), unrepresentable: bad }
      : { ok: true, bytes: out.subarray(0, n), unrepresentable: [] };
  }
  // UTF-16 documents are read-only until converted; encoding into them is a
  // programming error, surfaced loudly rather than guessed at.
  return { ok: false, bytes: new Uint8Array(0), unrepresentable: [text] };
}
