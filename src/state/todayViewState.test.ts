import { todayViewState, TodayViewStateInput } from './todayViewState';
import { mockSessionState } from './test-helpers';

describe('todayViewState', () => {

  describe('guard precedence', () => {
    it('shows resume when sessionState is in-progress (highest priority)', () => {
      const result = todayViewState({
        sessionState: mockSessionState('working'),
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
        sessionState: null,
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
        sessionState: null,
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
        sessionState: null,
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
        sessionState: null,
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
        sessionState: null,
        loading: false,
        loadError: null,
        startOptions: { kind: 'no-routines' },
      });

      expect(result).toEqual({ kind: 'no-routines' });
    });

    it('maps routines-need-exercises with its routines payload', () => {
      const routines = [
        { id: 'r1', name: 'Empty', exerciseCount: 0, hasActiveExercise: false, startable: false },
      ];
      const result = todayViewState({
        sessionState: null,
        loading: false,
        loadError: null,
        startOptions: { kind: 'routines-need-exercises', routines },
      });

      expect(result).toEqual({ kind: 'routines-need-exercises', routines });
    });

    it('maps choose-routine with its routines payload', () => {
      const routines = [
        { id: 'r1', name: 'Push Day', exerciseCount: 3, hasActiveExercise: true, startable: true },
      ];
      const result = todayViewState({
        sessionState: null,
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
        input: { sessionState: null, loading: false, loadError: null, startOptions: null },
        expected: 'loading',
      },
      {
        name: 'first load in flight',
        input: { sessionState: null, loading: true, loadError: null, startOptions: null },
        expected: 'loading',
      },
      {
        name: 'load failed',
        input: { sessionState: null, loading: false, loadError: 'err', startOptions: null },
        expected: 'error',
      },
      {
        name: 'retry in flight after failure',
        input: { sessionState: null, loading: true, loadError: 'err', startOptions: null },
        expected: 'error',
      },
      {
        name: 'reload in flight with stale data still present',
        input: {
          sessionState: null,
          loading: true,
          loadError: null,
          startOptions: { kind: 'no-routines' },
        },
        expected: 'loading',
      },
      {
        name: 'in-progress session wins over everything',
        input: { sessionState: mockSessionState('working'), loading: true, loadError: 'err', startOptions: null },
        expected: 'resume',
      },
      {
        name: 'no routines saved',
        input: {
          sessionState: null,
          loading: false,
          loadError: null,
          startOptions: { kind: 'no-routines' },
        },
        expected: 'no-routines',
      },
      {
        name: 'routines exist but none startable',
        input: {
          sessionState: null,
          loading: false,
          loadError: null,
          startOptions: { kind: 'routines-need-exercises', routines: [] },
        },
        expected: 'routines-need-exercises',
      },
      {
        name: 'routines ready to choose',
        input: {
          sessionState: null,
          loading: false,
          loadError: null,
          startOptions: { kind: 'choose-routine', routines: [] },
        },
        expected: 'choose-routine',
      },
      {
        name: 'finished workout allows choosing routines',
        input: {
          sessionState: mockSessionState('done'),
          loading: false,
          loadError: null,
          startOptions: { kind: 'choose-routine', routines: [] },
        },
        expected: 'choose-routine',
      },
      {
        // Idle phase in-store is unreachable by construction: no rule ever emits an
        // Idle state, saveEngineState skips done, and boot hydrate only loads live
        // states. This row pins fail-closed behavior if idle ever surfaces: treat it
        // as a session in progress.
        name: 'idle phase (unreachable production case) blocks starting',
        input: {
          sessionState: mockSessionState('idle'),
          loading: false,
          loadError: null,
          startOptions: { kind: 'choose-routine', routines: [] },
        },
        expected: 'resume',
      },
    ];

    rows.forEach(({ name, input, expected }) => {
      it(`${name} -> ${expected}`, () => {
        expect(todayViewState(input).kind).toBe(expected);
      });
    });
  });
});
