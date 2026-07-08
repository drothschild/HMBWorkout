/**
 * Rest timer executor - schedules notifications at deadline for rest periods.
 * Uses expo-notifications for foreground+background alerting.
 * Deadline-based (no ticking timer inside app - engine handles via RestElapsed event).
 */

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
  let scheduledNotificationId: string | null = null;
  let permissionRequested = false;

  return {
    async onScheduleRest(deadlineMs: number) {
      // Request permission once
      if (!permissionRequested) {
        await apis.requestPermission();
        permissionRequested = true;
      }

      // Schedule notification at exact deadline
      scheduledNotificationId = await apis.scheduleNotificationAsync({
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
      if (scheduledNotificationId) {
        await apis.cancelScheduledNotificationAsync(scheduledNotificationId);
        scheduledNotificationId = null;
      }
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
