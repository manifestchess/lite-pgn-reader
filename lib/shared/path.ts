/**
 * The ONE node-id codec, shared by the main-process wire projection and the
 * renderer stores. Everything imports this, so no duplicate can drift.
 *
 * Ids are child-index paths. A step is 2 base-36 chars for indices < 1260;
 * wider fan-out (hostile but legal and editable) escapes with 'z' + 6
 * base-36 chars. Without the escape form, ids would collide at index >= 1260
 * and route edits to the WRONG node.
 */

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function pathStep(childIndex: number): string {
  if (childIndex < 1260) {
    const hi = Math.floor(childIndex / 36);
    const lo = childIndex % 36;
    return `${ALPHABET[hi]}${ALPHABET[lo]}`;
  }
  // Escape form: 'z' + 6 chars (z as hi digit is unreachable below: hi <= 34).
  let n = childIndex;
  let out = "";
  for (let k = 0; k < 6; k++) {
    out = ALPHABET[n % 36] + out;
    n = Math.floor(n / 36);
  }
  return `z${out}`;
}

/** Parse the step starting at `pos`; returns the child index and the number
 *  of characters consumed, or null for malformed input. */
export function readStep(
  id: string,
  pos: number,
): { index: number; length: number } | null {
  const c0 = id[pos];
  if (c0 === undefined) return null;
  if (c0 === "z") {
    if (pos + 7 > id.length) return null;
    let n = 0;
    for (let k = 1; k <= 6; k++) {
      const d = ALPHABET.indexOf(id[pos + k]!);
      if (d < 0) return null;
      n = n * 36 + d;
    }
    return { index: n, length: 7 };
  }
  const c1 = id[pos + 1];
  if (c1 === undefined) return null;
  const hi = ALPHABET.indexOf(c0);
  const lo = ALPHABET.indexOf(c1);
  if (hi < 0 || lo < 0) return null;
  return { index: hi * 36 + lo, length: 2 };
}

export function parentId(id: string): string {
  // Walk from the front — steps are variable-length.
  let pos = 0;
  let lastStart = 0;
  while (pos < id.length) {
    const step = readStep(id, pos);
    if (!step) return "";
    lastStart = pos;
    pos += step.length;
  }
  return id.slice(0, lastStart);
}

export function lastStepIndex(id: string): number | null {
  let pos = 0;
  let last: number | null = null;
  while (pos < id.length) {
    const step = readStep(id, pos);
    if (!step) return null;
    last = step.index;
    pos += step.length;
  }
  return last;
}

/** Resolve a path over any tree with a children array. */
export function resolvePath<T extends { children: T[] }>(
  roots: T[],
  id: string,
): T | null {
  let children = roots;
  let node: T | null = null;
  let pos = 0;
  while (pos < id.length) {
    const step = readStep(id, pos);
    if (!step) return null;
    node = children[step.index] ?? null;
    if (!node) return null;
    children = node.children;
    pos += step.length;
  }
  return node;
}

/** Well-formed id: a sequence of valid steps (empty = root). */
export function isValidId(id: string): boolean {
  let pos = 0;
  while (pos < id.length) {
    const step = readStep(id, pos);
    if (!step) return false;
    pos += step.length;
  }
  return true;
}
