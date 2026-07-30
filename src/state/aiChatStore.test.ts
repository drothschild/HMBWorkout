import { createAiChatStore, AiChatDeps } from './aiChatStore';
import { AiTurn, RoutineDraft, DraftValidationError } from '@/ai/draftSchema';
import { AnthropicHttpError, AnthropicUnreachable } from '@/ai/anthropicClient';

// Helper to create a test store with mocked dependencies
function makeStore(deps: Partial<AiChatDeps> = {}) {
  const fakeChat = jest.fn();
  const fakeBuildSystem = jest.fn().mockResolvedValue('SYSTEM');
  const fakeAccept = jest.fn().mockResolvedValue('routine-id-1');
  const fakeGetSettings = jest.fn().mockReturnValue({ anthropicKey: 'sk-test' });

  const store = createAiChatStore({
    db: {} as never,
    createClient: jest.fn().mockReturnValue({ chat: fakeChat }),
    buildSystem: fakeBuildSystem,
    accept: fakeAccept,
    getSettings: fakeGetSettings,
    ...deps,
  });

  return {
    store,
    fakeChat,
    fakeBuildSystem,
    fakeAccept,
    fakeGetSettings,
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

  describe('AC3.2 / AC5.3 - accept and write-path isolation', () => {
    it('calls accept with draft and returns id', async () => {
      const { store, fakeAccept, fakeChat } = makeStore();

      const draft: RoutineDraft = {
        name: 'Test Routine',
        exercises: [{ title: 'Push-up', kind: 'strength' }],
      };

      store.getState().reset({ kind: 'create' });
      fakeChat.mockResolvedValue({ reply: 'created', draft });

      await store.getState().send('create routine');

      expect(store.getState().pendingDraft).toEqual(draft);

      const id = await store.getState().acceptDraft();

      expect(fakeAccept).toHaveBeenCalledTimes(1);
      expect(fakeAccept).toHaveBeenCalledWith({}, draft);
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

      fakeChat.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ reply: 'recovered' }), 100))
      );

      const promise1 = store.getState().retry();
      const promise2 = store.getState().retry();

      await Promise.all([promise1, promise2]);

      expect(fakeChat).toHaveBeenCalledTimes(2);
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
});
