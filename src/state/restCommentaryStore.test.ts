/**
 * Rest-screen coach commentary: the ephemeral cache + generation store.
 *
 * Three invariants live here, and each has a test below:
 *  - at most ONE Anthropic call per upcoming routine entry per session;
 *  - a response that lands after rest ended (or after the upcoming entry
 *    changed) is never surfaced;
 *  - rest never depends on the AI — no key means no call, and every failure
 *    is logged and swallowed.
 */

import type { RestCommentaryHistorySet } from '@/ai/restCommentaryPrompt';
import { createRestCommentaryClient } from '@/ai/anthropicClient';
import { IMMUTABLE_DIRECTIVES } from '@/ai/coachDirectives';
import type { AiClient, ProviderConfig } from '@/ai/provider/types';
import {
  injectSettingsStorage,
  resetForTesting,
  setSettings,
  getSettings,
} from '@/state/settings';
import type { SessionState, RoutineEntry } from '@/engine/types';
import {
  createRestCommentaryStore,
  restCommentaryTarget,
  type RestCommentaryTarget,
} from './restCommentaryStore';

function target(overrides: Partial<RestCommentaryTarget> = {}): RestCommentaryTarget {
  return {
    sessionId: 'session-1',
    entryIdx: 0,
    exerciseId: 'bench-press',
    exerciseTitle: 'Bench Press',
    kind: 'strength',
    warmupSets: 0,
    targetSets: 3,
    targetReps: 8,
    targetDurationSeconds: 0,
    restSeconds: 90,
    isWarmupSet: false,
    setNumber: 2,
    ...overrides,
  };
}

const HISTORY: RestCommentaryHistorySet[] = [
  { reps: 8, weightKg: 61.23, rpe: 8, loggedDate: '2026-07-28' },
];

