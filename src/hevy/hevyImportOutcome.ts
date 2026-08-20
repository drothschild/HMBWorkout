/**
 * The user-facing wording of a Hevy import (#267 Phase 3).
 *
 * Pure, for the reason `exportOutcome` and `routineImportOutcome` are pure:
 * `src/app` has no jest project (AGENTS.md), so a branch written inline in the
 * Data screen is a decision no suite can execute. Every arm the screen can
 * reach is enumerated here.
 *
 * ## Two things here are load-bearing, not cosmetic
 *
 * **The lossiness summary is what the user reads BEFORE the write.** That
 * ordering is the design's whole answer to "we could not represent X", and it
 * is why `hevyLossinessSummary` returns `null` for "nothing was lost" rather
 * than `''` — the screen must render no panel at all in that case, and an
 * empty string is a panel with nothing in it.
 *
 * **AC3.9 extends past the client.** `HevyHttpError.message` carries Hevy's raw
 * response body, and this module never interpolates it. The banner is worded
 * from the STATUS alone, which makes "the API key cannot reach the screen" a
 * structural property rather than a hope that no error body ever echoes it.
 * `__tests__/hevyImportOutcome.test.ts` proves that with a deliberately leaky
 * error whose message contains the key.
 */

import { HevyHttpError, HevyUnreachable } from './hevyClient';
import type { HevyLossinessNote, HevyMapError } from './hevyRoutineMap';

/**
 * Everything the import could not carry, as one block of prose — or `null`
 * when it carried everything.
 *
 * Each note supplies its own sentence, already naming its subjects, so this
 * only joins them. A count would defeat the point (AC3.8): "3 things were
 * lost" tells the user nothing they can act on.
 */
export function hevyLossinessSummary(notes: readonly HevyLossinessNote[]): string | null {
  if (notes.length === 0) return null;
  return notes.map((note) => note.message).join('\n\n');
}

export type HevyImportOutcome =
  /** The routine was written. */
  | { kind: 'imported'; name: string }
  /** The user backed out before the write. */
  | { kind: 'cancelled' }
  /** No key is stored, so there was nothing to call with. */
  | { kind: 'no-key' }
  /** The key is stored but the account has no routines to import. */
  | { kind: 'no-routines' }
  /** `fetch` never reached Hevy. */
  | { kind: 'unreachable'; error: HevyUnreachable }
  /** Hevy answered, but not with a routine. */
  | { kind: 'http-error'; error: HevyHttpError }
  /** `mapHevyRoutine` refused the payload; nothing was written. */
  | { kind: 'refused'; error: HevyMapError };

/**
 * Word an HTTP failure from its status, and only from its status.
 *
 * The `401`/`403` arm is split out because it is the one the user can actually
 * fix, and telling someone with a mistyped key to "try again later" sends them
 * down the wrong path entirely.
 */
function httpMessage(status: number): string {
  if (status === 401 || status === 403) {
    return 'Hevy did not accept that API key. Check it in Hevy’s settings and paste it again.';
  }
  if (status === 404) {
    return 'That routine is no longer in your Hevy account.';
  }
  if (status === 429) {
    return 'Hevy is rate-limiting this app. Wait a minute and try again.';
  }
  if (status >= 500) {
    return 'Hevy had a server error. Nothing was imported; try again shortly.';
  }
  return `Hevy refused the request (HTTP ${status}). Nothing was imported.`;
}

/**
 * The banner text, or `null` for "show no banner".
 *
 * `null` is only ever the cancelled arm: backing out is not an outcome worth
 * reporting, while every other arm — including all four failures — must reach
 * the user.
 */
export function hevyImportOutcome(outcome: HevyImportOutcome): string | null {
  switch (outcome.kind) {
    case 'cancelled':
      return null;
    case 'imported':
      return `Imported “${outcome.name}” from Hevy. It's on the Routines tab.`;
    case 'no-key':
      return 'Add your Hevy API key first. You can create one in Hevy under Settings → Developer.';
    case 'no-routines':
      return 'That Hevy account has no routines to import.';
    case 'unreachable':
      // Deliberately does NOT mention the key: an offline phone and a rejected
      // key are different problems and must not read the same.
      return 'Could not reach Hevy. Check your connection and try again.';
    case 'http-error':
      // The status only. `outcome.error.message` carries Hevy's raw response
      // body and is never interpolated (AC3.9).
      return httpMessage(outcome.error.status);
    case 'refused':
      return `Could not import that routine. ${outcome.error.message}`;
  }
}
