import { todayViewState } from './todayViewState';

describe('todayViewState', () => {
  describe('guard precedence', () => {
    it('shows resume when sessionState is active (highest priority)', () => {
      const result = todayViewState({
        hasActiveSession: true,
        loading: true,
        loadError: 'some error',
        startOptions: null,
      });

      expect(result.kind).toBe('resume');
    });

    it('shows error when loadError is present, even while loading (retry in flight)', () => {
      // This is the C1 regression test: when loadError is truthy but we're in a retry,
      // error must be visible (not hidden behind loading)
      const result = todayViewState({
        hasActiveSession: false,
        loading: true,
        loadError: 'Could not load routines. Please try again.',
        startOptions: null,
      });

      expect(result.kind).toBe('error');
      expect(result.error).toBe('Could not load routines. Please try again.');
    });

    it('shows error when loadError is present and not loading', () => {
      // C1 defect: old code had `loading || startOptions === null` BEFORE loadError check
      // so this case (loading=false, loadError=truthy, startOptions=null) was unreachable
      const result = todayViewState({
        hasActiveSession: false,
        loading: false,
        loadError: 'Could not load routines. Please try again.',
        startOptions: null,
      });

      expect(result.kind).toBe('error');
      expect(result.error).toBe('Could not load routines. Please try again.');
    });

    it('shows loading only when no error and startOptions is null', () => {
      const result = todayViewState({
        hasActiveSession: false,
        loading: true,
        loadError: null,
        startOptions: null,
      });

      expect(result.kind).toBe('loading');
    });
  });

  describe('startOptions.kind mapping', () => {
    it('shows no-routines state when presenter returns no-routines', () => {
      const result = todayViewState({
        hasActiveSession: false,
        loading: false,
        loadError: null,
        startOptions: { kind: 'no-routines' },
      });

      expect(result.kind).toBe('no-routines');
    });

    it('shows routines-need-exercises when presenter returns that kind', () => {
      const routines = [
        { id: 'r1', name: 'Empty', exerciseCount: 0, startable: false },
      ];
      const result = todayViewState({
        hasActiveSession: false,
        loading: false,
        loadError: null,
        startOptions: { kind: 'routines-need-exercises', routines },
      });

      expect(result.kind).toBe('routines-need-exercises');
      expect(result.routines).toEqual(routines);
    });

    it('shows choose-routine when presenter returns that kind', () => {
      const routines = [
        { id: 'r1', name: 'Push Day', exerciseCount: 3, startable: true },
      ];
      const result = todayViewState({
        hasActiveSession: false,
        loading: false,
        loadError: null,
        startOptions: { kind: 'choose-routine', routines },
      });

      expect(result.kind).toBe('choose-routine');
      expect(result.routines).toEqual(routines);
    });
  });

  describe('exhaustiveness', () => {
    it('handles all valid state combinations', () => {
      // Verify that adding a new startOptions.kind would require updating this function
      const testCases: Parameters<typeof todayViewState>[0][] = [
        // resume
        { hasActiveSession: true, loading: false, loadError: null, startOptions: null },
        // error (no retry)
        { hasActiveSession: false, loading: false, loadError: 'err', startOptions: null },
        // error (retry in flight)
        { hasActiveSession: false, loading: true, loadError: 'err', startOptions: null },
        // loading
        { hasActiveSession: false, loading: true, loadError: null, startOptions: null },
        // no-routines
        { hasActiveSession: false, loading: false, loadError: null, startOptions: { kind: 'no-routines' } },
        // routines-need-exercises
        {
          hasActiveSession: false,
          loading: false,
          loadError: null,
          startOptions: { kind: 'routines-need-exercises', routines: [] },
        },
        // choose-routine
        {
          hasActiveSession: false,
          loading: false,
          loadError: null,
          startOptions: { kind: 'choose-routine', routines: [] },
        },
      ];

      testCases.forEach((testCase) => {
        expect(() => todayViewState(testCase)).not.toThrow();
        const result = todayViewState(testCase);
        // Verify result has a kind that can be exhausted by a switch statement
        expect(['resume', 'error', 'loading', 'no-routines', 'routines-need-exercises', 'choose-routine']).toContain(
          result.kind,
        );
      });
    });
  });
});
