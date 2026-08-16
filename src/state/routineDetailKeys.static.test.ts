/**
 * Static gate for the superset container's React key in the routine detail
 * screen (`src/app/routine/[id].tsx`).
 *
 * `RoutineDetailItem.label` is not routine-unique — per its own docstring in
 * `routineDetailPresenter.ts` (and engine convention 9, AGENTS.md), a later
 * superset run can legitimately reuse an earlier run's label while remaining
 * a distinct, non-adjacent group. Keying the superset `View` on `item.label`
 * would therefore collide between two sibling items sharing a label, which
 * corrupts React's reconciliation between them (stale children, lost focus,
 * duplicate-key warnings). The correct key is the first member's
 * `routineExerciseId` — a `routine_exercises` row id, unique per row.
 *
 * `src/app` has no jest coverage (AGENTS.md, Testing gotchas: screens are
 * untested by `npm test`), so nothing can render this screen and assert on
 * the DOM's key prop directly. Modeled on the precedent in
 * `src/state/activeSession.callSites.test.ts`: reading the file as text
 * (rather than importing it) is deliberate, since the file under test is a
 * `.tsx` screen full of RN/expo-router imports the node jest project cannot
 * load. A structural read of the source is the criterion here, same as
 * AGENTS.md's AC6.9 precedent for `session.tsx:303`.
 */

import * as fs from 'fs';
import * as path from 'path';

const SCREEN_PATH = path.resolve(__dirname, '../app/routine/[id].tsx');

describe('routine/[id].tsx superset container key', () => {
  const source = fs.readFileSync(SCREEN_PATH, 'utf-8');

  it('reads the screen source (guards against a broken path silently passing vacuously)', () => {
    expect(source.length).toBeGreaterThan(500);
  });

  it("keys the superset container on the first member's routineExerciseId, not the label", () => {
    expect(source).toContain('key={item.exercises[0].routineExerciseId}');
    expect(source).not.toContain('key={item.label');
    expect(source).not.toContain('key={`${item.label}');
  });

  it('keeps both ExerciseRow call sites keyed on routineExerciseId', () => {
    expect(source).toContain('key={exercise.routineExerciseId}');
    expect(source).toContain('key={item.exercise.routineExerciseId}');
  });
});
