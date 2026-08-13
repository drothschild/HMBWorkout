/**
 * The Replace flow: ask the coach for alternates, let the athlete pick one, and
 * swap the exercise in both the running session and the routine.
 *
 * Invariants with a test each:
 *  - the button is offered only when a key is configured AND nothing has been
 *    recorded against the current entry;
 *  - the engine decides whether the swap is legal — the store dispatches and
 *    obeys the answer, and only writes the routine row once the engine agreed;
 *  - a stale response (the workout moved on, or the sheet was closed) is
 *    discarded, never applied;
 *  - the session never depends on the AI: every failure is logged, surfaced as
 *    an error string, and swallowed.
 */

import { createExerciseAlternatesClient } from '@/ai/alternatesClient';
import { IMMUTABLE_DIRECTIVES } from '@/ai/coachDirectives';
import type { SessionState, RoutineEntry } from '@/engine/types';
import type { AiClient, ProviderConfig } from '@/ai/provider/types';
import { getSettings, injectSettingsStorage, resetForTesting, setSettings } from '@/state/settings';
import {
  canOfferReplace,
  createExerciseReplaceStore,
  replaceExerciseTarget,
  type ReplaceTarget,
} from './exerciseReplaceStore';

const ALTERNATES = {
  alternates: [
    { title: 'Dumbbell Floor Press', description: 'Press from the floor, elbows tucked.' },
    { title: 'Machine Chest Press', description: 'Seated press against a fixed path.' },
    { title: 'Weighted Push Up', description: 'Push up with a plate across the upper back.' },
  ],
};

function makeEntry(overrides?: Partial<RoutineEntry>): RoutineEntry {
  return {
    idx: 0,
    exerciseId: 'barbell-bench-press',
    kind: 'strength',
    warmupSets: 1,
    targetSets: 4,
    targetReps: 6,
    targetDurationSeconds: 0,
    restSeconds: 150,
    supersetGroup: '',
    ...overrides,
  };
}

function makeState(overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: 'session-1',
    routineId: 'routine-1',
    phase: 'working',
    exerciseIndex: 0,
    setIndex: 0,
    supersetPosition: 0,
    restDeadlineMs: 0,
    restRemainingMs: 0,
    loggedSets: [],
    startedAtMs: 1000,
    prePausePhase: '',
    entries: [makeEntry(), makeEntry({ idx: 1, exerciseId: 'barbell-row' })],
    ...overrides,
  };
}

function makeTarget(overrides?: Partial<ReplaceTarget>): ReplaceTarget {
  return {
    sessionId: 'session-1',
    routineId: 'routine-1',
    idx: 0,
    exerciseId: 'barbell-bench-press',
    exerciseTitle: 'Barbell Bench Press',
    kind: 'strength',
    warmupSets: 1,
    targetSets: 4,
    targetReps: 6,
    targetDurationSeconds: 0,
    restSeconds: 150,
    ...overrides,
  };
}

function alternatesResponse(value: unknown) {
  return {
    ok: true,
    json: async () => ({
      content: [{ type: 'text', text: JSON.stringify(value) }],
      stop_reason: 'end_turn',
    }),
  };
}

describe('replaceExerciseTarget', () => {
  it('describes the entry the athlete is facing', () => {
    expect(replaceExerciseTarget(makeState(), { 'barbell-bench-press': 'Barbell Bench Press' })).toEqual(
      makeTarget()
    );
  });

  it('falls back to the raw id when the title has not resolved', () => {
    expect(replaceExerciseTarget(makeState())?.exerciseTitle).toBe('barbell-bench-press');
  });

  it('is null once a set has been recorded against the entry', () => {
    expect(replaceExerciseTarget(makeState({ setIndex: 1 }))).toBeNull();
  });

  it('is null in phases where there is no exercise in progress', () => {
    for (const phase of ['idle', 'done', 'resting', 'paused'] as const) {
      expect(replaceExerciseTarget(makeState({ phase }))).toBeNull();
    }
  });

  it('is offered during warmup — nothing is committed until a set lands', () => {
    expect(replaceExerciseTarget(makeState({ phase: 'warmup' }))).not.toBeNull();
  });

  it('is null with no session, or a stranded exercise index', () => {
    expect(replaceExerciseTarget(null)).toBeNull();
    expect(replaceExerciseTarget(makeState({ exerciseIndex: 9 }))).toBeNull();
  });

  it('targets the second of two entries that name the same exercise', () => {
    const state = makeState({
      exerciseIndex: 1,
      entries: [makeEntry(), makeEntry({ idx: 1 })],
      // The first entry's sets are in loggedSets under the same exerciseId; the
      // second entry is still untouched and must remain replaceable.
      loggedSets: [
        {
          exerciseId: 'barbell-bench-press',
          setType: 'working',
          reps: 6,
          weightKg: 80,
          durationSeconds: undefined,
          rpe: -1,
        },
      ],
    });

    expect(replaceExerciseTarget(state)?.idx).toBe(1);
  });
});

