/**
 * THE ROUTINE ROUND-TRIP LATTICE (#295).
 *
 * `upsertRoutine` → WatermelonDB → `exportRoutine` → `parseRoutine`, over a
 * reduced but *generated* set of storable `routine_sets` shapes, asserting zero
 * throws and zero mismatches.
 *
 * WHY THIS EXISTS AS A COMMITTED TEST RATHER THAN A SCRATCH SCRIPT
 *
 * The interop family has shipped the same defect four times: a fix applied to
 * one of two symmetric paths, passing a green suite because no fixture
 * exercised the other. #277/#282 (quoting reached `serializeRoutine` and not
 * `buildSessionSetLine`), #282 round 2 (the grammar doc corrected, `format.ts`
 * left standing), #276 Phase 5 round 1 (an empty set list exported a document
 * `parseRoutine` threw on, *and* a load-only set silently vanished), #276
 * Phase 5 round 2 (the cardio/stretch duration requirement moved into the
 * session-only tail while its sibling, the sets-slot prohibition, stayed
 * unconditional — 64 of the 192 storable shapes exported documents the parser
 * refused). Every one was found by a reviewer hand-building an exhaustive probe
 * in a scratch directory, and every one was invisible to the committed suite.
 *
 * TWO PROPERTIES ARE THE POINT, AND BOTH ARE LOAD-BEARING
 *
 * 1. **The field axis is generated from the schema, not typed out here.** The
 *    nullable `routine_sets` columns are read off `databaseSchema` at run time
 *    and matched against `SET_COLUMN_FIELDS` below; a column with no entry
 *    fails `every nullable routine_sets column is on the lattice`. That is the
 *    specific failure mode of the four rounds above — each round's fixtures
 *    covered the fields that round happened to be thinking about — so a new
 *    nullable column must join coverage by default and be *removed*
 *    deliberately, never omitted by silence. The kind and set-type axes get the
 *    same property from the type checker instead: both are `Record<Union, …>`
 *    literals, so widening `ExerciseKind` or `RoutineSetType` fails `tsc` here
 *    until the new member is registered.
 *
 * 2. **It asserts the symmetry directly** rather than testing each half against
 *    its own expectations. AGENTS.md keeps `parse.ts` alive precisely as the
 *    round-trip oracle for a serializer with one production caller (#262); this
 *    is that maintenance obligation expressed as an executable check.
 *
 * THE REDUCTION (51 shapes, not 384)
 *
 * The full present/absent power set is 2^6 × 2 set types × 3 kinds = 384, which
 * runs fine as a one-off but is more than this suite should carry. What is kept:
 *
 * - one representative per (kind × set_type) pair — the ALL-fields shape;
 * - every single-field-only shape, per (kind × set_type) pair — single-field
 *   shapes are what caught rounds 3 and 4, where a set carrying only a load
 *   vanished and a cardio set carrying only reps was refused;
 * - the contentless set (`set_type` and nothing else), the floor of the partial
 *   family and the shape that collides with the zero-set entry line;
 * - the zero-set entry (`sets: []`) per kind, the other half of that collision.
 *
 * A shape that fails here fails as data, not as an exception: every throw and
 * every mismatch is collected and reported together, because the useful signal
 * in all four past rounds was *which family* of shapes broke, not the first one.
 */

import { Database } from '@nozbe/watermelondb';
import { databaseSchema } from '@/db/schema';
import { createTestDatabase, closeTestDatabase, flush } from '@/db/test-helpers';
import { upsertExercise, upsertRoutine, type RoutineSetEntry } from '@/db/repository';
import type { RoutineSetType } from '@/db/models/RoutineSet';
import type { ExerciseKind } from '@/db/models/Exercise';
import type { RoutineSetLine, WorkoutLine } from '@/interop/format';
import { parseRoutine } from '@/interop/parse';
import { exportRoutine } from '@/export/exportService';

