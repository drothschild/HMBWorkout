/**
 * `mapHevyRoutine` — the pure Hevy → per-set routine mapper (#267 Phase 3).
 *
 * Covers AC3.1 – AC3.8. Every assertion runs against the **verbatim PUSH
 * payload** (`fixtures/hevy-push-routine.json`, captured read-only from the
 * real account on 2026-08-19) except where an AC needs a shape the real data
 * does not contain — the two hand-built fixtures each say so in their own
 * `_comment`, and each exists because the real payload cannot discriminate the
 * rule in question:
 *
 * - `hevy-disagreeing-reps.json` — PUSH's Dead Bug carries `reps: 12` next to
 *   `rep_range {12,12}`, which AGREE, so no assertion on it separates "reps
 *   wins" from "rep_range wins" (AC3.3). It also carries the metric-native
 *   `weight_kg: 20` that separates "round kg" from "round-trip through lbs"
 *   (AC3.5) — every imperial value in PUSH agrees under both.
 * - `hevy-noncontiguous-superset.json` — every superset run in the real account
 *   is contiguous, so AC3.6's case can only be synthetic.
 *
 * **AC3.6 follows the 2026-08-19 decision on #267, not the design plan's
 * original text.** A non-contiguous superset no longer rejects the import: the
 * import succeeds, the offending label's members are demoted to standalone, and
 * the demotion is named in the lossiness summary. Reordering entries to force
 * contiguity stays forbidden, and the order assertions here are what pin that.
 */

import type { RoutineExerciseEntry } from '@/db/repository';
import { mapHevyRoutine } from '../hevyRoutineMap';
import { loadRoutineFixture } from './loadFixture';

const PUSH = loadRoutineFixture('hevy-push-routine');
const NONCONTIG = loadRoutineFixture('hevy-noncontiguous-superset');
const DISAGREEING = loadRoutineFixture('hevy-disagreeing-reps');

/** Unwrap an `ok: true` result, failing loudly rather than returning undefined. */
function mapped(routine: Parameters<typeof mapHevyRoutine>[0]) {
  const result = mapHevyRoutine(routine);
  if (!result.ok) {
    throw new Error(`expected a successful mapping, got ${result.error.code}: ${result.error.message}`);
  }
  return result;
}

function entryFor(entries: readonly RoutineExerciseEntry[], exerciseId: string): RoutineExerciseEntry {
  const entry = entries.find((candidate) => candidate.exerciseId === exerciseId);
  if (!entry) throw new Error(`no entry for ${exerciseId}; have ${entries.map((e) => e.exerciseId).join(', ')}`);
  return entry;
}

