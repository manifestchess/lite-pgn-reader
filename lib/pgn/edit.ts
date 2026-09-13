/**
 * Edit operations: minimal splices into the CST.
 *
 * Every operation touches only the leaves the user's intent requires; all
 * other leaves keep their verbatim source slices, which is what makes the
 * edit-fidelity properties (diff confinement, undo byte-identity, fixed
 * point) hold structurally instead of by luck.
 *
 * The semantic tree must be rebuilt after any of these (cheap — the CST is
 * already parsed); Document owns that lifecycle.
 */

import { makeSan } from "chessops/san";
import type { Move, Position } from "chessops";

import {
  escapeTagValue,
  tkFromText,
  WORD_CLS,
  type CstGame,
  type CstTagPair,
  type MtItem,
} from "./cst";
import { leadingTurnIndicator, type DrawShapeLite, type SemGame, type SemNode } from "./semantics";

// ---------------------------------------------------------------------------
// Container helpers
// ---------------------------------------------------------------------------

const isMoveWord = (it: MtItem): boolean =>
  it.k === "word" && (it.cls === WORD_CLS.SAN || it.cls === WORD_CLS.NULL);

const isClusterInterior = (it: MtItem): boolean =>
  it.k === "ws" ||
  it.k === "comment" ||
  it.k === "nag" ||
  (it.k === "word" &&
    (it.cls === WORD_CLS.SUFFIX || it.cls === WORD_CLS.SYM || it.cls === WORD_CLS.EP));

/** One past the last item belonging to the move cluster at wordIdx: the move
 *  word plus its whitespace, comments, NAGs, suffixes. Stops at the next
 *  move word, move number, RAV, result or escape line. */
export function clusterEnd(container: MtItem[], wordIdx: number): number {
  let i = wordIdx + 1;
  while (i < container.length && isClusterInterior(container[i]!)) i++;
  return i;
}

/** The cluster's first item: the move-number token(s) that announce this
 *  move ('2.', '2', '.', '2...'), walked back over interleaved whitespace.
 *  Deleting or relocating a move without its number leaves an orphan
 *  ('1. e4! e5 2. 1-0'). */
export function clusterStart(container: MtItem[], wordIdx: number): number {
  let start = wordIdx;
  let i = wordIdx - 1;
  while (i >= 0) {
    const it = container[i]!;
    if (it.k === "ws") {
      i--;
      continue;
    }
    if (it.k === "word" && it.cls === WORD_CLS.MOVENUM) {
      start = i;
      i--;
      continue;
    }
    break;
  }
  return start;
}

/** One past the RAV block (consecutive rav items with interleaved ws) that
 *  follows a cluster — the variations anchored as siblings of this move. */
export function ravBlockEnd(container: MtItem[], fromIdx: number): number {
  let i = fromIdx;
  let last = fromIdx;
  while (i < container.length) {
    const it = container[i]!;
    if (it.k === "rav") {
      i++;
      last = i;
      continue;
    }
    if (it.k === "ws") {
      i++;
      continue;
    }
    break;
  }
  return last;
}

function indexOfItem(container: MtItem[], item: MtItem): number {
  const i = container.indexOf(item);
  if (i < 0) throw new Error("CST item not found in its container");
  return i;
}

/** Remove items [from, to). Adjacent whitespace tokens are deliberately NOT
 *  merged: a ws token can carry the newline that gives a following
 *  '%'-escape line its column-0 status, and dropping it demotes structural
 *  escape content into movetext. Two adjacent ws runs are byte-noise at the
 *  edit site, which the format permits. */
function spliceOut(container: MtItem[], from: number, to: number): void {
  container.splice(from, to - from);
}

/**
 * Insert new content leaves after the last non-ws item at-or-before `bound`
 * (walking back over trailing whitespace so following ws — including the
 * newline that anchors a '%'-escape line — stays where it was). Separators:
 * a ';' comment and a '%'-escape own everything to end-of-line, so content
 * after them starts on a fresh line; everything else gets one space. A
 * trailing space is added when the item now following the insertion is not
 * whitespace (nothing may butt against a result token: 'e51-0' is one word
 * on reparse).
 */
