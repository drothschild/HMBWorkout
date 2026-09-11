// pattern: Functional Core
import type { CatalogEntry } from './exerciseCatalog';
import { normalizeExerciseTitle, type ImageDecision } from './exerciseImageMatch';

/** Strip only a trailing side label; internal movement/variant words survive. */
export function imageDecisionTitle(title: string): string {
  const withoutSide = title.trim().replace(/(?:\s*\((?:left|right|l|r)\)|(?:\s+[-–—]\s*|\s+)(?:left|right))$/i, '').trim();
  return normalizeExerciseTitle(withoutSide || title);
}

export function exactImageDecision(title: string, catalog: readonly CatalogEntry[]): ImageDecision | undefined {
  // Same equipment and movement; do not generalize to incline or goblet variants.
  if (imageDecisionTitle(title) !== 'dumbbell chest press') return undefined;
  const entry = catalog.find(candidate => candidate.id === 'Dumbbell_Bench_Press');
  return entry ? { kind: 'catalog', entry } : undefined;
}

/** Reuse an unambiguous persisted catalog choice for a group containing sided titles. */
export function siblingImageDecisions(
  rows: readonly { readonly title: string; readonly imageSource: string | null }[],
  catalog: readonly CatalogEntry[]
): ReadonlyMap<string, ImageDecision> {
  const groups = new Map<string, { sided: boolean; ids: Set<string> }>();
  for (const row of rows) {
    const title = imageDecisionTitle(row.title);
    const group = groups.get(title) ?? { sided: false, ids: new Set<string>() };
    group.sided ||= title !== normalizeExerciseTitle(row.title);
    if (row.imageSource?.startsWith('catalog:')) group.ids.add(row.imageSource.slice('catalog:'.length));
    groups.set(title, group);
  }
  const result = new Map<string, ImageDecision>();
  for (const [title, group] of groups) {
    if (!group.sided || group.ids.size !== 1) continue;
    const id = [...group.ids][0];
    const entry = catalog.find(candidate => candidate.id === id);
    if (entry) result.set(title, { kind: 'catalog', entry });
  }
  return result;
}
