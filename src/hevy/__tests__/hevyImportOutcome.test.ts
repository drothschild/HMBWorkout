/**
 * `hevyLossinessSummary` / `hevyImportOutcome` — the wording of the Hevy import
 * (#267 Phase 3).
 *
 * Pure, for the reason `exportOutcome` and `routineImportOutcome` are pure:
 * `src/app` has no jest project, so a branch written inline in the Data screen
 * is a decision no suite can execute. Two things here are load-bearing rather
 * than cosmetic:
 *
 * - **The lossiness summary is what the user sees BEFORE the write.** An empty
 *   summary and a suppressed summary are different outcomes, and the screen
 *   must not be the thing that decides which one happened.
 * - **AC3.9 extends to the banner.** The presenter words its own message from
 *   the HTTP status and never interpolates `HevyHttpError.message`, which
 *   carries Hevy's raw response body. That is a structural guarantee the key
 *   cannot reach the screen, not a hope that the body never echoes it.
 */

import { HevyHttpError, HevyUnreachable } from '../hevyClient';
import type { HevyLossinessNote } from '../hevyRoutineMap';
import { hevyImportOutcome, hevyLossinessSummary } from '../hevyImportOutcome';
import { mapHevyRoutine } from '../hevyRoutineMap';
import { loadRoutineFixture } from './loadFixture';

const KEY = 'hevy-secret-key-1a2b3c4d-DO-NOT-LEAK';

const NOTE: HevyLossinessNote = {
  code: 'superset-demoted',
  subjects: ['Squat (Barbell)', 'Calf Raise (Machine)'],
  message: 'Superset 1 is split; Squat (Barbell) and Calf Raise (Machine) were imported as ordinary exercises.',
};

describe('hevyLossinessSummary', () => {
  it('returns null when nothing was lost, so the screen shows no panel at all', () => {
    expect(hevyLossinessSummary([])).toBeNull();
  });

  it('renders every note’s own wording, so no loss is reduced to a count', () => {
    const summary = hevyLossinessSummary([NOTE]);

    expect(summary).toContain('Squat (Barbell)');
    expect(summary).toContain('Calf Raise (Machine)');
    expect(summary).not.toMatch(/\b1 (item|thing|change)\b/);
  });

  it('names every subject of the real PUSH mapping', () => {
    const result = mapHevyRoutine(loadRoutineFixture('hevy-push-routine'));
    if (!result.ok) throw new Error('PUSH must map');

    const summary = hevyLossinessSummary(result.lossiness) ?? '';

    // Content, not count (AC3.8): the dropped Hevy ids and the guessed kinds
    // both appear by name.
    expect(summary).toContain('D8F7F851');
    expect(summary).toContain('Stretching → strength');
    expect(summary).toContain('Cycling → cardio');
  });
});

describe('hevyImportOutcome', () => {
  it('reports a successful import by the routine’s name', () => {
    expect(hevyImportOutcome({ kind: 'imported', name: 'Push' })).toContain('Push');
  });

  it('shows no banner when the user backed out', () => {
    expect(hevyImportOutcome({ kind: 'cancelled' })).toBeNull();
  });

  it('tells the user to add a key when none is stored', () => {
    expect(hevyImportOutcome({ kind: 'no-key' })).toMatch(/key/i);
  });

  it('distinguishes a rejected key from any other HTTP failure', () => {
    const unauthorized = hevyImportOutcome({
      kind: 'http-error',
      error: new HevyHttpError(401, 'HTTP 401: Unauthorized'),
    });
    const rateLimited = hevyImportOutcome({
      kind: 'http-error',
      error: new HevyHttpError(429, 'HTTP 429: Too Many Requests'),
    });

    expect(unauthorized).toMatch(/key/i);
    expect(rateLimited).not.toEqual(unauthorized);
  });

  it('words the offline case as offline, not as a rejected key', () => {
    const message = hevyImportOutcome({
      kind: 'unreachable',
      error: new HevyUnreachable('getaddrinfo ENOTFOUND api.hevyapp.com'),
    });

    expect(message).toMatch(/connect|offline|reach/i);
    expect(message).not.toMatch(/key/i);
  });

  it('surfaces a mapper refusal so a routine that wrote nothing says so', () => {
    const message = hevyImportOutcome({
      kind: 'refused',
      error: { code: 'no-planned-sets', message: 'That Hevy routine plans no sets, so it could never be started.' },
    });

    expect(message).toContain('plans no sets');
  });

  it('AC3.9 — never lets the API key reach the banner, even when the body echoes it', () => {
    // A hostile-shaped body: the error message CONTAINS the key. The presenter
    // words its own message from the status and never interpolates
    // `error.message`, so the key cannot travel through it.
    const leaky = new HevyHttpError(401, `HTTP 401: bad api-key ${KEY}`);

    for (const outcome of [
      hevyImportOutcome({ kind: 'http-error', error: leaky }),
      hevyImportOutcome({ kind: 'unreachable', error: new HevyUnreachable(`failed for ${KEY}`) }),
    ]) {
      expect(String(outcome)).not.toContain(KEY);
    }
  });
});
