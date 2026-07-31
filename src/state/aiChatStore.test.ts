import { createAiChatStore, AiChatDeps, AiChatError } from './aiChatStore';
import { DEBRIEF_OPENING_MESSAGE } from './postWorkoutDebrief';
import { RoutineDraft, DraftValidationError, AiTurn, SettingsProposal } from '@/ai/draftSchema';
import { AnthropicHttpError, AnthropicUnreachable } from '@/ai/anthropicClient';

// Helper to create a test store with mocked dependencies
function makeStore(deps: Partial<AiChatDeps> = {}) {
  const fakeChat = jest.fn();
  const fakeCreateClient = jest.fn().mockReturnValue({ chat: fakeChat });
  const fakeBuildSystem = jest.fn().mockResolvedValue('SYSTEM');
  const fakeAccept = jest.fn().mockResolvedValue('routine-id-1');
  const fakeGetSettings = jest.fn().mockReturnValue({ anthropicKey: 'sk-test' });
  const fakeSetSettings = jest.fn();

  const store = createAiChatStore({
    db: {} as never,
    createClient: fakeCreateClient,
    buildSystem: fakeBuildSystem,
    accept: fakeAccept,
    getSettings: fakeGetSettings,
    setSettings: fakeSetSettings,
    ...deps,
  });

  return {
    store,
    fakeChat,
    fakeCreateClient,
    fakeBuildSystem,
    fakeAccept,
    fakeGetSettings,
    fakeSetSettings,
  };
}

