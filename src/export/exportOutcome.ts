import type { SessionExportFailure } from './exportService';

/**
 * Inputs to the export-outcome message. `failures` is the `SessionHistoryExport`
 * shortfall list; `sharingAvailable` is `Sharing.isAvailableAsync()`'s answer.
 */
export interface ExportOutcomeInput {
  readonly failures: readonly SessionExportFailure[];
  readonly sharingAvailable: boolean;
}

/**
 * The user-facing message for an attempted export → share (AC1.2, AC1.3).
 *
 * This is the FIRST reader of `SessionHistoryExport.failures`. Per AGENTS.md and
 * #212, a non-empty `failures` must reach the user — a screen that wrote the
 * markdown and dropped `failures` on the floor would reinstate the silent
 * partial-export data-loss bug. Keeping the branch here, in jest-covered
 * `src/export`, is what makes AC1.2 testable at all: a screen-only
 * implementation (`src/app` has no jest project) passes every test while
 * silently reinstating the bug.
 *
 * Precedence: sharing-unavailable is a hard stop. When the device cannot open a
 * share sheet, the file never reaches the user, so a partial-serialization
 * count is moot and the message says only that. In the real screen flow the
 * failure list is not computed when sharing is unavailable, so this ordering is
 * a don't-care in practice; it is pinned so a future reordering is deliberate.
 */
export function exportOutcome({ failures, sharingAvailable }: ExportOutcomeInput): string {
  if (!sharingAvailable) {
    return 'Sharing is not available on this device, so nothing was exported.';
  }

  const failureCount = failures.length;
  if (failureCount > 0) {
    const noun = failureCount === 1 ? 'session' : 'sessions';
    return `Exported, but ${failureCount} ${noun} could not be included.`;
  }

  return 'Export ready to share.';
}