function commentResponse(text: string) {
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

describe('createRestCommentaryStore', () => {
  let fakeStorage: { [key: string]: string };
  let mockFetch: jest.Mock;
  let loadHistory: jest.Mock;
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
      const client = createRestCommentaryClient(
        { apiKey },
        mockFetch as unknown as typeof fetch
      );
      return {
        async chat() {
          throw new Error('chat not used in test');
        },
        async comment(request) {
          return client.comment(request);
        },
        async suggest() {
          throw new Error('suggest not used in test');
        },
        async ask() {
          throw new Error('ask not used in test');
        },
      };
    };

    const store = createRestCommentaryStore({
      getSettings,
      loadHistory,
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

    mockFetch = jest.fn().mockResolvedValue(commentResponse('Same weight, one more rep.'));
    loadHistory = jest.fn().mockResolvedValue(HISTORY);
    logError = jest.fn();
  });

  describe('a normal rest', () => {
    it('surfaces the coach comment for the upcoming exercise', async () => {
      const { store } = makeStore();

      await store.getState().show(target());

      expect(store.getState().text).toBe('Same weight, one more rep.');
      expect(store.getState().pending).toBe(false);
    });

    it('reserves the slot while the request is in flight', async () => {
      let release: () => void = () => {};
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(commentResponse('Brace hard.'));
          })
      );

      const { store } = makeStore();
      const showing = store.getState().show(target());

      await waitUntil(() => store.getState().pending, 'pending to be set');
      expect(store.getState().text).toBeNull();

      release();
      await showing;

      expect(store.getState().pending).toBe(false);
      expect(store.getState().text).toBe('Brace hard.');
    });

    it('builds the prompt from the upcoming exercise and its history', async () => {
      const { store } = makeStore();

      await store.getState().show(target());

      expect(loadHistory).toHaveBeenCalledWith('bench-press');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content).toContain('Bench Press');
      expect(body.messages[0].content).toContain('135lbs');
      expect(body.messages[0].content).toContain('2026-07-28');
    });

    it('carries the coaching personality from settings', async () => {
      setSettings({ aiPersonality: 'Blunt ex-powerlifter.' });
      const { store } = makeStore();

      await store.getState().show(target());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toContain('Blunt ex-powerlifter.');
    });

    it('clears the comment when rest ends', async () => {
      const { store } = makeStore();
      await store.getState().show(target());

      store.getState().hide();

      expect(store.getState().text).toBeNull();
      expect(store.getState().pending).toBe(false);
    });
  });

  describe('one call per upcoming entry per session', () => {
    it('reuses the cached comment on the next rest of the same exercise', async () => {
      const { store } = makeStore();

      await store.getState().show(target());
      store.getState().hide();
      await store.getState().show(target());

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(store.getState().text).toBe('Same weight, one more rep.');
    });

    it('deliberately retries on the next rest if the first attempt failed', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(commentResponse('Success on retry.'));
      const { store } = makeStore();

      // First rest: network failure, no cache
      await store.getState().show(target());
      expect(store.getState().text).toBeNull();

      store.getState().hide();

      // Next rest of the same entry: retry allowed (not cached)
      await store.getState().show(target());

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(store.getState().text).toBe('Success on retry.');
    });

    it('does not re-request while the same rest is still showing', async () => {
      const { store } = makeStore();

      await store.getState().show(target());
      await store.getState().show(target());

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('requests again for a different upcoming entry', async () => {
      mockFetch
        .mockResolvedValueOnce(commentResponse('First.'))
        .mockResolvedValueOnce(commentResponse('Second.'));
      const { store } = makeStore();

      await store.getState().show(target({ entryIdx: 0 }));
      await store.getState().show(target({ entryIdx: 1, exerciseId: 'squat' }));

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(store.getState().text).toBe('Second.');
    });

    it('treats the same entry index in a new session as a new entry', async () => {
      const { store } = makeStore();

      await store.getState().show(target({ sessionId: 'session-1' }));
      await store.getState().show(target({ sessionId: 'session-2' }));

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not fire a second request when a rest for the same entry restarts mid-flight', async () => {
      let release: () => void = () => {};
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(commentResponse('Only once.'));
          })
      );

      const { store } = makeStore();
      const first = store.getState().show(target());
      await waitUntil(() => mockFetch.mock.calls.length === 1, 'first request');

      store.getState().hide();
      const second = store.getState().show(target());

      release();
      await Promise.all([first, second]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(store.getState().text).toBe('Only once.');
    });
  });

  describe('stale responses', () => {
    it('discards a response that lands after rest ended', async () => {
      let release: () => void = () => {};
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(commentResponse('Too late.'));
          })
      );

      const { store } = makeStore();
      const showing = store.getState().show(target());
      await waitUntil(() => mockFetch.mock.calls.length === 1, 'request to start');

      store.getState().hide();
      release();
      await showing;

      expect(store.getState().text).toBeNull();
      expect(store.getState().pending).toBe(false);
    });

    it('drops a stale response from the UI but still caches it for rule 1', async () => {
      let releaseFirst: () => void = () => {};
      mockFetch
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseFirst = () => resolve(commentResponse('Stale comment.'));
            })
        )
        .mockResolvedValueOnce(commentResponse('Fresh comment.'));

      const { store } = makeStore();
      const first = store.getState().show(target({ entryIdx: 0 }));
      await waitUntil(() => mockFetch.mock.calls.length === 1, 'first request');

      // Switch to a different entry before the first response lands
      const second = store.getState().show(target({ entryIdx: 1, exerciseId: 'squat' }));
      releaseFirst();
      await Promise.all([first, second]);

      // UI shows the fresh response
      expect(store.getState().text).toBe('Fresh comment.');

      // But the stale response was cached too, so re-visiting entry 0 uses it without refetching
      mockFetch.mockClear();
      await store.getState().show(target({ entryIdx: 0 }));

      expect(mockFetch).not.toHaveBeenCalled();
      expect(store.getState().text).toBe('Stale comment.');
    });

    it('discards a response that lands after the upcoming entry changed', async () => {
      let releaseFirst: () => void = () => {};
      mockFetch
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseFirst = () => resolve(commentResponse('About the old exercise.'));
            })
        )
        .mockResolvedValueOnce(commentResponse('About the new exercise.'));

      const { store } = makeStore();
      const first = store.getState().show(target({ entryIdx: 0 }));
      await waitUntil(() => mockFetch.mock.calls.length === 1, 'first request');

      const second = store.getState().show(target({ entryIdx: 1, exerciseId: 'squat' }));
      releaseFirst();
      await Promise.all([first, second]);

      expect(store.getState().text).toBe('About the new exercise.');
    });
  });

  describe('rest never depends on the AI', () => {
    it('forwards the configured API key to the client, not a blank value', async () => {
      // This catches mutants that blank anthropicKey but leave the shell unchanged.
      // The double records configs, so we verify the key value was actually forwarded.
      const { store, capturedConfigs } = makeStore();

      await store.getState().show(target());

      expect(mockFetch).toHaveBeenCalled();
      // E06 mutant: blanking config.anthropicKey in the double.
      // Without this assertion, the mutant survives because mockFetch resolves anyway.
      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0].anthropicKey).toBe('sk-ant-test'); // Must be non-empty
    });

    it('makes no call and shows nothing when no API key is configured', async () => {
      setSettings({ anthropicKey: '' });
      const { store, capturedConfigs } = makeStore();

      await store.getState().show(target());

      expect(mockFetch).not.toHaveBeenCalled();
      expect(loadHistory).not.toHaveBeenCalled();
      expect(store.getState().text).toBeNull();
      expect(store.getState().pending).toBe(false);
      // The byte-identical guarantee: with no key, no slot is ever reserved.
      expect(store.getState().attempted).toBe(false);
      // Verify the config was recorded but with empty key
      expect(capturedConfigs).toHaveLength(0); // No config recorded if no API call
    });

    it('R03/R04: forwards all provider config fields including aiProvider', async () => {
      setSettings({
        anthropicKey: 'sk-ant-prod',
        openaiKey: 'sk-openai-prod',
        aiProvider: 'anthropic',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'Great work!' }] }),
      });

      const { store, capturedConfigs } = makeStore();

      await store.getState().show(target());

      // R03/R04 mutations: deleting anthropicKey or openaiKey lines would fail
      expect(capturedConfigs).toHaveLength(1);
      const config = capturedConfigs[0];
      expect(config).toHaveProperty('anthropicKey', 'sk-ant-prod');
      expect(config).toHaveProperty('openaiKey', 'sk-openai-prod');
      expect(config).toHaveProperty('aiProvider', 'anthropic');
      expect(Object.keys(config).sort()).toEqual(['aiProvider', 'anthropicKey', 'openaiKey']);
    });

    it('treats a whitespace-only key as no key', async () => {
      setSettings({ anthropicKey: '   ' });
      const { store } = makeStore();

      await store.getState().show(target());

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('surfaces the coach comment from an OpenAI-only settings blob and forwards openaiKey', async () => {
      setSettings({
        anthropicKey: '',
        openaiKey: 'sk-openai-123',
        aiProvider: undefined,
      });

      const { store, capturedConfigs } = makeStore();

      await store.getState().show(target());

      expect(store.getState().text).toBe('Same weight, one more rep.');
      expect(store.getState().pending).toBe(false);
      // Verify the config was forwarded with the OpenAI key, not blanked
      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]).toEqual({
        anthropicKey: '',
        openaiKey: 'sk-openai-123',
        aiProvider: undefined,
      });
    });

    it('makes no call from a no-key settings blob', async () => {
      setSettings({
        anthropicKey: '',
        openaiKey: '',
      });

      const { store, capturedConfigs } = makeStore();

      await store.getState().show(target());

      expect(mockFetch).not.toHaveBeenCalled();
      expect(loadHistory).not.toHaveBeenCalled();
      expect(store.getState().text).toBeNull();
      expect(store.getState().pending).toBe(false);
      expect(store.getState().attempted).toBe(false);
      // No config should be captured if hasApiKey() returns false
      expect(capturedConfigs).toHaveLength(0);
    });

    it('swallows and logs a network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network request failed'));
      const { store } = makeStore();

      await expect(store.getState().show(target())).resolves.toBeUndefined();

      expect(store.getState().text).toBeNull();
      expect(store.getState().pending).toBe(false);
      // A failed attempt keeps the slot reserved for the life of the rest.
      expect(store.getState().attempted).toBe(true);
      expect(logError).toHaveBeenCalled();
    });

    it('clears attempted when the rest ends', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network request failed'));
      const { store } = makeStore();

      await store.getState().show(target());
      expect(store.getState().attempted).toBe(true);

      store.getState().hide();
      expect(store.getState().attempted).toBe(false);
    });

    it('swallows and logs an HTTP failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'unauthorized',
      });
      const { store } = makeStore();

      await store.getState().show(target());

      expect(store.getState().text).toBeNull();
      expect(logError).toHaveBeenCalled();
    });

    it('swallows and logs an unusable response body', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ content: [] }) });
      const { store } = makeStore();

      await store.getState().show(target());

      expect(store.getState().text).toBeNull();
      expect(logError).toHaveBeenCalled();
    });

    it('swallows and logs a history read failure', async () => {
      loadHistory.mockRejectedValueOnce(new Error('db closed'));
      const { store } = makeStore();

      await store.getState().show(target());

      expect(mockFetch).not.toHaveBeenCalled();
      expect(store.getState().text).toBeNull();
      expect(logError).toHaveBeenCalled();
    });
  });

  describe('coach directives', () => {
    it('carries the immutable coach directives — the safety rules bind here too', async () => {
      const { store } = makeStore();

      await store.getState().show(target());

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

      await store.getState().show(target());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const firstDirective = IMMUTABLE_DIRECTIVES.split('\n')[0].replace(/^-\s*/, '');
      expect(body.system.indexOf(firstDirective)).toBeGreaterThan(
        body.system.indexOf('Blunt ex-powerlifter.')
      );
    });
  });

  describe('Security: secrets regression guard', () => {
    it('coach-onboarding.AC6.5 Failure: never puts secrets in the prompt, even with profile', async () => {
      setSettings({
        anthropicKey: 'sk-ant-test-secret',
        openaiKey: 'sk-openai-secret-key',
        aiPersonality: 'Encouraging but honest.',
        profileAge: '41',
        profileExperience: 'Advanced',
      });
      const { store } = makeStore();

      await store.getState().show(target());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const prompt = `${body.system}\n${JSON.stringify(body.messages)}`;

      // Profile values SHOULD appear
      expect(prompt).toContain('41');
      expect(prompt).toContain('Advanced');
      expect(prompt).toContain('Encouraging but honest.');

      // Secrets should NOT appear
      expect(prompt).not.toContain('sk-ant-test-secret');
      expect(prompt).not.toContain('sk-openai-secret-key');
    });
  });
});

