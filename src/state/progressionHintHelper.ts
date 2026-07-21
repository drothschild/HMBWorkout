import { LoggedSet } from '@/engine/types';

/**
 * Compute progression hint for a strength exercise based on logged sets.
 * TODO: Integrate with rill-lang engine for progression_hint evaluation
 * Currently stubbed pending createEngine multi-rule support
 */
export function computeProgressionHint(currentExerciseId: string, loggedSets: LoggedSet[], exerciseKind?: string): string | undefined {
  // Only compute for strength exercises
  if (exerciseKind !== 'strength') {
    return undefined;
  }

  // TODO: Evaluate progression_hint rule through rill-lang engine
  // For now, return undefined (no hint)
  return undefined;
}