function insertContent(
  container: MtItem[],
  lowerBound: number,
  bound: number,
  items: MtItem[],
  eol: string,
): void {
  let at = bound;
  while (at > lowerBound && container[at - 1]!.k === "ws") at--;
  const prev = container[at - 1];
  const lead =
    prev !== undefined &&
    ((prev.k === "comment" && prev.style === "semi") || prev.k === "escape")
      ? eol
      : " ";
  const ins: MtItem[] = [{ k: "ws", t: tkFromText(lead) }, ...items];
  const next = container[at];
  if (next !== undefined && next.k !== "ws") ins.push({ k: "ws", t: tkFromText(" ") });
  container.splice(at, 0, ...ins);
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

const CMD_SCAN = /\[%[^\]]*\]/g;

/** All [%...] commands in a comment's inner text, in order. Editing prose
 *  keeps every command verbatim. */
function commandsIn(inner: string): string[] {
  return inner.match(CMD_SCAN) ?? [];
}

function buildBraceComment(prose: string, commands: string[]): string {
  const parts: string[] = [];
  if (commands.length > 0) parts.push(commands.join(""));
  const p = prose.trim();
  if (p.length > 0) parts.push(p);
  return `{ ${parts.join(" ")} }`;
}

/** Comments containing '}' cannot exist in a brace comment; the UI blocks
 *  the character at input time and this guards the model layer. */
export class UnrepresentableEditError extends Error {}

