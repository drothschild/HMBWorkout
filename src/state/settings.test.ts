/**
 * Tests for bridge settings persistence.
 * Verifies that settings are cached in-memory and persisted to storage.
 */

import { getSettings, setSettings, loadSettings, injectSettingsStorage, resetForTesting } from './settings';

describe('Settings Persistence', () => {
  let fakeCalls: string[] = [];
  let fakeStorage: { [key: string]: string } = {};

  const fakeStorageBackend = {
    getItemAsync: async (key: string) => {
      fakeCalls.push(`getItemAsync:${key}`);
      return fakeStorage[key] ?? null;
    },
    setItemAsync: async (key: string, value: string) => {
      fakeCalls.push(`setItemAsync:${key}`);
      fakeStorage[key] = value;
    },
    deleteItemAsync: async (key: string) => {
      fakeCalls.push(`deleteItemAsync:${key}`);
      delete fakeStorage[key];
    },
  };

  beforeEach(() => {
    fakeCalls = [];
    fakeStorage = {};
    // Reset cache and inject fake storage for all tests
    resetForTesting();
    injectSettingsStorage(fakeStorageBackend);
  });

  test('getSettings returns default empty baseUrl and empty token on first access', () => {
    const settings = getSettings();
    expect(settings.baseUrl).toBe('');
    expect(settings.token).toBe('');
  });

  test('setSettings updates cached values immediately', () => {
    setSettings({ baseUrl: 'http://example.com:8000', token: 'abc123' });

    const settings = getSettings();
    expect(settings.baseUrl).toBe('http://example.com:8000');
    expect(settings.token).toBe('abc123');
  });

  test('setSettings persists baseUrl to storage', async () => {
    setSettings({ baseUrl: 'http://example.com:8000' });
    await new Promise(resolve => setTimeout(resolve, 10)); // Allow async write

    expect(fakeStorage).toHaveProperty('bridge_settings');
    const stored = JSON.parse(fakeStorage.bridge_settings);
    expect(stored.baseUrl).toBe('http://example.com:8000');
  });

  test('setSettings persists token to storage', async () => {
    setSettings({ token: 'secret-token' });
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(fakeStorage).toHaveProperty('bridge_settings');
    const stored = JSON.parse(fakeStorage.bridge_settings);
    expect(stored.token).toBe('secret-token');
  });

  test('setSettings persists partial updates', async () => {
    setSettings({ baseUrl: 'http://example.com', token: 'token1' });
    await new Promise(resolve => setTimeout(resolve, 10));

    setSettings({ token: 'token2' });
    await new Promise(resolve => setTimeout(resolve, 10));

    const stored = JSON.parse(fakeStorage.bridge_settings);
    expect(stored.baseUrl).toBe('http://example.com');
    expect(stored.token).toBe('token2');
  });

  test('loadSettings hydrates cache from storage', async () => {
    // Pre-populate storage
    fakeStorage.bridge_settings = JSON.stringify({
      baseUrl: 'http://mac.local:3000',
      token: 'stored-token',
    });

    // Clear the cache by simulating a fresh app start
    // This is implicit - we just call loadSettings
    await loadSettings();

    const settings = getSettings();
    expect(settings.baseUrl).toBe('http://mac.local:3000');
    expect(settings.token).toBe('stored-token');
  });

  test('loadSettings returns early if storage is empty', async () => {
    const initialSettings = getSettings();
    expect(initialSettings.baseUrl).toBe('');
    expect(initialSettings.token).toBe('');

    await loadSettings();

    const afterSettings = getSettings();
    expect(afterSettings.baseUrl).toBe('');
    expect(afterSettings.token).toBe('');
  });

  test('multiple setSettings calls accumulate', () => {
    setSettings({ baseUrl: 'http://example.com' });
    setSettings({ token: 'token123' });

    const settings = getSettings();
    expect(settings.baseUrl).toBe('http://example.com');
    expect(settings.token).toBe('token123');
  });

  // AI Coach settings tests (AC1.1, AC1.2, AC1.3, AC1.4)
  test('AI Coach: persist and reload all three new fields', async () => {
    setSettings({ anthropicKey: 'sk-test', aiGoals: 'get strong', aiEquipment: 'dumbbells' });
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(fakeStorage).toHaveProperty('bridge_settings');
    const stored = JSON.parse(fakeStorage.bridge_settings);
    expect(stored.anthropicKey).toBe('sk-test');
    expect(stored.aiGoals).toBe('get strong');
    expect(stored.aiEquipment).toBe('dumbbells');

    // Simulate fresh app start
    resetForTesting();
    injectSettingsStorage(fakeStorageBackend);

    await loadSettings();
    const reloaded = getSettings();
    expect(reloaded.anthropicKey).toBe('sk-test');
    expect(reloaded.aiGoals).toBe('get strong');
    expect(reloaded.aiEquipment).toBe('dumbbells');
  });

  test('AI Coach: legacy blob without AI fields loads with empty defaults', async () => {
    // Pre-seed storage with legacy blob (no AI fields)
    fakeStorage.bridge_settings = JSON.stringify({
      baseUrl: 'http://mac.local:3000',
      token: 'tok',
    });

    resetForTesting();
    injectSettingsStorage(fakeStorageBackend);

    await loadSettings();

    const settings = getSettings();
    expect(settings.baseUrl).toBe('http://mac.local:3000');
    expect(settings.token).toBe('tok');
    expect(settings.anthropicKey).toBe('');
    expect(settings.aiGoals).toBe('');
    expect(settings.aiEquipment).toBe('');
  });

  test('AI Coach: setting AI fields does not affect bridge settings', async () => {
    // First set bridge settings
    setSettings({ baseUrl: 'http://example.com', token: 'bridge-token' });
    await new Promise(resolve => setTimeout(resolve, 10));

    // Then set only AI fields
    setSettings({ anthropicKey: 'sk-x' });
    await new Promise(resolve => setTimeout(resolve, 10));

    const settings = getSettings();
    expect(settings.baseUrl).toBe('http://example.com');
    expect(settings.token).toBe('bridge-token');
    expect(settings.anthropicKey).toBe('sk-x');
  });

  test('AI Coach: setting bridge fields does not affect AI fields', async () => {
    // First set AI fields
    setSettings({ anthropicKey: 'sk-y', aiGoals: 'goals', aiEquipment: 'equipment' });
    await new Promise(resolve => setTimeout(resolve, 10));

    // Then update bridge settings
    setSettings({ baseUrl: 'http://new' });
    await new Promise(resolve => setTimeout(resolve, 10));

    const stored = JSON.parse(fakeStorage.bridge_settings);
    expect(stored.baseUrl).toBe('http://new');
    expect(stored.anthropicKey).toBe('sk-y');
    expect(stored.aiGoals).toBe('goals');
    expect(stored.aiEquipment).toBe('equipment');
  });

  test('AI Coach: defaults are empty strings', () => {
    const settings = getSettings();
    expect(settings.anthropicKey).toBe('');
    expect(settings.aiGoals).toBe('');
    expect(settings.aiEquipment).toBe('');
  });

  test('AI Coach: can set all fields to empty strings', async () => {
    setSettings({ anthropicKey: '', aiGoals: '', aiEquipment: '' });
    await new Promise(resolve => setTimeout(resolve, 10));

    const stored = JSON.parse(fakeStorage.bridge_settings);
    expect(stored.anthropicKey).toBe('');
    expect(stored.aiGoals).toBe('');
    expect(stored.aiEquipment).toBe('');

    const settings = getSettings();
    expect(settings.anthropicKey).toBe('');
    expect(settings.aiGoals).toBe('');
    expect(settings.aiEquipment).toBe('');
  });
});
