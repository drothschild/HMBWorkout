import { exportOutcome } from './exportOutcome';
import type { SessionExportFailure } from './exportService';

/**
 * `exportOutcome` (AC1.2, AC1.3) is the first reader of
 * `SessionHistoryExport.failures`. AGENTS.md: a caller that drops `failures`
 * reinstates the #212 silent-partial-export data-loss bug, so the decision
 * MUST live in a pure `src/export` function (jest-covered), never in the
 * screen (`src/app`, invisible to every suite).
 *
 * These assertions pin behaviour, not exact prose: a non-empty `failures`
 * produces a message that NAMES the shortfall count; an empty one never
 * mentions failure; sharing-unavailable produces an informative message rather
 * than implying a silent no-op.
 */

const failure = (sessionId: string): SessionExportFailure => ({
  sessionId,
  reason: 'could not serialize',
});

describe('exportOutcome', () => {
  describe('sharing available, no failures (AC1.3 success path)', () => {
    it('returns a non-empty message', () => {
      const message = exportOutcome({ failures: [], sharingAvailable: true });
      expect(message.length).toBeGreaterThan(0);
    });

    it('does not mention failures', () => {
      const message = exportOutcome({ failures: [], sharingAvailable: true });
      expect(message.toLowerCase()).not.toContain('could not');
      expect(message.toLowerCase()).not.toContain("couldn't");
      expect(message.toLowerCase()).not.toContain('session');
      // No count leaks into a clean-success message.
      expect(message).not.toMatch(/\d/);
    });
  });

  describe('sharing available, some failures (AC1.2)', () => {
    it('names the failure count for a single failure, in the singular', () => {
      const message = exportOutcome({
        failures: [failure('s1')],
        sharingAvailable: true,
      });
      expect(message).toContain('1');
      // singular, and not the plural form
      expect(message).toMatch(/\bsession\b/);
      expect(message).not.toMatch(/\bsessions\b/);
    });

    it('names the failure count for several failures, in the plural', () => {
      const message = exportOutcome({
        failures: [failure('s1'), failure('s2'), failure('s3')],
        sharingAvailable: true,
      });
      expect(message).toContain('3');
      expect(message).toMatch(/\bsessions\b/);
    });

    it('reports the actual count, not a hard-coded number', () => {
      const message = exportOutcome({
        failures: [failure('s1'), failure('s2')],
        sharingAvailable: true,
      });
      expect(message).toContain('2');
      expect(message).not.toContain('3');
      expect(message).not.toContain('1');
    });

    it('differs from the clean-success message', () => {
      const partial = exportOutcome({
        failures: [failure('s1')],
        sharingAvailable: true,
      });
      const clean = exportOutcome({ failures: [], sharingAvailable: true });
      expect(partial).not.toBe(clean);
    });
  });

  describe('sharing unavailable (AC1.3 edge)', () => {
    it('returns a non-empty message rather than an empty/silent no-op', () => {
      const message = exportOutcome({ failures: [], sharingAvailable: false });
      expect(message.length).toBeGreaterThan(0);
    });

    it('mentions sharing so the user learns why nothing opened', () => {
      const message = exportOutcome({ failures: [], sharingAvailable: false });
      expect(message.toLowerCase()).toContain('shar');
    });

    it('does not read as a success', () => {
      const unavailable = exportOutcome({ failures: [], sharingAvailable: false });
      const success = exportOutcome({ failures: [], sharingAvailable: true });
      expect(unavailable).not.toBe(success);
    });

    it('takes precedence over failures — nothing was shared, so the file did not reach the user', () => {
      // In the real screen flow the failure list is not even computed when
      // sharing is unavailable (the screen short-circuits before serializing),
      // so this combination is a don't-care in practice. Pinned so a future
      // reordering of the branches is a conscious choice, not an accident.
      const message = exportOutcome({
        failures: [failure('s1')],
        sharingAvailable: false,
      });
      expect(message.toLowerCase()).toContain('shar');
    });
  });
});
