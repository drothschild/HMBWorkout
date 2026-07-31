import { todayViewState, TodayViewStateInput } from './todayViewState';

describe('todayViewState', () => {
  describe('guard precedence', () => {
    it('shows resume when sessionState is active (highest priority)', () => {
      const result = todayViewState({
        hasActiveSession: true,
        loading: true,
        loadError: 'some error',
        startOptions: null,
      });

      expect(result).toEqual({ kind: 'resume' });
    });

    it('shows error when loadError is present, even while loading (retry in flight)', () => {
      // Retry keeps the previous error visible (with a disabled Retry button)
      // instead of flashing back to the loading state.
      const result = todayViewState({
        hasActiveSession: false,
        loading: true,
        loadError: 'Could not load routines. Please try again.',
        startOptions: null,
      });

      expect(result).toEqual({
        kind: 'error',
        error: 'Could not load routines. Please try again.',
      });
    });

    it('shows error when loadError is present and not loading', () => {
      // Guard-order defect from review cycle 3: a `loading || !startOptions`
      // check evaluated before loadError made this state render as loading.
      const result = todayViewState({
        hasActiveSession: false,
        loading: false,
        loadError: 'Could not load routines. Please try again.',
        startOptions: null,
      });

      expect(result).toEqual({
        kind: 'error',
        error: 'Could not load routines. Please try again.',
      });
    });

    it('shows loading while a load is in flight', () => {
      const result = todayViewState({
        hasActiveSession: false,
        loading: true,
        loadError: null,
        startOptions: null,
      });

      expect(result).toEqual({ kind: 'loading' });
    });

    it('shows loading on the initial render, before the first load starts', () => {
      // First render happens before useFocusEffect fires: loading is still
      // false and startOptions is still null. This must be a loading state,
      // never a throw (review cycle 4, Critical N1).
      const result = todayViewState({
        hasActiveSession: false,
        loading: false,
        loadError: null,
        startOptions: null,
      });

      expect(result).toEqual({ kind: 'loading' });
    });
  });

  describe('startOptions.kind mapping', () => {
    it('maps no-routines', () => {
      const result = todayViewState({
        hasActiveSession: false,
        loading: false,
        loadError: null,
        startOptions: { kind: 'no-routines' },
      });

      expect(result).toEqual({ kind: 'no-routines' });
    });

    it('maps routines-need-exercises with its routines payload', () => {
      const routines = [{ id: 'r1', name: 'Empty', exerciseCount: 0, startable: false }];
      const result = todayViewState({
        hasActiveSession: false,
        loading: false,
        loadError: null,
        startOptions: { kind: 'routines-need-exercises', routines },
      });

      expect(result).toEqual({ kind: 'routines-need-exercises', routines });
    });

    it('maps choose-routine with its routines payload', () => {
      const routines = [{ id: 'r1', name: 'Push Day', exerciseCount: 3, startable: true }];
      const result = todayViewState({
        hasActiveSession: false,
        loading: false,
        loadError: null,
        startOptions: { kind: 'choose-routine', routines },
      });

      expect(result).toEqual({ kind: 'choose-routine', routines });
    });
  });

  describe('state table', () => {
    // Every reachable input tuple maps to an explicit expected kind. The
    // component can only produce these tuples; each row pins one of them.
    const rows: {
      name: string;
      input: TodayViewStateInput;
      expected: ReturnType<typeof todayViewState>['kind'];
    }[] = [
      {
        name: 'initial render (nothing started yet)',
        input: { hasActiveSession: false, loading: false, loadError: null, startOptions: null },
        expected: 'loading',
      },
      {
        name: 'first load in flight',
        input: { hasActiveSession: false, loading: true, loadError: null, startOptions: null },
        expected: 'loading',
      },
      {
        name: 'load failed',
        input: { hasActiveSession: false, loading: false, loadError: 'err', startOptions: null },
        expected: 'error',
      },
      {
        name: 'retry in flight after failure',
        input: { hasActiveSession: false, loading: true, loadError: 'err', startOptions: null },
        expected: 'error',
      },
      {
        name: 'reload in flight with stale data still present',
        input: {
          hasActiveSession: false,
          loading: true,
          loadError: null,
          startOptions: { kind: 'no-routines' },
        },
        expected: 'loading',
      },
      {
        name: 'active session wins over everything',
        input: { hasActiveSession: true, loading: true, loadError: 'err', startOptions: null },
        expected: 'resume',
      },
      {
        name: 'no routines saved',
        input: {
          hasActiveSession: false,
          loading: false,
          loadError: null,
          startOptions: { kind: 'no-routines' },
        },
        expected: 'no-routines',
      },
      {
        name: 'routines exist but none startable',
        input: {
          hasActiveSession: false,
          loading: false,
          loadError: null,
          startOptions: { kind: 'routines-need-exercises', routines: [] },
        },
        expected: 'routines-need-exercises',
      },
      {
        name: 'routines ready to choose',
        input: {
          hasActiveSession: false,
          loading: false,
          loadError: null,
          startOptions: { kind: 'choose-routine', routines: [] },
        },
        expected: 'choose-routine',
      },
    ];

    rows.forEach(({ name, input, expected }) => {
      it(`${name} -> ${expected}`, () => {
        expect(todayViewState(input).kind).toBe(expected);
      });
    });
  });
});
