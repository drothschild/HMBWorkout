import { LoggedSet } from '@/engine/types';
import { evaluateSource } from '@/engine/bridge';
import progressionHintSource from '../engine/rules/progression_hint.lv';

/**
 * Compute progression hint for a strength exercise based on logged sets.
 * Phase 4 Task 3: evaluate progression_hint rule against current session's working sets for the exercise.
 * Returns a display-only hint (e.g., "Increase weight by 2.5 kg" or "Hold current weight").
 * Display-only: never feeds back into transition logic.
 *
 * Called by the store layer (where .lv imports are available).
 */
export function computeProgressionHint(currentExerciseId: string, loggedSets: LoggedSet[], exerciseKind?: string): string | undefined {
  // Only compute for strength exercises
  if (exerciseKind !== 'strength') {
    return undefined;
  }

  // Filter to sets from the current exercise only
  const exerciseSets = loggedSets.filter(set => set.exerciseId === currentExerciseId);

  // If no sets logged yet for this exercise, no hint
  if (exerciseSets.length === 0) {
    return undefined;
  }

  // Convert LoggedSet to rule format (add exerciseId field for compatibility)
  const history = exerciseSets.map(set => ({
    reps: set.reps ?? 0,
    weight_kg: set.weightKg ?? 0,
    rpe: set.rpe ?? 0,
    set_type: set.setType,
    exerciseId: set.exerciseId,
  }));

  const result = evaluateSource(progressionHintSource, { history });
  return result.success ? (result.value as string) : undefined;
}
