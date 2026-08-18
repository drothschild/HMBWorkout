/**
 * Phase 1 of #276: a routine entry owns an ordered list of prescribed sets.
 *
 * The aggregate model — one `routine_exercises` row saying "3 warmup sets, 4
 * working sets, 8 reps, 22.68 kg" — cannot express a warmup ramp. RAMP below is
 * the user's real Hevy Bench Press prescription (9.07 → 11.34 → 18.14 kg), and
 * it is the discriminating fixture precisely because no pair of counts can hold
 * it: any regression to counts collapses three distinct warmup weights to one.
 *
 * Phase 1 was additive: `routine_exercises` kept its aggregate columns and
 * `upsertRoutine` kept writing them, derived from the set list, so every
 * existing reader still worked while the list was proven out. #276 Phase 6
 * deleted the aggregate columns and their derivation outright — `routine_sets`
 * is now the only representation of the plan, so there is nothing left to keep
 * consistent. The tests that pinned that derivation are gone with it; see the
 * note ahead of "AC1.4" below.
 */

import { Database, Q } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from './test-helpers';
import {
  appendSet,
  createSession,
  getExerciseWorkingSetHistory,
  getRoutineSets,
  upsertExercise,
  upsertRoutine,
  type RoutineExerciseEntry,
  type RoutineSetEntry,
} from './repository';

const ROUTINE_ID = 'routine-per-set';
const BENCH = 'bench-press-dumbbell';

/**
 * RAMP — the real payload from Hevy routine 760bdf23-0a80-4df3-a36d-4af1d55f370b.
 * Three ascending warmups, then four working sets at a rep range.
 */
