import { createRestTimerExecutor } from './restTimer';

/**
 * Test: Rest timer executor with mocked expo-notifications
 * Verifies AC2.1 (rest timer alerts) and AC10.6 (deadline-based timing)
 */

describe('createRestTimerExecutor', () => {
  test('schedules notification at exact deadline', async () => {
    const mockSchedule = jest.fn(async () => 'notification-id');
    const mockCancel = jest.fn(async () => undefined);

    const executor = createRestTimerExecutor({
      scheduleNotificationAsync: mockSchedule,
      cancelScheduledNotificationAsync: mockCancel,
      setNotificationHandler: jest.fn(),
      requestPermission: jest.fn(async () => 'granted'),
    });

    const deadline = Date.now() + 90000;
    await executor.onScheduleRest(deadline);

    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          title: expect.any(String),
          sound: true,
        }),
        trigger: {
          type: 'DATE',
          date: deadline,
        },
      })
    );
  });

  test('schedules under a stable identifier so re-arming replaces a pending alert', async () => {
    // A relaunch re-emits ScheduleRest for a still-live deadline while the
    // pre-kill process's notification is still pending in the OS scheduler.
    // The fixed identifier makes the OS replace it instead of stacking a
    // second alert at the same deadline.
    const mockSchedule = jest.fn(async () => 'rest-timer');

    const executor = createRestTimerExecutor({
      scheduleNotificationAsync: mockSchedule,
      cancelScheduledNotificationAsync: jest.fn(),
      setNotificationHandler: jest.fn(),
      requestPermission: jest.fn(async () => 'granted'),
    });

    await executor.onScheduleRest(Date.now() + 90000);

    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'rest-timer' })
    );
  });

  test('cancels by the stable identifier after scheduling', async () => {
    const mockSchedule = jest.fn(async () => 'rest-timer');
    const mockCancel = jest.fn(async () => undefined);

    const executor = createRestTimerExecutor({
      scheduleNotificationAsync: mockSchedule,
      cancelScheduledNotificationAsync: mockCancel,
      setNotificationHandler: jest.fn(),
      requestPermission: jest.fn(async () => 'granted'),
    });

    await executor.onScheduleRest(Date.now() + 90000);
    await executor.onCancelRest();

    expect(mockCancel).toHaveBeenCalledWith('rest-timer');
  });

  test('cancels an alert scheduled by a previous process', async () => {
    // Relaunch: this executor never scheduled anything, but the pre-kill
    // process's alert is still pending under the stable identifier. Skipping
    // rest after a relaunch must still silence it.
    const mockCancel = jest.fn(async () => undefined);

    const executor = createRestTimerExecutor({
      scheduleNotificationAsync: jest.fn(async () => 'rest-timer'),
      cancelScheduledNotificationAsync: mockCancel,
      setNotificationHandler: jest.fn(),
      requestPermission: jest.fn(async () => 'granted'),
    });

    await executor.onCancelRest();

    expect(mockCancel).toHaveBeenCalledWith('rest-timer');
  });

  test('schedules immediate notification on onNotify', async () => {
    const mockSchedule = jest.fn(async () => 'notification-id');

    const executor = createRestTimerExecutor({
      scheduleNotificationAsync: mockSchedule,
      cancelScheduledNotificationAsync: jest.fn(),
      setNotificationHandler: jest.fn(),
      requestPermission: jest.fn(async () => 'granted'),
    });

    await executor.onNotify('Rest over!');

    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          title: 'Rest over!',
        }),
        trigger: null,
      })
    );
  });

  test('requests notification permission on first schedule', async () => {
    const mockSchedule = jest.fn(async () => 'id');
    const mockRequest = jest.fn(async () => 'granted');

    const executor = createRestTimerExecutor({
      scheduleNotificationAsync: mockSchedule,
      cancelScheduledNotificationAsync: jest.fn(),
      setNotificationHandler: jest.fn(),
      requestPermission: mockRequest,
    });

    await executor.onScheduleRest(Date.now() + 90000);

    expect(mockRequest).toHaveBeenCalled();
  });
});
