import { ensureAuthorized } from './healthkit';

describe('ensureAuthorized', () => {
  it('resolves with "authorized" status when authorization succeeds', async () => {
    const mockRequestAuth = jest.fn().mockResolvedValue(true);

    const result = await ensureAuthorized({ requestAuthorization: mockRequestAuth });

    expect(result).toBe('authorized');
    expect(mockRequestAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        toShare: expect.arrayContaining(['HKWorkoutTypeIdentifier']),
      })
    );
  });

  it('resolves with "denied" status when authorization fails', async () => {
    const mockRequestAuth = jest.fn().mockResolvedValue(false);

    const result = await ensureAuthorized({ requestAuthorization: mockRequestAuth });

    expect(result).toBe('denied');
    expect(mockRequestAuth).toHaveBeenCalled();
  });

  it('resolves with "denied" status when authorization throws', async () => {
    const mockRequestAuth = jest.fn().mockRejectedValue(new Error('Authorization failed'));

    const result = await ensureAuthorized({ requestAuthorization: mockRequestAuth });

    expect(result).toBe('denied');
  });

  it('does not throw on denial or error', async () => {
    const mockRequestAuth = jest.fn().mockResolvedValue(false);

    await expect(ensureAuthorized({ requestAuthorization: mockRequestAuth })).resolves.not.toThrow();
  });
});
