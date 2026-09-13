/**
 * Sound player. Audio-element pools per URL so autorepeat navigation never
 * cuts a clip off mid-decay. The current node's token (SAN as written)
 * classifies the event.
 */

import type { SoundEvent, SoundTheme } from "./sound-themes";

import { useBoardPreferencesStore } from "../../store/board-preferences-store";
import { useDocumentStore, nodeById } from "../../store/document-store";
import {
  SOUND_EVENT,
  SOUND_THEMES,
  getSoundUrl,
  soundEventForSan,
} from "./sound-themes";

/**
 * How many elements back each URL. Holding an arrow key steps faster than a
 * clip's tail, and a single element would cut the previous sound off.
 */
const POOL_SIZE = 3;

interface Pool {
  elements: HTMLAudioElement[];
  next: number;
}

const pools = new Map<string, Pool>();

function getPool(url: string): Pool | null {
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;

  const existing = pools.get(url);

  if (existing) return existing;

  const pool: Pool = {
    elements: Array.from({ length: POOL_SIZE }, () => {
      const el = new Audio(url);

      el.preload = "auto";

      return el;
    }),
    next: 0,
  };

  pools.set(url, pool);

  return pool;
}

/**
 * Warms the pool for every event a theme provides, so the first move of a
 * session does not wait on a file read. Idempotent.
 */
export function preloadSoundTheme(theme: SoundTheme): void {
  if (typeof window === "undefined") return;

  for (const event of SOUND_THEMES[theme].events) {
    getPool(getSoundUrl(theme, event));
  }
}

/**
 * Plays `event` in the user's chosen theme at their chosen volume, honouring
 * the master toggle.
 */
export function playSound(event: SoundEvent): void {
  const { soundEnabled, soundTheme, soundVolume } =
    useBoardPreferencesStore.getState();

  if (!soundEnabled || soundVolume <= 0) return;

  playSoundPreview(soundTheme, event, soundVolume);
}

/**
 * Plays a specific theme/event at an explicit volume, bypassing the master
 * toggle, so the settings picker can audition a theme while sound is off.
 *
 * The rejection from `play()` is swallowed: the browser refuses until it has
 * seen a user gesture, which is expected on a cold page.
 */
export function playSoundPreview(
  theme: SoundTheme,
  event: SoundEvent,
  volume: number,
): void {
  const pool = getPool(getSoundUrl(theme, event));

  if (!pool) return;

  const el = pool.elements[pool.next];

  pool.next = (pool.next + 1) % pool.elements.length;

  if (!el) return;
  el.volume = Math.max(0, Math.min(1, volume));
  el.currentTime = 0;
  el.play().catch(() => {});
}

/**
 * Plays the sound for the move the document cursor is currently sitting on.
 * Landing on the root leaves no move to characterise, so it falls back to a
 * plain move. Null moves make no piece sound worth telling apart.
 */
export function playMoveSoundForCursor(): void {
  const { game, currentId } = useDocumentStore.getState();
  const node = game && currentId !== "" ? nodeById(game, currentId) : null;

  playSound(node?.san ? soundEventForSan(node.san) : SOUND_EVENT.MOVE);
}

/**
 * Runs a navigation action and plays the sound for the move it landed on,
 * staying silent when the cursor did not move (already at the start or end
 * of a line).
 */
export function withMoveSound(action: () => void): void {
  const before = useDocumentStore.getState().currentId;

  action();

  if (useDocumentStore.getState().currentId === before) return;

  playMoveSoundForCursor();
}
