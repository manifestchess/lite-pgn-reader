/**
 * NAG glyphs and annotation colours.
 *
 * Colours are named for what they mark rather than for the hue, and each is
 * a per-theme token (styles/globals.css --nag-*): as move text these must
 * hold 4.5:1, and the luminance window that clears 4.5 on a cream bed sits
 * below the one that clears it on a near-black bed, so no single value
 * satisfies both themes.
 */
const AnnotationColor = {
  green: "var(--nag-good)",
  teal: "var(--nag-brilliant)",
  purple: "var(--nag-interesting)",
  yellow: "var(--nag-dubious)",
  orange: "var(--nag-mistake)",
  red: "var(--nag-blunder)",
  violet: "var(--nag-novelty)",
} as const;

interface NagDef {
  id: number;
  symbol: string;
  color?: string;
}

/** Single source of truth for all NAG definitions, keyed by name. */
const NAGS = {
  GoodMove: { id: 1, symbol: "!", color: AnnotationColor.green },
  Mistake: { id: 2, symbol: "?", color: AnnotationColor.orange },
  BrilliantMove: { id: 3, symbol: "‼", color: AnnotationColor.teal },
  Blunder: { id: 4, symbol: "⁇", color: AnnotationColor.red },
  InterestingMove: { id: 5, symbol: "⁉", color: AnnotationColor.purple },
  DubiousMove: { id: 6, symbol: "⁈", color: AnnotationColor.yellow },
  ForcedMove: { id: 7, symbol: "□" },
  SingularMove: { id: 8, symbol: "□" },
  WorstMove: { id: 9, symbol: "?!" },
  Drawish: { id: 10, symbol: "=" },
  EqualQuiet: { id: 11, symbol: "=" },
  EqualActive: { id: 12, symbol: "=" },
  Unclear: { id: 13, symbol: "∞" },
  WhiteSlightEdge: { id: 14, symbol: "⩲" },
  BlackSlightEdge: { id: 15, symbol: "⩱" },
  WhiteModerateEdge: { id: 16, symbol: "±" },
  BlackModerateEdge: { id: 17, symbol: "∓" },
  WhiteDecisive: { id: 18, symbol: "+−" },
  BlackDecisive: { id: 19, symbol: "−+" },
  WhiteCrushing: { id: 20, symbol: "+−" },
  BlackCrushing: { id: 21, symbol: "−+" },
  WhiteZugzwang: { id: 22, symbol: "⨀" },
  BlackZugzwang: { id: 23, symbol: "⨀" },
  WhiteSpace: { id: 26, symbol: "○" },
  BlackSpace: { id: 27, symbol: "○" },
  WhiteDevelopment: { id: 32, symbol: "⟳" },
  BlackDevelopment: { id: 33, symbol: "⟳" },
  WhiteInitiative: { id: 36, symbol: "→" },
  BlackInitiative: { id: 37, symbol: "→" },
  WhiteAttack: { id: 40, symbol: "↑" },
  BlackAttack: { id: 41, symbol: "↑" },
  WhiteCompensation: { id: 44, symbol: "=/∞" },
  BlackCompensation: { id: 45, symbol: "=/∞" },
  WhiteCounterplay: { id: 130, symbol: "⇄" },
  BlackCounterplay: { id: 131, symbol: "⇄" },
  WhiteCounterplayAlt: { id: 132, symbol: "⇆" },
  BlackCounterplayAlt: { id: 133, symbol: "⇆" },
  WhiteTimeTrouble: { id: 136, symbol: "⨁" },
  BlackTimeTrouble: { id: 137, symbol: "⨁" },
  WhiteSevereTime: { id: 138, symbol: "⨁" },
  BlackSevereTime: { id: 139, symbol: "⨁" },
  WithTheIdea: { id: 140, symbol: "∆" },
  AimedAgainst: { id: 141, symbol: "∇" },
  BetterIs: { id: 142, symbol: "⌓" },
  WorseIs: { id: 143, symbol: "□" },
  EquivalentIs: { id: 144, symbol: "=" },
  EditorialComment: { id: 145, symbol: "RR" },
  Novelty: { id: 146, symbol: "N", color: AnnotationColor.violet },
} satisfies Record<string, NagDef>;