function assertBraceSafe(prose: string): void {
  if (prose.includes("}"))
    throw new UnrepresentableEditError(
      "a brace comment cannot contain '}' — remove it or use a different character",
    );
  // A blank line followed by tag-pair-shaped lines inside a comment would
  // trip the scanner's unmatched-brace resync on reparse and split the game
  // in two. Refused at input, like '}'.
  if (/\n[ \t]*\n[ \t]*\[[A-Za-z0-9_][\w.-]*\s+"/.test(prose))
    throw new UnrepresentableEditError(
      "a comment cannot contain a blank line followed by a [Tag \"...\"] line — that sequence reads as a new game's header",
    );
}

/**
 * Replace the prose of a node's comment(s), preserving every [%...] command.
 * Multiple consecutive comments merge into one when (and only when) the user
 * edits this node's comment. Empty prose with no commands deletes.
 */
export function setNodeComment(
  node: SemNode,
  prose: string,
  decodeTk: (i: MtItem) => string,
  eol = "\n",
): void {
  assertBraceSafe(prose);
  const container = node.container;
  const commands: string[] = [];
  for (const c of node.commentItems) {
    const raw = decodeTk(c);
    const inner = c.style === "semi" ? raw.replace(/^;/, "") : raw.replace(/^\{/, "").replace(/\}$/, "");
    commands.push(...commandsIn(inner));
  }
  // Remove existing comment items (keep list positions tidy).
  for (const c of node.commentItems) {
    const i = indexOfItem(container, c);
    spliceOut(container, i, i + 1);
  }
  node.commentItems = [];

  if (prose.trim().length === 0 && commands.length === 0) return;

  const text = buildBraceComment(prose, commands);
  const wordIdx = indexOfItem(container, node.wordItem);
  insertContent(
    container,
    wordIdx + 1,
    clusterEnd(container, wordIdx),
    [{ k: "comment", t: tkFromText(text), style: "brace", unclosed: false }],
    eol,
  );
}

/** Game-level (pre-game) comment: the same contract on the root. */
export function setRootComment(
  cst: CstGame,
  sem: SemGame,
  prose: string,
  decodeTk: (i: MtItem) => string,
): void {
  assertBraceSafe(prose);
  const container = cst.movetext;
  const commands: string[] = [];
  for (const c of sem.rootCommentItems) {
    const raw = decodeTk(c);
    const inner = c.style === "semi" ? raw.replace(/^;/, "") : raw.replace(/^\{/, "").replace(/\}$/, "");
    commands.push(...commandsIn(inner));
  }
  for (const c of sem.rootCommentItems) {
    const i = indexOfItem(container, c);
    spliceOut(container, i, i + 1);
  }
  if (prose.trim().length === 0 && commands.length === 0) return;
  const text = buildBraceComment(prose, commands);
  container.splice(0, 0, {
    k: "comment",
    t: tkFromText(text),
    style: "brace",
    unclosed: false,
  }, { k: "ws", t: tkFromText(" ") });
}

// ---------------------------------------------------------------------------
// NAGs and shapes
// ---------------------------------------------------------------------------

/**
 * Replace the node's NAG set. The user explicitly re-annotated this move, so
 * a suffix fused into the move token ('e4!?') may be normalized away — the
 * one sanctioned conversion, allowed only on moves the user explicitly
 * re-annotated.
 */
export function setNodeNags(node: SemNode, nags: number[], decodeTk: (i: MtItem) => string): void {
  const container = node.container;
  for (const item of node.nagItems) {
    const i = container.indexOf(item);
    if (i >= 0) spliceOut(container, i, i + 1);
  }
  node.nagItems = [];
  if (node.wordItem.suffix !== null) {
    const word = decodeTk(node.wordItem);
    node.wordItem.t = tkFromText(word.replace(/[!?]{1,2}$/, ""));
    node.wordItem.suffix = null;
  }
  const wordIdx = indexOfItem(container, node.wordItem);
  let at = wordIdx + 1;
  const inserts: MtItem[] = [];
  for (const n of nags) {
    inserts.push({ k: "ws", t: tkFromText(" ") });
    inserts.push({ k: "nag", t: tkFromText(`$${n}`), value: n });
  }
  container.splice(at, 0, ...inserts);
}

function shapeToCommand(shapes: DrawShapeLite[]): string[] {
  const csl = shapes.filter((s) => !s.dest);
  const cal = shapes.filter((s) => s.dest);
  const letter = (brush: string): string =>
    ({ green: "G", red: "R", yellow: "Y", blue: "B" })[brush] ?? "G";
  const out: string[] = [];
  if (csl.length > 0)
    out.push(`[%csl ${csl.map((s) => letter(s.brush) + s.orig).join(",")}]`);
  if (cal.length > 0)
    out.push(`[%cal ${cal.map((s) => letter(s.brush) + s.orig + s.dest).join(",")}]`);
  return out;
}

/**
 * Set the node's drawn shapes: rewrites only the well-formed [%csl]/[%cal]
 * commands in the node's comment, preserving prose, unknown commands, and
 * malformed payloads verbatim.
 */
export function setNodeShapes(
  node: SemNode,
  shapes: DrawShapeLite[],
  decodeTk: (i: MtItem) => string,
): void {
  const container = node.container;
  const existing = node.commentItems;
  const newCommands = shapeToCommand(shapes);

  if (existing.length === 0) {
    if (newCommands.length === 0) return;
    const wordIdx = indexOfItem(container, node.wordItem);
    insertContent(
      container,
      wordIdx + 1,
      clusterEnd(container, wordIdx),
      [
        {
          k: "comment",
          t: tkFromText(`{ ${newCommands.join("")} }`),
          style: "brace",
          unclosed: false,
        },
      ],
      "\n",
    );
    return;
  }

  // Strip well-formed csl/cal from every comment; append new ones to the
  // first comment. Everything else in the text survives byte-for-byte.
  existing.forEach((c, idx) => {
    const raw = decodeTk(c);
    const isSemi = c.style === "semi";
    const inner = isSemi ? raw.replace(/^;/, "") : raw.replace(/^\{/, "").replace(/\}$/, "");
    let cleaned = inner.replace(/\[%(csl|cal)\s+[^\]]*\]/g, "");
    if (idx === 0 && newCommands.length > 0) {
      cleaned = `${newCommands.join("")}${cleaned}`;
    }
    if (isSemi) {
      c.t = tkFromText(`;${cleaned}`);
    } else {
      c.t = tkFromText(`{${cleaned}}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

export interface AddMoveTarget {
  /** Parent node, or null to play from the game's initial position. */
  parent: SemNode | null;
  /** Position before the new move (parent's position-after / initial). */
  position: Position;
  cst: CstGame;
  sem: SemGame;
  /** The game's dominant line ending (separator after ';' comments). */
  eol?: string;
}

/**
 * Add a move. If the target has no existing continuation the move extends
 * the line in place; otherwise it becomes a new variation `( … )` after the
 * existing continuation's cluster.
 */
export function addMove(target: AddMoveTarget, move: Move): void {
  const { parent, position, cst } = target;
  const eol = target.eol ?? "\n";
  const san = makeSan(position, move);
  const white = position.turn === "white";
  const num = position.fullmoves;

  if (parent === null) {
    const container = cst.movetext;
    const first = container.find(isMoveWord);
    if (!first) {
      // Empty game: insert before the result token if there is one.
      let at = container.findIndex((it) => it.k === "result");
      if (at < 0) at = container.length;
      insertContent(container, 0, at, [numberedMove(san, num, white, true)], eol);
      return;
    }
    insertAlternative(container, container.indexOf(first), san, num, white, eol);
    return;
  }

  const container = parent.container;
  const wordIdx = indexOfItem(container, parent.wordItem);
  const cEnd = clusterEnd(container, wordIdx);
  const afterRavs = ravBlockEnd(container, cEnd);
  // Existing continuation?
  let nextMoveIdx = -1;
  for (let i = afterRavs; i < container.length; i++) {
    const it = container[i]!;
    if (isMoveWord(it)) {
      nextMoveIdx = i;
      break;
    }
    if (it.k === "rav" || it.k === "result" || it.k === "escape") break;
    if (it.k === "word" && it.cls === WORD_CLS.MOVENUM) continue;
    if (it.k === "ws") continue;
    break;
  }

  if (nextMoveIdx < 0) {
    // Extend the line at the end of the parent's cluster/RAV block.
    const needsNumber = white || afterRavs > cEnd; // black shows '…' after interruptions
    insertContent(
      container,
      wordIdx + 1,
      afterRavs,
      [numberedMove(san, num, white, needsNumber)],
      eol,
    );
    return;
  }
  insertAlternative(container, nextMoveIdx, san, num, white, eol);
}

function numberedMove(
  san: string,
  num: number,
  white: boolean,
  withNumber: boolean,
): MtItem {
  const text = withNumber ? (white ? `${num}. ${san}` : `${num}... ${san}`) : san;
  // The number and SAN are one fused token by choice: it keeps the splice
  // single-leaf and matches a common source form the parser already handles.
  return {
    k: "word",
    t: tkFromText(text.replace(/ /g, "")),
    cls: WORD_CLS.SAN,
    san,
    suffix: null,
  };
}

/** Insert `(N.san)` as a variation after the cluster of the move at
 *  existingIdx (its sibling alternative). */
function insertAlternative(
  container: MtItem[],
  existingIdx: number,
  san: string,
  num: number,
  white: boolean,
  eol: string,
): void {
  const cEnd = clusterEnd(container, existingIdx);
  const at = ravBlockEnd(container, cEnd);
  const rav: MtItem = {
    k: "rav",
    open: tkFromText("("),
    items: [numberedMove(san, num, white, true)],
    close: tkFromText(")"),
  };
  insertContent(container, existingIdx + 1, at, [rav], eol);
}

/** Delete this move and everything after it in its line. Variations in the
 *  RAV block after its cluster survive only when they are the move's true
 *  ALTERNATIVES (their leading number indicator claims the same side to
 *  move); a black-continuation variation there is a re-anchored CHILD of
 *  the deleted move and goes with it — keeping it strands an unanchorable
 *  branch. An emptied variation is removed entirely. */
export function deleteFromHere(
  cst: CstGame,
  node: SemNode,
  decodeTk: (i: MtItem) => string,
): void {
  const container = node.container;
  const wordIdx = indexOfItem(container, node.wordItem);
  const cStart = clusterStart(container, wordIdx);
  const cEnd = clusterEnd(container, wordIdx);
  let keepRavsEnd = ravBlockEnd(container, cEnd);

  // Filter the kept block: same-side indicators (or unknown) stay as
  // alternatives; opposite-side ones are children of the deleted move.
  for (let i = keepRavsEnd - 1; i >= cEnd; i--) {
    const it = container[i]!;
    if (it.k !== "rav") continue;
    const indicator = leadingTurnIndicator(it.items, decodeTk);
    if (indicator !== null && indicator !== node.turn) {
      spliceOut(container, i, i + 1);
      keepRavsEnd--;
    }
  }

  // Remove the tail (continuation and everything after the RAV block),
  // except a trailing result token in the mainline.
  // The rebuilt tail keeps the terminator AND everything positioned after
  // it — comments on the terminator are the user's content and stay attached
  // to the finished game, and escape lines are structural; dropping either
  // loses bytes. Only the deleted line's own moves/annotations between
  // keepRavsEnd and the result go.
  const tail: MtItem[] = [];
  let afterResult = false;
  for (let i = keepRavsEnd; i < container.length; i++) {
    const it = container[i]!;
    if (it.k === "result") {
      tail.push(it);
      afterResult = true;
      continue;
    }
    if (afterResult) {
      tail.push(it);
      continue;
    }
    if (it.k === "ws" && tail.length > 0) {
      tail.push(it);
      continue;
    }
  }
  container.splice(keepRavsEnd, container.length - keepRavsEnd, ...dedupeWs(tail));
  // Remove the node's own cluster, its announcing move number included.
  spliceOut(container, cStart, cEnd);

  removeEmptyRavs(cst.movetext);
}

function dedupeWs(items: MtItem[]): MtItem[] {
  const out: MtItem[] = [];
  for (const it of items) {
    if (it.k === "ws" && out[out.length - 1]?.k === "ws") continue;
    out.push(it);
  }
  // Keep a single separating space before a kept result token.
  if (out.length > 0 && out[0]!.k === "result") {
    out.unshift({ k: "ws", t: tkFromText(" ") });
  }
  return out;
}

function removeEmptyRavs(items: MtItem[]): void {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.k !== "rav") continue;
    removeEmptyRavs(it.items);
    if (!it.items.some((x) => x.k !== "ws")) {
      spliceOut(items, i, i + 1);
    }
  }
}

/**
 * Promote a variation: the RAV's line replaces the current continuation and
 * the continuation becomes a RAV in its place. Every move/comment/NAG leaf
 * moves verbatim; only parens and separator ws are newly created. Numbering
 * stays valid because both lines start from the same position.
 */
export function promoteVariation(cst: CstGame, firstNodeOfVariation: SemNode): void {
  const ravItems = firstNodeOfVariation.container;
  const rav = findRavOwning(cst.movetext, ravItems);
  if (!rav) throw new Error("node is not inside a variation");
  const { parent: hostContainer, item: ravItem } = rav;

  const ravIdx = indexOfItem(hostContainer, ravItem);
  // The displaced line: from the sibling move's cluster start to the end of
  // the container (minus a trailing result token which stays put).
  let siblingIdx = -1;
  for (let i = ravIdx - 1; i >= 0; i--) {
    const it = hostContainer[i]!;
    if (isMoveWord(it)) {
      siblingIdx = i;
      break;
    }
  }
  if (siblingIdx < 0) throw new Error("variation has no sibling move to swap with");

  // Split host: [prefix][sibling line incl. its move number][suffix after]
  const tailStart = clusterStart(hostContainer, siblingIdx);
  const tail = hostContainer.slice(tailStart);
  // Remove the promoted RAV from the tail copy.
  const ravInTail = tail.indexOf(ravItem);
  tail.splice(ravInTail, 1);
  if (tail[ravInTail]?.k === "ws" && tail[ravInTail - 1]?.k === "ws") tail.splice(ravInTail, 1);
  // Result token stays in the host, not inside the new RAV.
  const resultParts: MtItem[] = [];
  for (let i = tail.length - 1; i >= 0; i--) {
    const it = tail[i]!;
    if (it.k === "result" || (it.k === "ws" && resultParts.length > 0 && resultParts[0]!.k === "result")) {
      resultParts.unshift(...tail.splice(i, 1));
    } else if (it.k === "ws" && i === tail.length - 1) {
      tail.splice(i, 1);
    } else break;
  }

  const demoted: MtItem = {
    k: "rav",
    open: tkFromText("("),
    items: trimWs(tail),
    close: tkFromText(")"),
  };
  const promoted = trimWs(ravItem.items.slice());

  // Reattach the demoted line at the BRANCH POINT: a RAV is an alternative
  // to the move that precedes it, and the demoted line is the alternative
  // to the promoted line's FIRST move — so it must follow that move's
  // cluster (move word + its NAGs/comments, after any existing sibling
  // alternatives), not trail the whole promoted line. Trailing it would
  // re-anchor the demoted line to the promoted line's LAST move and change
  // the game's semantics.
  let firstMove = -1;
  for (let i = 0; i < promoted.length; i++) {
    if (isMoveWord(promoted[i]!)) {
      firstMove = i;
      break;
    }
  }
  // A move-less promoted line (comment-only variation) keeps the demoted
  // line trailing — there is no branch point to anchor to.
  let insertAt = promoted.length;
  if (firstMove >= 0) {
    insertAt = firstMove + 1;
    while (insertAt < promoted.length) {
      const k = promoted[insertAt]!.k;
      if (k === "ws" || k === "nag" || k === "comment" || k === "rav") {
        insertAt++;
        continue;
      }
      break;
    }
    while (insertAt > 0 && promoted[insertAt - 1]!.k === "ws") insertAt--;
  }
  const head = promoted.slice(0, insertAt);
  const rest = trimWs(promoted.slice(insertAt));

  hostContainer.splice(
    tailStart,
    hostContainer.length - tailStart,
    ...head,
    { k: "ws", t: tkFromText(" ") },
    demoted,
    ...(rest.length > 0 ? [{ k: "ws", t: tkFromText(" ") } as MtItem, ...rest] : []),
    ...resultParts,
  );
}

function trimWs(items: MtItem[]): MtItem[] {
  let a = 0;
  let b = items.length;
  while (a < b && items[a]!.k === "ws") a++;
  while (b > a && items[b - 1]!.k === "ws") b--;
  return items.slice(a, b);
}

function findRavOwning(
  items: MtItem[],
  target: MtItem[],
): { parent: MtItem[]; item: MtItem & { k: "rav" } } | null {
  for (const it of items) {
    if (it.k !== "rav") continue;
    if (it.items === target) return { parent: items, item: it };
    const nested = findRavOwning(it.items, target);
    if (nested) return nested;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tags and result
// ---------------------------------------------------------------------------

const tagLineText = (pairs: CstTagPair[]): string =>
  pairs.map((p) => `[${p.name} "${escapeTagValue(p.value)}"]`).join("\n");

function assertTagSafe(name: string, value: string): void {
  if (/[\r\n]/.test(value) || /[\r\n]/.test(name))
    throw new UnrepresentableEditError("tag values cannot contain newlines");
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))
    throw new UnrepresentableEditError("tag values cannot contain control characters");
  if (!/^[A-Za-z0-9_][\w.-]*$/.test(name))
    throw new UnrepresentableEditError(`invalid tag name: ${name}`);
}

/**
 * Set (or add) a tag. Editing a tag on a multi-pair line rewrites that line
 * (the user edited it); every other tag line keeps its verbatim bytes. New
 * tags are appended after the last tag line.
 */
export function setTag(cst: CstGame, name: string, value: string, eol: string): void {
  assertTagSafe(name, value);
  for (const el of cst.header) {
    if (el.k !== "tagline") continue;
    const pair = el.pairs.find((p) => p.name === name);
    if (pair) {
      pair.value = value;
      pair.rawValue = escapeTagValue(value);
      el.t = tkFromText(tagLineText(el.pairs).replace(/\n/g, eol));
      el.strict = true;
      cst.tags.set(name, value);
      return;
    }
  }
  // Append a new tag line after the last tag line.
  let lastTag = -1;
  cst.header.forEach((el, i) => {
    if (el.k === "tagline") lastTag = i;
  });
  const newLine: (typeof cst.header)[number] = {
    k: "tagline",
    t: tkFromText(`[${name} "${escapeTagValue(value)}"]`),
    pairs: [{ name, rawValue: escapeTagValue(value), value }],
    strict: true,
  };
  if (lastTag < 0) {
    cst.header.splice(0, 0, newLine, { k: "ws", t: tkFromText(eol) });
  } else {
    cst.header.splice(lastTag + 1, 0, { k: "ws", t: tkFromText(eol) }, newLine);
  }
  cst.tags.set(name, value);
}

export function deleteTag(cst: CstGame, name: string, eol = "\n"): void {
  for (let i = 0; i < cst.header.length; i++) {
    const el = cst.header[i]!;
    if (el.k !== "tagline") continue;
    const pairIdx = el.pairs.findIndex((p) => p.name === name);
    if (pairIdx < 0) continue;
    if (el.pairs.length === 1) {
      const next = cst.header[i + 1];
      cst.header.splice(i, next?.k === "ws" ? 2 : 1);
    } else {
      el.pairs.splice(pairIdx, 1);
      el.t = tkFromText(tagLineText(el.pairs).replace(/\n/g, eol));
    }
    cst.tags.delete(name);
    return;
  }
}

/** Set the game result: updates BOTH the terminator token and the Result
 *  tag — an explicit user edit of the outcome, so no mismatch survives it. */
export function setResult(cst: CstGame, sem: SemGame, result: string, eol: string): void {
  if (!["1-0", "0-1", "1/2-1/2", "*"].includes(result))
    throw new UnrepresentableEditError(`not a result: ${result}`);
  if (sem.resultItem) {
    sem.resultItem.t = tkFromText(result);
  } else {
    const container = cst.movetext;
    container.push({ k: "ws", t: tkFromText(" ") }, {
      k: "result",
      t: tkFromText(result),
    });
  }
  setTag(cst, "Result", result, eol);
}
