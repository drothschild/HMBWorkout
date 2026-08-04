/**
 * Settings store for bridge configuration with persistent storage.
 * Holds bridge URL, API token, and multi-provider AI configuration in-memory,
 * backed by secure storage.
 */

/**
 * Per-surface model selection for AI providers.
 * Frontier tier for chat/debrief/drafting, cheaper tier for one-shot features.
 */
export interface AiModelConfig {
  /** Model for chat, debrief, routine drafting (frontier tier) */
  chat: string;
  /** Model for rest commentary, exercise question (cheaper tier) */
  oneShot: string;
}

interface BridgeSettings {
  baseUrl: string;
  token: string;
  anthropicKey: string;
  aiGoals: string;
  aiEquipment: string;
  aiPersonality: string;

  /** OpenAI API key (set on openai-only installs) */
  openaiKey?: string;

  /**
   * Explicit provider selection ('anthropic' or 'openai').
   * When set, it wins over implicit key-based detection.
   */
  aiProvider?: string;

  /**
   * Per-surface model selection.
   * Each provider has defaults if not specified.
   */
  aiModel?: AiModelConfig;
}

interface StorageBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const SETTINGS_KEY = 'bridge_settings';

const DEFAULT_SETTINGS: BridgeSettings = {
  baseUrl: '',
  token: '',
  anthropicKey: '',
  aiGoals: '',
  aiEquipment: '',
  aiPersonality: '',
  openaiKey: undefined,
  aiProvider: undefined,
  aiModel: undefined,
};

// Module-level cache, hydrated from storage at app boot
let cache: BridgeSettings = { ...DEFAULT_SETTINGS };

let storageBackend: StorageBackend | null = null;

/**
 * Inject storage backend for testability.
 * Tests pass a fake; production uses expo-secure-store.
 */
export function injectSettingsStorage(backend: StorageBackend): void {
  storageBackend = backend;
}

/**
 * Reset cache and backend for testing.
 */
export function resetForTesting(): void {
  cache = { ...DEFAULT_SETTINGS };
  storageBackend = null;
}

/**
 * Load settings from persistent storage into cache.
 * Call once at app boot before any getSettings() calls.
 */
export async function loadSettings(): Promise<void> {
  if (!storageBackend) {
    // No storage backend injected; cache remains at defaults
    return;
  }

  try {
    const stored = await storageBackend.getItemAsync(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as BridgeSettings;
      cache = { ...cache, ...parsed };
    }
  } catch (error) {
    console.error('Failed to load settings from storage:', error);
    // Fall back to defaults
  }
}

/**
 * Get current bridge settings (from cache, not storage).
 * Synchronous for callers that need it in sync context.
 */
export function getSettings(): BridgeSettings {
  return { ...cache };
}

/**
 * Update bridge settings (cache + persist).
 * Fire-and-forget write to storage; cache updated immediately.
 */
export function setSettings(newSettings: Partial<BridgeSettings>): void {
  // Update cache immediately for sync callers
  cache = { ...cache, ...newSettings };

  // Persist to storage async (fire-and-forget)
  if (storageBackend) {
    storageBackend.setItemAsync(SETTINGS_KEY, JSON.stringify(cache)).catch(error => {
      console.error('Failed to persist settings:', error);
    });
  }
}