describe('aiChatStore', () => {
  describe('send - happy path', () => {
    it('appends user message and assistant turn on success', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockResolvedValue({ reply: 'hi there' });

      await store.getState().send('hello');

      const state = store.getState();
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0]).toEqual({
        role: 'user',
        content: 'hello',
      });
      expect(state.messages[1]).toEqual({
        role: 'assistant',
        content: JSON.stringify({ reply: 'hi there' }),
        turn: { reply: 'hi there' },
      });
      expect(state.status).toBe('idle');
      expect(state.error).toBeNull();
    });

    it('calls buildSystem once per conversation', async () => {
      const { store, fakeChat, fakeBuildSystem } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockResolvedValue({ reply: 'response 1' });

      await store.getState().send('hello');
      expect(fakeBuildSystem).toHaveBeenCalledTimes(1);
      expect(fakeBuildSystem).toHaveBeenCalledWith({}, { kind: 'create' });

      fakeChat.mockResolvedValue({ reply: 'response 2' });
      await store.getState().send('follow up');
      expect(fakeBuildSystem).toHaveBeenCalledTimes(1); // still 1, not 2
    });

    it('passes correct wire messages to chat', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockResolvedValue({ reply: 'hi' });

      await store.getState().send('hello');

      expect(fakeChat).toHaveBeenCalledWith({
        system: 'SYSTEM',
        messages: [{ role: 'user', content: 'hello' }],
      });
    });
  });

  describe('AC2.5 - full history with prior drafts', () => {
    it('resends full message history including prior assistant drafts as JSON', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });

      // First turn with a draft
      const draftA: RoutineDraft = {
        name: 'Routine A',
        exercises: [{ title: 'Ex 1', kind: 'strength' }],
      };
      fakeChat.mockResolvedValueOnce({ reply: 'first response', draft: draftA });

      await store.getState().send('create a routine');
      expect(fakeChat).toHaveBeenCalledTimes(1);

      // Second turn with tweak
      fakeChat.mockResolvedValueOnce({ reply: 'adjusted' });

      await store.getState().send('tweak it');

      // Verify second call includes full history
      expect(fakeChat).toHaveBeenCalledTimes(2);
      const secondCall = fakeChat.mock.calls[1][0];

      expect(secondCall.messages).toHaveLength(3);
      expect(secondCall.messages[0]).toEqual({
        role: 'user',
        content: 'create a routine',
      });
      expect(secondCall.messages[1]).toEqual({
        role: 'assistant',
        content: JSON.stringify({ reply: 'first response', draft: draftA }),
      });
      expect(secondCall.messages[2]).toEqual({
        role: 'user',
        content: 'tweak it',
      });

      // Verify we can parse the draft from wire content
      const wireContent = JSON.parse(secondCall.messages[1].content);
      expect(wireContent.draft.name).toBe('Routine A');
    });
  });

  describe('AC3.6 - draft replacement', () => {
    it('replaces pending draft with newer one', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });

      const draftA: RoutineDraft = {
        name: 'Routine A',
        exercises: [{ title: 'Ex 1', kind: 'strength' }],
      };
      const draftB: RoutineDraft = {
        name: 'Routine B',
        exercises: [{ title: 'Ex 2', kind: 'cardio' }],
      };

      fakeChat.mockResolvedValueOnce({ reply: 'first', draft: draftA });
      await store.getState().send('create');

      let state = store.getState();
      expect(state.pendingDraft).toEqual(draftA);

      fakeChat.mockResolvedValueOnce({ reply: 'second', draft: draftB });
      await store.getState().send('update');

      state = store.getState();
      expect(state.pendingDraft).toEqual(draftB);
    });

    it('leaves pending draft untouched when response has no draft', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });

      const draft: RoutineDraft = {
        name: 'Routine',
        exercises: [{ title: 'Ex 1', kind: 'strength' }],
      };

      fakeChat.mockResolvedValueOnce({ reply: 'first', draft });
      await store.getState().send('create');

      expect(store.getState().pendingDraft).toEqual(draft);

      fakeChat.mockResolvedValueOnce({ reply: 'just a comment' });
      await store.getState().send('looks good');

      expect(store.getState().pendingDraft).toEqual(draft);
    });
  });

  describe('AC4.1 - missing key', () => {
    it('does not send request when API key is empty', async () => {
      const fakeGetSettings = jest.fn().mockReturnValue({ anthropicKey: '' });
      const { store, fakeChat, fakeBuildSystem } = makeStore({
        getSettings: fakeGetSettings,
      });

      store.getState().reset({ kind: 'create' });

      await store.getState().send('hello');

      expect(fakeChat).not.toHaveBeenCalled();
      expect(fakeBuildSystem).not.toHaveBeenCalled();
      expect(store.getState().status).toBe('error');
      expect(store.getState().error).toEqual({ kind: 'missing_key' });
      expect(store.getState().messages).toHaveLength(0);
    });
  });

  describe('AC4.2 - unauthorized', () => {
    it('maps 401 to unauthorized error', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValue(new AnthropicHttpError(401, 'Unauthorized'));

      await store.getState().send('hello');

      expect(store.getState().status).toBe('error');
      expect(store.getState().error).toEqual({ kind: 'unauthorized' });
    });
  });

  describe('AC4.3 - error handling and retry', () => {
    it('maps AnthropicUnreachable to network error', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValue(new AnthropicUnreachable('Network error'));

      await store.getState().send('hello');

      expect(store.getState().status).toBe('error');
      expect(store.getState().error).toEqual({ kind: 'network' });
    });

    it('maps AnthropicHttpError to http error with status', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValue(new AnthropicHttpError(500, 'Internal Server Error'));

      await store.getState().send('hello');

      expect(store.getState().status).toBe('error');
      expect(store.getState().error).toEqual({ kind: 'http', status: 500 });
    });

    it('keeps user message after error for retry', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValue(new AnthropicUnreachable('Network error'));

      await store.getState().send('hello');

      const state = store.getState();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]).toEqual({ role: 'user', content: 'hello' });
    });

    it('retry re-sends the same turn on success', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValueOnce(new AnthropicUnreachable('Network error'));

      await store.getState().send('hello');
      expect(store.getState().status).toBe('error');

      fakeChat.mockResolvedValueOnce({ reply: 'hi there' });
      await store.getState().retry();

      expect(fakeChat).toHaveBeenCalledTimes(2);

      // Second call should have same wire messages (one user message)
      const secondCall = fakeChat.mock.calls[1][0];
      expect(secondCall.messages).toHaveLength(1);
      expect(secondCall.messages[0]).toEqual({ role: 'user', content: 'hello' });

      // After success, state should be idle
      const state = store.getState();
      expect(state.status).toBe('idle');
      expect(state.messages).toHaveLength(2);
      expect(state.messages[1]).toEqual({
        role: 'assistant',
        content: JSON.stringify({ reply: 'hi there' }),
        turn: { reply: 'hi there' },
      });
    });

    it('retry does not append duplicate user message', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValueOnce(new AnthropicUnreachable('Network error'));

      await store.getState().send('hello');
      expect(store.getState().messages).toHaveLength(1);

      fakeChat.mockResolvedValueOnce({ reply: 'success' });
      await store.getState().retry();

      // Should still have exactly 2 messages (1 user + 1 assistant)
      expect(store.getState().messages).toHaveLength(2);
    });
  });

  describe('AC5.1 - reset and ephemerality', () => {
    it('clears all state on reset', async () => {
      const { store, fakeChat } = makeStore();

      // Build up some state
      store.getState().reset({ kind: 'create' });
      fakeChat.mockResolvedValue({ reply: 'hi', draft: { name: 'Draft', exercises: [{ title: 'Ex', kind: 'strength' as const }] } });

      await store.getState().send('hello');

      let state = store.getState();
      expect(state.messages.length).toBeGreaterThan(0);
      expect(state.pendingDraft).not.toBeNull();

      // Reset should clear everything
      store.getState().reset({ kind: 'edit', routineId: 'routine-123' });

      state = store.getState();
      expect(state.messages).toHaveLength(0);
      expect(state.pendingDraft).toBeNull();
      expect(state.status).toBe('idle');
      expect(state.error).toBeNull();
      expect(state.mode).toEqual({ kind: 'edit', routineId: 'routine-123' });
    });

    it('clears cached system prompt on reset', async () => {
      const { store, fakeChat, fakeBuildSystem } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeBuildSystem.mockResolvedValue('SYSTEM');
      fakeChat.mockResolvedValue({ reply: 'hi' });

      await store.getState().send('hello');
      expect(fakeBuildSystem).toHaveBeenCalledTimes(1);

      // Reset should clear cache
      store.getState().reset({ kind: 'create' });

      fakeBuildSystem.mockResolvedValue('SYSTEM_v2');
      fakeChat.mockResolvedValue({ reply: 'hi' });

      await store.getState().send('new conversation');
      expect(fakeBuildSystem).toHaveBeenCalledTimes(2);
    });
  });

  describe('post-workout debrief', () => {
    const debrief = {
      kind: 'debrief',
      routineId: 'routine-1',
      sessionId: 'session-1',
    } as const;

    it('opens the conversation with the coach, not the user', async () => {
      const { store, fakeChat, fakeBuildSystem } = makeStore();
      fakeChat.mockResolvedValue({ reply: 'How did that go?' });

      await store.getState().openDebrief(debrief);

      const state = store.getState();
      expect(state.mode).toEqual(debrief);
      expect(fakeBuildSystem).toHaveBeenCalledWith({}, debrief);
      expect(state.messages[0]).toEqual({
        role: 'user',
        content: DEBRIEF_OPENING_MESSAGE,
      });
      expect(state.messages[1].turn).toEqual({ reply: 'How did that go?' });
      expect(state.status).toBe('idle');
    });

    it('discards the previous conversation', async () => {
      const { store, fakeChat } = makeStore();
      fakeChat.mockResolvedValue({
        reply: 'hi',
        draft: { name: 'Draft', exercises: [{ title: 'Ex', kind: 'strength' as const }] },
      });

      store.getState().reset({ kind: 'create' });
      await store.getState().send('build me something');
      expect(store.getState().pendingDraft).not.toBeNull();

      fakeChat.mockResolvedValue({ reply: 'How did that go?' });
      await store.getState().openDebrief(debrief);

      const state = store.getState();
      expect(state.pendingDraft).toBeNull();
      expect(state.messages.map((message) => message.content)).toEqual([
        DEBRIEF_OPENING_MESSAGE,
        JSON.stringify({ reply: 'How did that go?' }),
      ]);
    });

    it('discards a reply that was in flight when the debrief opened', async () => {
      const { store, fakeChat } = makeStore();

      let resolveFirst: (turn: AiTurn) => void = () => {};
      fakeChat.mockReturnValueOnce(
        new Promise<AiTurn>((resolve) => {
          resolveFirst = resolve;
        })
      );

      store.getState().reset({ kind: 'create' });
      const inFlight = store.getState().send('build me something');

      fakeChat.mockResolvedValue({ reply: 'How did that go?' });
      const opening = store.getState().openDebrief(debrief);

      resolveFirst({ reply: 'stale answer' });
      await inFlight;
      await opening;

      const state = store.getState();
      expect(state.messages).toHaveLength(2);
      expect(state.messages.some((message) => message.content.includes('stale answer'))).toBe(false);
    });

    it('reports a missing key without leaving a half-open conversation', async () => {
      const { store, fakeChat } = makeStore({
        getSettings: jest.fn().mockReturnValue({ anthropicKey: '' }) as never,
      });

      await store.getState().openDebrief(debrief);

      const state = store.getState();
      expect(fakeChat).not.toHaveBeenCalled();
      expect(state.error).toEqual({ kind: 'missing_key' });
      expect(state.mode).toEqual(debrief);
    });
  });

  describe('AC3.2 / AC5.3 - accept and write-path isolation', () => {
    it.each([
      { kind: 'create' } as const,
      { kind: 'edit', routineId: 'routine-1' } as const,
      { kind: 'debrief', routineId: 'routine-1', sessionId: 'session-1' } as const,
    ])('calls accept with the draft and the live mode (%o), returns id', async (mode) => {
      const { store, fakeAccept, fakeChat } = makeStore();

      const draft: RoutineDraft = {
        name: 'Test Routine',
        exercises: [{ title: 'Push-up', kind: 'strength' }],
      };

      // Copies so the assertions' expected values cannot alias objects the
      // store might mutate in place — the store gets its own instances.
      store.getState().reset({ ...mode });
      fakeChat.mockResolvedValue({ reply: 'created', draft: structuredClone(draft) });

      await store.getState().send('create routine');

      expect(store.getState().pendingDraft).toEqual(draft);

      const id = await store.getState().acceptDraft();

      expect(fakeAccept).toHaveBeenCalledTimes(1);
      // Mode must be passed unchanged to accept
      expect(fakeAccept).toHaveBeenCalledWith({}, draft, mode);
      expect(id).toBe('routine-id-1');
      expect(store.getState().pendingDraft).toBeNull();
    });

    it('is the only write path touched by store', async () => {
      const { store, fakeAccept, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });

      // Drive a complete conversation: send, failure, retry, reset
      fakeChat.mockRejectedValueOnce(new AnthropicUnreachable('Network error'));
      await store.getState().send('hello');
      expect(fakeAccept).not.toHaveBeenCalled();

      fakeChat.mockResolvedValueOnce({ reply: 'hi' });
      await store.getState().retry();
      expect(fakeAccept).not.toHaveBeenCalled();

      store.getState().reset({ kind: 'create' });
      expect(fakeAccept).not.toHaveBeenCalled();

      // Only acceptDraft() should call accept
      const draft: RoutineDraft = {
        name: 'Test',
        exercises: [{ title: 'Ex', kind: 'strength' }],
      };
      fakeChat.mockResolvedValueOnce({ reply: 'created', draft });
      await store.getState().send('create');

      await store.getState().acceptDraft();
      expect(fakeAccept).toHaveBeenCalledTimes(1);
    });
  });

  describe('concurrency guard', () => {
    it('ignores send while status is sending', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });

      fakeChat.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ reply: 'delayed' }), 100))
      );

      const promise1 = store.getState().send('first');
      const promise2 = store.getState().send('second');

      await Promise.all([promise1, promise2]);

      expect(store.getState().messages).toHaveLength(2);
      expect(store.getState().messages[0].content).toBe('first');
      expect(fakeChat).toHaveBeenCalledTimes(1);
    });

    it('retry sets status sending while in flight', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValueOnce(new AnthropicUnreachable('Network error'));

      await store.getState().send('hello');
      expect(store.getState().status).toBe('error');

      const statusDuringSend: string[] = [];
      fakeChat.mockImplementation(() => {
        statusDuringSend.push(store.getState().status);
        return Promise.resolve({ reply: 'recovered' });
      });

      const retryPromise = store.getState().retry();
      expect(store.getState().status).toBe('sending');

      await retryPromise;
      expect(statusDuringSend).toContain('sending');
    });

    it('double retry fires exactly one request', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValueOnce(new AnthropicUnreachable('Network error'));

      await store.getState().send('hello');

      fakeChat.mockClear();
      fakeChat.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ reply: 'recovered' }), 100))
      );

      const promise1 = store.getState().retry();
      const promise2 = store.getState().retry();

      await Promise.all([promise1, promise2]);

      expect(fakeChat).toHaveBeenCalledTimes(1);
    });

    it('send during in-flight retry is a no-op', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValueOnce(new AnthropicUnreachable('Network error'));

      await store.getState().send('hello');

      fakeChat.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ reply: 'recovered' }), 100))
      );

      const retryPromise = store.getState().retry();
      const sendPromise = store.getState().send('second');

      await Promise.all([retryPromise, sendPromise]);

      expect(store.getState().messages).toHaveLength(2);
      expect(store.getState().messages[0].content).toBe('hello');
      expect(store.getState().messages[1].role).toBe('assistant');
    });
  });

  describe('error kind mapping', () => {
    it('maps DraftValidationError to parse error', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValue(new DraftValidationError('Invalid response'));

      await store.getState().send('hello');

      expect(store.getState().error).toEqual({ kind: 'parse' });
    });

    it('maps unexpected errors to unknown error', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValue(new Error('Unexpected error'));

      await store.getState().send('hello');

      expect(store.getState().error).toEqual({ kind: 'unknown' });
    });
  });

  describe('retry missing-key guard', () => {
    it('retry sets missing_key error when key is cleared after network failure', async () => {
      const fakeGetSettings = jest.fn().mockReturnValue({ anthropicKey: 'sk-test' });
      const { store, fakeChat } = makeStore({
        getSettings: fakeGetSettings,
      });

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValueOnce(new AnthropicUnreachable('Network error'));

      await store.getState().send('hello');
      expect(store.getState().status).toBe('error');

      // Clear the key
      fakeGetSettings.mockReturnValue({ anthropicKey: '' });

      await store.getState().retry();

      expect(fakeChat).toHaveBeenCalledTimes(1);
      expect(store.getState().error).toEqual({ kind: 'missing_key' });
    });
  });

  describe('retry guard branches', () => {
    it('retry is a no-op when status is idle', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockResolvedValue({ reply: 'hi' });

      await store.getState().send('hello');
      expect(store.getState().status).toBe('idle');

      fakeChat.mockClear();
      await store.getState().retry();

      expect(fakeChat).not.toHaveBeenCalled();
    });

    it('retry is a no-op when history is empty', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });

      expect(store.getState().messages).toHaveLength(0);
      await store.getState().retry();

      expect(fakeChat).not.toHaveBeenCalled();
    });

    it('retry is a no-op when last message is not a user turn', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValueOnce(new AnthropicUnreachable('Network error'));

      await store.getState().send('hello');
      expect(store.getState().status).toBe('error');

      fakeChat.mockResolvedValueOnce({ reply: 'recovered' });
      await store.getState().retry();
      expect(store.getState().messages).toHaveLength(2);

      fakeChat.mockClear();
      await store.getState().retry();

      expect(fakeChat).not.toHaveBeenCalled();
    });
  });

  describe('acceptDraft error handling', () => {
    it('acceptDraft throws when pendingDraft is null', async () => {
      const { store } = makeStore();

      store.getState().reset({ kind: 'create' });
      expect(store.getState().pendingDraft).toBeNull();

      await expect(store.getState().acceptDraft()).rejects.toThrow('No pending draft to accept');
    });
  });

  describe('CRITICAL 1 — reset invalidates in-flight requests', () => {
    it('reset() kills in-flight send response after success', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });

      // Warm the cache with one successful send
      fakeChat.mockResolvedValueOnce({ reply: 'first' });
      await store.getState().send('hello');

      // Now arm the deferred for the second send
      let resolveRequest: (value: AiTurn) => void;
      const deferred = new Promise<AiTurn>((resolve) => {
        resolveRequest = resolve;
      });
      fakeChat.mockReturnValue(deferred);

      const sendPromise = store.getState().send('hello2');

      // The deferred must be genuinely in flight — otherwise this test is vacuous
      expect(fakeChat).toHaveBeenCalledTimes(2);

      // While send is in flight, reset
      store.getState().reset({ kind: 'edit', routineId: 'routine-1' });

      // Now resolve the deferred request
      resolveRequest!({ reply: 'hi there' });
      await sendPromise;

      // After reset + resolution, fresh conversation should stay empty
      const state = store.getState();
      expect(state.messages).toHaveLength(0);
      expect(state.pendingDraft).toBeNull();
      expect(state.status).toBe('idle');
      expect(state.error).toBeNull();
    });

    it('reset() kills in-flight send error after rejection', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });

      // Warm the cache with one successful send
      fakeChat.mockResolvedValueOnce({ reply: 'first' });
      await store.getState().send('hello');

      // Now arm the deferred for the second send
      let rejectRequest: (reason: unknown) => void;
      const deferred = new Promise<AiTurn>((resolve, reject) => {
        rejectRequest = reject;
      });
      fakeChat.mockReturnValue(deferred);

      const sendPromise = store.getState().send('hello2');

      // While send is in flight, reset
      store.getState().reset({ kind: 'edit', routineId: 'routine-1' });

      // Now reject the deferred request
      rejectRequest!(new AnthropicUnreachable('Network error'));
      await sendPromise;

      // After reset + rejection, fresh conversation should stay empty
      const state = store.getState();
      expect(state.messages).toHaveLength(0);
      expect(state.pendingDraft).toBeNull();
      expect(state.status).toBe('idle');
      expect(state.error).toBeNull();
    });

    it('reset() during deferred buildSystem invalidates cache repopulation', async () => {
      const { store, fakeChat, fakeBuildSystem, fakeCreateClient } = makeStore();

      store.getState().reset({ kind: 'create' });

      let resolveBuild: (value: string) => void;
      const deferredBuild = new Promise<string>((resolve) => {
        resolveBuild = resolve;
      });

      fakeBuildSystem.mockReturnValueOnce(deferredBuild);
      fakeChat.mockResolvedValue({ reply: 'hi' });

      const sendPromise = store.getState().send('first');

      // While buildSystem is in flight, reset to a different mode
      store.getState().reset({ kind: 'edit', routineId: 'routine-1' });

      // Now resolve the deferred buildSystem with old mode's system
      resolveBuild!('SYSTEM_CREATE');
      await sendPromise;

      expect(fakeBuildSystem).toHaveBeenCalledTimes(1);

      // Early-throw guard should have prevented client creation and chat in first send
      expect(fakeCreateClient).not.toHaveBeenCalled();
      expect(fakeChat).not.toHaveBeenCalled();

      // After reset, the cache should have been cleared and stay cleared
      fakeBuildSystem.mockClear();
      fakeBuildSystem.mockResolvedValue('SYSTEM_EDIT');
      fakeChat.mockResolvedValue({ reply: 'hi' });

      await store.getState().send('second');

      // buildSystem should be called again (cache not populated with stale value)
      expect(fakeBuildSystem).toHaveBeenCalledTimes(1);
      expect(fakeBuildSystem).toHaveBeenCalledWith({}, { kind: 'edit', routineId: 'routine-1' });
    });
  });

  describe('IMPORTANT 1 — API key verification', () => {
    it('passes trimmed API key to createClient', async () => {
      const { store, fakeChat, fakeCreateClient } = makeStore({
        getSettings: jest.fn().mockReturnValue({ anthropicKey: '  sk-padded  ' }),
      });

      store.getState().reset({ kind: 'create' });
      fakeChat.mockResolvedValue({ reply: 'hi' });

      await store.getState().send('hello');

      expect(fakeCreateClient).toHaveBeenCalledWith({ apiKey: 'sk-padded' });
    });

    it('creates client once per send call', async () => {
      const { store, fakeChat, fakeCreateClient } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockResolvedValue({ reply: 'response 1' });

      await store.getState().send('first');
      expect(fakeCreateClient).toHaveBeenCalledTimes(1);

      fakeChat.mockResolvedValue({ reply: 'response 2' });
      await store.getState().send('second');
      expect(fakeCreateClient).toHaveBeenCalledTimes(2);
    });
  });

  describe('IMPORTANT 1 — retry generation guards', () => {
    it('reset() during retry-in-flight success does not commit response', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValueOnce(new AnthropicUnreachable('Network error'));

      await store.getState().send('hello');
      expect(store.getState().status).toBe('error');

      let resolveRetry: (value: AiTurn) => void;
      const deferredRetry = new Promise<AiTurn>((resolve) => {
        resolveRetry = resolve;
      });
      fakeChat.mockReturnValueOnce(deferredRetry);

      const retryPromise = store.getState().retry();

      // While retry is in flight, reset
      store.getState().reset({ kind: 'edit', routineId: 'routine-1' });

      // Now resolve the deferred retry
      resolveRetry!({ reply: 'recovered' });
      await retryPromise;

      // After reset, the response should not have been committed
      const state = store.getState();
      expect(state.messages).toHaveLength(0); // reset cleared messages
      expect(state.status).toBe('idle');
      expect(state.error).toBeNull();
    });

    it('reset() during retry-in-flight error does not commit error', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValueOnce(new AnthropicUnreachable('Network error'));

      await store.getState().send('hello');
      expect(store.getState().status).toBe('error');

      let rejectRetry: (reason: unknown) => void;
      const deferredRetry = new Promise<AiTurn>((resolve, reject) => {
        rejectRetry = reject;
      });
      fakeChat.mockReturnValueOnce(deferredRetry);

      const retryPromise = store.getState().retry();

      // While retry is in flight, reset
      store.getState().reset({ kind: 'edit', routineId: 'routine-1' });

      // Now reject the deferred retry
      rejectRetry!(new AnthropicUnreachable('Still network error'));
      await retryPromise;

      // After reset, the error should not have been committed (state is clean from reset)
      const state = store.getState();
      expect(state.messages).toHaveLength(0); // reset cleared messages
      expect(state.status).toBe('idle');
      expect(state.error).toBeNull();
    });
  });

  describe('IMPORTANT 2 — retry clears stale error while in flight', () => {
    it('error is null while retry is in flight', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValueOnce(new AnthropicUnreachable('Network error'));

      await store.getState().send('hello');
      expect(store.getState().status).toBe('error');
      expect(store.getState().error).toEqual({ kind: 'network' });

      const statusesDuring: string[] = [];
      const errorsDuring: (AiChatError | null)[] = [];
      fakeChat.mockImplementation(() => {
        statusesDuring.push(store.getState().status);
        errorsDuring.push(store.getState().error);
        return Promise.resolve({ reply: 'recovered' });
      });

      const retryPromise = store.getState().retry();
      await retryPromise;

      expect(statusesDuring).toEqual(['sending']);
      expect(errorsDuring).toEqual([null]);
      expect(store.getState().status).toBe('idle');
      expect(store.getState().error).toBeNull();
    });

    it('error is null while send is in flight after prior error', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValueOnce(new AnthropicUnreachable('Network error'));

      await store.getState().send('hello');
      expect(store.getState().status).toBe('error');
      expect(store.getState().error).toEqual({ kind: 'network' });

      const statusesDuring: string[] = [];
      const errorsDuring: (AiChatError | null)[] = [];
      fakeChat.mockImplementation(() => {
        statusesDuring.push(store.getState().status);
        errorsDuring.push(store.getState().error);
        return Promise.resolve({ reply: 'recovered' });
      });

      const sendPromise = store.getState().send('again');
      await sendPromise;

      expect(statusesDuring).toEqual(['sending']);
      expect(errorsDuring).toEqual([null]);
      expect(store.getState().status).toBe('idle');
      expect(store.getState().error).toBeNull();
    });
  });

  describe('settings proposals — capture', () => {
    const proposal: SettingsProposal = { goals: 'Run a 5k under 25 minutes' };

    it('captures a settings proposal carried by a turn', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockResolvedValueOnce({ reply: 'want me to update that?', settingsProposal: proposal });

      await store.getState().send('my goal is a faster 5k');

      expect(store.getState().pendingSettingsProposal).toEqual(proposal);
    });

    it('replaces a pending proposal with a newer one', async () => {
      const { store, fakeChat } = makeStore();
      const second: SettingsProposal = { equipment: 'Dumbbells only' };

      store.getState().reset({ kind: 'create' });
      fakeChat.mockResolvedValueOnce({ reply: 'first', settingsProposal: proposal });
      await store.getState().send('change my goals');

      fakeChat.mockResolvedValueOnce({ reply: 'second', settingsProposal: second });
      await store.getState().send('actually, my equipment');

      expect(store.getState().pendingSettingsProposal).toEqual(second);
    });

    it('leaves a pending proposal untouched when a turn carries none', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockResolvedValueOnce({ reply: 'first', settingsProposal: proposal });
      await store.getState().send('change my goals');

      fakeChat.mockResolvedValueOnce({ reply: 'just chatting' });
      await store.getState().send('hold on');

      expect(store.getState().pendingSettingsProposal).toEqual(proposal);
    });

    it('reset clears the pending proposal', async () => {
      const { store, fakeChat } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockResolvedValueOnce({ reply: 'first', settingsProposal: proposal });
      await store.getState().send('change my goals');

      store.getState().reset({ kind: 'create' });

      expect(store.getState().pendingSettingsProposal).toBeNull();
    });

    it('a proposal-only turn does not disturb the pending draft', async () => {
      const { store, fakeChat } = makeStore();
      const draft: RoutineDraft = {
        name: 'Routine A',
        exercises: [{ title: 'Ex 1', kind: 'strength' }],
      };

      store.getState().reset({ kind: 'create' });
      fakeChat.mockResolvedValueOnce({ reply: 'here is a routine', draft });
      await store.getState().send('build me something');

      fakeChat.mockResolvedValueOnce({ reply: 'and your goals?', settingsProposal: proposal });
      await store.getState().send('also update my goals');

      expect(store.getState().pendingDraft).toEqual(draft);
      expect(store.getState().pendingSettingsProposal).toEqual(proposal);
    });

    it('a draft-only turn does not disturb the pending proposal', async () => {
      const { store, fakeChat } = makeStore();
      const draft: RoutineDraft = {
        name: 'Routine A',
        exercises: [{ title: 'Ex 1', kind: 'strength' }],
      };

      store.getState().reset({ kind: 'create' });
      fakeChat.mockResolvedValueOnce({ reply: 'and your goals?', settingsProposal: proposal });
      await store.getState().send('update my goals');

      fakeChat.mockResolvedValueOnce({ reply: 'here is a routine', draft });
      await store.getState().send('build me something');

      expect(store.getState().pendingSettingsProposal).toEqual(proposal);
      expect(store.getState().pendingDraft).toEqual(draft);
    });
  });

  describe('settings proposals — approve', () => {
    async function storeWithProposal(proposal: SettingsProposal) {
      const made = makeStore();

      made.store.getState().reset({ kind: 'create' });
      made.fakeChat.mockResolvedValueOnce({ reply: 'shall I?', settingsProposal: proposal });
      await made.store.getState().send('change my settings');

      return made;
    }

    it('writes both fields via setSettings and clears the proposal', async () => {
      const { store, fakeSetSettings } = await storeWithProposal({
        goals: 'Build strength',
        equipment: 'Barbell and rack',
      });

      store.getState().approveSettingsProposal();

      expect(fakeSetSettings).toHaveBeenCalledTimes(1);
      expect(fakeSetSettings).toHaveBeenCalledWith({
        aiGoals: 'Build strength',
        aiEquipment: 'Barbell and rack',
      });
      expect(store.getState().pendingSettingsProposal).toBeNull();
    });

    it('writes only the field the proposal carries', async () => {
      const { store, fakeSetSettings } = await storeWithProposal({ goals: 'Build strength' });

      store.getState().approveSettingsProposal();

      // toStrictEqual so an explicit `aiEquipment: undefined` — which would blank
      // the user's equipment — fails rather than passing as an absent key.
      expect(fakeSetSettings).toHaveBeenCalledWith({ aiGoals: 'Build strength' });
      expect(fakeSetSettings.mock.calls[0][0]).toStrictEqual({ aiGoals: 'Build strength' });
    });

    it('keeps the conversation intact', async () => {
      const { store } = await storeWithProposal({ goals: 'Build strength' });

      const before = store.getState().messages;
      store.getState().approveSettingsProposal();

      expect(store.getState().messages).toEqual(before);
      expect(store.getState().status).toBe('idle');
      expect(store.getState().error).toBeNull();
    });

    it('rebuilds the system prompt on the next turn without clearing the chat', async () => {
      const { store, fakeChat, fakeBuildSystem } = await storeWithProposal({ goals: 'Build strength' });

      expect(fakeBuildSystem).toHaveBeenCalledTimes(1);

      store.getState().approveSettingsProposal();

      fakeChat.mockResolvedValueOnce({ reply: 'noted' });
      await store.getState().send('thanks');

      // The cached prompt embeds goals/equipment, so it must be rebuilt after a write
      expect(fakeBuildSystem).toHaveBeenCalledTimes(2);
      expect(store.getState().messages).toHaveLength(4);
    });

    it('does not discard an in-flight response', async () => {
      const { store, fakeChat, fakeSetSettings } = await storeWithProposal({ goals: 'Build strength' });

      let resolveRequest: (value: AiTurn) => void;
      fakeChat.mockReturnValueOnce(
        new Promise<AiTurn>((resolve) => {
          resolveRequest = resolve;
        })
      );

      const sendPromise = store.getState().send('one more thing');
      expect(fakeChat).toHaveBeenCalledTimes(2);

      // Approving mid-flight must not behave like reset(): the conversation continues
      store.getState().approveSettingsProposal();
      expect(fakeSetSettings).toHaveBeenCalledTimes(1);

      resolveRequest!({ reply: 'still here' });
      await sendPromise;

      expect(store.getState().messages).toHaveLength(4);
      expect(store.getState().messages[3]).toEqual({
        role: 'assistant',
        content: JSON.stringify({ reply: 'still here' }),
        turn: { reply: 'still here' },
      });
    });

    it('validates again before writing and refuses an invalid proposal', async () => {
      const { store, fakeChat, fakeSetSettings } = makeStore();

      store.getState().reset({ kind: 'create' });
      // A turn that slipped past parseAiTurn — structured output is not a guarantee
      fakeChat.mockResolvedValueOnce({ reply: 'shall I?', settingsProposal: { goals: '   ' } });
      await store.getState().send('change my goals');

      expect(() => store.getState().approveSettingsProposal()).toThrow(DraftValidationError);
      expect(fakeSetSettings).not.toHaveBeenCalled();
      // The rejected proposal stays pending so the card does not silently vanish
      expect(store.getState().pendingSettingsProposal).toEqual({ goals: '   ' });
    });

    it('throws when there is no pending proposal', () => {
      const { store, fakeSetSettings } = makeStore();

      store.getState().reset({ kind: 'create' });

      expect(() => store.getState().approveSettingsProposal()).toThrow(
        'No pending settings proposal to approve'
      );
      expect(fakeSetSettings).not.toHaveBeenCalled();
    });

    it('is the only settings write path touched by the store', async () => {
      const { store, fakeChat, fakeSetSettings } = makeStore();

      store.getState().reset({ kind: 'create' });
      fakeChat.mockRejectedValueOnce(new AnthropicUnreachable('Network error'));
      await store.getState().send('hello');
      expect(fakeSetSettings).not.toHaveBeenCalled();

      fakeChat.mockResolvedValueOnce({ reply: 'shall I?', settingsProposal: { goals: 'Build strength' } });
      await store.getState().retry();
      expect(fakeSetSettings).not.toHaveBeenCalled();

      store.getState().declineSettingsProposal();
      expect(fakeSetSettings).not.toHaveBeenCalled();

      store.getState().reset({ kind: 'create' });
      expect(fakeSetSettings).not.toHaveBeenCalled();
    });
  });

  describe('settings proposals — decline', () => {
    async function storeWithProposal() {
      const made = makeStore();

      made.store.getState().reset({ kind: 'create' });
      made.fakeChat.mockResolvedValueOnce({
        reply: 'shall I?',
        settingsProposal: { goals: 'Build strength' },
      });
      await made.store.getState().send('change my goals');

      return made;
    }

    it('clears the proposal without writing settings', async () => {
      const { store, fakeSetSettings } = await storeWithProposal();

      store.getState().declineSettingsProposal();

      expect(fakeSetSettings).not.toHaveBeenCalled();
      expect(store.getState().pendingSettingsProposal).toBeNull();
    });

    it('keeps the conversation going', async () => {
      const { store, fakeChat } = await storeWithProposal();

      store.getState().declineSettingsProposal();

      expect(store.getState().messages).toHaveLength(2);
      expect(store.getState().status).toBe('idle');

      fakeChat.mockResolvedValueOnce({ reply: 'no problem' });
      await store.getState().send('leave it as is');

      expect(store.getState().messages).toHaveLength(4);
    });

    it('leaves the cached system prompt in place', async () => {
      const { store, fakeChat, fakeBuildSystem } = await storeWithProposal();

      store.getState().declineSettingsProposal();

      fakeChat.mockResolvedValueOnce({ reply: 'no problem' });
      await store.getState().send('leave it as is');

      // Nothing was written, so the cached prompt is still accurate
      expect(fakeBuildSystem).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when there is no pending proposal', () => {
      const { store, fakeSetSettings } = makeStore();

      store.getState().reset({ kind: 'create' });

      expect(() => store.getState().declineSettingsProposal()).not.toThrow();
      expect(fakeSetSettings).not.toHaveBeenCalled();
      expect(store.getState().pendingSettingsProposal).toBeNull();
    });

    it('leaves a pending routine draft alone', async () => {
      const { store, fakeChat } = makeStore();
      const draft: RoutineDraft = {
        name: 'Routine A',
        exercises: [{ title: 'Ex 1', kind: 'strength' }],
      };

      store.getState().reset({ kind: 'create' });
      fakeChat.mockResolvedValueOnce({
        reply: 'both',
        draft,
        settingsProposal: { goals: 'Build strength' },
      });
      await store.getState().send('do both');

      store.getState().declineSettingsProposal();

      expect(store.getState().pendingDraft).toEqual(draft);
      expect(store.getState().pendingSettingsProposal).toBeNull();
    });
  });
});
