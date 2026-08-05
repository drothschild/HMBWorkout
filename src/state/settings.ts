/**
 * Settings store for bridge configuration with persistent storage.
 * Holds bridge URL, API token, and multi-provider AI configuration in-memory,
 * backed by secure storage.
 */

import type { AiModelConfig, AiProvider } from '@/ai/provider/types';

interface BridgeSettings {
  baseUrl: string;
  token: string;
  anthropicKey: string;
  aiGoals: string;
  aiEquipment: string;
  aiPersonality: string;

  /** Free text: "41", "early 40s", "prefer not to say". '' = never asked. */
  profileAge: string;
  /** Free text, including self-described. '' = never asked. */
  profileGender: string;
  /** Free text: "beginner", "strong squat, terrible overhead". '' = never asked. */
  profileExperience: string;
  /** Lifecycle of the opening conversation. Defaults to 'unseen'. */
  onboardingState: 'unseen' | 'dismissed' | 'completed';

  /** OpenAI API key (set on openai-only installs) */
  openaiKey?: string;

  /**
   * Explicit provider selection ('anthropic' or 'openai').
   * When set, it wins over implicit key-based detection.
   */
  aiProvider?: AiProvider;

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
  profileAge: '',
  profileGender: '',
  profileExperience: '',
  onboardingState: 'unseen',
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

/**
 * Resolve which AI provider is active based on settings.
 *
 * Resolution order:
 * 1. If aiProvider is explicitly set, use it (overrides implicit detection)
 * 2. If only anthropicKey is set, use 'anthropic'
 * 3. If only openaiKey is set, use 'openai'
 * 4. If both keys are set, use the explicit aiProvider if set, otherwise return null
 * 5. If neither key is set, return null (AI features disabled)
 */
export function resolveAiProvider(): 'anthropic' | 'openai' | null {
  const settings = getSettings();

  // Explicit provider setting wins
  if (settings.aiProvider === 'anthropic' || settings.aiProvider === 'openai') {
    return settings.aiProvider;
  }

  // Implicit detection: whichever key is set
  const hasAnthropicKey = (settings.anthropicKey ?? '').trim().length > 0;
  const hasOpenaiKey = (settings.openaiKey ?? '').trim().length > 0;

  if (hasAnthropicKey && !hasOpenaiKey) {
    return 'anthropic';
  }

  if (hasOpenaiKey && !hasAnthropicKey) {
    return 'openai';
  }

  // Both or neither: no implicit choice
  return null;
}
