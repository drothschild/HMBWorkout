/**
 * The one implementation of superset contiguity grouping (issue #278).
 *
 * A superset group is a **contiguous run** of routine entries sharing a
 * `superset_group` label — the definition AGENTS.md engine convention 9 gives
 * and `helpers.lv`'s `h.group_end_idx` depends on. Convention 10 adds that
 * labels are contiguous but **not routine-unique**: a later run may
 * legitimately reuse an earlier run's label and must stay a distinct group.
 * Merging two same-label runs that are not adjacent misrepresents what the
 * engine will actually run — that was the #268 bug.
 *
 * This module is pure and depends on nothing. It lives outside `src/db`,
 * `src/state` and `src/app` because all three need it and none of them owns
 * it: the rule is a property of the routine model, not of any one layer or
 * row shape. It is generic over "thing with an optional label" so the
 * `RoutineExercise` row, the AI `DraftExercise`, the presenter's
 * `ExerciseDetail` and the engine's `RoutineEntry` can all share it.
 *
 * ## The rules, stated once
 *
 * - **Order is the caller's job.** These functions group by *adjacency in the
 *   array you hand them* and never read an `order` field. Sort by `order`
 *   first (or pass engine entries, which are already in `idx` order). A
 *   routine with duplicate `order` values therefore groups by whatever
 *   sequence the caller's sort produced, and no item is ever dropped.
 * - **`null`, `undefined` and `''` all mean "no superset."** `''` is the
 *   engine's own sentinel (`engine/types.ts`: `supersetGroup: string; // ""
 *   means no superset`; `rules/types.lv` carries it as `Option(String)`), and
 *   the DB column is `isOptional`, so a row can hold either. Unifying them
 *   here is what makes the shell agree with the engine.
 * - **A standalone entry is a singleton run whose `label` is `null`.** That is
 *   deliberately a superset of the two behaviours this replaced: a caller that
 *   wanted singleton groups reads `.members`, a caller that wanted "not a
 *   group" tests `label === null`. Two standalone entries never join each
 *   other, however adjacent they are.
 * - **A returned `label` is never `''`** — it is either a real key or `null`.
 */

/**
 * The label that identifies a superset run. `string` today; `number` is
 * included so that if #276 ever re-points `superset_group` at Hevy's integer
 * `supersets_id`, that is a type argument at the call sites and not a rewrite
 * here. (#276's plan currently resolves that question as "keep the string".)
 */
export type SupersetKey = string | number;

/**
 * A contiguous run of entries sharing one label, or a single entry with no
 * label (`label === null`).
 */
export interface SupersetRun<T, K extends SupersetKey = SupersetKey> {
  readonly label: K | null;
  readonly members: readonly T[];
}

/**
 * `null`, `undefined` and `''` collapse to `null`; anything else is a real
 * label.
 *
 * The emptiness test is written out rather than done with a falsy check on
 * purpose: a numeric key of `0` is a perfectly good label and a falsy check
 * would silently shatter that group into singletons.
 */
function normalizeKey<K extends SupersetKey>(raw: K | null | undefined): K | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && raw.length === 0) return null;
  return raw;
}

/**
 * The index of the last entry in the contiguous run that `startIndex` belongs
 * to, scanning **forward only**.
 *
 * Returns `startIndex` unchanged when that entry is standalone (or when the
 * index is out of range), since a labelless entry can never extend a run.
 * Callers that need the run's *start* must already know it — this deliberately
 * does not scan backwards, matching `h.group_end_idx`.
 */
export function supersetRunEndIndex<T, K extends SupersetKey>(
  items: readonly T[],
  startIndex: number,
  keyOf: (item: T) => K | null | undefined
): number {
  const label = startIndex >= 0 && startIndex < items.length
    ? normalizeKey(keyOf(items[startIndex]))
    : null;
  if (label === null) return startIndex;

  let end = startIndex;
  while (end + 1 < items.length && normalizeKey(keyOf(items[end + 1])) === label) {
    end += 1;
  }
  return end;
}

/**
 * Partition already-ordered entries into contiguous superset runs, preserving
 * order. Every input item appears in exactly one run, exactly once.
 *
 * Built on `supersetRunEndIndex` so there is genuinely one contiguity check in
 * this codebase rather than two that agree by inspection.
 */
export function groupBySupersetRuns<T, K extends SupersetKey>(
  items: readonly T[],
  keyOf: (item: T) => K | null | undefined
): SupersetRun<T, K>[] {
  const runs: SupersetRun<T, K>[] = [];

  let index = 0;
  while (index < items.length) {
    const end = supersetRunEndIndex(items, index, keyOf);
    runs.push({
      label: normalizeKey(keyOf(items[index])),
      members: items.slice(index, end + 1),
    });
    index = end + 1;
  }

  return runs;
}