/**
 * The value the lattice prescribes for each nullable `routine_sets` column, and
 * the `RoutineSetEntry` field that writes it.
 *
 * Keyed by COLUMN NAME so the schema can be the authority on membership: the
 * first test below asserts these keys are exactly the nullable columns
 * `databaseSchema` declares. Add a nullable column to `routine_sets` and that
 * test fails until the column is registered here — which is the entire reason
 * this axis is not a hand-written list of five fields.
 *
 * The values are deliberately distinct from one another so a mismatch report
 * names the field that moved without having to cross-reference anything.
 */
const SET_COLUMN_FIELDS: Record<string, { field: keyof RoutineSetEntry; value: number }> = {
  target_reps: { field: 'targetReps', value: 5 },
  target_reps_max: { field: 'targetRepsMax', value: 8 },
  target_weight_kg: { field: 'targetWeightKg', value: 22.68 },
  target_duration_seconds: { field: 'targetDurationSeconds', value: 300 },
  target_distance_m: { field: 'targetDistanceM', value: 1000 },
  // The per-set rest override (#281). 45 stays under the m:ss threshold, so it
  // round-trips as `set_rest=45` — distinct from the entry-level `rest=`, which
  // the lattice's exercise entries never set, so there is no collision to mask.
  rest_seconds: { field: 'restSeconds', value: 45 },
};

/** The nullable per-set columns, read off the schema rather than listed. */
const NULLABLE_SET_COLUMNS: string[] = databaseSchema.tables.routine_sets.columnArray
  .filter((column) => column.isOptional)
  .map((column) => column.name)
  .sort();

/**
 * One exercise per kind. A `Record<ExerciseKind, …>` on purpose: a fourth kind
 * added to the union fails to compile here rather than quietly skipping the
 * lattice, the type-level equivalent of the schema check on the column axis.
 */
const EXERCISE_BY_KIND: Record<ExerciseKind, string> = {
  strength: 'bench-press-db',
  cardio: 'rower',
  stretch: 'hamstring-stretch',
};

/** Same exhaustiveness trick for the set-type axis. */
const SET_TYPE_MEMBERS: Record<RoutineSetType, true> = { warmup: true, normal: true };

const KINDS = Object.keys(EXERCISE_BY_KIND) as ExerciseKind[];
const SET_TYPES = Object.keys(SET_TYPE_MEMBERS) as RoutineSetType[];

/**
 * Deep-compare two set lists as VALUES, not as key insertion orders.
 *
 * `getRoutineSets` rebuilds an entry field by field in its own fixed order,
 * which is not the order the lattice happened to write them in, so a plain
 * `JSON.stringify` comparison reports every all-fields shape as a mismatch.
 * Sorting the keys first is what makes the comparison mean "same fields, same
 * values, absent fields absent" — the property under test.
 */
