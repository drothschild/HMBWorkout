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
import { createRestCommentaryClient as createOpenaiRestCommentaryClient } from '@/ai/openaiClient';
import { IMMUTABLE_DIRECTIVES } from '@/ai/coachDirectives';
import type { AiClient, ProviderConfig } from '@/ai/provider/types';
import {
  injectSettingsStorage,
  resetForTesting,
  setSettings,
  getSettings,
} from '@/state/settings';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { SessionState, RoutineEntry, LoggedSet } from '@/engine/types';
import {
  createRestCommentaryStore,
  restCommentaryKey,
  restCommentaryTarget,
  type RestCommentaryTarget,
} from './restCommentaryStore';

type UpNextTarget = Extract<RestCommentaryTarget, { shape: 'upNext' }>;
type LastSetTarget = Extract<RestCommentaryTarget, { shape: 'lastSet' }>;

function target(overrides: Partial<UpNextTarget> = {}): RestCommentaryTarget {
  return {
    shape: 'upNext',
    sessionId: 'session-1',
    entryIdx: 0,
    exerciseIndex: 0,
    setIndex: 0,
    exerciseId: 'bench-press',
    exerciseTitle: 'Bench Press',
    kind: 'strength',
    restSeconds: 90,
    // Deliberately NOT `totalOfType` sets long. `restCommentaryStore` is the
    // single line by which the per-set denominator reaches the prompt, and a
    // fixture where the list length and the caller-supplied count agree cannot
    // tell a regression that re-derives the denominator apart from the correct
    // read.
    sets: [
      { setType: 'normal', reps: 8 },
      { setType: 'normal', reps: 8 },
    ],
    isWarmupSet: false,
    setNumber: 2,
    totalOfType: 3,
    ...overrides,
  };
}

