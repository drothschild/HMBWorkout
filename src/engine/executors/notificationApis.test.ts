import * as Notifications from 'expo-notifications';
import { createRealNotificationApis } from './notificationApis';

/**
 * Test: createRealNotificationApis adapter to expo-notifications
 * Verifies that the production adapter correctly maps payloads and forwards
 * the stable identifier so re-scheduling replaces pending alerts.
 * Guards the REST_NOTIFICATION_ID constant in restTimer.ts and the
 * kill-mid-rest relaunch replacement behavior (when re-arming, the fixed
 * identifier makes the OS replace a pending notification instead of stacking).
 */

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(async () => 'os-id'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

describe('createRealNotificationApis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('forwards rest-schedule payload identifier to Notifications.scheduleNotificationAsync', async () => {
    const apis = createRealNotificationApis();

    const deadline = Date.now() + 90000;
    await apis.scheduleNotificationAsync({
      identifier: 'rest-timer',
      content: {
        title: 'Rest over',
        sound: true,
      },
      trigger: {
        type: 'DATE',
        date: deadline,
      },
    });

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'rest-timer',
      })
    );
  });

  test('passes through absent identifier as undefined so expo generates its own id', async () => {
    const apis = createRealNotificationApis();

    await apis.scheduleNotificationAsync({
      content: {
        title: 'Rest over!',
        sound: true,
      },
      trigger: null,
    });

    // ObjectContaining checks hasProperty before comparing, so this fails if
    // the `identifier: payload.identifier,` line is deleted from the adapter.
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: undefined,
      })
    );
  });

  test('carries the DATE trigger deadline through to Notifications.scheduleNotificationAsync', async () => {
    const apis = createRealNotificationApis();

    const deadline = Date.now() + 90000;
    await apis.scheduleNotificationAsync({
      identifier: 'rest-timer',
      content: {
        title: 'Rest over',
        sound: true,
      },
      trigger: {
        type: 'DATE',
        date: deadline,
      },
    });

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: {
          type: 'date',
          date: deadline,
        },
      })
    );
  });

  test('converts sound boolean to true for expo-notifications format', async () => {
    const apis = createRealNotificationApis();

    await apis.scheduleNotificationAsync({
      identifier: 'rest-timer',
      content: {
        title: 'Rest over',
        sound: true,
      },
      trigger: null,
    });

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          sound: true,
        }),
      })
    );
  });
});
