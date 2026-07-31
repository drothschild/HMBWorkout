import { create } from 'zustand';
import { Database } from '@nozbe/watermelondb';
import {
  AiTurn,
  RoutineDraft,
  DraftValidationError,
  SettingsProposal,
  validateSettingsProposal,
} from '@/ai/draftSchema';
import { acceptDraft as acceptDraftFn } from '@/ai/acceptDraft';
import {
  AnthropicHttpError,
  AnthropicUnreachable,
  createAnthropicClient,
  AiChatMessage,
} from '@/ai/anthropicClient';
import { buildSystem as buildSystemFn, AiCoachMode, DebriefMode } from '@/ai/contextBuilder';
import { getSettings, setSettings } from '@/state/settings';
import { DEBRIEF_OPENING_MESSAGE } from '@/state/postWorkoutDebrief';

export interface AiDisplayMessage {
  role: 'user' | 'assistant';
  content: string; // wire content: user text, or raw AiTurn JSON for assistant turns
  turn?: AiTurn; // parsed turn for rendering (assistant only)
  hidden?: boolean; // when true, not rendered in the UI but still sent to API
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
  pendingSettingsProposal: SettingsProposal | null;
  status: 'idle' | 'sending' | 'error';
  error: AiChatError | null;
  reset(mode: AiCoachMode): void;
  openDebrief(mode: DebriefMode): Promise<void>;
  send(text: string): Promise<void>;
  retry(): Promise<void>;
  acceptDraft(): Promise<string>;
  approveSettingsProposal(): void;
  declineSettingsProposal(): void;
}

export interface AiChatDeps {
  db: Database;
  createClient: typeof createAnthropicClient;
  buildSystem: typeof buildSystemFn;
  accept: typeof acceptDraftFn;
  getSettings: typeof getSettings;
  setSettings: typeof setSettings;
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
  // Epoch counter for the prompt cache alone. It advances on every event that
  // makes the cached prompt wrong, which is a strictly larger set than the events
  // that invalidate a conversation: reset() does both, while an approved settings
  // change only stales the prompt and must leave in-flight responses alone.
  let systemEpoch = 0;

  function invalidateCachedSystem() {
    cachedSystem = null;
    systemEpoch++;
  }

  async function performRequest(messages: AiDisplayMessage[], mode: AiCoachMode, apiKey: string, gen: number): Promise<AiTurn> {
    let system = cachedSystem;
    if (system === null) {
      const epoch = systemEpoch;
      system = await deps.buildSystem(deps.db, mode);
      // A reset() or an approved settings write during the build must not
      // repopulate the cache it just cleared. This request still uses the prompt
      // it started with — it is already committed — but the next one rebuilds.
      if (systemEpoch === epoch) cachedSystem = system;
    }

    // If generation changed during buildSystem, abort before creating billable client.
    if (generation !== gen) throw new Error('conversation reset');

    const client = deps.createClient({ apiKey: apiKey.trim() });

    const wireMessages: AiChatMessage[] = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    return await client.chat({
      system,
      messages: wireMessages,
    });
  }

  return create<AiChatState>((set, get) => {
    // Shared turn execution with generation guard and unified error handling
    async function runTurn(gen: number, messages: AiDisplayMessage[], mode: AiCoachMode, apiKey: string) {
      try {
        const turn = await performRequest(messages, mode, apiKey, gen);
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
          pendingSettingsProposal: turn.settingsProposal
            ? turn.settingsProposal
            : currentState.pendingSettingsProposal,
        }));
      } catch (error) {
        if (generation !== gen) return;
        set({
          status: 'error',
          error: mapError(error),
        });
      }
    }

    // Shared turn-start body: check key, set status, call runTurn. Used by
    // openDebrief, send, and retry to avoid drifting copies.
    async function startTurn(newMessages: AiDisplayMessage[], mode: AiCoachMode) {
      const settings = deps.getSettings();
      if (!settings.anthropicKey || settings.anthropicKey.trim() === '') {
        set({
          status: 'error',
          error: { kind: 'missing_key' },
        });
        return;
      }

      const gen = generation;
      set({
        messages: newMessages,
        status: 'sending',
        error: null,
      });

      await runTurn(gen, newMessages, mode, settings.anthropicKey);
    }

    return {
      mode: { kind: 'create' },
      messages: [],
      pendingDraft: null,
      pendingSettingsProposal: null,
      status: 'idle',
      error: null,

      reset(mode: AiCoachMode) {
        invalidateCachedSystem();
        generation++;
        set({
          mode,
          messages: [],
          pendingDraft: null,
          pendingSettingsProposal: null,
          status: 'idle',
          error: null,
        });
      },

      async openDebrief(mode: DebriefMode) {
        // A debrief is a conversation the coach starts, so the opening turn is
        // sent for the user. Going through reset() first keeps the generation
        // and prompt-cache rules identical to every other conversation start.
        get().reset(mode);

        // Send the opening message but mark it hidden: the user never typed it,
        // and the AI's greeting should be the first visible message.
        const newMessages: AiDisplayMessage[] = [{ role: 'user', content: DEBRIEF_OPENING_MESSAGE, hidden: true }];
        await startTurn(newMessages, mode);
      },

      async send(text: string) {
        const state = get();

        if (state.status === 'sending') {
          return;
        }

        const newMessages: AiDisplayMessage[] = [...state.messages, { role: 'user', content: text }];
        await startTurn(newMessages, state.mode);
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

        await startTurn(state.messages, state.mode);
      },

      async acceptDraft() {
        const state = get();

        if (state.pendingDraft === null) {
          throw new Error('No pending draft to accept');
        }

        const id = await deps.accept(deps.db, state.pendingDraft, state.mode);
        set({ pendingDraft: null });
        return id;
      },

      approveSettingsProposal() {
        const state = get();

        if (state.pendingSettingsProposal === null) {
          throw new Error('No pending settings proposal to approve');
        }

        // Validate twice: structured output is not a guarantee, and this is the
        // last point before the values reach persistent storage. Throwing here
        // leaves the proposal pending so the card stays on screen.
        const proposal = validateSettingsProposal(state.pendingSettingsProposal);

        // Build the patch from present fields only — spreading an explicit
        // `undefined` over the settings cache would blank the other field.
        const patch: Parameters<typeof setSettings>[0] = {};
        if (proposal.goals !== undefined) patch.aiGoals = proposal.goals;
        if (proposal.equipment !== undefined) patch.aiEquipment = proposal.equipment;

        deps.setSettings(patch);

        // The cached prompt embeds goals and equipment, so it is now stale. Clear
        // it without bumping `generation`: the conversation carries on and an
        // in-flight response must still be committed.
        invalidateCachedSystem();

        set({ pendingSettingsProposal: null });
      },

      declineSettingsProposal() {
        // Nothing was written, so the cached prompt is still accurate.
        set({ pendingSettingsProposal: null });
      },
    };
  });
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
      setSettings,
    });
  }
  return globalStore;
}
