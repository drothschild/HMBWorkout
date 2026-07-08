/**
 * Bridge client tests
 * Tests response/error mapping, BridgeUnreachable distinct from HTTP errors
 */

import { createBridgeClient, BridgeUnreachable, BridgeHttpError } from './bridgeClient';

describe('Bridge Client', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
  });

  describe('getRoutines', () => {
    it('returns array of routines on success', async () => {
      const routines = [
        { id: 'routine-1', updated: 1000, markdown: '# Routine 1' },
        { id: 'routine-2', updated: 2000, markdown: '# Routine 2' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(routines),
      });

      const client = createBridgeClient(
        { baseUrl: 'http://bridge.local', token: 'test-token' },
        mockFetch
      );

      const result = await client.getRoutines();
      expect(result).toEqual(routines);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://bridge.local/routines',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    it('throws BridgeHttpError on HTTP error (non-ok response)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValueOnce('Unauthorized'),
      });

      const client = createBridgeClient(
        { baseUrl: 'http://bridge.local', token: 'test-token' },
        mockFetch
      );

      const error = await client.getRoutines().catch((e) => e);
      expect(error).toBeInstanceOf(BridgeHttpError);
      expect(error.status).toBe(401);
    });

    it('throws BridgeUnreachable on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const client = createBridgeClient(
        { baseUrl: 'http://bridge.local', token: 'test-token' },
        mockFetch
      );

      await expect(client.getRoutines()).rejects.toThrow(BridgeUnreachable);
    });
  });

  describe('getRoutine', () => {
    it('returns routine on success', async () => {
      const routine = { id: 'routine-1', updated: 1000, markdown: '# Routine 1' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(routine),
      });

      const client = createBridgeClient(
        { baseUrl: 'http://bridge.local', token: 'test-token' },
        mockFetch
      );

      const result = await client.getRoutine('routine-1');
      expect(result).toEqual(routine);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://bridge.local/routines/routine-1',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    it('throws BridgeHttpError on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValueOnce('Not found'),
      });

      const client = createBridgeClient(
        { baseUrl: 'http://bridge.local', token: 'test-token' },
        mockFetch
      );

      await expect(client.getRoutine('routine-1')).rejects.toThrow(BridgeHttpError);
    });

    it('throws BridgeUnreachable on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const client = createBridgeClient(
        { baseUrl: 'http://bridge.local', token: 'test-token' },
        mockFetch
      );

      await expect(client.getRoutine('routine-1')).rejects.toThrow(BridgeUnreachable);
    });
  });

  describe('postSession', () => {
    it('POSTs session markdown and returns on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce({}),
      });

      const client = createBridgeClient(
        { baseUrl: 'http://bridge.local', token: 'test-token' },
        mockFetch
      );

      const payload = { id: 'session-1', markdown: '# Session' };
      await client.postSession(payload);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://bridge.local/sessions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
          }),
          body: JSON.stringify(payload),
        })
      );
    });

    it('throws BridgeHttpError on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValueOnce('Internal error'),
      });

      const client = createBridgeClient(
        { baseUrl: 'http://bridge.local', token: 'test-token' },
        mockFetch
      );

      await expect(
        client.postSession({ id: 'session-1', markdown: '# Session' })
      ).rejects.toThrow(BridgeHttpError);
    });

    it('throws BridgeUnreachable on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      const client = createBridgeClient(
        { baseUrl: 'http://bridge.local', token: 'test-token' },
        mockFetch
      );

      await expect(
        client.postSession({ id: 'session-1', markdown: '# Session' })
      ).rejects.toThrow(BridgeUnreachable);
    });
  });

  describe('health', () => {
    it('returns ok:true on successful health check', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce({ ok: true }),
      });

      const client = createBridgeClient(
        { baseUrl: 'http://bridge.local', token: 'test-token' },
        mockFetch
      );

      const result = await client.health();
      expect(result).toEqual({ ok: true });
    });

    it('throws BridgeHttpError on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: jest.fn().mockResolvedValueOnce('Service unavailable'),
      });

      const client = createBridgeClient(
        { baseUrl: 'http://bridge.local', token: 'test-token' },
        mockFetch
      );

      await expect(client.health()).rejects.toThrow(BridgeHttpError);
    });

    it('throws BridgeUnreachable on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const client = createBridgeClient(
        { baseUrl: 'http://bridge.local', token: 'test-token' },
        mockFetch
      );

      await expect(client.health()).rejects.toThrow(BridgeUnreachable);
    });
  });

  describe('error types', () => {
    it('BridgeUnreachable is distinct from BridgeHttpError', () => {
      const unreachable = new BridgeUnreachable('Network error');
      const httpError = new BridgeHttpError(401, 'Unauthorized');

      expect(unreachable).toBeInstanceOf(BridgeUnreachable);
      expect(unreachable).not.toBeInstanceOf(BridgeHttpError);
      expect(httpError).toBeInstanceOf(BridgeHttpError);
      expect(httpError).not.toBeInstanceOf(BridgeUnreachable);
    });
  });

  describe('default fetch', () => {
    it('uses global fetch when not provided', () => {
      const client = createBridgeClient({
        baseUrl: 'http://bridge.local',
        token: 'test-token',
      });

      // Verify the client was created successfully (no throw)
      expect(client).toBeDefined();
    });
  });
});
