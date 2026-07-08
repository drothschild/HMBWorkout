/**
 * HealthKit authorization wrapper.
 * Handles requesting write access to workout data.
 */

import type { SampleTypeIdentifierWriteable } from '@kingstinct/react-native-healthkit';

export type AuthStatus = 'authorized' | 'denied';

export interface HealthKitDeps {
  requestAuthorization(options: { toShare?: readonly SampleTypeIdentifierWriteable[] }): Promise<boolean>;
}

/**
 * Ensure HealthKit write authorization for workouts and active energy.
 * Returns "authorized" on success, "denied" on failure (never throws).
 * Errors are caught and treated as denial.
 */
export async function ensureAuthorized(deps: HealthKitDeps): Promise<AuthStatus> {
  try {
    // Request write access for workout type and active energy
    const authorized = await deps.requestAuthorization({
      toShare: ['HKWorkoutTypeIdentifier', 'HKQuantityTypeIdentifierActiveEnergyBurned'],
    });

    return authorized ? 'authorized' : 'denied';
  } catch (error) {
    // Swallow any errors and return denied status
    console.error('HealthKit authorization failed:', error);
    return 'denied';
  }
}