describe('mapHevyRoutine — AC3.1 order follows Hevy index, never supersets_id', () => {
  it('maps PUSH to 12 entries ordered 0…11 in Hevy index order', () => {
    const { routine } = mapped(PUSH);

    expect(routine.name).toBe('Push');
    expect(routine.entries).toHaveLength(12);
    expect(routine.entries.map((entry) => entry.order)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it('never sorts by supersets_id — PUSH’s ids run 5,6,7,4, so a sort moves the core group to the front', () => {
    const { routine } = mapped(PUSH);

    // The full sequence, pinned. PUSH's superset ids are non-ascending
    // (undefined, undefined, 5,5, 6,6, 7,7, 4,4,4, undefined), so ANY sort by
    // supersets_id lifts the three id-4 core exercises above the id-5 pair.
    expect(routine.entries.map((entry) => entry.exerciseId)).toEqual([
      'cycling',
      'bench-press-dumbbell',
      'chest-fly-dumbbell',
      'triceps-extension-dumbbell',
      'incline-bench-press-dumbbell',
      'lateral-raise-dumbbell',
      'shoulder-press-dumbbell',
      'skullcrusher-dumbbell',
      'russian-twist-weighted',
      'plank',
      'dead-bug',
      'stretching',
    ]);
  });
});

describe('mapHevyRoutine — AC3.2 the warmup ramp survives per set', () => {
  it('maps Bench Press to seven sets: three distinct warmup loads then four working sets', () => {
    const { routine } = mapped(PUSH);
    const bench = entryFor(routine.entries, 'bench-press-dumbbell');

    expect(bench.sets).toHaveLength(7);
    expect(bench.sets.map((set) => set.setType)).toEqual([
      'warmup',
      'warmup',
      'warmup',
      'normal',
      'normal',
      'normal',
      'normal',
    ]);
    // Three DIFFERENT warmup loads: the exact datum the aggregate model
    // destroyed, and the reason a per-exercise count cannot pass this.
    expect(bench.sets.map((set) => set.targetWeightKg)).toEqual([
      9.07, 11.34, 18.14, 22.68, 22.68, 22.68, 22.68,
    ]);
  });
});

describe('mapHevyRoutine — AC3.3 the four rep shapes, and which source wins', () => {
  it('maps a {8,10} range to targetReps 8 + targetRepsMax 10', () => {
    const { routine } = mapped(PUSH);
    const bench = entryFor(routine.entries, 'bench-press-dumbbell');

    expect(bench.sets[3]).toMatchObject({ targetReps: 8, targetRepsMax: 10 });
  });

  it('collapses a degenerate {5,5} range to a bare targetReps with no max', () => {
    const { routine } = mapped(PUSH);
    const bench = entryFor(routine.entries, 'bench-press-dumbbell');

    expect(bench.sets[0].targetReps).toBe(5);
    expect(bench.sets[0].targetRepsMax).toBeUndefined();
  });

  it('maps a plain reps: 20 with no range to targetReps 20', () => {
    const { routine } = mapped(PUSH);
    const twist = entryFor(routine.entries, 'russian-twist-weighted');

    expect(twist.sets[0].targetReps).toBe(20);
    expect(twist.sets[0].targetRepsMax).toBeUndefined();
  });

  it('maps reps: 12 alongside an agreeing {12,12} to targetReps 12', () => {
    const { routine } = mapped(PUSH);
    const deadBug = entryFor(routine.entries, 'dead-bug');

    expect(deadBug.sets[0].targetReps).toBe(12);
    expect(deadBug.sets[0].targetRepsMax).toBeUndefined();
  });

  it('gives `reps` precedence when it DISAGREES with rep_range — the case PUSH cannot pin', () => {
    // reps: 12 against rep_range {8,10}. A rep_range-wins mapper yields
    // targetReps 8 / targetRepsMax 10; a reps-wins mapper yields 12 and no max.
    const { routine } = mapped(DISAGREEING);
    const set = entryFor(routine.entries, 'disagreeing-reps').sets[0];

    expect(set.targetReps).toBe(12);
    expect(set.targetRepsMax).toBeUndefined();
  });
});

describe('mapHevyRoutine — AC3.4 a zero measurement is absent, not zero', () => {
  it('maps Cycling’s warmup to distance + duration with NO weight and NO reps, while Bench Press keeps 22.68', () => {
    const { routine } = mapped(PUSH);
    const cycling = entryFor(routine.entries, 'cycling');
    const bench = entryFor(routine.entries, 'bench-press-dumbbell');

    expect(cycling.sets).toHaveLength(1);
    expect(cycling.sets[0]).toEqual({
      setType: 'warmup',
      targetDistanceM: 2000,
      targetDurationSeconds: 300,
    });
    expect(cycling.sets[0].targetWeightKg).toBeUndefined();
    expect(cycling.sets[0].targetReps).toBeUndefined();

    // Asserted in the SAME test on purpose: `weight !== 0` alone passes a mutant
    // that drops every weight, so the absent case is only meaningful next to a
    // present one.
    expect(bench.sets[6].targetWeightKg).toBe(22.68);
  });
});

describe('mapHevyRoutine — AC3.5 kg is rounded, never round-tripped through pounds', () => {
  it('rounds 22.67964547178199 kg to 22.68', () => {
    const { routine } = mapped(PUSH);

    expect(entryFor(routine.entries, 'bench-press-dumbbell').sets[3].targetWeightKg).toBe(22.68);
  });

  it('leaves a metric-native 20 kg at 20 — a lbs round trip would land on 19.96', () => {
    const { routine } = mapped(DISAGREEING);

    // lbsToKg(kgToLbs(20)) === 19.96. This is the ONLY shape that separates the
    // two implementations; every imperial value in PUSH agrees under both.
    expect(entryFor(routine.entries, 'metric-native').sets[0].targetWeightKg).toBe(20);
  });
});

describe('mapHevyRoutine — AC3.6 superset contiguity (per the 2026-08-19 decision)', () => {
  it('keeps PUSH’s four contiguous runs as stringified labels in Hevy’s own order', () => {
    const { routine } = mapped(PUSH);

    expect(routine.entries.map((entry) => entry.supersetGroup)).toEqual([
      undefined, // Cycling
      undefined, // Bench Press
      '5',
      '5',
      '6',
      '6',
      '7',
      '7',
      '4',
      '4',
      '4',
      undefined, // Stretching
    ]);
  });

  it('reports no superset demotion for PUSH, whose every run is contiguous', () => {
    const { lossiness } = mapped(PUSH);

    expect(lossiness.filter((note) => note.code === 'superset-demoted')).toEqual([]);
  });

  it('IMPORTS a non-contiguous superset, demoting only that label’s members to standalone', () => {
    const { routine } = mapped(NONCONTIG);

    // The import SUCCEEDS — the whole point of the override. Label 1 owns two
    // runs (index 0 and index 3), so both of its members lose the label; label
    // 2 is a legitimate contiguous run and keeps it.
    expect(routine.entries.map((entry) => entry.supersetGroup)).toEqual([
      undefined, // Squat — was label 1, demoted
      '2',
      '2',
      undefined, // Calf Raise — was label 1, demoted
      undefined, // Hamstring Curl — never had a label
    ]);
  });

  it('never reorders entries to force contiguity', () => {
    const { routine } = mapped(NONCONTIG);

    // The forbidden repair would move Calf Raise up beside Squat. Hevy's index
    // order is preserved exactly, which is what makes the demotion the only
    // change the mapper made.
    expect(routine.entries.map((entry) => entry.exerciseId)).toEqual([
      'squat-barbell',
      'lunge-dumbbell',
      'leg-press',
      'calf-raise-machine',
      'hamstring-curl-machine',
    ]);
    expect(routine.entries.map((entry) => entry.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it('names the demotion in the lossiness summary, by the exercises it affected', () => {
    const { lossiness } = mapped(NONCONTIG);

    const demoted = lossiness.filter((note) => note.code === 'superset-demoted');
    expect(demoted).toHaveLength(1);
    expect(demoted[0].subjects).toEqual(['Squat (Barbell)', 'Calf Raise (Machine)']);
    expect(demoted[0].message).toContain('Squat (Barbell)');
    expect(demoted[0].message).toContain('Calf Raise (Machine)');
  });
});

describe('mapHevyRoutine — AC3.7 notes and rest land on the entry, never on the set or the exercise', () => {
  it('maps each exercise’s notes to the entry note and its rest_seconds to the entry rest', () => {
    const { routine } = mapped(PUSH);
    const cycling = entryFor(routine.entries, 'cycling');
    const bench = entryFor(routine.entries, 'bench-press-dumbbell');

    expect(cycling.notes).toBe('Warm-up — easy spin, 5 min.');
    expect(cycling.restSeconds).toBe(60);
    expect(bench.restSeconds).toBe(120);
  });

  it('keeps a rest_seconds of 0 as 0 rather than dropping it — unlike a zero measurement', () => {
    const { routine } = mapped(PUSH);

    // Stretching's rest is a real "no rest", not a missing value. The 0 → absent
    // rule is scoped to the per-set MEASUREMENTS (AGENTS.md / #281).
    expect(entryFor(routine.entries, 'stretching').restSeconds).toBe(0);
  });

  it('writes no per-set rest at all — Hevy has none to give', () => {
    const { routine } = mapped(PUSH);

    const withSetRest = routine.entries.flatMap((entry) =>
      entry.sets.filter((set) => set.restSeconds !== undefined)
    );
    expect(withSetRest).toEqual([]);
  });

  it('carries no exercise description, so the create-only write can never overwrite one', () => {
    const { routine } = mapped(PUSH);

    // `ImportedExercise` has id/title/kind and deliberately no description
    // field: Hevy's notes are per-routine, and `exercises.description` is
    // global and shared (AGENTS.md Boundaries).
    for (const exercise of routine.exercises) {
      expect(Object.keys(exercise).sort()).toEqual(['id', 'kind', 'title']);
    }
  });
});

describe('mapHevyRoutine — AC3.8 kind is inferred, and the loss is named by content', () => {
  it('infers cardio from distance and strength from everything else', () => {
    const { routine } = mapped(PUSH);
    const byId = new Map(routine.exercises.map((exercise) => [exercise.id, exercise]));

    expect(byId.get('cycling')?.kind).toBe('cardio');
    expect(byId.get('bench-press-dumbbell')?.kind).toBe('strength');
    // Never `stretch`: Hevy has no such concept, so a cool-down arrives as a
    // duration-carrying strength exercise.
    expect(byId.get('stretching')?.kind).toBe('strength');
    expect([...byId.values()].some((exercise) => exercise.kind === 'stretch')).toBe(false);
  });

  it('names the dropped exercise_template_ids by content, not by count', () => {
    const { lossiness } = mapped(PUSH);

    const dropped = lossiness.find((note) => note.code === 'dropped-template-ids');
    expect(dropped).toBeDefined();
    // Content: the ids themselves, one per exercise, in routine order.
    expect(dropped?.subjects).toEqual([
      'Cycling (D8F7F851)',
      'Bench Press (Dumbbell) (3601968B)',
      'Chest Fly (Dumbbell) (12017185)',
      'Triceps Extension (Dumbbell) (3765684D)',
      'Incline Bench Press (Dumbbell) (07B38369)',
      'Lateral Raise (Dumbbell) (422B08F1)',
      'Shoulder Press (Dumbbell) (878CD1D0)',
      'Skullcrusher (Dumbbell) (68F8A292)',
      'Russian Twist (Weighted) (2982AA23)',
      'Plank (C6C9B8A0)',
      'Dead Bug (D8911FC4)',
      'Stretching (527DA061)',
    ]);
    expect(dropped?.message).toContain('D8F7F851');
    // "by content, not count": the summary must not be a bare number.
    expect(dropped?.message).not.toMatch(/\b12 exercise/);
  });

  it('names the kind inference by exercise, including the stretch that becomes strength', () => {
    const { lossiness } = mapped(PUSH);

    const inferred = lossiness.find((note) => note.code === 'inferred-kind');
    expect(inferred).toBeDefined();
    expect(inferred?.subjects).toContain('Cycling → cardio');
    expect(inferred?.subjects).toContain('Stretching → strength');
    expect(inferred?.message).toContain('Stretching → strength');
  });

  it('reports a non-normal Hevy set type rather than silently flattening it', () => {
    // `dropset` and `failure` are real Hevy set types with no column here; they
    // become `normal` and the demotion is named. PUSH has none, so this is a
    // synthetic edit of it rather than a fixture.
    const withDropset = {
      ...PUSH,
      exercises: PUSH.exercises.map((exercise, index) =>
        index === 1
          ? { ...exercise, sets: exercise.sets.map((set, i) => (i === 6 ? { ...set, type: 'dropset' } : set)) }
          : exercise
      ),
    };

    const { routine, lossiness } = mapped(withDropset);
    expect(entryFor(routine.entries, 'bench-press-dumbbell').sets[6].setType).toBe('normal');

    const note = lossiness.find((n) => n.code === 'set-type-flattened');
    expect(note).toBeDefined();
    expect(note?.subjects).toEqual(['Bench Press (Dumbbell) set 7: dropset → normal']);
  });
});

describe('mapHevyRoutine — the refusals it keeps', () => {
  it('refuses a routine with no exercises', () => {
    const result = mapHevyRoutine({ ...PUSH, exercises: [] });

    expect(result).toMatchObject({ ok: false, error: { code: 'empty-routine' } });
  });

  it('refuses a routine in which every exercise prescribes zero sets', () => {
    const result = mapHevyRoutine({
      ...PUSH,
      exercises: PUSH.exercises.map((exercise) => ({ ...exercise, sets: [] })),
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'no-planned-sets' } });
  });

  it('accepts a routine where only SOME exercises prescribe nothing (engine convention 10)', () => {
    const result = mapHevyRoutine({
      ...PUSH,
      exercises: PUSH.exercises.map((exercise, index) =>
        index === 0 ? { ...exercise, sets: [] } : exercise
      ),
    });

    expect(result.ok).toBe(true);
  });

  it('refuses a negative or non-finite weight explicitly rather than storing it', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = mapHevyRoutine({
        ...PUSH,
        exercises: PUSH.exercises.map((exercise, index) =>
          index === 1
            ? { ...exercise, sets: [{ index: 0, type: 'normal', weight_kg: bad, reps: 5 }] }
            : exercise
        ),
      });

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-weight' } });
    }
  });
});

describe('mapHevyRoutine — #323 regression: the wire sends `superset_id` (singular), not `supersets_id`', () => {
  it('reads the real API field name and populates supersetGroup', () => {
    // Two raw `curl` calls against a live Hevy account (list AND single-routine
    // endpoints, two different routines) confirm the server sends `superset_id`
    // — singular — never `supersets_id`. The old checked-in fixture and the
    // `supersets_id` field name both trace back to the Hevy MCP connector,
    // which silently renames the field to match Hevy's OpenAPI *documentation*
    // rather than what the server actually sends (#323). This routine literal
    // is shaped exactly like the real wire payload — `as unknown as
    // HevyRoutine` because at the time this test was written, `HevyExercise`
    // still (incorrectly) declared `supersets_id`, not `superset_id`.
    const routine = {
      id: 'r-323',
      title: 'Superset Field Regression',
      exercises: [
        {
          title: 'Exercise A',
          index: 0,
          superset_id: 9,
          sets: [{ index: 0, type: 'normal', weight_kg: 10, reps: 5 }],
        },
        {
          title: 'Exercise B',
          index: 1,
          superset_id: 9,
          sets: [{ index: 0, type: 'normal', weight_kg: 10, reps: 5 }],
        },
      ],
    } as unknown as Parameters<typeof mapHevyRoutine>[0];

    const { routine: mappedRoutine } = mapped(routine);

    expect(mappedRoutine.entries.map((entry) => entry.supersetGroup)).toEqual(['9', '9']);
  });
});