function canonical(sets: readonly RoutineSetLine[]): string {
  return JSON.stringify(
    sets.map((set) =>
      Object.fromEntries(
        Object.entries(set)
          .filter(([, value]) => value !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
      )
    )
  );
}

type Shape = {
  /** Stable, human-readable — this is what a failure report names. */
  label: string;
  kind: ExerciseKind;
  sets: RoutineSetEntry[];
};

/**
 * Build the lattice. Pure: takes the column axis rather than reading it, so the
 * shape count can be asserted against the schema-derived list independently.
 */
function buildShapes(columns: readonly string[]): Shape[] {
  const shapes: Shape[] = [];

  for (const kind of KINDS) {
    // The entry the routine NAMES but prescribes nothing for — `sets=0` on the
    // wire. Half of the ambiguity the marker resolves; the contentless set
    // below is the other half, and the two must stay distinguishable.
    shapes.push({ label: `${kind}/ZERO-SETS`, kind, sets: [] });

    for (const setType of SET_TYPES) {
      shapes.push({ label: `${kind}/${setType}/no-fields`, kind, sets: [{ setType }] });

      for (const column of columns) {
        const { field, value } = SET_COLUMN_FIELDS[column];
        shapes.push({
          label: `${kind}/${setType}/only:${column}`,
          kind,
          sets: [{ setType, [field]: value }],
        });
      }

      const allFields: RoutineSetEntry = { setType };
      for (const column of columns) {
        const { field, value } = SET_COLUMN_FIELDS[column];
        (allFields as unknown as Record<string, unknown>)[field] = value;
      }
      shapes.push({ label: `${kind}/${setType}/all-fields`, kind, sets: [allFields] });
    }
  }

  return shapes;
}

describe('#295: the routine round-trip lattice', () => {
  test('every nullable routine_sets column is on the lattice', () => {
    // The mechanism, not a tidiness check. A new nullable column that nobody
    // registers here would otherwise escape the lattice in silence — exactly
    // how each of the four past rounds' fixtures came to cover only the fields
    // that round was thinking about.
    expect(Object.keys(SET_COLUMN_FIELDS).sort()).toEqual(NULLABLE_SET_COLUMNS);
  });

  test('the reduction is the advertised size and shape', () => {
    const shapes = buildShapes(NULLABLE_SET_COLUMNS);

    // per kind: one zero-set entry, plus per set type (no-fields + one per
    // column + all-fields).
    expect(shapes).toHaveLength(
      KINDS.length * (1 + SET_TYPES.length * (NULLABLE_SET_COLUMNS.length + 2))
    );
    // 3 kinds × (1 zero-set + 2 set types × (no-fields + 6 columns + all-fields)).
    // Was 45 at five nullable columns; rest_seconds (#281) makes it six.
    expect(shapes).toHaveLength(51);

    // Every column really is exercised alone somewhere — the property rounds 3
    // and 4 turned on, asserted rather than assumed from the loop above.
    for (const column of NULLABLE_SET_COLUMNS) {
      expect(shapes.some((shape) => shape.label.endsWith(`only:${column}`))).toBe(true);
    }
  });

  describe('every generated shape survives export → parse', () => {
    let db: Database;

    beforeAll(async () => {
      db = createTestDatabase();
      for (const kind of KINDS) {
        await upsertExercise(db, EXERCISE_BY_KIND[kind], `Lattice ${kind}`, kind);
      }
      await flush();
    });

    afterAll(async () => {
      await closeTestDatabase(db);
    });

    test('zero throws and zero mismatches', async () => {
      const shapes = buildShapes(NULLABLE_SET_COLUMNS);
      const throws: string[] = [];
      const mismatches: string[] = [];
      let roundTripped = 0;

      for (const [index, shape] of shapes.entries()) {
        const routineId = `lattice-${index}`;
        await upsertRoutine(db, routineId, `Lattice ${shape.label}`, [
          { exerciseId: EXERCISE_BY_KIND[shape.kind], order: 0, sets: shape.sets },
        ]);
        await flush();

        let markdown: string;
        try {
          markdown = await exportRoutine(db, routineId);
        } catch (error) {
          throws.push(`EXPORT ${shape.label}: ${(error as Error).message}`);
          continue;
        }

        let entries: (WorkoutLine | { exercises: WorkoutLine[] })[];
        try {
          entries = parseRoutine(markdown).exercises;
        } catch (error) {
          throws.push(`PARSE ${shape.label}: ${(error as Error).message}\n${markdown}`);
          continue;
        }

        roundTripped += 1;

        if (entries.length !== 1) {
          mismatches.push(`${shape.label}: ${entries.length} entries, expected 1\n${markdown}`);
          continue;
        }

        const entry = entries[0] as WorkoutLine;
        // `toEqual` semantics without the throw: the parsed set list must equal
        // what was stored, field for field, with absent fields absent.
        const got = canonical(entry.sets ?? []);
        const want = canonical(shape.sets as unknown as RoutineSetLine[]);
        if (got !== want) {
          mismatches.push(`${shape.label}: got ${got}, want ${want}\n${markdown}`);
        }
      }

      // Reported together, and the count asserted alongside them: a loop that
      // silently ran zero shapes would otherwise pass with two empty lists.
      expect({ throws, mismatches, roundTripped }).toEqual({
        throws: [],
        mismatches: [],
        roundTripped: shapes.length,
      });
    }, 60000);
  });
});