describe('canOfferReplace', () => {
  it('is false without an API key (Anthropic or OpenAI) — the button is hidden, not disabled', () => {
    expect(canOfferReplace(makeState(), { anthropicKey: '' })).toBe(false);
    expect(canOfferReplace(makeState(), { anthropicKey: '   ' })).toBe(false);
    expect(canOfferReplace(makeState(), { anthropicKey: '', openaiKey: '' })).toBe(false);
  });

  it('is true with an Anthropic key and an untouched current entry', () => {
    expect(canOfferReplace(makeState(), { anthropicKey: 'sk-ant-test' })).toBe(true);
  });

  it('is true with an OpenAI key and an untouched current entry', () => {
    expect(canOfferReplace(makeState(), { openaiKey: 'sk-openai-test' })).toBe(true);
  });

  it('is false once a set has been recorded, key or not', () => {
    expect(canOfferReplace(makeState({ setIndex: 1 }), { anthropicKey: 'sk-ant-test' })).toBe(false);
  });
});

describe('createExerciseReplaceStore', () => {
  let fakeStorage: Record<string, string>;
  let mockFetch: jest.Mock;
  let dispatch: jest.Mock;
  let ensureExercise: jest.Mock;
  let applyToRoutine: jest.Mock;
  let logError: jest.Mock;

  const fakeStorageBackend = {
    getItemAsync: async (key: string) => fakeStorage[key] ?? null,
    setItemAsync: async (key: string, value: string) => {
      fakeStorage[key] = value;
    },
    deleteItemAsync: async (key: string) => {
      delete fakeStorage[key];
    },
  };

  function makeStore() {
    const capturedConfigs: ProviderConfig[] = [];

    const createUnifiedClient = (config: ProviderConfig): AiClient => {
      capturedConfigs.push(config);
      const apiKey = (config.aiProvider === 'openai') ||
        (config.openaiKey && !config.anthropicKey && !config.aiProvider)
        ? (config.openaiKey ?? '')
        : (config.anthropicKey ?? '');
      const client = createExerciseAlternatesClient(
        { apiKey },
        mockFetch as unknown as typeof fetch
      );
      return {
        async chat() {
          throw new Error('chat not used in test');
        },
        async comment() {
          throw new Error('comment not used in test');
        },
        async suggest(request) {
          return client.suggest(request);
        },
        async ask() {
          throw new Error('ask not used in test');
        },
      };
    };

    const store = createExerciseReplaceStore({
      getSettings,
      createClient: createUnifiedClient,
      dispatch,
      ensureExercise,
      applyToRoutine,
      logError,
    });
    return { store, capturedConfigs };
  }

  beforeEach(() => {
    fakeStorage = {};
    resetForTesting();
    injectSettingsStorage(fakeStorageBackend);
    setSettings({ anthropicKey: 'sk-ant-test' });

    mockFetch = jest.fn().mockResolvedValue(alternatesResponse(ALTERNATES));
    dispatch = jest.fn().mockResolvedValue(makeState());
    ensureExercise = jest.fn().mockResolvedValue('dumbbell-floor-press');
    applyToRoutine = jest.fn().mockResolvedValue(undefined);
    logError = jest.fn();
  });

  describe('open', () => {
    it('forwards the configured Anthropic API key to the client, not a blank value', async () => {
      // This catches mutants that blank anthropicKey but leave the shell unchanged.
      // The factory records configs, so we verify the key value was actually forwarded.
      // Without this assertion, the mutant survives because mockFetch resolves anyway.
      const { store, capturedConfigs } = makeStore();

      await store.getState().open(makeTarget());

      expect(store.getState().status).toBe('choosing');
      // Verify the config was forwarded with the Anthropic key, not blanked
      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0].anthropicKey).toBe('sk-ant-test'); // Must be non-empty
    });

    it('fetches alternates and offers them for choosing', async () => {
      const { store } = makeStore();

      await store.getState().open(makeTarget());

      expect(store.getState().status).toBe('choosing');
      expect(store.getState().alternates).toHaveLength(3);
      expect(store.getState().alternates[0].title).toBe('Dumbbell Floor Press');
      expect(store.getState().error).toBeNull();
    });

    it('reports loading while the request is in flight', async () => {
      let release: (value: unknown) => void = () => {};
      mockFetch.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));

      const { store } = makeStore();
      const pending = store.getState().open(makeTarget());

      expect(store.getState().status).toBe('loading');

      release(alternatesResponse(ALTERNATES));
      await pending;

      expect(store.getState().status).toBe('choosing');
    });

    it('sends the exercise being replaced in the prompt', async () => {
      const { store } = makeStore();

      await store.getState().open(makeTarget());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content).toContain('Barbell Bench Press');
    });

    it('makes no call and offers nothing without a key', async () => {
      setSettings({ anthropicKey: '' });
      const { store } = makeStore();

      await store.getState().open(makeTarget());

      expect(mockFetch).not.toHaveBeenCalled();
      expect(store.getState().status).toBe('idle');
      expect(store.getState().alternates).toEqual([]);
    });

    it('fetches alternates from an OpenAI-only settings blob and forwards openaiKey', async () => {
      setSettings({
        anthropicKey: '',
        openaiKey: 'sk-openai-123',
        aiProvider: undefined,
      });

      const { store, capturedConfigs } = makeStore();

      await store.getState().open(makeTarget());

      expect(store.getState().status).toBe('choosing');
      expect(store.getState().alternates).toHaveLength(3);
      // Verify the config was forwarded with the OpenAI key, not blanked
      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]).toEqual({
        anthropicKey: '',
        openaiKey: 'sk-openai-123',
        aiProvider: undefined,
      });
    });

    it('X03/X04: forwards all provider config fields including aiProvider', async () => {
      setSettings({
        anthropicKey: 'sk-ant-prod',
        openaiKey: 'sk-openai-prod',
        aiProvider: 'openai',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: JSON.stringify([{ title: 'Alt 1', kind: 'strength' }]) }],
          stop_reason: 'end_turn',
        }),
      });

      const { store, capturedConfigs } = makeStore();

      await store.getState().open(makeTarget());

      // X03/X04 mutations: deleting anthropicKey or openaiKey lines would fail
      expect(capturedConfigs).toHaveLength(1);
      const config = capturedConfigs[0];
      expect(config).toHaveProperty('anthropicKey', 'sk-ant-prod');
      expect(config).toHaveProperty('openaiKey', 'sk-openai-prod');
      expect(config).toHaveProperty('aiProvider', 'openai');
      expect(Object.keys(config).sort()).toEqual(['aiModel', 'aiProvider', 'anthropicKey', 'openaiKey']);
    });

    it('does nothing from a no-key settings blob', async () => {
      setSettings({
        anthropicKey: '',
        openaiKey: '',
      });

      const { store, capturedConfigs } = makeStore();

      await store.getState().open(makeTarget());

      expect(mockFetch).not.toHaveBeenCalled();
      expect(store.getState().status).toBe('idle');
      expect(store.getState().alternates).toEqual([]);
      expect(capturedConfigs).toHaveLength(0);
    });

    it('swallows a failed request, surfacing an error instead of throwing', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
      const { store } = makeStore();

      await expect(store.getState().open(makeTarget())).resolves.toBeUndefined();

      expect(store.getState().status).toBe('error');
      expect(store.getState().error).toMatch(/couldn’t|could not/i);
      expect(logError).toHaveBeenCalled();
    });

    it('swallows a malformed response the same way', async () => {
      mockFetch.mockResolvedValueOnce(alternatesResponse({ alternates: [] }));
      const { store } = makeStore();

      await store.getState().open(makeTarget());

      expect(store.getState().status).toBe('error');
      expect(store.getState().alternates).toEqual([]);
      expect(logError).toHaveBeenCalled();
    });

    it('discards a response that lands after the sheet was closed', async () => {
      let release: (value: unknown) => void = () => {};
      mockFetch.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));

      const { store } = makeStore();
      const pending = store.getState().open(makeTarget());
      store.getState().cancel();

      release(alternatesResponse(ALTERNATES));
      await pending;

      expect(store.getState().status).toBe('idle');
      expect(store.getState().alternates).toEqual([]);
    });

    it('carries the immutable coach directives — the safety rules bind here too', async () => {
      const { store } = makeStore();

      await store.getState().open(makeTarget());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      for (const line of IMMUTABLE_DIRECTIVES.split('\n')) {
        expect(body.system).toContain(line.replace(/^-\s*/, ''));
      }
    });

    it('places the directives after every section built from user text', async () => {
      // Precedence against injection: goals, equipment and coaching style are
      // user-controlled free text, and the directives must outrank them.
      setSettings({
        anthropicKey: 'sk-ant-test',
        aiGoals: 'Bigger bench',
        aiEquipment: 'Barbell, dumbbells',
        aiPersonality: 'Blunt',
      });
      const { store } = makeStore();

      await store.getState().open(makeTarget());

      const system: string = JSON.parse(mockFetch.mock.calls[0][1].body).system;
      const firstDirective = IMMUTABLE_DIRECTIVES.split('\n')[0].replace(/^-\s*/, '');
      expect(system.indexOf(firstDirective)).toBeGreaterThan(system.indexOf('Bigger bench'));
      expect(system.indexOf(firstDirective)).toBeGreaterThan(system.indexOf('Barbell, dumbbells'));
      expect(system.indexOf(firstDirective)).toBeGreaterThan(system.indexOf('Blunt'));
    });

    it('coach-onboarding.AC6.4 / AC6.5: profile reaches the prompt, secrets never do', async () => {
      // This test covers the store→builder wiring, which the prompt-builder
      // tests cannot: they call the builder directly, so deleting the three
      // profile lines from this store leaves them all green. Asserting the
      // profile VALUES appear in the request body is what pins the wiring.
      setSettings({
        anthropicKey: 'sk-ant-test-secret',
        openaiKey: 'sk-openai-secret-key',
        aiProvider: 'anthropic',
        aiGoals: 'Bigger bench',
        aiEquipment: 'Barbell, dumbbells',
        aiPersonality: 'Blunt',
        profileAge: '41',
        profileExperience: 'Advanced',
      });
      const { store } = makeStore();

      await store.getState().open(makeTarget());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const prompt = `${body.system}\n${body.messages[0].content}`;

      // Profile SHOULD appear — this is the store-wiring assertion.
      expect(prompt).toContain('41');
      expect(prompt).toContain('Advanced');

      // Secrets should NOT. openaiKey is a real reachable field, not a
      // hypothetical key name — an openai client exists.
      expect(prompt).not.toContain('sk-ant-test-secret');
      expect(prompt).not.toContain('sk-openai-secret-key');
      // The key travels in the header, where it belongs.
      expect(mockFetch.mock.calls[0][1].headers['x-api-key']).toBe('sk-ant-test-secret');
    });
  });

  describe('choose', () => {
    async function opened() {
      const { store } = makeStore();
      await store.getState().open(makeTarget());
      return store;
    }

    it('creates the exercise, tells the engine, then rewrites the routine row', async () => {
      const store = await opened();

      const ok = await store.getState().choose(ALTERNATES.alternates[0]);

      expect(ok).toBe(true);
      expect(ensureExercise).toHaveBeenCalledWith(ALTERNATES.alternates[0], 'strength');
      expect(dispatch).toHaveBeenCalledWith({
        tag: 'ReplaceExercise',
        idx: 0,
        exerciseId: 'dumbbell-floor-press',
      });
      expect(applyToRoutine).toHaveBeenCalledWith('routine-1', 0, 'dumbbell-floor-press');
      expect(store.getState().status).toBe('idle');
      expect(store.getState().alternates).toEqual([]);
    });

    it('writes the routine row only after the engine accepted the swap', async () => {
      const order: string[] = [];
      ensureExercise.mockImplementation(async () => {
        order.push('ensureExercise');
        return 'dumbbell-floor-press';
      });
      dispatch.mockImplementation(async () => {
        order.push('dispatch');
        return makeState();
      });
      applyToRoutine.mockImplementation(async () => {
        order.push('applyToRoutine');
      });

      const store = await opened();
      await store.getState().choose(ALTERNATES.alternates[0]);

      expect(order).toEqual(['ensureExercise', 'dispatch', 'applyToRoutine']);
    });

    it('leaves the routine alone when the engine rejects the swap', async () => {
      dispatch.mockResolvedValueOnce(null);
      const store = await opened();

      const ok = await store.getState().choose(ALTERNATES.alternates[0]);

      expect(ok).toBe(false);
      expect(applyToRoutine).not.toHaveBeenCalled();
      expect(store.getState().status).toBe('error');
    });

    it('re-validates the chosen alternate before writing anything', async () => {
      const store = await opened();

      const ok = await store.getState().choose({ title: '???', description: 'x' } as any);

      expect(ok).toBe(false);
      expect(ensureExercise).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      expect(applyToRoutine).not.toHaveBeenCalled();
    });

    it('swallows a failed write, surfacing an error instead of throwing', async () => {
      applyToRoutine.mockRejectedValueOnce(new Error('disk full'));
      const store = await opened();

      await expect(store.getState().choose(ALTERNATES.alternates[0])).resolves.toBe(false);

      expect(store.getState().status).toBe('error');
      expect(logError).toHaveBeenCalled();
    });

    it('does nothing when there is no open choice', async () => {
      const { store } = makeStore();

      const ok = await store.getState().choose(ALTERNATES.alternates[0]);

      expect(ok).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('ignores a second tap on the same choice — one swap, not two', async () => {
      const store = await opened();

      const [first, second] = await Promise.all([
        store.getState().choose(ALTERNATES.alternates[0]),
        store.getState().choose(ALTERNATES.alternates[1]),
      ]);

      expect([first, second]).toEqual([true, false]);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(applyToRoutine).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancel', () => {
    it('clears the sheet', async () => {
      const { store } = makeStore();
      await store.getState().open(makeTarget());

      store.getState().cancel();

      expect(store.getState().status).toBe('idle');
      expect(store.getState().alternates).toEqual([]);
      expect(store.getState().error).toBeNull();
    });
  });

  describe('routineRevision counter', () => {
    // AC6.7: the counter is bumped after a successful swap, but not on rejection
    // or write failure. The bump is observable only after the write completes.

    async function opened() {
      const { store } = makeStore();
      await store.getState().open(makeTarget());
      return store;
    }

    it('(a) bump: a successful choose() leaves routineRevision one higher', async () => {
      const store = await opened();
      const before = store.getState().routineRevision;

      await store.getState().choose(ALTERNATES.alternates[0]);

      expect(store.getState().routineRevision).toBe(before + 1);
    });

    it('(b) ordering: the bump happens AFTER applyToRoutine resolves', async () => {
      const recordedValues: number[] = [];
      applyToRoutine.mockImplementation(async () => {
        recordedValues.push(store.getState().routineRevision);
      });

      const store = await opened();
      const before = store.getState().routineRevision;

      await store.getState().choose(ALTERNATES.alternates[0]);

      // The value captured during applyToRoutine should be the pre-bump value
      expect(recordedValues[0]).toBe(before);
      // And the current value should be bumped
      expect(store.getState().routineRevision).toBe(before + 1);
    });

    it('(c) rejection: an engine rejection leaves routineRevision unchanged', async () => {
      dispatch.mockResolvedValueOnce(null);
      const store = await opened();
      const before = store.getState().routineRevision;

      await store.getState().choose(ALTERNATES.alternates[0]);

      expect(store.getState().routineRevision).toBe(before);
    });

    it('(d) write failure: a thrown applyToRoutine leaves routineRevision unchanged', async () => {
      applyToRoutine.mockRejectedValueOnce(new Error('disk full'));
      const store = await opened();
      const before = store.getState().routineRevision;

      await store.getState().choose(ALTERNATES.alternates[0]);

      expect(store.getState().routineRevision).toBe(before);
    });

    it('(e) cancelled mid-write: routineRevision is bumped even if the sheet is cancelled while writing', async () => {
      let release: (value: void) => void = () => {};
      applyToRoutine.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));

      const store = await opened();
      const before = store.getState().routineRevision;

      const choosePromise = store.getState().choose(ALTERNATES.alternates[0]);
      // Cancel while the write is in flight
      store.getState().cancel();
      // Release the promise
      release();
      await choosePromise;

      // The write committed, so the bump should have happened
      expect(store.getState().routineRevision).toBe(before + 1);
    });
  });
});
