/**
 * The renderer-facing wire format: JSON-safe projections of the document
 * model. Node ids are base-36 child-index paths: "" is the
 * root, each step is 2 chars, mainline steps are "00". Ids are stable for a
 * given parse and resolve by tree walk.
 */

import type { GameEntry } from "../lib/pgn/index";
import type { CommentMeta, SemGame, SemNode } from "../lib/pgn/semantics";
import { GFLAG } from "../lib/pgn/scan";
import { pathStep, resolvePath } from "../lib/shared/path";

export { pathStep };

export interface WireRow {
  i: number;
  white: string;
  black: string;
  whiteElo: string;
  blackElo: string;
  event: string;
  date: string;
  result: string;
  flags: number;
  hasMovetext: boolean;
}

export interface WireComment {
  displayText: string;
  shapes: { orig: string; dest?: string; brush: string }[];
  clockSeconds?: number;
  emtSeconds?: number;
  evaluation?: { cp?: number; mate?: number; depth?: number };
}

export interface WireNode {
  id: string;
  /** Display text of the move: the source token, minus any fused move-number
   *  prefix ("6.Ngf3" arrives as "Ngf3" — the tree draws its own labels).
   *  Byte-exact text lives in the CST only. */
  text: string;
  san: string | null;
  isNullMove: boolean;
  fen: string;
  ply: number;
  moveNumber: number;
  turn: "white" | "black";
  check: boolean;
  /** uci of the move that led here (for lastMove highlight). */
  uci: string | null;
  nags: number[];
  comments: WireComment[];
  startingComments: WireComment[];
  children: WireNode[];
}

export interface WireGame {
  index: number;
  initialFen: string;
  children: WireNode[];
  rootComments: WireComment[];
  tags: [string, string][];
  duplicateTagNames: string[];
  resultText: string | null;
  resultConflict: boolean;
  stuck: { token: string; reason: string; mainline: boolean }[];
  positionError: string | null;
  readOnly: boolean;
  dirty: boolean;
  plyCount: number;
  flags: number;
}

function wireComment(c: CommentMeta): WireComment {
  return {
    displayText: c.displayText,
    shapes: c.shapes,
    clockSeconds: c.clockSeconds,
    emtSeconds: c.emtSeconds,
    evaluation: c.evaluation,
  };
}

function squareName(sq: number): string {
  return `${"abcdefgh"[sq & 7]}${Math.floor(sq / 8) + 1}`;
}

function uciOf(node: SemNode): string | null {
  if (!node.move) return null;
  const m = node.move as { from?: number; to?: number; promotion?: string };
  if (m.from === undefined || m.to === undefined) return null;
  // chessops stores castling as king-captures-rook; the highlight and the
  // played-move matcher want king-to-destination (otherwise O-O highlights
  // e1-h1). The SAN tells us which castle it was.
  if (node.san === "O-O" || node.san === "O-O-O") {
    const rank = node.turn === "white" ? "1" : "8";
    const dest = node.san === "O-O" ? `g${rank}` : `c${rank}`;
    return `${squareName(m.from)}${dest}`;
  }
  const promo = m.promotion
    ? ({ queen: "q", rook: "r", bishop: "b", knight: "n" } as Record<string, string>)[m.promotion] ?? ""
    : "";
  return `${squareName(m.from)}${squareName(m.to)}${promo}`;
}

/** Iterative projection — the recursive form overflows the stack on very
 *  long games (3,000-ply mainlines). */
