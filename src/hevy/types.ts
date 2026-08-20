/**
 * The Hevy API payload shapes (#267 Phase 3).
 *
 * Transcribed from the published OpenAPI document (`api.hevyapp.com/docs`,
 * read 2026-08-19) and cross-checked against the verbatim PUSH payload in
 * `__tests__/fixtures/`. These describe **what the wire sends**, not what this
 * app stores — the translation is `hevyRoutineMap.ts` and nothing else.
 *
 * Every optional field is typed `?: T | null` rather than `?: T`. The spec
 * marks most of them `nullable: true`, and the wire genuinely mixes the two:
 * PUSH omits `supersets_id` on standalone exercises while the spec documents
 * `null` for the same thing. The mapper therefore tests `!= null` throughout,
 * exactly as the DB boundary does for WatermelonDB's own nulls (AGENTS.md).
 */

/** A rep range on a prescribed set. Both ends are independently nullable. */
export interface HevyRepRange {
  start?: number | null;
  end?: number | null;
}

/**
 * One prescribed set.
 *
 * `type` is a bare `string`, not a union: the spec documents `'normal'`,
 * `'warmup'`, `'dropset'` and `'failure'`, and a value outside that list must
 * reach the mapper as data to be reported rather than as a type error that
 * cannot happen at runtime anyway.
 */
export interface HevySet {
  index?: number | null;
  type: string;
  weight_kg?: number | null;
  reps?: number | null;
  rep_range?: HevyRepRange | null;
  distance_meters?: number | null;
  duration_seconds?: number | null;
  /** Target RPE. This app has no routine-level RPE column; reported as lost. */
  rpe?: number | null;
  /** Floors/steps on a stair machine. No column here; reported as lost. */
  custom_metric?: number | null;
}

/** One exercise within a routine, with its own ordered sets. */
export interface HevyExercise {
  title: string;
  /** The routine-order position. The ONLY ordering authority (AC3.1). */
  index: number;
  exercise_template_id?: string | null;
  notes?: string | null;
  rest_seconds?: number | null;
  /**
   * The superset this exercise belongs to; `null`/absent means standalone.
   * A number on the wire, a string in `routine_exercises.superset_group`.
   */
  supersets_id?: number | null;
  sets: HevySet[];
}

export interface HevyRoutine {
  id: string;
  title: string;
  folder_id?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  exercises: HevyExercise[];
}

/** A page of `GET /v1/routines`, already unwrapped by the client. */
export interface HevyRoutinePage {
  page: number;
  pageCount: number;
  routines: HevyRoutine[];
}
