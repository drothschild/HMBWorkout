/**
 * Exercise-question store: the "?" button's ephemeral cache + toggle state.
 *
 * Mirrors `restCommentaryStore.test.ts`'s invariants, adapted for a
 * tap-to-expand affordance instead of an automatic rest-screen comment:
 *  - one Anthropic call per exercise entry per session (successes cached,
 *    failures are not, so a retry is allowed on the next tap);
 *  - a response that lands after the block was collapsed (or the current
 *    exercise changed) is never surfaced;
 *  - logging a set never depends on the AI — no key means no call, and every
 *    failure is logged and swallowed, quietly reverting to collapsed.
 */

import { createExerciseQuestionClient } from '@/ai/exerciseQuestionClient';
import { IMMUTABLE_DIRECTIVES } from '@/ai/coachDirectives';
import {
  injectSettingsStorage,
  resetForTesting,
  setSettings,
  getSettings,
} from '@/state/settings';
import type { AiClient, ProviderConfig } from '@/ai/provider/types';
import type { SessionState, RoutineEntry } from '@/engine/types';
import {
  createExerciseQuestionStore,
  exerciseQuestionTarget,
  type ExerciseQuestionTarget,
} from './exerciseQuestionStore';

function target(overrides: Partial<ExerciseQuestionTarget> = {}): ExerciseQuestionTarget {
  return {
    sessionId: 'session-1',
    entryIdx: 0,
    exerciseId: 'bench-press',
    exerciseTitle: 'Bench Press',
    kind: 'strength',
    ...overrides,
  };
}

function answerResponse(text: string) {
  return {
    ok: true,
    json: async () => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }),
  };
}

async function waitUntil(predicate: () => boolean, label: string) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

