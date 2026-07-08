import * as Notifications from 'expo-notifications';
import { NotificationAPIs } from './restTimer';

/**
 * Production adapter for expo-notifications v57
 * Maps real expo-notifications API to our abstracted NotificationAPIs interface
 */
export function createRealNotificationApis(): NotificationAPIs {
  return {
    scheduleNotificationAsync: async (payload: any) => {
      // Payload format: { content: { title, sound }, trigger: { type: 'DATE', date } | null }
      // Convert to expo-notifications format
      const request: any = {
        content: {
          title: payload.content.title,
          sound: payload.content.sound ? true : undefined,
        },
        trigger: payload.trigger
          ? {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: payload.trigger.date,
            }
          : null,
      };

      const id = await Notifications.scheduleNotificationAsync(request);
      return id;
    },

    cancelScheduledNotificationAsync: async (id: string) => {
      await Notifications.cancelScheduledNotificationAsync(id);
    },

    setNotificationHandler: (handler: any) => {
      Notifications.setNotificationHandler(handler);
    },

    requestPermission: async () => {
      const status = await Notifications.requestPermissionsAsync();
      // Return status as a string for interface compatibility
      return status.granted ? 'granted' : 'denied';
    },
  };
}

/**
 * Default notification handler for foreground presentation
 * Configured to show banner + sound when app is in foreground
 */
export function getDefaultNotificationHandler() {
  return {
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowList: true,
    }),
  };
}
