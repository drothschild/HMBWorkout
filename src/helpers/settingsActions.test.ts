/**
 * Tests for settings screen actions (test connection, import, sync).
 * Uses injected fake dependencies instead of real bridge/sync services.
 */

import { testBridgeConnection, runImportRoutines, runSync } from './settingsActions';
import { BridgeUnreachable, BridgeHttpError } from '@/sync/bridgeClient';

describe('Settings Actions', () => {
  describe('testBridgeConnection', () => {
    it('returns reachable on successful health check', async () => {
      const fakeBridgeClient = {
        health: async () => ({ ok: true }),
      };

      const result = await testBridgeConnection(fakeBridgeClient as any);

      expect(result).toEqual({ status: 'reachable', message: 'Bridge is reachable' });
    });

    it('returns unreachable on network error', async () => {
      const fakeBridgeClient = {
        health: async () => {
          throw new BridgeUnreachable('Network timeout');
        },
      };

      const result = await testBridgeConnection(fakeBridgeClient as any);

      expect(result).toEqual({ status: 'unreachable', message: 'Network timeout' });
    });

    it('returns unreachable on HTTP error', async () => {
      const fakeBridgeClient = {
        health: async () => {
          throw new BridgeHttpError(500, 'Server error');
        },
      };

      const result = await testBridgeConnection(fakeBridgeClient as any);

      expect(result).toEqual({ status: 'unreachable', message: 'Server error' });
    });

    it('returns unreachable on 401 unauthorized', async () => {
      const fakeBridgeClient = {
        health: async () => {
          throw new BridgeHttpError(401, 'Unauthorized');
        },
      };

      const result = await testBridgeConnection(fakeBridgeClient as any);

      expect(result).toEqual({ status: 'unreachable', message: 'Unauthorized' });
    });
  });

  describe('runImportRoutines', () => {
    it('returns success on successful import', async () => {
      const fakeSyncService = {
        importRoutines: async () => {
          // Successful import
        },
      };

      const result = await runImportRoutines(fakeSyncService as any);

      expect(result).toEqual({ status: 'success', message: 'Routines imported successfully' });
    });

    it('returns error on bridge network error', async () => {
      const fakeSyncService = {
        importRoutines: async () => {
          throw new BridgeUnreachable('Network unavailable');
        },
      };

      const result = await runImportRoutines(fakeSyncService as any);

      expect(result).toEqual({ status: 'error', message: 'Network unavailable' });
    });

    it('returns error on bridge HTTP error', async () => {
      const fakeSyncService = {
        importRoutines: async () => {
          throw new BridgeHttpError(404, 'Not found');
        },
      };

      const result = await runImportRoutines(fakeSyncService as any);

      expect(result).toEqual({ status: 'error', message: 'Not found' });
    });

    it('returns error on unexpected error', async () => {
      const fakeSyncService = {
        importRoutines: async () => {
          throw new Error('Database locked');
        },
      };

      const result = await runImportRoutines(fakeSyncService as any);

      expect(result).toEqual({ status: 'error', message: 'Database locked' });
    });
  });

  describe('runSync', () => {
    it('returns success on successful sync', async () => {
      const fakeSyncService = {
        syncNow: async () => {
          // Successful sync
        },
      };

      const result = await runSync(fakeSyncService as any);

      expect(result).toEqual({ status: 'success', message: 'Sessions synced successfully' });
    });

    it('returns error on bridge network error', async () => {
      const fakeSyncService = {
        syncNow: async () => {
          throw new BridgeUnreachable('Bridge offline');
        },
      };

      const result = await runSync(fakeSyncService as any);

      expect(result).toEqual({ status: 'error', message: 'Bridge offline' });
    });

    it('returns error on unexpected error', async () => {
      const fakeSyncService = {
        syncNow: async () => {
          throw new Error('Sync failed');
        },
      };

      const result = await runSync(fakeSyncService as any);

      expect(result).toEqual({ status: 'error', message: 'Sync failed' });
    });
  });
});
