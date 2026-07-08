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

  test('cancels notification by stored id', async () => {
    const mockSchedule = jest.fn(async () => 'stored-id-123');
    const mockCancel = jest.fn(async () => undefined);

    const executor = createRestTimerExecutor({
      scheduleNotificationAsync: mockSchedule,
      cancelScheduledNotificationAsync: mockCancel,
      setNotificationHandler: jest.fn(),
      requestPermission: jest.fn(async () => 'granted'),
    });

    await executor.onScheduleRest(Date.now() + 90000);
    await executor.onCancelRest();

    expect(mockCancel).toHaveBeenCalledWith('stored-id-123');
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