type NagKey = keyof typeof NAGS;

/** Name → NAG id */
export const Nag: { [K in NagKey]: number } = Object.fromEntries(
  Object.entries(NAGS).map(([name, def]) => [name, def.id]),
) as never;

const allDefs = Object.values(NAGS) as NagDef[];
const symbolById: Record<number, string> = Object.fromEntries(
  allDefs.map((d) => [d.id, d.symbol]),
);
const colorById: Record<number, string> = Object.fromEntries(
  allDefs.flatMap((d) => (d.color ? [[d.id, d.color] as const] : [])),
);

export function nagToSymbol(nag: number): string {
  return symbolById[nag] ?? `$${nag}`;
}

export function nagSymbols(nags: number[]): string {
  return nags.map(nagToSymbol).join("");
}

export function nagColor(nags: number[]): string | undefined {
  for (const nag of nags) {
    if (nag in colorById) return colorById[nag];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Groups (GlyphSelector + single-key entry)
// ---------------------------------------------------------------------------

/** Move quality NAGs (mutually exclusive within this group). */
export const MOVE_NAGS = [1, 2, 3, 4, 5, 6, 7, 146] as const;
/** Position evaluation NAGs (mutually exclusive within this group). */
export const POSITION_NAGS = [10, 13, 14, 15, 16, 17, 18, 19] as const;

export const MOVE_NAG_SET: ReadonlySet<number> = new Set<number>(MOVE_NAGS);
export const POSITION_NAG_SET: ReadonlySet<number> = new Set<number>(POSITION_NAGS);

/** English labels for the selector tooltips (the app ships English only). */
export const NAG_LABELS: Record<number, string> = {
  1: "Good move",
  2: "Mistake",
  3: "Brilliant move",
  4: "Blunder",
  5: "Interesting move",
  6: "Dubious move",
  7: "Forced move",
  146: "Novelty",
  10: "Equal position",
  13: "Unclear position",
  14: "White is slightly better",
  15: "Black is slightly better",
  16: "White is better",
  17: "Black is better",
  18: "White is winning",
  19: "Black is winning",
};

// ---------------------------------------------------------------------------
// Suffix annotations ("e4!?") and single-key entry
// ---------------------------------------------------------------------------

/** PGN suffix annotation → NAG id (the six standard suffixes). */
export const SUFFIX_TO_NAG: Record<string, number> = {
  "!": 1,
  "?": 2,
  "!!": 3,
  "??": 4,
  "!?": 5,
  "?!": 6,
};

/** NAG id for a composed !/? key sequence, or null when it is not one. */
export function nagForSuffix(seq: string): number | null {
  return SUFFIX_TO_NAG[seq] ?? null;
}

/**
 * Toggle a move-class NAG into an existing NAG list: pressing the glyph a
 * move already carries removes it; otherwise it replaces the other members
 * of its exclusive group. Position-class and unknown NAGs are preserved.
 */
export function toggleGroupNag(existing: number[], nag: number): number[] {
  if (existing.includes(nag)) return existing.filter((n) => n !== nag);
  const group = MOVE_NAG_SET.has(nag) ? MOVE_NAG_SET : POSITION_NAG_SET;
  return [...existing.filter((n) => !group.has(n)), nag];
}

/**
 * NAGs to render after a move token. A suffix fused into the token itself
 * ("e4!") is surfaced as a NAG by the semantic layer while the bytes keep
 * the suffix, so rendering every NAG would print the glyph twice. Drop the
 * one occurrence the visible token already carries.
 */
export function displayNags(text: string, nags: number[]): number[] {
  const m = text.match(/[!?]{1,2}$/);
  if (!m) return nags;
  const fused = SUFFIX_TO_NAG[m[0]];
  if (fused === undefined) return nags;
  const i = nags.indexOf(fused);
  if (i < 0) return nags;
  return [...nags.slice(0, i), ...nags.slice(i + 1)];
}