function lastSetTarget(overrides: Partial<LastSetTarget> = {}): RestCommentaryTarget {
  return {
    ...(target() as UpNextTarget),
    shape: 'lastSet',
    setIndex: 1,
    setNumber: 1,
    completedSet: { reps: 8, weightKg: 61.23, rpe: 8 },
    logIndex: 0,
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
      const isOpenai = (config.aiProvider === 'openai') ||
        (config.openaiKey && !config.anthropicKey && !config.aiProvider);
      const apiKey = isOpenai
        ? (config.openaiKey ?? '')
        : (config.anthropicKey ?? '');
      const client = isOpenai
        ? createOpenaiRestCommentaryClient(
            { apiKey },
            mockFetch as unknown as typeof fetch
          )
        : createRestCommentaryClient(
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
      // The set position the coach is told about comes from the entry's own
      // list (`totalOfType`), never the aggregate. No other test in this file
      // asserts the rendered position, so without this line the one store
      // statement that forwards the denominator has no cover at all.
      expect(body.messages[0].content).toContain('Set 2 of 3');
      expect(body.messages[0].content).not.toContain('Set 2 of 99');
    });

    it('forwards the prescription itself into the prompt, not an empty list', async () => {
      // The store→prompt seam for `sets` (#276 Phase 4). Both ENDS of it are
      // pinned — `restCommentaryTarget` builds the list (above), and
      // `buildRestCommentaryPrompt` renders it (restCommentaryPrompt.test) —
      // but the hand-off between them was not: substituting `sets: []` at this
      // one statement survived the whole suite, and every rest remark would
      // have been told "no target recorded" for an exercise that has a target.
      const { store } = makeStore();

      await store.getState().show(target());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content).toContain('target 2 × 8 reps');
      expect(body.messages[0].content).not.toContain('no target recorded');
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
      await store.getState().show(target({ entryIdx: 1, exerciseIndex: 1, exerciseId: 'squat' }));

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
      const second = store.getState().show(target({ entryIdx: 1, exerciseIndex: 1, exerciseId: 'squat' }));
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

      const second = store.getState().show(target({ entryIdx: 1, exerciseIndex: 1, exerciseId: 'squat' }));
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
      expect(Object.keys(config).sort()).toEqual(['aiModel', 'aiProvider', 'anthropicKey', 'openaiKey']);
    });

    it('I2: forwards configured aiModel by value (not just by key presence)', async () => {
      // I2 fix: prior test only checked Object.keys presence; it passed even
      // when aiModel was undefined. This test verifies the actual value arrives.
      setSettings({
        anthropicKey: 'sk-ant-test',
        aiModel: { chat: 'claude-opus', oneShot: 'claude-haiku' },
      });

      mockFetch.mockResolvedValueOnce(commentResponse('Great work!'));

      const { store, capturedConfigs } = makeStore();

      await store.getState().show(target());

      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0].aiModel).toStrictEqual({
        chat: 'claude-opus',
        oneShot: 'claude-haiku',
      });
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

      // Use OpenAI Responses format: output array with message item
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Same weight, one more rep.' }],
            },
          ],
        }),
      });

      const { store, capturedConfigs } = makeStore();

      await store.getState().show(target());

      expect(store.getState().text).toBe('Same weight, one more rep.');
      expect(store.getState().pending).toBe(false);
      // Verify the config was forwarded with the OpenAI key, not blanked
      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]).toEqual({
        aiModel: undefined,
        aiProvider: undefined,
        anthropicKey: '',
        openaiKey: 'sk-openai-123',
      });
      // M1: Verify OpenAI client was used by checking Authorization header
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.authorization).toBe('Bearer sk-openai-123');
      expect(headers['x-api-key']).toBeUndefined();
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

  describe('#270: one call per working set', () => {
    it('requests a fresh comment for the next working set of the same exercise', async () => {
      mockFetch
        .mockResolvedValueOnce(commentResponse('Set one banked.'))
        .mockResolvedValueOnce(commentResponse('Set two banked.'));
      const { store } = makeStore();

      await store.getState().show(lastSetTarget({ setIndex: 1, logIndex: 0 }));
      store.getState().hide();
      await store.getState().show(lastSetTarget({ setIndex: 2, setNumber: 2, logIndex: 1 }));

      // Under the old `sessionId#entryIdx` key both rests share one comment.
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(store.getState().text).toBe('Set two banked.');
    });

    it('re-serves the same rest without a second call', async () => {
      const { store } = makeStore();

      await store.getState().show(lastSetTarget());
      store.getState().hide();
      // The session screen unmounts and remounts mid-rest: same rest, same set.
      await store.getState().show(lastSetTarget());

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(store.getState().text).toBe('Same weight, one more rep.');
    });

    it('sends the Last Set message shape and the performed exercise history', async () => {
      const { store } = makeStore();

      await store.getState().show(
        lastSetTarget({ exerciseId: 'barbell-row', exerciseTitle: 'Barbell Row' })
      );

      expect(loadHistory).toHaveBeenCalledWith('barbell-row');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content).toContain('## Last Set');
      expect(body.messages[0].content).toContain('Barbell Row');
      expect(body.system).not.toContain('Comment on the exercise that is coming up');
    });
  });

  describe('#270: a rest reached by skipping a set stays silent', () => {
    it('makes no call when a later rest still names the same logged set', async () => {
      const { store } = makeStore();

      await store.getState().show(lastSetTarget({ setIndex: 1, logIndex: 0 }));
      expect(store.getState().text).toBe('Same weight, one more rep.');
      store.getState().hide();
      mockFetch.mockClear();

      // "Skip Set": setIndex advanced but nothing new was logged, so
      // lastLoggedSet — and therefore logIndex — is unchanged.
      await store.getState().show(lastSetTarget({ setIndex: 2, setNumber: 2, logIndex: 0 }));

      expect(mockFetch).not.toHaveBeenCalled();
      expect(loadHistory).toHaveBeenCalledTimes(1);
      expect(store.getState().text).toBeNull();
      expect(store.getState().pending).toBe(false);
      expect(store.getState().attempted).toBe(false);
    });

    it('recovers on the next set that is actually logged', async () => {
      mockFetch
        .mockResolvedValueOnce(commentResponse('Set one banked.'))
        .mockResolvedValueOnce(commentResponse('Back on it.'));
      const { store } = makeStore();

      await store.getState().show(lastSetTarget({ setIndex: 1, logIndex: 0 }));
      store.getState().hide();
      await store.getState().show(lastSetTarget({ setIndex: 2, setNumber: 2, logIndex: 0 }));
      store.getState().hide();
      await store.getState().show(lastSetTarget({ setIndex: 3, setNumber: 3, logIndex: 1 }));

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(store.getState().text).toBe('Back on it.');
    });

    it('does not carry a claim across sessions', async () => {
      const { store } = makeStore();

      await store.getState().show(lastSetTarget({ sessionId: 'session-1', logIndex: 0 }));
      store.getState().hide();
      await store.getState().show(lastSetTarget({ sessionId: 'session-2', logIndex: 0 }));

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('leaves the up-next shape unlatched', async () => {
      // Only the last-set shape reads lastLoggedSet, so only it can go stale.
      const { store } = makeStore();

      await store.getState().show(target({ exerciseIndex: 1, entryIdx: 1, exerciseId: 'squat' }));
      store.getState().hide();
      await store.getState().show(target({ exerciseIndex: 2, entryIdx: 2, exerciseId: 'deadlift' }));

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Security: secrets regression guard', () => {
    it('coach-onboarding.AC6.5 Failure: never puts secrets in the prompt, even with profile', async () => {
      setSettings({
        anthropicKey: 'sk-ant-test-secret',
        openaiKey: 'sk-openai-secret-key',
        aiProvider: 'anthropic',
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
  /**
   * #276 Phase 6: `RoutineEntry` lost `warmupSets`/`targetSets`/`targetReps`/
   * `targetDurationSeconds` — `sets: RoutineSet[]` is the only representation
   * of the plan now. This is the one local helper (per the migration brief)
   * that expands the same counts this file's fixtures used to write directly,
   * exactly what the deleted `setsFromCounts` did at read time: a `0` in
   * `targetReps`/`targetDurationSeconds` means "unset" and becomes
   * `undefined`, not `0`.
   */
  const makeSets = (
    warmupSets: number,
    targetSets: number,
    targetReps = 0,
    targetDurationSeconds = 0
  ): RoutineEntry['sets'] => {
    const reps = targetReps > 0 ? targetReps : undefined;
    const durationSeconds = targetDurationSeconds > 0 ? targetDurationSeconds : undefined;
    return [
      ...Array.from({ length: warmupSets }, () => ({ setType: 'warmup' as const, reps, durationSeconds })),
      ...Array.from({ length: targetSets }, () => ({ setType: 'normal' as const, reps, durationSeconds })),
    ];
  };

  const entry = (overrides: Partial<RoutineEntry> = {}): RoutineEntry => ({
    idx: 0,
    exerciseId: 'bench-press',
    kind: 'strength',
    sets: makeSets(0, 3, 8),
    restSeconds: 90,
    supersetGroup: '',
    ...overrides,
  });

  const logged = (overrides: Partial<LoggedSet> = {}): LoggedSet => ({
    exerciseId: 'bench-press',
    setType: 'working',
    reps: 8,
    weightKg: 61.23,
    durationSeconds: null,
    rpe: 8,
    ...overrides,
  });

  /** Between exercises by default: setIndex 0, nothing logged. */
  const state = (overrides: Partial<SessionState> = {}): SessionState => ({
    sessionId: 'session-1',
    routineId: 'routine-1',
    phase: 'resting',
    exerciseIndex: 1,
    setIndex: 0,
    supersetPosition: 0,
    loggedSets: [],
    startedAtMs: 0,
    entries: [entry(), entry({ idx: 1, exerciseId: 'squat' })],
    ...overrides,
  });

  /** Mid-exercise: one working set of entry 0 logged, resting before the next. */
  const afterWorkingSet = (overrides: Partial<SessionState> = {}): SessionState =>
    state({
      exerciseIndex: 0,
      setIndex: 1,
      loggedSets: [logged()],
      lastLoggedSet: logged(),
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

    expect(result?.exerciseId).toBe('squat');
  });

  it('is null when there is no entry at the current index', () => {
    // Rest cannot precede `done`, but a stranded index must show nothing
    // rather than reach for an exercise that is not there.
    expect(restCommentaryTarget(state({ exerciseIndex: 5 }))).toBeNull();
    expect(restCommentaryTarget(state({ entries: [] }))).toBeNull();
  });

  it('points at the next exercise when resting between exercises', () => {
    // transition.lv:103-107 — the group-exhausted rest lands on a new entry
    // with setIndex 0. Unchanged behaviour: the remark is about what is next.
    const result = restCommentaryTarget(state({ exerciseIndex: 1, setIndex: 0 }));

    expect(result).toMatchObject({
      shape: 'upNext',
      entryIdx: 1,
      exerciseId: 'squat',
      setNumber: 1,
    });
  });

  it('resolves the exercise title shell-side, falling back to the id', () => {
    expect(restCommentaryTarget(state(), { squat: 'Back Squat' })?.exerciseTitle).toBe('Back Squat');
    expect(restCommentaryTarget(state())?.exerciseTitle).toBe('squat');
  });

  it('carries the upcoming entry’s own set list, not the one it just left (#276 AC4.12)', () => {
    // The `upNext` half of the pair. Its `lastSet` sibling is covered under
    // "#270: superset groups"; this branch had no cover at all, and a mutation
    // sending `sets: []` from here survived the whole suite — the target
    // summary would then read "no target recorded" for every between-exercise
    // rest. The two entries prescribe visibly different plans, so a read off
    // the wrong one is not interchangeable with the right one.
    const result = restCommentaryTarget(
      state({
        exerciseIndex: 1,
        setIndex: 0,
        entries: [
          entry(),
          entry({
            idx: 1,
            exerciseId: 'squat',
            sets: [
              { setType: 'warmup', reps: 5, weightKg: 60 },
              { setType: 'normal', reps: 5, weightKg: 100 },
            ],
          }),
        ],
      })
    );

    expect(result?.sets).toEqual([
      { setType: 'warmup', reps: 5, weightKg: 60 },
      { setType: 'normal', reps: 5, weightKg: 100 },
    ]);
  });

  // "expands an aggregate-only upcoming entry through the derivation seam"
  // deleted (#276 Phase 6): it existed to prove a count-shaped entry (no
  // `routine_sets` rows / pre-#276 build) still expanded into a list through
  // the aggregate-to-list derivation seam. `RoutineEntry.sets` is required
  // now and there are no aggregate fields left to hydrate a "count-shaped"
  // entry from, so the shape this test exercised cannot be constructed any
  // more — there is no seam left to prove anything about. The sibling test
  // above ("carries the upcoming entry's own set list...") already covers an
  // upcoming entry's `sets` reaching the target unchanged.

  describe('#270: resting inside an exercise comments on the set just completed', () => {
    it('describes the completed set, not the upcoming one', () => {
      // transition.lv:66-70 — the round-repeat rest carries setIndex = round + 1,
      // so setIndex >= 1 means the rest landed inside the exercise/group.
      const result = restCommentaryTarget(afterWorkingSet());

      expect(result).toMatchObject({
        shape: 'lastSet',
        sessionId: 'session-1',
        entryIdx: 0,
        exerciseIndex: 0,
        setIndex: 1,
        exerciseId: 'bench-press',
        isWarmupSet: false,
        // The set just done was set 1 of 3, not the upcoming set 2.
        setNumber: 1,
        logIndex: 0,
        completedSet: { reps: 8, weightKg: 61.23, rpe: 8 },
      });
    });

    it('is silent after a warmup set rather than falling back to the up-next shape', () => {
      const warmup = logged({ setType: 'warmup', weightKg: 20 });

      const result = restCommentaryTarget(
        afterWorkingSet({
          entries: [entry({ sets: makeSets(2, 3, 8) }), entry({ idx: 1, exerciseId: 'squat' })],
          loggedSets: [warmup],
          lastLoggedSet: warmup,
        })
      );

      expect(result).toBeNull();
    });

    it('still comments after a cardio entry logged set', () => {
      // transition.lv:190 stamps the entry's kind, not 'working', for
      // non-strength entries — a `setType === "working"` guard would kill this.
      const cardioSet = logged({
        exerciseId: 'rower',
        setType: 'cardio',
        reps: null,
        weightKg: null,
        durationSeconds: 300,
        rpe: null,
      });

      const result = restCommentaryTarget(
        afterWorkingSet({
          entries: [entry({ exerciseId: 'rower', kind: 'cardio', sets: makeSets(0, 3, 8, 300) })],
          loggedSets: [cardioSet],
          lastLoggedSet: cardioSet,
        })
      );

      expect(result).toMatchObject({ shape: 'lastSet', exerciseId: 'rower', kind: 'cardio' });
    });

    it('still comments after a stretch entry logged set', () => {
      const stretchSet = logged({
        exerciseId: 'couch-stretch',
        setType: 'stretch',
        reps: null,
        weightKg: null,
        durationSeconds: 45,
        rpe: null,
      });

      const result = restCommentaryTarget(
        afterWorkingSet({
          entries: [entry({ exerciseId: 'couch-stretch', kind: 'stretch', sets: makeSets(0, 3, 8, 45) })],
          loggedSets: [stretchSet],
          lastLoggedSet: stretchSet,
        })
      );

      expect(result).toMatchObject({ shape: 'lastSet', exerciseId: 'couch-stretch' });
    });

    it('reads the RPE -1 sentinel as absent', () => {
      const result = restCommentaryTarget(
        afterWorkingSet({
          loggedSets: [logged({ rpe: -1 })],
          lastLoggedSet: logged({ rpe: -1 }),
        })
      );

      expect(result).toMatchObject({ shape: 'lastSet' });
      expect((result as Extract<RestCommentaryTarget, { shape: 'lastSet' }>).completedSet.rpe)
        .toBeNull();
    });

    it('names the performer on a working set past the target-sets count in rounds', () => {
      // The activity predicate mirrors `h.next_active_idx`: active at round r
      // iff `r < warmupSets + targetSets`. With warmups 2 and targets 3, rounds
      // 0-1 are the warmups and 2-4 the working sets, so the round just
      // completed here (setIndex - 1 = 3) sits PAST `targetSets` on its own.
      // Dropping the `warmupSets` term would go silent on working sets 2 and 3
      // of every exercise that has warmups — the most ordinary routine shape
      // there is — and every other fixture in this file has `warmupSets: 0`,
      // where the two readings agree.
      const result = restCommentaryTarget(
        afterWorkingSet({
          entries: [entry({ sets: makeSets(2, 3, 8) })],
          exerciseIndex: 0,
          setIndex: 4,
          loggedSets: [logged(), logged(), logged(), logged()],
          lastLoggedSet: logged(),
        })
      );

      expect(result).toMatchObject({
        shape: 'lastSet',
        entryIdx: 0,
        exerciseId: 'bench-press',
        isWarmupSet: false,
        // Round 3 of an entry with 2 warmups: working set 2.
        setNumber: 2,
      });
    });

    it('is silent when nothing has been logged yet', () => {
      // A session whose very first set was skipped: setIndex advanced but
      // lastLoggedSet is still absent.
      expect(restCommentaryTarget(afterWorkingSet({ loggedSets: [], lastLoggedSet: undefined })))
        .toBeNull();
    });
  });

  describe('#270: superset groups', () => {
    /**
     * The two members disagree on EVERY field the target copies, not just
     * `exerciseId`. A group whose members share their plan cannot tell a field
     * read off the performed entry from the same field read off
     * `entries[exerciseIndex]`, so the whole payload below would be silently
     * interchangeable — the "fixture chosen so two readings agree" trap.
     */
    const supersetEntries = () => [
      entry({ idx: 0, exerciseId: 'bench-press', supersetGroup: 'A', sets: makeSets(2, 3, 8) }),
      entry({
        idx: 1,
        exerciseId: 'rower',
        kind: 'cardio',
        supersetGroup: 'A',
        sets: makeSets(0, 2, 0, 60),
        restSeconds: 30,
      }),
    ];

    it('follows lastLoggedSet, not entries[exerciseIndex], on a round-repeat rest', () => {
      // The round hands back to the group's first active member, so
      // entries[exerciseIndex] is bench-press while the set just done was the
      // rower. Every field must come off the rower: titling or planning this
      // remark as the bench while printing the rower's numbers is the failure.
      const rowerSet = logged({
        exerciseId: 'rower',
        setType: 'cardio',
        reps: null,
        weightKg: null,
        durationSeconds: 60,
        rpe: null,
      });

      const result = restCommentaryTarget(
        state({
          entries: supersetEntries(),
          exerciseIndex: 0,
          supersetPosition: 0,
          setIndex: 1,
          loggedSets: [logged(), rowerSet],
          lastLoggedSet: rowerSet,
        }),
        { 'bench-press': 'Bench Press', rower: 'Rower' }
      );

      expect(result).toMatchObject({
        shape: 'lastSet',
        entryIdx: 1,
        exerciseId: 'rower',
        logIndex: 1,
        // Read off the performed entry, never the one the engine advanced to.
        exerciseTitle: 'Rower',
        kind: 'cardio',
        restSeconds: 30,
        // The rower's own plan. The bench's is two warmups plus its own
        // working sets, so a read off `entries[exerciseIndex]` gives a
        // visibly different list.
        sets: [
          { setType: 'normal', durationSeconds: 60 },
          { setType: 'normal', durationSeconds: 60 },
        ],
      });
    });

    it('is silent when the round-ending member was skipped rather than logged', () => {
      // SetDone (transition.lv:208-210) never writes lastLoggedSet, so the
      // snapshot still names the partner logged earlier in the same round.
      const result = restCommentaryTarget(
        state({
          entries: supersetEntries(),
          exerciseIndex: 0,
          supersetPosition: 0,
          setIndex: 1,
          loggedSets: [logged()],
          lastLoggedSet: logged(),
        })
      );

      expect(result).toBeNull();
    });

    it('skips a group member whose own sets are exhausted when naming the performer', () => {
      // Round 1 of a mismatched group: the row plans only one set, so round 1
      // ends on the bench again.
      const entries = [
        entry({ idx: 0, exerciseId: 'bench-press', supersetGroup: 'A', sets: makeSets(0, 3, 8) }),
        entry({ idx: 1, exerciseId: 'barbell-row', supersetGroup: 'A', sets: makeSets(0, 1, 8) }),
      ];

      const result = restCommentaryTarget(
        state({
          entries,
          exerciseIndex: 0,
          supersetPosition: 0,
          setIndex: 2,
          loggedSets: [logged(), logged({ exerciseId: 'barbell-row' }), logged()],
          lastLoggedSet: logged(),
        })
      );

      expect(result).toMatchObject({ shape: 'lastSet', entryIdx: 0, exerciseId: 'bench-press' });
    });

    it('reads activity at the round just completed, not the round coming up', () => {
      // Round 1 of a 3-set/2-set group. The row is still owed a set at round 1
      // (so it closed the round) but not at round 2, so a performer lookup that
      // asked about the upcoming round would name the bench instead and then
      // reject the row's set as belonging to someone else.
      const entries = [
        entry({ idx: 0, exerciseId: 'bench-press', supersetGroup: 'A', sets: makeSets(0, 3, 8) }),
        entry({ idx: 1, exerciseId: 'barbell-row', supersetGroup: 'A', sets: makeSets(0, 2, 8) }),
      ];
      const rowSet = logged({ exerciseId: 'barbell-row' });

      const result = restCommentaryTarget(
        state({
          entries,
          exerciseIndex: 0,
          supersetPosition: 0,
          setIndex: 2,
          loggedSets: [logged(), logged({ exerciseId: 'barbell-row' }), logged(), rowSet],
          lastLoggedSet: rowSet,
        })
      );

      expect(result).toMatchObject({
        shape: 'lastSet',
        entryIdx: 1,
        exerciseId: 'barbell-row',
        // Its own second set, counted on its own entry.
        setNumber: 2,
      });
    });
  });

  describe('#270: the warmup guard scopes to the last-set shape only', () => {
    /**
     * A decision, not an accident, and nothing else in the suite distinguishes
     * it from its opposite. Spec rule 2 ("no remark after a warmup set") scopes
     * the `lastSet` shape: it exists so warmup numbers are not coached and so
     * the ~4x call increase stays bounded. Spec rule 1 is the shape selector,
     * and a rest BETWEEN two exercises is definitionally an `upNext` rest that
     * says nothing about the set just done — the entry it previews may not even
     * be the one that was warming up.
     *
     * The degenerate routine below is where the two rules touch: an entry that
     * plans warmups and no working sets, so the rest after its last warmup is a
     * between-exercises rest whose `lastLoggedSet` is a warmup. It still
     * previews the next exercise. Hoisting the warmup guard above the
     * `setIndex >= 1` discriminator, or repeating it inside the `upNext`
     * branch, would silence this rest instead; both survive the rest of the
     * suite.
     */
    it('still previews the next exercise when a warmup ended the previous one', () => {
      const warmup = logged({ setType: 'warmup', weightKg: 20 });

      const result = restCommentaryTarget(
        state({
          entries: [
            entry({ idx: 0, sets: makeSets(2, 0) }),
            entry({ idx: 1, exerciseId: 'squat' }),
          ],
          exerciseIndex: 1,
          setIndex: 0,
          loggedSets: [warmup, warmup],
          lastLoggedSet: warmup,
        })
      );

      expect(result).toMatchObject({
        shape: 'upNext',
        entryIdx: 1,
        exerciseId: 'squat',
        setNumber: 1,
      });
    });
  });

  describe('#270: the same exercise listed twice', () => {
    const twice = () => [
      entry({ idx: 0, exerciseId: 'bench-press' }),
      entry({ idx: 1, exerciseId: 'bench-press' }),
    ];

    it('uses the position, not the exercise id, to pick the shape', () => {
      const between = restCommentaryTarget(
        state({
          entries: twice(),
          exerciseIndex: 1,
          setIndex: 0,
          loggedSets: [logged(), logged(), logged()],
          lastLoggedSet: logged(),
        })
      );
      const within = restCommentaryTarget(
        state({
          entries: twice(),
          exerciseIndex: 1,
          setIndex: 1,
          loggedSets: [logged(), logged(), logged(), logged()],
          lastLoggedSet: logged(),
        })
      );

      // Same exerciseId on both sides; only setIndex differs.
      expect(between).toMatchObject({ shape: 'upNext', entryIdx: 1 });
      expect(within).toMatchObject({ shape: 'lastSet', entryIdx: 1, logIndex: 3 });
    });
  });

  // ---- #276 Phase 3: the target carries the per-set denominator ------------

  describe('per-set position (#276 AC3.4, AC3.5)', () => {
    // "reads the denominator off the set list, not the aggregate counts"
    // deleted (#276 Phase 6): it existed to prove the set list wins when it
    // disagrees with the aggregate counts ("aggregates say 1/1; the list says
    // 3 and 4"). `RoutineEntry` has no aggregate fields left to disagree with
    // the list, so that claim can no longer even be expressed, let alone
    // tested. The INTERLEAVE test below covers the same denominator
    // computation off the set list alone.

    it('INTERLEAVE: the third set is Warmup 2 of 2, which no count pair gives', () => {
      const interleaved = entry({
        sets: [
          { setType: 'warmup', reps: 5 },
          { setType: 'normal', reps: 8 },
          { setType: 'warmup', reps: 5 },
        ],
      });
      const target = restCommentaryTarget(
        state({
          exerciseIndex: 0,
          setIndex: 3,
          entries: [interleaved],
          loggedSets: [logged(), logged(), logged()],
          lastLoggedSet: logged(),
        })
      );

      // setIndex 3 means the round that just ended was 2 — INTERLEAVE's warmup.
      expect(target).toMatchObject({ isWarmupSet: true, setNumber: 2, totalOfType: 2 });
    });

    it('EMPTY: an entry prescribing nothing yields totalOfType 0, which hides the segment', () => {
      const nothing = entry({ sets: [] });
      expect(restCommentaryTarget(state({ exerciseIndex: 0, entries: [nothing] }))).toMatchObject({
        totalOfType: 0,
      });
    });

    it('performedEntryIndex skips a superset partner whose own list is exhausted', () => {
      // Member A prescribes 3 sets, member B 2. At setIndex 2 the round that
      // just ended is round 1, which B was still active for; at setIndex 3 the
      // round was 2, which only A was active for, so the remark is A's.
      const memberA = entry({
        idx: 0,
        exerciseId: 'member-a',
        supersetGroup: 'G5',
        sets: [
          { setType: 'normal', reps: 8 },
          { setType: 'normal', reps: 8 },
          { setType: 'normal', reps: 8 },
        ],
      });
      const memberB = entry({
        idx: 1,
        exerciseId: 'member-b',
        supersetGroup: 'G5',
        sets: [
          { setType: 'normal', reps: 8 },
          { setType: 'normal', reps: 8 },
        ],
      });

      const mismatchState = (setIndex: number, exerciseId: string) =>
        state({
          exerciseIndex: 0,
          supersetPosition: 0,
          setIndex,
          entries: [memberA, memberB],
          loggedSets: [logged({ exerciseId })],
          lastLoggedSet: logged({ exerciseId }),
        });

      expect(restCommentaryTarget(mismatchState(2, 'member-b'))).toMatchObject({
        entryIdx: 1,
        exerciseId: 'member-b',
        totalOfType: 2,
      });
      expect(restCommentaryTarget(mismatchState(3, 'member-a'))).toMatchObject({
        entryIdx: 0,
        exerciseId: 'member-a',
        totalOfType: 3,
      });
    });
  });
});

describe('restCommentaryKey', () => {
  it('changes with the rest position, so each working set gets its own slot', () => {
    const first = restCommentaryKey(lastSetTarget({ setIndex: 1, logIndex: 0 }));
    const second = restCommentaryKey(lastSetTarget({ setIndex: 2, logIndex: 1 }));

    expect(first).not.toBe(second);
  });

  it('scopes the key to the session', () => {
    expect(restCommentaryKey(target({ sessionId: 'a' }))).not.toBe(
      restCommentaryKey(target({ sessionId: 'b' }))
    );
  });

  /**
   * `src/app` has no jest coverage (AGENTS.md, Testing gotchas), and the session
   * screen builds the same key to decide when its effect re-fires. A screen that
   * rebuilt the key by hand would go stale the moment the store's key changed —
   * exactly the "guard in two places, tested in one" failure this repo has
   * shipped before. The only available check is a structural read.
   */
  it('is the single key builder: session.tsx imports it rather than rebuilding it', () => {
    const source = readFileSync(join(__dirname, '..', 'app', 'session.tsx'), 'utf8');

    expect(source).toContain('restCommentaryKey(commentaryTarget)');
    // No hand-rolled reconstruction of the commentary key alongside it.
    expect(source).not.toContain('`${commentaryTarget.sessionId}#${commentaryTarget.entryIdx}`');
  });

  /**
   * Building the key correctly is worthless if the screen's effect does not
   * depend on it. Dropping `commentaryKey` from the dep array leaves the effect
   * firing once per rest-phase entry instead of once per rest, so every working
   * set after the first re-serves the first set's remark — the feature half
   * dead, with a green suite. That is the same failure the shared
   * `restCommentaryKey` was introduced to prevent, one layer up.
   *
   * `src/app` is jest-invisible, so this is a structural read, the precedent
   * AGENTS.md sets for `session.tsx:303` / `routineRevision` (AC6.9) and the
   * same technique as `activeSession.callSites.test.ts`.
   */
  it('is wired into the screen effect: the dep array carries commentaryKey', () => {
    const source = readFileSync(join(__dirname, '..', 'app', 'session.tsx'), 'utf8');

    expect(source).toContain('}, [commentaryKey, shouldShowCommentary]);');
  });
});