describe('restCommentaryTarget', () => {
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
    phase: 'resting',
    exerciseIndex: 0,
    setIndex: 1,
    loggedSets: [],
    startedAtMs: 0,
    entries: [entry(), entry({ idx: 1, exerciseId: 'squat' })],
    ...overrides,
  });

  it('is null when there is no session', () => {
    expect(restCommentaryTarget(null)).toBeNull();
    expect(restCommentaryTarget(undefined)).toBeNull();
  });

  it('is null when the session is not resting', () => {
    expect(restCommentaryTarget(state({ phase: 'working' }))).toBeNull();
    expect(restCommentaryTarget(state({ phase: 'done' }))).toBeNull();
  });

  it('is null while paused outside of a rest', () => {
    expect(restCommentaryTarget(state({ phase: 'paused', restRemainingMs: 0 }))).toBeNull();
  });

  it('describes the upcoming exercise while paused mid-rest', () => {
    const result = restCommentaryTarget(state({ phase: 'paused', restRemainingMs: 30_000 }));

    expect(result?.exerciseId).toBe('bench-press');
  });

  it('is null when there is no entry at the current index', () => {
    // Rest cannot precede `done`, but a stranded index must show nothing
    // rather than reach for an exercise that is not there.
    expect(restCommentaryTarget(state({ exerciseIndex: 5 }))).toBeNull();
    expect(restCommentaryTarget(state({ entries: [] }))).toBeNull();
  });

  it('points at the next set of the same exercise when resting between sets', () => {
    // The engine advances setIndex and leaves exerciseIndex alone, so the
    // current entry IS the upcoming one.
    const result = restCommentaryTarget(state({ exerciseIndex: 0, setIndex: 1 }));

    expect(result).toMatchObject({
      sessionId: 'session-1',
      entryIdx: 0,
      exerciseId: 'bench-press',
      isWarmupSet: false,
      setNumber: 2,
    });
  });

  it('points at the next exercise when resting between exercises', () => {
    // The engine advances exerciseIndex before entering Resting.
    const result = restCommentaryTarget(state({ exerciseIndex: 1, setIndex: 0 }));

    expect(result).toMatchObject({ entryIdx: 1, exerciseId: 'squat', setNumber: 1 });
  });

  it('reports an upcoming warmup set as a warmup', () => {
    const result = restCommentaryTarget(
      state({ entries: [entry({ warmupSets: 2 })], exerciseIndex: 0, setIndex: 1 })
    );

    expect(result).toMatchObject({ isWarmupSet: true, setNumber: 2 });
  });

  it('resolves the exercise title shell-side, falling back to the id', () => {
    expect(restCommentaryTarget(state(), { 'bench-press': 'Barbell Bench Press' })?.exerciseTitle)
      .toBe('Barbell Bench Press');
    expect(restCommentaryTarget(state())?.exerciseTitle).toBe('bench-press');
  });
});
