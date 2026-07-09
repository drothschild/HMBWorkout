/**
 * Settings screen action helpers.
 * Thin wrappers around bridge/sync services for UI error handling.
 */

import { BridgeClient, BridgeUnreachable, BridgeHttpError } from '@/sync/bridgeClient';
import { SyncService } from '@/sync/syncService';

export interface ActionResult {
  status: 'success' | 'error' | 'reachable' | 'unreachable';
  message: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Test bridge connectivity via health check.
 */
export async function testBridgeConnection(bridgeClient: BridgeClient): Promise<ActionResult> {
  try {
    await bridgeClient.health();
    return { status: 'reachable', message: 'Bridge is reachable' };
  } catch (error) {
    if (error instanceof BridgeUnreachable || error instanceof BridgeHttpError) {
      return { status: 'unreachable', message: getErrorMessage(error) };
    }
    return { status: 'unreachable', message: getErrorMessage(error) };
  }
}

/**
 * Run routine import operation.
 */
export async function runImportRoutines(syncService: SyncService): Promise<ActionResult> {
  try {
    await syncService.importRoutines();
    return { status: 'success', message: 'Routines imported successfully' };
  } catch (error) {
    if (error instanceof BridgeUnreachable || error instanceof BridgeHttpError) {
      return { status: 'error', message: getErrorMessage(error) };
    }
    return { status: 'error', message: getErrorMessage(error) };
  }
}

/**
 * Run sync operation (export local sessions).
 */
export async function runSync(syncService: SyncService): Promise<ActionResult> {
  try {
    await syncService.syncNow();
    return { status: 'success', message: 'Sessions synced successfully' };
  } catch (error) {
    if (error instanceof BridgeUnreachable || error instanceof BridgeHttpError) {
      return { status: 'error', message: getErrorMessage(error) };
    }
    return { status: 'error', message: getErrorMessage(error) };
  }
}
