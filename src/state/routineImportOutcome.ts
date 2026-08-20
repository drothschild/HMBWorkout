/**
 * The user-facing message for a routine import (#267 Phase 2).
 *
 * A pure presenter for the same reason `exportOutcome` is one: `src/app` has no
 * jest project, so a branch written inline in the Data screen is a decision no
 * suite can execute. Every arm the screen can reach is enumerated here, which
 * is also what stops a refusal from rendering as a success — the failure mode
 * that matters, since a refused import writes nothing and the user has only
 * this banner to tell them so.
 */

import type { RoutineImportError } from '@/interop/importRoutine';

export type RoutineImportOutcome =
  /** `applyRoutineImport` wrote the routine. */
  | { kind: 'imported'; name: string }
  /** The user dismissed the document picker. */
  | { kind: 'cancelled' }
  /** The file could not be read off disk at all. */
  | { kind: 'unreadable' }
  /** `importRoutine` refused the document; nothing was written. */
  | { kind: 'refused'; error: RoutineImportError };

/**
 * The banner text, or `null` for "show no banner".
 *
 * `null` is only ever the cancelled arm: backing out of the picker is not an
 * outcome worth reporting, while every other arm — including the two failures —
 * must reach the user.
 */
export function routineImportOutcome(outcome: RoutineImportOutcome): string | null {
  switch (outcome.kind) {
    case 'cancelled':
      return null;
    case 'imported':
      return `Imported “${outcome.name}”. It's on the Routines tab.`;
    case 'unreadable':
      return 'Could not read that file. Please try again.';
    case 'refused':
      // The importer's own wording, prefixed so the banner reads as a refusal
      // rather than as a description of something that happened.
      return `Could not import that file. ${outcome.error.message}`;
  }
}
