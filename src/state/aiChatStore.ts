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
  | { kind: 'parse' };

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

export function createAiChatStore(deps: AiChatDeps) {
  // Cache the system prompt for the duration of a conversation
  let cachedSystem: string | null = null;

  return create<AiChatState>((set, get) => ({
    mode: { kind: 'create' },
    messages: [],
    pendingDraft: null,
    status: 'idle',
    error: null,

    reset(mode: AiCoachMode) {
      cachedSystem = null;
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

      // No-op if already sending
      if (state.status === 'sending') {
        return;
      }

      // Check for missing API key
      const settings = deps.getSettings();
      if (!settings.anthropicKey || settings.anthropicKey.trim() === '') {
        set({
          status: 'error',
          error: { kind: 'missing_key' },
        });
        return;
      }

      // Append user message and set status to sending
      set({
        messages: [...state.messages, { role: 'user', content: text }],
        status: 'sending',
        error: null,
      });

      try {
        // Build system prompt once per conversation
        if (cachedSystem === null) {
          cachedSystem = await deps.buildSystem(deps.db, state.mode);
        }

        // Create client and send request
        const client = deps.createClient({ apiKey: settings.anthropicKey });

        // Map state messages to wire format
        const wireMessages: AiChatMessage[] = get().messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        const turn = await client.chat({
          system: cachedSystem,
          messages: wireMessages,
        });

        // Append assistant message
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
          // Update pending draft if this turn includes one
          pendingDraft: turn.draft ? turn.draft : currentState.pendingDraft,
        }));
      } catch (error) {
        // Map error to AiChatError
        let errorKind: AiChatError;

        if (error instanceof AnthropicHttpError) {
          if (error.status === 401) {
            errorKind = { kind: 'unauthorized' };
          } else {
            errorKind = { kind: 'http', status: error.status };
          }
        } else if (error instanceof AnthropicUnreachable) {
          errorKind = { kind: 'network' };
        } else if (error instanceof DraftValidationError) {
          errorKind = { kind: 'parse' };
        } else {
          // Fallback for unexpected errors
          errorKind = { kind: 'parse' };
        }

        set({
          status: 'error',
          error: errorKind,
        });
      }
    },

    async retry() {
      const state = get();

      // Only meaningful when there's an error and last message is user
      if (state.status !== 'error' || state.messages.length === 0) {
        return;
      }

      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage.role !== 'user') {
        return;
      }

      // Re-run the request path without appending a new user message
      try {
        // Ensure system is cached
        if (cachedSystem === null) {
          cachedSystem = await deps.buildSystem(deps.db, state.mode);
        }

        // Create client and send request
        const settings = deps.getSettings();
        const client = deps.createClient({ apiKey: settings.anthropicKey });

        // Map current state messages to wire format
        const wireMessages: AiChatMessage[] = state.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        const turn = await client.chat({
          system: cachedSystem,
          messages: wireMessages,
        });

        // Append assistant message
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
          error: null,
          // Update pending draft if this turn includes one
          pendingDraft: turn.draft ? turn.draft : currentState.pendingDraft,
        }));
      } catch (error) {
        // Map error to AiChatError
        let errorKind: AiChatError;

        if (error instanceof AnthropicHttpError) {
          if (error.status === 401) {
            errorKind = { kind: 'unauthorized' };
          } else {
            errorKind = { kind: 'http', status: error.status };
          }
        } else if (error instanceof AnthropicUnreachable) {
          errorKind = { kind: 'network' };
        } else if (error instanceof DraftValidationError) {
          errorKind = { kind: 'parse' };
        } else {
          errorKind = { kind: 'parse' };
        }

        set({
          status: 'error',
          error: errorKind,
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
