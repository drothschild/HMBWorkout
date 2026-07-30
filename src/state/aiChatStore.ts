import { create } from 'zustand';
import { Database } from '@nozbe/watermelondb';
import { AiTurn, RoutineDraft, DraftValidationError } from '@/ai/draftSchema';
import { acceptDraft as acceptDraftFn } from '@/ai/acceptDraft';
import {
  AnthropicHttpError,
  AnthropicUnreachable,
  createAnthropicClient,
  AiChatMessage,
} from '@/ai/anthropicClient';
import { buildSystem as buildSystemFn, AiCoachMode } from '@/ai/contextBuilder';
import { getSettings } from '@/state/settings';

export interface AiDisplayMessage {
  role: 'user' | 'assistant';
  content: string; // wire content: user text, or raw AiTurn JSON for assistant turns
  turn?: AiTurn; // parsed turn for rendering (assistant only)
}

export type AiChatError =
  | { kind: 'missing_key' }
  | { kind: 'unauthorized' }
  | { kind: 'network' }
  | { kind: 'http'; status: number }
  | { kind: 'parse' }
  | { kind: 'unknown' };

interface AiChatState {
  mode: AiCoachMode;
  messages: AiDisplayMessage[];
  pendingDraft: RoutineDraft | null;
  status: 'idle' | 'sending' | 'error';
  error: AiChatError | null;
  reset(mode: AiCoachMode): void;
  send(text: string): Promise<void>;
  retry(): Promise<void>;
  acceptDraft(): Promise<string>;
}

export interface AiChatDeps {
  db: Database;
  createClient: typeof createAnthropicClient;
  buildSystem: typeof buildSystemFn;
  accept: typeof acceptDraftFn;
  getSettings: typeof getSettings;
}

function mapError(error: unknown): AiChatError {
  if (error instanceof AnthropicHttpError) {
    if (error.status === 401) {
      return { kind: 'unauthorized' };
    } else {
      return { kind: 'http', status: error.status };
    }
  } else if (error instanceof AnthropicUnreachable) {
    return { kind: 'network' };
  } else if (error instanceof DraftValidationError) {
    return { kind: 'parse' };
  } else {
    return { kind: 'unknown' };
  }
}

export function createAiChatStore(deps: AiChatDeps) {
  // Cache the system prompt for the duration of a conversation
  let cachedSystem: string | null = null;
  // Generation counter to discard stale responses after reset() invalidates ongoing requests
  let generation = 0;

  async function performRequest(messages: AiDisplayMessage[], mode: AiCoachMode, apiKey: string): Promise<AiTurn> {
    if (cachedSystem === null) {
      cachedSystem = await deps.buildSystem(deps.db, mode);
    }

    const client = deps.createClient({ apiKey: apiKey.trim() });

    const wireMessages: AiChatMessage[] = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    return await client.chat({
      system: cachedSystem,
      messages: wireMessages,
    });
  }

  return create<AiChatState>((set, get) => ({
    mode: { kind: 'create' },
    messages: [],
    pendingDraft: null,
    status: 'idle',
    error: null,

    reset(mode: AiCoachMode) {
      cachedSystem = null;
      generation++;
      set({
        mode,
        messages: [],
        pendingDraft: null,
        status: 'idle',
        error: null,
      });
    },

    async send(text: string) {
      const state = get();

      if (state.status === 'sending') {
        return;
      }

      const settings = deps.getSettings();
      if (!settings.anthropicKey || settings.anthropicKey.trim() === '') {
        set({
          status: 'error',
          error: { kind: 'missing_key' },
        });
        return;
      }

      const newMessages: AiDisplayMessage[] = [...state.messages, { role: 'user', content: text }];
      const gen = generation;
      set({
        messages: newMessages,
        status: 'sending',
        error: null,
      });

      try {
        const turn = await performRequest(newMessages, state.mode, settings.anthropicKey);
        if (generation !== gen) return;
        set((currentState) => ({
          messages: [
            ...currentState.messages,
            {
              role: 'assistant',
              content: JSON.stringify(turn),
              turn,
            },
          ],
          status: 'idle',
          pendingDraft: turn.draft ? turn.draft : currentState.pendingDraft,
        }));
      } catch (error) {
        if (generation !== gen) return;
        set({
          status: 'error',
          error: mapError(error),
        });
      }
    },

    async retry() {
      const state = get();

      if (state.status !== 'error' || state.messages.length === 0) {
        return;
      }

      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage.role !== 'user') {
        return;
      }

      const settings = deps.getSettings();
      if (!settings.anthropicKey || settings.anthropicKey.trim() === '') {
        set({
          status: 'error',
          error: { kind: 'missing_key' },
        });
        return;
      }

      const gen = generation;
      set({ status: 'sending', error: null });

      try {
        const turn = await performRequest(state.messages, state.mode, settings.anthropicKey);
        if (generation !== gen) return;
        set((currentState) => ({
          messages: [
            ...currentState.messages,
            {
              role: 'assistant',
              content: JSON.stringify(turn),
              turn,
            },
          ],
          status: 'idle',
          pendingDraft: turn.draft ? turn.draft : currentState.pendingDraft,
        }));
      } catch (error) {
        if (generation !== gen) return;
        set({
          status: 'error',
          error: mapError(error),
        });
      }
    },

    async acceptDraft() {
      const state = get();

      if (state.pendingDraft === null) {
        throw new Error('No pending draft to accept');
      }

      const id = await deps.accept(deps.db, state.pendingDraft);
      set({ pendingDraft: null });
      return id;
    },
  }));
}

// Defer import until needed to avoid loading database singleton at module load time
let database: Database | null = null;

function getDatabase(): Database {
  if (!database) {
    const mod = require('@/db');
    database = mod.database as Database;
  }
  return database as Database;
}

let globalStore: ReturnType<typeof createAiChatStore> | null = null;

export function getAiChatStore() {
  if (!globalStore) {
    globalStore = createAiChatStore({
      db: getDatabase(),
      createClient: createAnthropicClient,
      buildSystem: buildSystemFn,
      accept: acceptDraftFn,
      getSettings,
    });
  }
  return globalStore;
}
