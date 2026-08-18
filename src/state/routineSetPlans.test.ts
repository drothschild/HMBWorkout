/**
 * The shell's one answer to "what does this routine entry prescribe?".
 *
 * #276 Phase 6 deleted the aggregate-column fallback (`prescribedSets`,
 * `RoutineExerciseCounts`) along with the columns it read
 * (`warmup_sets`/`target_sets`/`target_reps`/`target_weight_kg` on
 * `routine_exercises`). `routine_sets` is now the only representation of a
 * plan, and an entry with no rows prescribes nothing — there is no second
 * source left to fall back to. This file used to cover that fallback
 * directly: an aggregate-only row still yielding a derived plan, rows
 * winning over counts when both existed, and `getPrescribedSetsForRow`
 * resolving counts on its own. All three are deleted along with the
 * behaviour they proved; what remains below is rewritten to seed real
 * `routine_sets` rows instead of aggregate columns.
 */

import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import type { Database } from '@nozbe/watermelondb';
import {
  entrySetsFromRows,
  getPrescribedSetsForEntry,
  getPrescribedSetsForRow,
  rowHasPrescribedSets,
} from './routineSetPlans';

describe('entrySetsFromRows / rowHasPrescribedSets (pure)', () => {
  it('maps routine_sets rows straight into engine shape', () => {
    const rows = [
      { setType: 'warmup' as const, targetReps: 5, targetWeightKg: 9.07 },
      { setType: 'normal' as const, targetReps: 8, targetWeightKg: 22.68 },
    ];

    expect(entrySetsFromRows(rows)).toEqual([
      {
        setType: 'warmup',
        reps: 5,
        repsMax: undefined,
        weightKg: 9.07,
        durationSeconds: undefined,
        distanceM: undefined,
      },
      {
        setType: 'normal',
        reps: 8,
        repsMax: undefined,
        weightKg: 22.68,
        durationSeconds: undefined,
        distanceM: undefined,
      },
    ]);
  });

  it('is empty for an entry with no rows', () => {
    expect(entrySetsFromRows([])).toEqual([]);
    expect(rowHasPrescribedSets([])).toBe(false);
  });

  it('is true whenever at least one row exists', () => {
    expect(rowHasPrescribedSets([{ setType: 'normal', targetReps: 8 }])).toBe(true);
  });
});

describe('getPrescribedSetsForEntry / ForRow (database)', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(db);
  });

  async function seed(sets: any[] = []): Promise<string> {
    let rowId = '';
    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-1';
        r.name = 'Push';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });
      await db.get('exercises').create((e: any) => {
        e._raw.id = 'bench-press';
        e.title = 'Bench Press';
        e._raw.kind = 'strength';
        e._raw.created_at = Date.now();
      });
      const re = await db.get('routine_exercises').create((row: any) => {
        row._raw.routine_id = 'routine-1';
        row._raw.exercise_id = 'bench-press';
        row._raw.order = 0;
      });
      rowId = re.id;
      for (const [order, set] of sets.entries()) {
        await db.get('routine_sets').create((row: any) => {
          row._raw.routine_exercise_id = rowId;
          row._raw.order = order;
          row._raw.set_type = set.set_type;
          if (set.target_reps != null) row._raw.target_reps = set.target_reps;
          if (set.target_weight_kg != null) row._raw.target_weight_kg = set.target_weight_kg;
        });
      }
    });
    return rowId;
  }

  it("reads an entry's prescribed sets from its routine_sets rows", async () => {
    await seed([
      { set_type: 'warmup', target_reps: 5, target_weight_kg: 9.07 },
      { set_type: 'normal', target_reps: 8, target_weight_kg: 22.68 },
    ]);

    const plan = await getPrescribedSetsForEntry(db, 'routine-1', 0);

    expect(plan.map((set) => set.targetWeightKg)).toEqual([9.07, 22.68]);
  });

  it('keys on the entry’s DB order, not a loop counter or the exercise id', async () => {
    await seed([{ set_type: 'normal', target_reps: 8, target_weight_kg: 83.91 }]);

    expect(await getPrescribedSetsForEntry(db, 'routine-1', 0)).toHaveLength(1);
    expect(await getPrescribedSetsForEntry(db, 'routine-1', 1)).toEqual([]);
    expect(await getPrescribedSetsForEntry(db, 'routine-missing', 0)).toEqual([]);
  });

  it('resolves the same plan by row id', async () => {
    const rowId = await seed([
      { set_type: 'warmup', target_reps: 8 },
      { set_type: 'normal', target_reps: 8 },
    ]);

    expect(await getPrescribedSetsForRow(db, rowId)).toEqual([
      { setType: 'warmup', targetReps: 8 },
      { setType: 'normal', targetReps: 8 },
    ]);
  });

  it('prescribes nothing for a row that no longer exists', async () => {
    await seed();

    expect(await getPrescribedSetsForRow(db, 'no-such-row')).toEqual([]);
  });
});