function wireNode(root: SemNode, rootId: string): WireNode {
  const make = (node: SemNode, id: string): WireNode => ({
    id,
    // Display text only: a source token may fuse the move number into the
    // SAN ("6.Ngf3" is one legal PGN token); the tree renders its own
    // number labels, so the fused prefix would otherwise paint twice.
    // CST bytes stay verbatim — round-trip fidelity is untouched.
    text:
      node.san !== null ? node.text.replace(/^\d+\.{1,3}(?=\S)/, "") : node.text,
    san: node.san,
    isNullMove: node.isNullMove,
    fen: node.fen,
    ply: node.ply,
    moveNumber: node.moveNumber,
    turn: node.turn,
    check: node.check,
    uci: uciOf(node),
    nags: node.nags,
    comments: node.comments.map(wireComment),
    startingComments: node.startingComments.map(wireComment),
    children: [],
  });
  const out = make(root, rootId);
  const stack: { sem: SemNode; wire: WireNode }[] = [{ sem: root, wire: out }];
  while (stack.length > 0) {
    const { sem, wire } = stack.pop()!;
    for (let i = 0; i < sem.children.length; i++) {
      const child = sem.children[i]!;
      const w = make(child, wire.id + pathStep(i));
      wire.children.push(w);
      stack.push({ sem: child, wire: w });
    }
  }
  return out;
}

/**
 * Transport form. A WireGame is a tree nested one object level per ply, and
 * Electron IPC's structured clone RECURSES over it — a 3,000-ply mainline
 * overflows the clone stack and the handler throws "An object could not be
 * cloned", leaving the renderer with no document at all. Games therefore
 * cross IPC flat: nodes in BFS order with a parent index, rebuilt into the
 * same WireGame shape on the renderer side. Both directions are iterative
 * and preserve sibling order (BFS emits children in push order; unpack
 * appends in array order).
 */
export interface PackedWireNode extends Omit<WireNode, "children"> {
  /** Index into `flat` of the parent node; -1 = child of the game root. */
  parent: number;
}
export interface PackedWireGame extends Omit<WireGame, "children"> {
  flat: PackedWireNode[];
}

export function packWireGame(g: WireGame): PackedWireGame {
  const flat: PackedWireNode[] = [];
  const queue: { node: WireNode; parent: number }[] = [];
  for (const c of g.children) queue.push({ node: c, parent: -1 });
  for (let qi = 0; qi < queue.length; qi++) {
    const { node, parent } = queue[qi]!;
    const { children, ...rest } = node;
    const here = flat.length;
    flat.push({ ...rest, parent });
    for (const c of children) queue.push({ node: c, parent: here });
  }
  const { children: _root, ...gameRest } = g;
  return { ...gameRest, flat };
}

export function unpackWireGame(p: PackedWireGame): WireGame {
  const { flat, ...gameRest } = p;
  const nodes: WireNode[] = flat.map((f) => {
    const { parent: _parent, ...rest } = f;
    return { ...rest, children: [] };
  });
  const game: WireGame = { ...gameRest, children: [] };
  for (let i = 0; i < flat.length; i++) {
    const parent = flat[i]!.parent;
    (parent === -1 ? game.children : nodes[parent]!.children).push(nodes[i]!);
  }
  return game;
}

export function toWireGame(
  index: number,
  sem: SemGame,
  tags: Map<string, string>,
  entry: GameEntry,
  readOnly: boolean,
  dirty: boolean,
  duplicateTagNames: string[] = [],
): WireGame {
  return {
    index,
    initialFen: sem.initialFen,
    children: sem.children.map((c, i) => wireNode(c, pathStep(i))),
    rootComments: sem.rootComments.map(wireComment),
    tags: [...tags.entries()],
    duplicateTagNames,
    resultText: sem.resultText,
    resultConflict: sem.resultConflict,
    stuck: sem.stuck,
    positionError: sem.positionError,
    readOnly,
    dirty,
    plyCount: sem.plyCount,
    flags: entry.flags,
  };
}

/** Resolve a wire path back to the semantic node (shared codec). */
export function nodeAtPath(sem: SemGame, id: string): SemNode | null {
  return resolvePath<SemNode>(sem.children, id);
}

export function toWireRow(i: number, g: GameEntry): WireRow {
  const h = g.headers;
  return {
    i,
    white: h.white ?? h.chapterName ?? "",
    black: h.black ?? "",
    whiteElo: h.whiteElo ?? "",
    blackElo: h.blackElo ?? "",
    event: h.event ?? "",
    date: h.date ?? "",
    result: h.result ?? "",
    flags: g.flags,
    hasMovetext: g.hasMovetext,
  };
}

export { GFLAG };
