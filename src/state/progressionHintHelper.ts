import { LoggedSet } from '@/engine/types';

/**
 * Compute progression hint for a strength exercise based on logged sets.
 * This implements the same logic as the progression_hint function in helpers.lv.
 */
export function computeProgressionHint(currentExerciseId: string, loggedSets: LoggedSet[], exerciseKind?: string): string | undefined {
  // Only compute for strength exercises
  if (exerciseKind !== 'strength') {
    return undefined;
  }

  // Convert logged sets: handle TypeScript nulls as undefined (Option equivalence)
  const history = loggedSets.map(set => ({
    exerciseId: set.exerciseId,
    setType: set.setType,
    reps: set.reps,
    weightKg: set.weightKg,
    durationSeconds: set.durationSeconds,
    rpe: set.rpe,
  }));

  // Implementation mirroring helpers.lv progression_hint function
  if (history.length === 0) {
    return 'No history yet - establish a baseline';
  }

  const workingSets = history.filter((s: any) => s.setType === 'working');

  if (workingSets.length === 0) {
    return 'No working sets yet - establish a baseline';
  }

  const highRpeSets = workingSets.filter((s: any) => {
    // Check if rpe is set (not undefined and not null) and > 8.0
    return s.rpe != null && s.rpe > 8.0;
  });

  if (highRpeSets.length === 0) {
    return 'Increase weight by 2.5 kg - hitting target with room in RPE';
  } else {
    return 'Hold current weight - working harder than desired';
  }
}
