/**
 * The shell's one answer to "what does this routine entry prescribe?".
 *
 * The module had no test file of its own, which is how the aggregate fallback
 * came to be dropped from `getPrescribedSetsForEntry` while the three other
 * readers kept it: every suite that exercised the fallback did so through a
 * presenter, and the one function the session screen calls had no direct
 * cover at all.
 *
 * The aggregate shape is not legacy trivia — `acceptDraft` writes count columns
 * plus `target_weight_kg` and no `routine_sets` rows until Phase 4, so it is
 * what every routine in the app looks like today.
 */

import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import type { Database } from '@nozbe/watermelondb';
import {
  entrySetsFromRows,
  getPrescribedSetsForEntry,
  getPrescribedSetsForRow,
  prescribedSets,
  rowHasPrescribedSets,
} from './routineSetPlans';

describe('prescribedSets (pure)', () => {
  it('takes a non-empty row list at its word and ignores the counts', () => {
    const rows = [
      { setType: 'warmup' as const, targetReps: 5, targetWeightKg: 9.07 },
      { setType: 'normal' as const, targetReps: 8, targetWeightKg: 22.68 },
    ];

    expect(
      prescribedSets(rows, {
        warmup_sets: 99,
        target_sets: 99,
        target_reps: 99,
        target_weight_kg: 60,
      })
    ).toEqual(rows);
  });

  it('expands the counts AND carries the row’s prescribed load onto every set', () => {
    // The C3 fix. The row-level `target_weight_kg` is the only place a coach's
    // prescription lives before Phase 4, and dropping it here deleted the
    // prescribed-weight prefill for every routine in the app.
    expect(
      prescribedSets([], {
        warmup_sets: 1,
        target_sets: 2,
        target_reps: 8,
        target_weight_kg: 83.91,
      })
    ).toEqual([
      { setType: 'warmup', targetReps: 8, targetWeightKg: 83.91 },
      { setType: 'normal', targetReps: 8, targetWeightKg: 83.91 },
      { setType: 'normal', targetReps: 8, targetWeightKg: 83.91 },
    ]);
  });

  it('treats a 0 load as no prescription, not a prescribed zero', () => {
    expect(prescribedSets([], { target_sets: 1, target_reps: 8, target_weight_kg: 0 })).toEqual([
      { setType: 'normal', targetReps: 8 },
    ]);
  });

  it('expands nothing when the counts are empty', () => {
    expect(prescribedSets([], { warmup_sets: 0, target_sets: 0, target_weight_kg: 83.91 })).toEqual(
      []
    );
    expect(rowHasPrescribedSets([], { warmup_sets: 0, target_sets: 0 })).toBe(false);
    expect(rowHasPrescribedSets([], { target_sets: 2 })).toBe(true);
  });

  it('carries the load into engine shape too, so all readers agree', () => {
    expect(
      entrySetsFromRows([], { target_sets: 1, target_reps: 8, target_weight_kg: 83.91 })
    ).toEqual([
      {
        setType: 'normal',
        reps: 8,
        repsMax: undefined,
        weightKg: 83.91,
        durationSeconds: undefined,
        distanceM: undefined,
      },
    ]);
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

  async function seed(counts: Record<string, unknown>, sets: any[] = []): Promise<string> {
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
        for (const [column, value] of Object.entries(counts)) {
          row._raw[column] = value;
        }
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

  it('C3: an aggregate-only row still yields the coach’s prescribed load', async () => {
    // Exactly what `acceptDraft` writes today: counts plus target_weight_kg,
    // zero `routine_sets` rows. 83.91 kg is 185 lb.
    await seed({ warmup_sets: 0, target_sets: 3, target_reps: 8, target_weight_kg: 83.91 });

    const plan = await getPrescribedSetsForEntry(db, 'routine-1', 0);

    expect(plan).toHaveLength(3);
    expect(plan.map((set) => set.targetWeightKg)).toEqual([83.91, 83.91, 83.91]);
  });

  it('prefers the row list over the counts when both exist', async () => {
    await seed({ warmup_sets: 99, target_sets: 99, target_reps: 99, target_weight_kg: 83.91 }, [
      { set_type: 'warmup', target_reps: 5, target_weight_kg: 9.07 },
      { set_type: 'normal', target_reps: 8, target_weight_kg: 22.68 },
    ]);

    const plan = await getPrescribedSetsForEntry(db, 'routine-1', 0);

    expect(plan.map((set) => set.targetWeightKg)).toEqual([9.07, 22.68]);
  });

  it('keys on the entry’s DB order, not a loop counter or the exercise id', async () => {
    await seed({ target_sets: 1, target_reps: 8, target_weight_kg: 83.91 });

    expect(await getPrescribedSetsForEntry(db, 'routine-1', 0)).toHaveLength(1);
    expect(await getPrescribedSetsForEntry(db, 'routine-1', 1)).toEqual([]);
    expect(await getPrescribedSetsForEntry(db, 'routine-missing', 0)).toEqual([]);
  });

  it('resolves the same plan by row id, looking the counts up itself', async () => {
    const rowId = await seed({ warmup_sets: 1, target_sets: 1, target_reps: 8 });

    expect(await getPrescribedSetsForRow(db, rowId)).toEqual([
      { setType: 'warmup', targetReps: 8 },
      { setType: 'normal', targetReps: 8 },
    ]);
  });

  it('prescribes nothing for a row that no longer exists', async () => {
    await seed({ target_sets: 1, target_reps: 8 });

    expect(await getPrescribedSetsForRow(db, 'no-such-row')).toEqual([]);
  });
});