const RAMP: RoutineSetEntry[] = [
  { setType: 'warmup', targetReps: 5, targetWeightKg: 9.07 },
  { setType: 'warmup', targetReps: 5, targetWeightKg: 11.34 },
  { setType: 'warmup', targetReps: 3, targetWeightKg: 18.14 },
  { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
  { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
  { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
  { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
];

/**
 * INTERLEAVE — [warmup, normal, warmup]. The fixture no count-based derivation
 * can satisfy at ANY value: `warmupSets: 1` reconstructs
 * ['warmup','normal','normal'] and `warmupSets: 2` reconstructs
 * ['warmup','warmup','normal']. Neither is the stored order.
 */
const INTERLEAVE: RoutineSetEntry[] = [
  { setType: 'warmup', targetReps: 5, targetWeightKg: 20 },
  { setType: 'normal', targetReps: 8, targetWeightKg: 60 },
  { setType: 'warmup', targetReps: 5, targetWeightKg: 25 },
];

/** RANGE — an explicit rep range, alongside an exact prescription. */
const RANGE: RoutineSetEntry[] = [
  { setType: 'normal', targetReps: 8, targetRepsMax: 10 },
  { setType: 'normal', targetReps: 8 },
];

describe('Per-set routine model (#276 Phase 1)', () => {
  let database: Database;

  beforeEach(async () => {
    database = createTestDatabase();
    await upsertExercise(database, BENCH, 'Bench Press (Dumbbell)', 'strength');
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  /** The single routine_exercises row for BENCH in ROUTINE_ID. */
  async function benchRow(): Promise<any> {
    const [row] = (await database
      .get('routine_exercises')
      .query(Q.and(Q.where('routine_id', ROUTINE_ID), Q.where('exercise_id', BENCH)))
      .fetch()) as any[];
    return row;
  }

  async function writeBench(sets: RoutineSetEntry[], extra: Partial<RoutineExerciseEntry> = {}) {
    await upsertRoutine(database, ROUTINE_ID, 'Push Day', [
      { exerciseId: BENCH, order: 0, restSeconds: 120, sets, ...extra },
    ]);
  }

  describe('AC1.2 — a warmup ramp round-trips', () => {
    it('stores all seven RAMP sets in order with their own distinct weights', async () => {
      await writeBench(RAMP);

      const sets = await getRoutineSets(database, (await benchRow()).id);

      expect(sets).toHaveLength(7);
      expect(sets.map((s) => s.targetWeightKg)).toEqual([
        9.07, 11.34, 18.14, 22.68, 22.68, 22.68, 22.68,
      ]);
      expect(sets.map((s) => s.setType)).toEqual([
        'warmup',
        'warmup',
        'warmup',
        'normal',
        'normal',
        'normal',
        'normal',
      ]);
      expect(sets.map((s) => s.targetReps)).toEqual([5, 5, 3, 8, 8, 8, 8]);
    });

    it('assigns contiguous 0-based order to the stored rows, so read order is not incidental', async () => {
      await writeBench(RAMP);

      const rows = (await database
        .get('routine_sets')
        .query(Q.where('routine_exercise_id', (await benchRow()).id))
        .fetch()) as any[];

      expect(rows.map((r) => r._raw.order).sort((a: number, b: number) => a - b)).toEqual([
        0, 1, 2, 3, 4, 5, 6,
      ]);
    });

    it('returns sets in `order`, not in whatever order the query happens to yield', async () => {
      // Written deliberately out of order to prove getRoutineSets sorts rather
      // than relying on insertion order. Loki returns insertion order, so a
      // reader with no sort passes on the ramp above and fails here.
      const rowId = await (async () => {
        await writeBench([]);
        return (await benchRow()).id;
      })();

      await database.write(async () => {
        for (const [order, weight] of [
          [2, 18.14],
          [0, 9.07],
          [1, 11.34],
        ] as [number, number][]) {
          await database.get('routine_sets').create((s: any) => {
            s._raw.routine_exercise_id = rowId;
            s._raw.order = order;
            s._raw.set_type = 'warmup';
            s._raw.target_weight_kg = weight;
          });
        }
      });

      const sets = await getRoutineSets(database, rowId);
      expect(sets.map((s) => s.targetWeightKg)).toEqual([9.07, 11.34, 18.14]);
    });
  });

  describe('AC1.3 — rep ranges', () => {
    it('stores and reads back both ends of a range', async () => {
      await writeBench(RANGE);

      const sets = await getRoutineSets(database, (await benchRow()).id);
      expect(sets[0]).toEqual({ setType: 'normal', targetReps: 8, targetRepsMax: 10 });
    });

    it('leaves targetRepsMax absent — not equal to targetReps — for an exact prescription', async () => {
      await writeBench(RANGE);

      const sets = await getRoutineSets(database, (await benchRow()).id);
      // Hevy emits rep_range {start:5,end:5} for exact prescriptions; collapsing
      // that to a bare targetReps is the deliberate, lossless choice. An
      // implementation that back-fills max = reps fails here.
      expect(sets[1].targetRepsMax).toBeUndefined();
      expect(sets[1].targetReps).toBe(8);
    });

    it('normalises WatermelonDB nulls to undefined at the read boundary', async () => {
      await writeBench([{ setType: 'normal' }]);

      const [only] = await getRoutineSets(database, (await benchRow()).id);
      // `!= null`, not `!== undefined`: an unset optional column comes back as
      // null, and a reader that passes it through hands every consumer a value
      // it has to re-check (AGENTS.md).
      expect(only).toEqual({ setType: 'normal' });
      expect(Object.values(only).every((v) => v !== null)).toBe(true);
    });

    it('carries duration and distance, the two fields with no aggregate ancestor', async () => {
      await writeBench([{ setType: 'normal', targetDurationSeconds: 45, targetDistanceM: 2000 }]);

      const [only] = await getRoutineSets(database, (await benchRow()).id);
      expect(only).toEqual({
        setType: 'normal',
        targetDurationSeconds: 45,
        targetDistanceM: 2000,
      });
    });
  });

  describe('AC1.9 — EMPTY persists as an entry with no sets', () => {
    // #276 Phase 6: three tests formerly lived here — "drops the derived
    // aggregates to zero when an existing list is emptied", "does not fire
    // the zero-total targetSets default when a set list is supplied", and
    // "still applies the zero-total default when no set list is supplied at
    // all". All three pinned the aggregate-derivation seam and the zero-total
    // `targetSets` default on `upsertRoutine`; both are deleted in this phase
    // (routine_exercises has no aggregate columns left to derive or default),
    // so the behaviour they covered no longer exists. `sets` is also REQUIRED
    // on `RoutineExerciseEntry` now, so the third test's aggregate-only call
    // (`{ exerciseId: BENCH, order: 0 }`, no `sets`) is no longer expressible.
    it('writes the exercise row and returns an empty set list, rather than dropping the entry', async () => {
      await writeBench([]);

      const row = await benchRow();
      expect(row).toBeDefined();
      expect(await getRoutineSets(database, row.id)).toEqual([]);
    });

    it('destroys an existing list when a later upsert passes an explicitly empty one', async () => {
      // `sets: []` is a statement, not an omission — the discriminating pair
      // with the "omits `sets` entirely" case below. A guard written as
      // `if (sets?.length)` treats the two the same and silently keeps a
      // seven-set ramp on an entry the caller just emptied.
      await writeBench(RAMP);
      expect(await getRoutineSets(database, (await benchRow()).id)).toHaveLength(7);

      await writeBench([]);

      expect(await getRoutineSets(database, (await benchRow()).id)).toEqual([]);
      expect(await database.get('routine_sets').query().fetch()).toHaveLength(0);
    });
  });

  // #276 Phase 6: the whole "the derived aggregates stay exactly consistent
  // with the list" describe block (seven tests) lived here and is deleted.
  // Its subject — `deriveAggregates` re-deriving warmup_sets/target_sets/
  // target_reps/target_duration_seconds/target_weight_kg from the set list on
  // every `upsertRoutine` write — no longer exists: those columns are gone
  // from `routine_exercises` and `routine_sets` is the only representation of
  // the plan, so there is nothing left for a derivation to keep consistent.
  describe('AC1.4 — reconciliation keeps the exercise row id and replaces the set rows', () => {
    it('keeps the routine_exercises row id, so logged history still resolves, while the set list is replaced wholesale', async () => {
      await writeBench(RAMP);
      const idBefore = (await benchRow()).id;

      await createSession(database, {
        sessionId: 'session-ramp',
        routineId: ROUTINE_ID,
        startedAtMs: Date.now() - 60_000,
      });
      await appendSet(database, 'session-ramp', idBefore, {
        setType: 'working',
        reps: 8,
        weightKg: 22.68,
        exerciseId: BENCH,
      });
      expect(await getExerciseWorkingSetHistory(database, BENCH)).toHaveLength(1);

      // A routine edit: same exercise, a heavier ramp with one fewer set.
      await writeBench([
        { setType: 'warmup', targetReps: 5, targetWeightKg: 11.34 },
        { setType: 'normal', targetReps: 6, targetWeightKg: 25 },
      ]);

      expect((await benchRow()).id).toBe(idBefore);
      expect(await getExerciseWorkingSetHistory(database, BENCH)).toHaveLength(1);

      const sets = await getRoutineSets(database, idBefore);
      expect(sets).toHaveLength(2);
      expect(sets.map((s) => s.targetWeightKg)).toEqual([11.34, 25]);
    });

    it('leaves no orphaned set rows behind after a shrinking edit', async () => {
      await writeBench(RAMP);
      await writeBench([{ setType: 'normal', targetReps: 6 }]);

      const all = await database.get('routine_sets').query().fetch();
      expect(all).toHaveLength(1);
    });

    it('does not touch another exercise’s set rows when one entry is edited', async () => {
      await upsertExercise(database, 'chest-fly', 'Chest Fly', 'strength');
      await upsertRoutine(database, ROUTINE_ID, 'Push Day', [
        { exerciseId: BENCH, order: 0, sets: RAMP },
        { exerciseId: 'chest-fly', order: 1, sets: RANGE },
      ]);

      await upsertRoutine(database, ROUTINE_ID, 'Push Day', [
        { exerciseId: BENCH, order: 0, sets: [{ setType: 'normal', targetReps: 6 }] },
        { exerciseId: 'chest-fly', order: 1, sets: RANGE },
      ]);

      const [fly] = (await database
        .get('routine_exercises')
        .query(Q.where('exercise_id', 'chest-fly'))
        .fetch()) as any[];
      expect(await getRoutineSets(database, fly.id)).toHaveLength(2);
    });

    // #276 Phase 6: "leaves an entry's existing set rows alone when a later
    // upsert omits `sets` entirely" lived here and is deleted. Its subject —
    // `sets: undefined` on an `upsertRoutine` entry meaning "this caller does
    // not speak per-set, leave the rows alone" — no longer exists: `sets` is
    // REQUIRED on `RoutineExerciseEntry` now, so `upsertRoutine` can no longer
    // be called without it, and the production code unconditionally replaces
    // an entry's set rows on every write (see `replaceRoutineSets`'s only
    // caller in `upsertRoutine`). The preserve-on-absent contract survives
    // only on the test-only `upsertRoutineExercise` helper's `sets` option.
  });

  describe('AC1.5 — the drop branch destroys set rows, after stamping history', () => {
    it('destroys an omitted exercise’s set rows alongside its routine_exercises row', async () => {
      await upsertExercise(database, 'ex-drop', 'Dropped', 'strength');
      await upsertRoutine(database, ROUTINE_ID, 'Push Day', [
        { exerciseId: BENCH, order: 0, sets: RAMP },
        { exerciseId: 'ex-drop', order: 1, sets: RANGE },
      ]);
      expect(await database.get('routine_sets').query().fetch()).toHaveLength(9);

      await upsertRoutine(database, ROUTINE_ID, 'Push Day', [
        { exerciseId: BENCH, order: 0, sets: RAMP },
      ]);

      expect(await database.get('routine_exercises').query().fetch()).toHaveLength(1);
      // Only RAMP's seven survive; the dropped entry's two are gone.
      expect(await database.get('routine_sets').query().fetch()).toHaveLength(7);
    });

    it('still stamps the dropped row’s null-stamped session sets with its outgoing identity', async () => {
      // The layer-2 defense AGENTS.md requires: dropping an exercise from the
      // PLAN must not erase what was already DONE. Adding a set-row destroy to
      // this branch must not displace it.
      await upsertExercise(database, 'ex-drop', 'Dropped', 'strength');
      await upsertRoutine(database, ROUTINE_ID, 'Push Day', [
        { exerciseId: 'ex-drop', order: 0, sets: RANGE },
      ]);
      const [dropRow] = (await database.get('routine_exercises').query().fetch()) as any[];

      await createSession(database, {
        sessionId: 'session-drop',
        routineId: ROUTINE_ID,
        startedAtMs: Date.now() - 60_000,
      });
      // No exerciseId: a pre-v3 style unstamped set, resolving through the join.
      await appendSet(database, 'session-drop', dropRow.id, {
        setType: 'working',
        reps: 10,
        weightKg: 20,
      });

      await upsertRoutine(database, ROUTINE_ID, 'Push Day', [
        { exerciseId: BENCH, order: 0, sets: RAMP },
      ]);

      const history = await getExerciseWorkingSetHistory(database, 'ex-drop');
      expect(history).toHaveLength(1);
      expect(await database.get('routine_sets').query().fetch()).toHaveLength(7);
    });
  });
});