describe('createExerciseQuestionStore', () => {
  let fakeStorage: { [key: string]: string };
  let mockFetch: jest.Mock;
  let loadDescription: jest.Mock;
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
      const client = createExerciseQuestionClient(
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
        async suggest() {
          throw new Error('suggest not used in test');
        },
        async ask(request) {
          return client.ask(request);
        },
      };
    };

    const store = createExerciseQuestionStore({
      getSettings,
      loadDescription,
      createClient: createUnifiedClient,
      logError,
    });

    return { store, capturedConfigs };
  }

  beforeEach(() => {
    fakeStorage = {};
    resetForTesting();
    injectSettingsStorage(fakeStorageBackend);
    setSettings({ anthropicKey: 'sk-ant-test' });

    mockFetch = jest.fn().mockResolvedValue(answerResponse('Setup: grip just outside shoulder width.'));
    loadDescription = jest.fn().mockResolvedValue(null);
    logError = jest.fn();
  });

  describe('a normal tap', () => {
    it('expands with the answer for the current exercise', async () => {
      const { store } = makeStore();

      await store.getState().toggle(target());

      expect(store.getState().text).toBe('Setup: grip just outside shoulder width.');
      expect(store.getState().pending).toBe(false);
      expect(store.getState().expandedKey).toBe('session-1#0');
    });

    it('reserves the slot while the request is in flight', async () => {
      let release: () => void = () => {};
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(answerResponse('Brace your core.'));
          })
      );

      const { store } = makeStore();
      const toggling = store.getState().toggle(target());

      await waitUntil(() => store.getState().pending, 'pending to be set');
      expect(store.getState().text).toBeNull();
      expect(store.getState().expandedKey).toBe('session-1#0');

      release();
      await toggling;

      expect(store.getState().pending).toBe(false);
      expect(store.getState().text).toBe('Brace your core.');
    });

    it('builds the prompt from the current exercise and its description', async () => {
      loadDescription.mockResolvedValue('Pause at the chest.');
      const { store } = makeStore();

      await store.getState().toggle(target());

      expect(loadDescription).toHaveBeenCalledWith('bench-press');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content).toContain('Bench Press');
      expect(body.messages[0].content).toContain('strength');
      expect(body.messages[0].content).toContain('Pause at the chest.');
    });

    it('carries the coaching personality from settings', async () => {
      setSettings({ aiPersonality: 'Blunt ex-powerlifter.' });
      const { store } = makeStore();

      await store.getState().toggle(target());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toContain('Blunt ex-powerlifter.');
    });

    it('collapses when tapped again', async () => {
      const { store } = makeStore();
      await store.getState().toggle(target());

      await store.getState().toggle(target());

      expect(store.getState().expandedKey).toBeNull();
      expect(store.getState().text).toBeNull();
    });
  });

  describe('caching per exercise entry for the session', () => {
    it('reuses the cached answer on a re-tap without calling again', async () => {
      const { store } = makeStore();

      await store.getState().toggle(target());
      await store.getState().toggle(target()); // collapse
      await store.getState().toggle(target()); // expand again

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(store.getState().text).toBe('Setup: grip just outside shoulder width.');
    });

    it('does not re-call while already expanded for the same entry', async () => {
      const { store } = makeStore();

      await store.getState().toggle(target());
      // A caller re-deriving the same target and calling toggle again would
      // collapse (this is a toggle, not an idempotent "show"), so this test
      // asserts the collapse path makes no extra network call either.
      await store.getState().toggle(target());

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('calls again for a different exercise entry', async () => {
      mockFetch
        .mockResolvedValueOnce(answerResponse('About bench.'))
        .mockResolvedValueOnce(answerResponse('About squat.'));
      const { store } = makeStore();

      await store.getState().toggle(target({ entryIdx: 0 }));
      await store.getState().toggle(target({ entryIdx: 1, exerciseId: 'squat' }));

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(store.getState().text).toBe('About squat.');
    });

    it('maintains separate cache entries when the same exercise appears at different routine indices', async () => {
      mockFetch
        .mockResolvedValueOnce(answerResponse('First bench press'))
        .mockResolvedValueOnce(answerResponse('Second bench press'));
      const { store } = makeStore();

      await store.getState().toggle(target({ entryIdx: 0, exerciseId: 'bench-press' }));
      await store.getState().toggle(target({ entryIdx: 0 })); // collapse
      await store.getState().toggle(target({ entryIdx: 2, exerciseId: 'bench-press' }));

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(store.getState().text).toBe('Second bench press');

      // Re-expand the first entry and verify it uses its own cached answer
      await store.getState().toggle(target({ entryIdx: 2 })); // collapse second
      await store.getState().toggle(target({ entryIdx: 0 }));
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(store.getState().text).toBe('First bench press');
    });

    it('treats the same entry index in a new session as a new entry', async () => {
      const { store } = makeStore();

      await store.getState().toggle(target({ sessionId: 'session-1' }));
      await store.getState().toggle(target({ sessionId: 'session-1' })); // collapse
      await store.getState().toggle(target({ sessionId: 'session-2' }));

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('dedupes a rapid re-expand that lands while the first request is still in flight', async () => {
      let release: () => void = () => {};
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(answerResponse('Only once.'));
          })
      );

      const { store } = makeStore();
      const first = store.getState().toggle(target());
      await waitUntil(() => mockFetch.mock.calls.length === 1, 'first request to start');

      // Collapse, then immediately expand again before the first resolves.
      await store.getState().toggle(target()); // collapses (synchronous branch)
      const second = store.getState().toggle(target()); // re-expands, should dedupe

      release();
      await Promise.all([first, second]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(store.getState().text).toBe('Only once.');
    });
  });

  describe('collapsing', () => {
    it('clears the expanded state', async () => {
      const { store } = makeStore();
      await store.getState().toggle(target());

      store.getState().collapse();

      expect(store.getState().expandedKey).toBeNull();
      expect(store.getState().text).toBeNull();
      expect(store.getState().pending).toBe(false);
    });

    it('is a no-op when nothing is expanded', () => {
      const { store } = makeStore();

      expect(() => store.getState().collapse()).not.toThrow();
      expect(store.getState().expandedKey).toBeNull();
    });

    it('discards a response that lands after collapsing', async () => {
      let release: () => void = () => {};
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(answerResponse('Too late.'));
          })
      );

      const { store } = makeStore();
      const toggling = store.getState().toggle(target());
      await waitUntil(() => mockFetch.mock.calls.length === 1, 'request to start');

      store.getState().collapse();
      release();
      await toggling;

      expect(store.getState().text).toBeNull();
      expect(store.getState().expandedKey).toBeNull();
      expect(store.getState().pending).toBe(false);
    });

    it('drops a stale response from the UI but still caches it for the next visit', async () => {
      let releaseFirst: () => void = () => {};
      mockFetch
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseFirst = () => resolve(answerResponse('Stale answer.'));
            })
        )
        .mockResolvedValueOnce(answerResponse('Fresh answer.'));

      const { store } = makeStore();
      const first = store.getState().toggle(target({ entryIdx: 0 }));
      await waitUntil(() => mockFetch.mock.calls.length === 1, 'first request');

      // Switch to a different entry before the first response lands
      const second = store.getState().toggle(target({ entryIdx: 1, exerciseId: 'squat' }));
      releaseFirst();
      await Promise.all([first, second]);

      expect(store.getState().text).toBe('Fresh answer.');

      mockFetch.mockClear();
      await store.getState().toggle(target({ entryIdx: 0 }));

      expect(mockFetch).not.toHaveBeenCalled();
      expect(store.getState().text).toBe('Stale answer.');
    });
  });

  describe('logging a set must never depend on the AI', () => {
    it('makes no call and does not expand when no API key is configured', async () => {
      setSettings({ anthropicKey: '' });
      const { store } = makeStore();

      await store.getState().toggle(target());

      expect(mockFetch).not.toHaveBeenCalled();
      expect(loadDescription).not.toHaveBeenCalled();
      expect(store.getState().text).toBeNull();
      expect(store.getState().expandedKey).toBeNull();
      expect(store.getState().pending).toBe(false);
    });

    it('treats a whitespace-only key as no key', async () => {
      setSettings({ anthropicKey: '   ' });
      const { store } = makeStore();

      await store.getState().toggle(target());

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('forwards the configured Anthropic API key to the client, not a blank value', async () => {
      // This catches mutants that blank anthropicKey but leave the shell unchanged.
      // The factory records configs, so we verify the key value was actually forwarded.
      // Without this assertion, the mutant survives because mockFetch resolves anyway.
      const { store, capturedConfigs } = makeStore();

      await store.getState().toggle(target());

      expect(mockFetch).toHaveBeenCalled();
      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0].anthropicKey).toBe('sk-ant-test'); // Must be non-empty
    });

    it('drives the surface from an OpenAI-only settings blob and forwards openaiKey', async () => {
      setSettings({
        anthropicKey: '',
        openaiKey: 'sk-openai-123',
        aiProvider: undefined,
      });

      const { store, capturedConfigs } = makeStore();

      await store.getState().toggle(target());

      expect(store.getState().text).toBe('Setup: grip just outside shoulder width.');
      expect(store.getState().pending).toBe(false);
      // Verify the config was forwarded with the OpenAI key, not blanked
      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]).toEqual({
        aiModel: undefined,
        aiProvider: undefined,
        anthropicKey: '',
        openaiKey: 'sk-openai-123',
      });
    });

    it('does not fire from a no-key settings blob', async () => {
      setSettings({
        anthropicKey: '',
        openaiKey: '',
      });

      const { store, capturedConfigs } = makeStore();

      await store.getState().toggle(target());

      expect(mockFetch).not.toHaveBeenCalled();
      expect(store.getState().text).toBeNull();
      expect(store.getState().expandedKey).toBeNull();
      expect(store.getState().pending).toBe(false);
      expect(capturedConfigs).toHaveLength(0);
    });

    it('E04/E05: forwards all provider config fields including aiProvider', async () => {
      setSettings({
        anthropicKey: 'sk-ant-prod',
        openaiKey: 'sk-openai-prod',
        aiProvider: 'anthropic',
      });

      const { store, capturedConfigs } = makeStore();
      mockFetch.mockResolvedValue(answerResponse('Test answer'));

      await store.getState().toggle(target());

      // E04/E05 mutations: deleting anthropicKey or openaiKey lines would fail
      expect(capturedConfigs).toHaveLength(1);
      const config = capturedConfigs[0];
      expect(config).toHaveProperty('anthropicKey', 'sk-ant-prod');
      expect(config).toHaveProperty('openaiKey', 'sk-openai-prod');
      expect(config).toHaveProperty('aiProvider', 'anthropic');
      expect(Object.keys(config).sort()).toEqual(['aiModel', 'aiProvider', 'anthropicKey', 'openaiKey']);
    });

    it('swallows and logs a network failure, quietly reverting to collapsed', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network request failed'));
      const { store } = makeStore();

      await expect(store.getState().toggle(target())).resolves.toBeUndefined();

      expect(store.getState().text).toBeNull();
      expect(store.getState().expandedKey).toBeNull();
      expect(store.getState().pending).toBe(false);
      expect(logError).toHaveBeenCalled();
    });

    it('swallows and logs an HTTP failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'unauthorized' });
      const { store } = makeStore();

      await store.getState().toggle(target());

      expect(store.getState().text).toBeNull();
      expect(store.getState().expandedKey).toBeNull();
      expect(logError).toHaveBeenCalled();
    });

    it('swallows and logs an unusable response body', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ content: [] }) });
      const { store } = makeStore();

      await store.getState().toggle(target());

      expect(store.getState().text).toBeNull();
      expect(logError).toHaveBeenCalled();
    });

    it('swallows and logs a description read failure', async () => {
      loadDescription.mockRejectedValueOnce(new Error('db closed'));
      const { store } = makeStore();

      await store.getState().toggle(target());

      expect(mockFetch).not.toHaveBeenCalled();
      expect(store.getState().text).toBeNull();
      expect(logError).toHaveBeenCalled();
    });

    it('allows a retry on the next tap after a failed attempt (failures are not cached)', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(answerResponse('Success on retry.'));
      const { store } = makeStore();

      await store.getState().toggle(target());
      expect(store.getState().text).toBeNull();

      await store.getState().toggle(target());

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(store.getState().text).toBe('Success on retry.');
    });
  });

  describe('coach directives', () => {
    it('carries the immutable coach directives — the safety rules bind here too', async () => {
      const { store } = makeStore();

      await store.getState().toggle(target());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      for (const line of IMMUTABLE_DIRECTIVES.split('\n')) {
        expect(body.system).toContain(line.replace(/^-\s*/, ''));
      }
    });

    it('places the directives after the coaching style section', async () => {
      // Precedence against injection: coaching style is user-controlled free
      // text, and the directives must outrank it.
      setSettings({ aiPersonality: 'Blunt ex-powerlifter.' });
      const { store } = makeStore();

      await store.getState().toggle(target());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const firstDirective = IMMUTABLE_DIRECTIVES.split('\n')[0].replace(/^-\s*/, '');
      expect(body.system.indexOf(firstDirective)).toBeGreaterThan(
        body.system.indexOf('Blunt ex-powerlifter.')
      );
    });
  });

  describe('Security: secrets regression guard', () => {
    it('coach-onboarding.AC6.3 / AC6.5: profile reaches the prompt, secrets never do', async () => {
      // This test covers the store→builder wiring, which the prompt-builder
      // tests cannot: they call the builder directly, so deleting the three
      // profile lines from this store leaves them all green. Asserting the
      // profile VALUES appear in the request body is what pins the wiring.
      setSettings({
        anthropicKey: 'sk-ant-test-secret',
        openaiKey: 'sk-openai-secret-key',
        aiProvider: 'anthropic',
        aiPersonality: 'Encouraging but honest.',
        profileAge: '41',
        profileExperience: 'Advanced',
      });
      const { store } = makeStore();

      await store.getState().toggle(target());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const prompt = `${body.system}\n${JSON.stringify(body.messages)}`;

      // Profile SHOULD appear — this is the store-wiring assertion.
      expect(prompt).toContain('41');
      expect(prompt).toContain('Advanced');
      expect(prompt).toContain('Encouraging but honest.');

      // Secrets should NOT. openaiKey is a real reachable field, not a
      // hypothetical key name — an openai client exists.
      expect(prompt).not.toContain('sk-ant-test-secret');
      expect(prompt).not.toContain('sk-openai-secret-key');
    });
  });
});

