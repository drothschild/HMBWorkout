/**
 * Rest timer executor - schedules notifications at deadline for rest periods.
 * Uses expo-notifications for foreground+background alerting.
 * Deadline-based (no ticking timer inside app - engine handles via RestElapsed event).
 */

/**
 * Stable identifier for the rest alert. A scheduled OS notification outlives
 * the process, so its identity must not live in process memory: scheduling
 * under this identifier replaces a pending alert left by a previous process
 * (the relaunch re-arm must not double-notify), and cancelling by it silences
 * an alert this process never scheduled.
 */
export const REST_NOTIFICATION_ID = 'rest-timer';

export interface NotificationAPIs {
  scheduleNotificationAsync: (payload: any) => Promise<string>;
  cancelScheduledNotificationAsync: (id: string) => Promise<void>;
  setNotificationHandler: (handler: any) => void;
  requestPermission: () => Promise<string>;
}

export interface RestTimerExecutor {
  onScheduleRest(deadlineMs: number): Promise<void>;
  onCancelRest(): Promise<void>;
  onNotify(message: string): Promise<void>;
}

export function createRestTimerExecutor(apis: NotificationAPIs): RestTimerExecutor {
  let permissionRequested = false;

  return {
    async onScheduleRest(deadlineMs: number) {
      // Request permission once
      if (!permissionRequested) {
        await apis.requestPermission();
        permissionRequested = true;
      }

      // Schedule notification at exact deadline
      await apis.scheduleNotificationAsync({
        identifier: REST_NOTIFICATION_ID,
        content: {
          title: 'Rest over',
          sound: true,
        },
        trigger: {
          type: 'DATE',
          date: deadlineMs,
        },
      });
    },

    async onCancelRest() {
      // Only one rest alert can ever be pending (fixed identifier), so cancel
      // unconditionally — there is no in-process record of whether the pending
      // one belongs to this process or a killed predecessor.
      await apis.cancelScheduledNotificationAsync(REST_NOTIFICATION_ID);
    },

    async onNotify(message: string) {
      // Immediate foreground notification
      await apis.scheduleNotificationAsync({
        content: {
          title: message,
          sound: true,
        },
        trigger: null,
      });
    },
  };
}
