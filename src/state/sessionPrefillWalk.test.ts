/**
 * #276 Phase 3 — walking a real session and prefilling every set the way the
 * screen does.
 *
 * The two defects this file exists for MASK EACH OTHER, which is why every
 * unit-level assertion in `sessionPresenter.perSet.test.ts` passed while the
 * athlete saw one flat weight for a whole warmup ramp:
 *
 *  - C1: the prefill effect's async upgrade never landed after the first set,
 *    so `computeSetPrefill`'s per-set indexing was evaluated once per exercise.
 *  - C2: even when it did land, the athlete's last set outranked the plan
 *    unconditionally, so rank 1 flattened the ramp anyway.
 *
 * Fixing either alone changes nothing observable. So the test is a WALK: start
 * a real session from a real database through the real engine, and at every
 * stop compute the prefill exactly the way `src/app/session.tsx` does — the
 * synchronous pass, then the async upgrade behind `historyPrefillStillApplies`
 * — accept it, log it, and move on.
 *
 * `session.tsx` itself is invisible to every jest suite (AGENTS.md Testing
 * gotchas), so the effect's *dependency array* is pinned separately and
 * structurally by `sessionPrefillWiring.static.test.ts`. What is mirrored here
 * is everything the effect calls, in the order it calls it.
 */

import { createTestDatabase } from '@/db/test-helpers';
import { createEngine } from '@/engine';
import type { SessionState } from '@/engine/types';
import { startSessionFromRoutine } from './startSessionFromRoutine';
import { getPrescribedSetsForEntry } from './routineSetPlans';
import {
  computeSetPrefill,
  historyPrefillStillApplies,
  type SetInputValues,
} from './sessionPresenter';
import { lbsToKg } from './weightUnits';

/** The Hevy Bench Press (Dumbbell) ramp: three ascending warmups, four working sets. */
const RAMP_SETS = [
  { set_type: 'warmup', target_reps: 5, target_weight_kg: 9.07 },
  { set_type: 'warmup', target_reps: 5, target_weight_kg: 11.34 },
  { set_type: 'warmup', target_reps: 3, target_weight_kg: 18.14 },
  { set_type: 'normal', target_reps: 8, target_reps_max: 10, target_weight_kg: 22.68 },
  { set_type: 'normal', target_reps: 8, target_reps_max: 10, target_weight_kg: 22.68 },
];

/** FLAT: 3 x 8 at one load. Nothing varies, so the plan never asserts itself. */
const FLAT_SETS = [
  { set_type: 'normal', target_reps: 8, target_weight_kg: 22.68 },
  { set_type: 'normal', target_reps: 8, target_weight_kg: 22.68 },
  { set_type: 'normal', target_reps: 8, target_weight_kg: 22.68 },
];

/** REPS DROP: the reps vary, the load does not. The discriminating fixture. */
const REPS_DROP_SETS = [
  { set_type: 'normal', target_reps: 8, target_weight_kg: 22.68 },
  { set_type: 'normal', target_reps: 8, target_weight_kg: 22.68 },
  { set_type: 'normal', target_reps: 6, target_weight_kg: 22.68 },
];

async function seedRoutine(db: any, routineId: string, sets: any[]): Promise<void> {
  await db.write(async () => {
    await db.get('routines').create((r: any) => {
      r._raw.id = routineId;
      r.name = 'Push';
      r._raw.created_at = Date.now();
      r._raw.updated_at = Date.now();
    });
    await db.get('exercises').create((e: any) => {
      e._raw.id = 'bench-press-dumbbell';
      e.title = 'Bench Press (Dumbbell)';
      e._raw.kind = 'strength';
      e._raw.created_at = Date.now();
    });
    const re = await db.get('routine_exercises').create((row: any) => {
      row._raw.routine_id = routineId;
      row._raw.exercise_id = 'bench-press-dumbbell';
      row._raw.order = 0;
      row._raw.rest_seconds = 0;
    });
    for (const [order, set] of sets.entries()) {
      await db.get('routine_sets').create((row: any) => {
        row._raw.routine_exercise_id = re.id;
        row._raw.order = order;
        row._raw.set_type = set.set_type;
        if (set.target_reps != null) row._raw.target_reps = set.target_reps;
        if (set.target_reps_max != null) row._raw.target_reps_max = set.target_reps_max;
        if (set.target_weight_kg != null) row._raw.target_weight_kg = set.target_weight_kg;
      });
    }
  });
}

/**
 * What `src/app/session.tsx`'s prefill effect computes for the state on screen:
 * the synchronous pass first, then the DB-backed upgrade — applied only when
 * `historyPrefillStillApplies` still holds for the state the read was made for.
 */
async function screenPrefill(
  db: any,
  state: SessionState,
  historyFallback?: SetInputValues
): Promise<SetInputValues | undefined> {
  const entry = state.entries[state.exerciseIndex];
  const synchronous = computeSetPrefill(state);

  const prescribedSets = await getPrescribedSetsForEntry(db, state.routineId, entry.idx);
  if (
    !historyPrefillStillApplies(state, {
      sessionId: state.sessionId,
      exerciseIndex: state.exerciseIndex,
      exerciseId: entry.exerciseId,
      setIndex: state.setIndex,
    })
  ) {
    return synchronous;
  }
  return computeSetPrefill(state, historyFallback, prescribedSets);
}