describe('exerciseQuestionTarget', () => {
  const entry = (overrides: Partial<RoutineEntry> = {}): RoutineEntry => ({
    idx: 0,
    exerciseId: 'bench-press',
    kind: 'strength',
    warmupSets: 0,
    targetSets: 3,
    targetReps: 8,
    targetDurationSeconds: 0,
    restSeconds: 90,
    supersetGroup: '',
    ...overrides,
  });

  const state = (overrides: Partial<SessionState> = {}): SessionState => ({
    sessionId: 'session-1',
    routineId: 'routine-1',
    phase: 'working',
    exerciseIndex: 0,
    setIndex: 0,
    loggedSets: [],
    startedAtMs: 0,
    entries: [entry(), entry({ idx: 1, exerciseId: 'squat' })],
    ...overrides,
  });

  it('is null when there is no session', () => {
    expect(exerciseQuestionTarget(null)).toBeNull();
    expect(exerciseQuestionTarget(undefined)).toBeNull();
  });

  it('is null when the session is done', () => {
    expect(exerciseQuestionTarget(state({ phase: 'done' }))).toBeNull();
  });

  it('is null when idle (before session starts)', () => {
    expect(exerciseQuestionTarget(state({ phase: 'idle' }))).toBeNull();
  });

  it('is null during the full-screen rest takeover', () => {
    expect(exerciseQuestionTarget(state({ phase: 'resting' }))).toBeNull();
  });

  it('is null while paused mid-rest', () => {
    expect(
      exerciseQuestionTarget(state({ phase: 'paused', restRemainingMs: 30_000 }))
    ).toBeNull();
  });

  it('describes the current exercise while paused outside of a rest', () => {
    const result = exerciseQuestionTarget(state({ phase: 'paused', restRemainingMs: 0 }));

    expect(result?.exerciseId).toBe('bench-press');
  });

  it('describes the current exercise during warmup or working', () => {
    expect(exerciseQuestionTarget(state({ phase: 'warmup' }))?.exerciseId).toBe('bench-press');
    expect(exerciseQuestionTarget(state({ phase: 'working' }))?.exerciseId).toBe('bench-press');
  });

  it('is null when there is no entry at the current index', () => {
    expect(exerciseQuestionTarget(state({ exerciseIndex: 5 }))).toBeNull();
    expect(exerciseQuestionTarget(state({ entries: [] }))).toBeNull();
  });

  it('carries the entry kind', () => {
    expect(
      exerciseQuestionTarget(state({ entries: [entry({ kind: 'cardio' })] }))?.kind
    ).toBe('cardio');
  });

  it('resolves the exercise title shell-side, falling back to the id', () => {
    expect(
      exerciseQuestionTarget(state(), { 'bench-press': 'Barbell Bench Press' })?.exerciseTitle
    ).toBe('Barbell Bench Press');
    expect(exerciseQuestionTarget(state())?.exerciseTitle).toBe('bench-press');
  });
});
