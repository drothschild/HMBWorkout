/**
 * HealthKit workout save integration.
 * Writes completed workout sessions to Apple Health.
 */

import type { LoggedSet } from '@/engine/types';

export interface SessionCompleteSummary {
  startMs: number;
  endMs: number;
  exercisesCompleted: number;
  setsLogged: number;
  loggedSets: LoggedSet[];
  energyBurned?: number;
}

export interface HealthKitSaveDeps {
  ensureAuthorized(deps: { requestAuthorization: (options: any) => Promise<boolean> }): Promise<'authorized' | 'denied'>;
  saveWorkoutSample(
    activityType: number,
    quantities: readonly any[],
    startDate: Date,
    endDate: Date,
    totals?: { distance?: number; energyBurned?: number },
    metadata?: any
  ): Promise<any>;
}

/**
 * Save workout to Apple Health.
 * All errors are logged and swallowed — HealthKit failures must not affect DB or sync state.
 */
export async function saveWorkout(summary: SessionCompleteSummary, deps: HealthKitSaveDeps): Promise<void> {
  try {
    // Ensure authorization first
    const authStatus = await deps.ensureAuthorized({
      requestAuthorization: async () => true, // Placeholder; will be injected in real usage
    });

    if (authStatus === 'denied') {
      console.error('HealthKit authorization denied; skipping workout write');
      return;
    }

    // Build totals object with active energy if available
    const totals: { energyBurned?: number } = {};
    if (summary.energyBurned !== undefined) {
      totals.energyBurned = summary.energyBurned;
    }

    // Write workout to HealthKit
    // ActivityType 20 = functionalStrengthTraining
    // Quantities array is empty for now (can be extended for individual exercise tracking)
    await deps.saveWorkoutSample(
      20, // WorkoutActivityType.functionalStrengthTraining
      [], // quantities
      new Date(summary.startMs),
      new Date(summary.endMs),
      totals,
      undefined // metadata
    );
  } catch (error) {
    // Log and swallow all errors
    const message = error instanceof Error ? error.message : String(error);
    console.error('HealthKit workout write failed:', error);
  }
}