interface WalkStep {
  reps?: number;
  weightLbs?: number;
}

/**
 * Walk the session, prefilling and accepting every set.
 *
 * `deviations` lets the athlete log something other than what was offered at a
 * given set index, which is how the "the athlete corrected the plan" cases are
 * built. The recorded value is always what was OFFERED, not what was logged.
 */
async function walk(
  db: any,
  routineId: string,
  options: {
    history?: SetInputValues;
    deviations?: Record<number, WalkStep>;
  } = {}
): Promise<WalkStep[]> {
  const engine = createEngine({});
  let state = await engine.dispatch(
    await startSessionFromRoutine(db, routineId, `session-${routineId}`)
  );

  const offered: WalkStep[] = [];
  let guard = 0;
  while (state.phase !== 'done' && guard < 40) {
    guard += 1;
    if (state.phase === 'resting') {
      state = await engine.dispatch({ tag: 'SkipRest' });
      continue;
    }

    const prefill = await screenPrefill(db, state, options.history);
    offered.push({ reps: prefill?.reps, weightLbs: prefill?.weightLbs });

    const logged = options.deviations?.[offered.length - 1] ?? {
      reps: prefill?.reps,
      weightLbs: prefill?.weightLbs,
    };
    state = await engine.dispatch({
      tag: 'LogSet',
      reps: logged.reps,
      weightKg: logged.weightLbs != null ? lbsToKg(logged.weightLbs) : undefined,
      nowMs: 0,
    });
  }

  return offered;
}

describe('the prefill an athlete actually sees, set by set (#276 C1 + C2)', () => {
  it('RAMP: every set is offered its own prescription, not the previous one', async () => {
    const db = await createTestDatabase();
    await seedRoutine(db, 'routine-ramp', RAMP_SETS);

    expect(await walk(db, 'routine-ramp')).toEqual([
      { reps: 5, weightLbs: 20 },
      { reps: 5, weightLbs: 25 },
      { reps: 3, weightLbs: 40 },
      { reps: 8, weightLbs: 50 },
      { reps: 8, weightLbs: 50 },
    ]);
  });

  it("RAMP with cross-session history: the plan owns set 0's reps too", async () => {
    // The athlete has benched 8 x 175 before. History must not overwrite the
    // ramp's own rep counts — not even on the first set, where there is no
    // previous set to compare against but the plan is plainly per-set.
    const db = await createTestDatabase();
    await seedRoutine(db, 'routine-ramp-history', RAMP_SETS);

    expect(await walk(db, 'routine-ramp-history', { history: { reps: 8, weightLbs: 175 } })).toEqual(
      [
        { reps: 5, weightLbs: 20 },
        { reps: 5, weightLbs: 25 },
        { reps: 3, weightLbs: 40 },
        { reps: 8, weightLbs: 50 },
        { reps: 8, weightLbs: 50 },
      ]
    );
  });

  it('FLAT: an athlete who drops the weight keeps the lighter load for the rest', async () => {
    // 3 x 8 @ 50. The athlete finds 50 too heavy and does 45. The plan intends
    // no change from set to set, so it must not drag 50 back.
    const db = await createTestDatabase();
    await seedRoutine(db, 'routine-flat', FLAT_SETS);

    expect(
      await walk(db, 'routine-flat', { deviations: { 0: { reps: 8, weightLbs: 45 } } })
    ).toEqual([
      { reps: 8, weightLbs: 50 },
      { reps: 8, weightLbs: 45 },
      { reps: 8, weightLbs: 45 },
    ]);
  });

  it('REPS DROP: the planned rep change lands while the deviated load survives', async () => {
    // 8/8/6 @ 50, athlete deviates to 45 on set 0. The reps change at set 2 is
    // planned; the weight change is not. This is the fixture that tells the
    // field-wise rule apart from a set-wise one — a set-wise comparison sees
    // set 2 differ AS A SET and drags the weight back to 50.
    const db = await createTestDatabase();
    await seedRoutine(db, 'routine-reps-drop', REPS_DROP_SETS);

    expect(
      await walk(db, 'routine-reps-drop', { deviations: { 0: { reps: 8, weightLbs: 45 } } })
    ).toEqual([
      { reps: 8, weightLbs: 50 },
      { reps: 8, weightLbs: 45 },
      { reps: 6, weightLbs: 45 },
    ]);
  });

  // "AGGREGATE-ONLY: the coach-prescribed row load reaches every set (#276
  // C3)" and "AGGREGATE-ONLY: a uniform plan still defers to history for
  // reps on set 0" deleted (#276 Phase 6): both seeded a routine with
  // aggregate columns (warmup_sets/target_sets/target_reps/target_weight_kg)
  // and zero `routine_sets` rows — "what `acceptDraft` produces TODAY" per
  // their own comments, at a point before Phase 4 gave `acceptDraft` a set
  // list. `acceptDraft` has written `routine_sets` rows since Phase 4, and
  // Phase 6 deleted the aggregate columns and the fallback that read them,
  // so that fixture shape is now a routine with NO prescribed sets at all —
  // `startSessionFromRoutine` correctly refuses to start it ("no entry with
  // any sets to perform"), which is not a bug to route around here. The
  // walk's other cases (RAMP, FLAT, REPS DROP) already cover the
  // prescription-vs-history precedence this pair existed to pin, through
  // real `routine_sets` rows.
});
