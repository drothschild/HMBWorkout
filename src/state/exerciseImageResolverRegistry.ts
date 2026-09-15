// pattern: Imperative Shell
/**
 * The one running exercise-image resolver (#335), so screens can ask for a
 * pass (first-view retry, Phase 5) and so a re-run boot effect (Fast Refresh)
 * cannot start a second observer.
 */
import type { ExerciseImageRefreshOutcome, ExerciseImageResolver } from './exerciseImageResolver';

let active: ExerciseImageResolver | null = null;

export function ensureExerciseImageResolver(start: () => ExerciseImageResolver): ExerciseImageResolver {
  if (active === null) active = start();
  return active;
}

/** No-op until the resolver has started. Never throws. */
export function requestExerciseImagePass(): void {
  active?.request();
}

/** Refresh one exercise through the active resolver without clearing its image first. */
export function refreshExerciseImage(
  exerciseId: string
): Promise<ExerciseImageRefreshOutcome | { readonly kind: 'unavailable' }> {
  return active?.refresh(exerciseId) ?? Promise.resolve({ kind: 'unavailable' });
}
