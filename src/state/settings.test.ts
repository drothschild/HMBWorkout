/**
 * Tests for bridge settings persistence.
 * Verifies that settings are cached in-memory and persisted to storage.
 */

import { getSettings, setSettings, loadSettings, injectSettingsStorage, resetForTesting, resolveAiProvider } from './settings';

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


  test('setSettings persists partial updates', async () => {
    setSettings({ anthropicKey: 'sk-test-1', onboardingState: 'dismissed' });
    await new Promise(resolve => setTimeout(resolve, 10));

    setSettings({ onboardingState: 'completed' });
    await new Promise(resolve => setTimeout(resolve, 10));

    const stored = JSON.parse(fakeStorage.bridge_settings);
    expect(stored.anthropicKey).toBe('sk-test-1');
    expect(stored.onboardingState).toBe('completed');
  });

  test('loadSettings returns early if storage is empty', async () => {
    const initialSettings = getSettings();
    expect(initialSettings.onboardingState).toBe('unseen');

    await loadSettings();

    const afterSettings = getSettings();
    expect(afterSettings.onboardingState).toBe('unseen');
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
      anthropicKey: 'sk-old',
    });

    resetForTesting();
    injectSettingsStorage(fakeStorageBackend);

    await loadSettings();

    const settings = getSettings();
    expect(settings.anthropicKey).toBe('sk-old');
    expect(settings.aiGoals).toBe('');
    expect(settings.aiEquipment).toBe('');
  });

  test('AI Coach: setting AI fields does not affect other settings', async () => {
    // First set some settings
    setSettings({ anthropicKey: 'sk-initial', onboardingState: 'dismissed' });
    await new Promise(resolve => setTimeout(resolve, 10));

    // Then set only AI goals
    setSettings({ aiGoals: 'get strong' });
    await new Promise(resolve => setTimeout(resolve, 10));

    const settings = getSettings();
    expect(settings.anthropicKey).toBe('sk-initial');
    expect(settings.onboardingState).toBe('dismissed');
    expect(settings.aiGoals).toBe('get strong');
  });

  test('AI Coach: setting some settings does not affect AI fields', async () => {
    // First set AI fields
    setSettings({ anthropicKey: 'sk-y', aiGoals: 'goals', aiEquipment: 'equipment' });
    await new Promise(resolve => setTimeout(resolve, 10));

    // Then update onboarding state
    setSettings({ onboardingState: 'completed' });
    await new Promise(resolve => setTimeout(resolve, 10));

    const stored = JSON.parse(fakeStorage.bridge_settings);
    expect(stored.onboardingState).toBe('completed');
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

  // Coach personality setting
  test('AI Coach: aiPersonality default is empty string', () => {
    const settings = getSettings();
    expect(settings.aiPersonality).toBe('');
  });

  test('AI Coach: persist and reload aiPersonality', async () => {
    setSettings({ aiPersonality: 'Direct and no-nonsense; celebrate PRs' });
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(fakeStorage).toHaveProperty('bridge_settings');
    const stored = JSON.parse(fakeStorage.bridge_settings);
    expect(stored.aiPersonality).toBe('Direct and no-nonsense; celebrate PRs');

    // Simulate fresh app start
    resetForTesting();
    injectSettingsStorage(fakeStorageBackend);

    await loadSettings();
    expect(getSettings().aiPersonality).toBe('Direct and no-nonsense; celebrate PRs');
  });

  test('AI Coach: legacy blob without aiPersonality loads with empty default', async () => {
    // Pre-seed storage with a blob written before the personality field existed
    fakeStorage.bridge_settings = JSON.stringify({
      anthropicKey: 'sk-test',
      aiGoals: 'get strong',
      aiEquipment: 'dumbbells',
    });

    resetForTesting();
    injectSettingsStorage(fakeStorageBackend);

    await loadSettings();

    const settings = getSettings();
    expect(settings.aiPersonality).toBe('');
    expect(settings.aiGoals).toBe('get strong');
    expect(settings.aiEquipment).toBe('dumbbells');
  });

  test('AI Coach: setting aiPersonality does not affect other fields', async () => {
    setSettings({ aiGoals: 'goals', aiEquipment: 'equipment' });
    await new Promise(resolve => setTimeout(resolve, 10));

    setSettings({ aiPersonality: 'Upbeat hype coach' });
    await new Promise(resolve => setTimeout(resolve, 10));

    const stored = JSON.parse(fakeStorage.bridge_settings);
    expect(stored.aiGoals).toBe('goals');
    expect(stored.aiEquipment).toBe('equipment');
    expect(stored.aiPersonality).toBe('Upbeat hype coach');
  });

  // Multi-provider support: backward compatibility and migration
  test('existing anthropic-only install keeps working untouched', async () => {
    // Simulate legacy storage with anthropic fields
    fakeStorage.bridge_settings = JSON.stringify({
      anthropicKey: 'sk-ant-xxxxx',
      aiGoals: 'Build strength',
      aiEquipment: 'Dumbbell',
      aiPersonality: 'Encouraging',
    });

    resetForTesting();
    injectSettingsStorage(fakeStorageBackend);

    await loadSettings();

    const loaded = getSettings();

    // Old fields intact
    expect(loaded.anthropicKey).toBe('sk-ant-xxxxx');
    expect(loaded.aiGoals).toBe('Build strength');
    expect(loaded.aiEquipment).toBe('Dumbbell');
    expect(loaded.aiPersonality).toBe('Encouraging');

    // New fields default to undefined
    expect(loaded.openaiKey).toBeUndefined();
    expect(loaded.aiProvider).toBeUndefined();
    expect(loaded.aiModel).toBeUndefined();
  });

  test('new OpenAI install can be set', () => {
    setSettings({
      openaiKey: 'sk-openai-xxxxx',
      aiProvider: 'openai',
      aiModel: {
        chat: 'gpt-5.6-sol',
        oneShot: 'gpt-5.6-terra',
      },
    });

    const loaded = getSettings();

    expect(loaded.openaiKey).toBe('sk-openai-xxxxx');
    expect(loaded.aiProvider).toBe('openai');
    expect(loaded.aiModel).toEqual({
      chat: 'gpt-5.6-sol',
      oneShot: 'gpt-5.6-terra',
    });
  });

  // Provider resolver tests
  test('resolver: with only anthropic key, resolves to anthropic', () => {
    setSettings({
      anthropicKey: 'sk-ant-xxxxx',
      openaiKey: undefined,
    });

    expect(resolveAiProvider()).toBe('anthropic');
  });

  test('resolver: with only openai key, resolves to openai', () => {
    setSettings({
      anthropicKey: '',
      openaiKey: 'sk-openai-xxxxx',
    });

    expect(resolveAiProvider()).toBe('openai');
  });

  test('resolver: with both keys set but no explicit provider, returns null', () => {
    setSettings({
      anthropicKey: 'sk-ant-xxxxx',
      openaiKey: 'sk-openai-xxxxx',
      aiProvider: undefined,
    });

    expect(resolveAiProvider()).toBe(null);
  });

  test('resolver: with both keys set, explicit provider wins', () => {
    setSettings({
      anthropicKey: 'sk-ant-xxxxx',
      openaiKey: 'sk-openai-xxxxx',
      aiProvider: 'openai',
    });

    expect(resolveAiProvider()).toBe('openai');
  });

  test('resolver: with neither key set, returns null (AI disabled)', () => {
    setSettings({
      anthropicKey: '',
      openaiKey: '',
      aiProvider: undefined,
    });

    expect(resolveAiProvider()).toBe(null);
  });

  test('resolver: explicit provider overrides implicit detection', () => {
    setSettings({
      anthropicKey: 'sk-ant-xxxxx',
      openaiKey: undefined,
      aiProvider: 'openai',
    });

    expect(resolveAiProvider()).toBe('openai');
  });

  test('per-surface model selection allows different models for different surfaces', () => {
    setSettings({
      aiModel: {
        chat: 'gpt-5.6-sol',
        oneShot: 'gpt-5.6-terra',
      },
    });

    const loaded = getSettings();

    expect(loaded.aiModel?.chat).toBe('gpt-5.6-sol');
    expect(loaded.aiModel?.oneShot).toBe('gpt-5.6-terra');
  });

  test('migration from anthropic to openai works seamlessly', async () => {
    // Start with anthropic-only setup
    const anthropicOnly = {
      anthropicKey: 'sk-ant-xxxxx',
      aiGoals: 'Build strength',
      aiEquipment: 'Dumbbell',
      aiPersonality: 'Encouraging',
    };

    fakeStorage.bridge_settings = JSON.stringify(anthropicOnly);

    resetForTesting();
    injectSettingsStorage(fakeStorageBackend);

    await loadSettings();

    // Now user adds OpenAI key and explicitly selects it
    setSettings({
      openaiKey: 'sk-openai-xxxxx',
      aiProvider: 'openai',
      aiModel: {
        chat: 'gpt-5.6-sol',
        oneShot: 'gpt-5.6-terra',
      },
    });

    const loaded = getSettings();

    // Old anthropic setup still there
    expect(loaded.anthropicKey).toBe('sk-ant-xxxxx');

    // New OpenAI setup added
    expect(loaded.openaiKey).toBe('sk-openai-xxxxx');
    expect(loaded.aiProvider).toBe('openai');
    expect(loaded.aiModel?.chat).toBe('gpt-5.6-sol');
  });

  // Coach onboarding Phase 1 tests
  test('coach-onboarding.AC1.1 Success: The two profile* fields and onboardingState save and survive an app restart', async () => {
    setSettings({
      profileAge: '41',
      profileExperience: 'intermediate, weak shoulders',
      onboardingState: 'completed',
    });
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(fakeStorage).toHaveProperty('bridge_settings');
    const stored = JSON.parse(fakeStorage.bridge_settings);
    expect(stored.profileAge).toBe('41');
    expect(stored.profileExperience).toBe('intermediate, weak shoulders');
    expect(stored.onboardingState).toBe('completed');

    // Simulate fresh app start
    resetForTesting();
    injectSettingsStorage(fakeStorageBackend);

    await loadSettings();
    const reloaded = getSettings();
    expect(reloaded.profileAge).toBe('41');
    expect(reloaded.profileExperience).toBe('intermediate, weak shoulders');
    expect(reloaded.onboardingState).toBe('completed');
  });

  test('coach-onboarding.AC1.2 Success: A stored blob written before this feature loads without error; the new fields default to empty and onboardingState to unseen', async () => {
    // Pre-seed storage with legacy blob (no profile or onboarding fields)
    fakeStorage.bridge_settings = JSON.stringify({
      anthropicKey: 'sk-test',
      aiGoals: 'get strong',
      aiEquipment: 'dumbbells',
      aiPersonality: 'upbeat',
    });

    resetForTesting();
    injectSettingsStorage(fakeStorageBackend);

    await loadSettings();

    const settings = getSettings();
    // Old fields intact
    expect(settings.anthropicKey).toBe('sk-test');
    expect(settings.aiGoals).toBe('get strong');
    expect(settings.aiEquipment).toBe('dumbbells');
    expect(settings.aiPersonality).toBe('upbeat');
    // New fields default to empty strings and 'unseen'
    expect(settings.profileAge).toBe('');
    expect(settings.profileExperience).toBe('');
    expect(settings.onboardingState).toBe('unseen');
  });

  test('remove-vault-sync.AC1.4 Edge: Legacy blob with now-deleted baseUrl/token loads without error', async () => {
    // Pre-seed storage with a blob that has baseUrl/token (now-deleted fields)
    // alongside valid current fields, simulating a blob written before this phase.
    // The two stale values deliberately avoid the old bridge host/token strings.
    // The vault-sync removal's exit criteria grep all of src for them to prove
    // no fixture reintroduces a bridge credential, so a legacy-blob fixture
    // reusing them would turn that check into a permanent false positive.
    fakeStorage.bridge_settings = JSON.stringify({
      baseUrl: 'http://legacy-host.example:3000',
      token: 'legacy-token-abc123',
      anthropicKey: 'sk-test-key',
      onboardingState: 'completed',
      aiGoals: 'get stronger',
      profileAge: '35',
    });

    resetForTesting();
    injectSettingsStorage(fakeStorageBackend);

    // Should load without throwing
    await loadSettings();

    const settings = getSettings();
    // Surviving fields should have loaded correctly
    expect(settings.anthropicKey).toBe('sk-test-key');
    expect(settings.onboardingState).toBe('completed');
    expect(settings.aiGoals).toBe('get stronger');
    expect(settings.profileAge).toBe('35');
    // Note: we do NOT assert on baseUrl/token since they no longer exist in the type.
    // loadSettings' merge deliberately preserves unknown keys, so the stale ones
    // survive in the blob as inert data that no read site reaches.
  });

  test('coach-onboarding.AC1.3 Success: A refusal is stored as its own text, so empty still means never asked and the two are distinguishable by reading the value alone', () => {
    // Both fields carry the same "declining is data, not absence" invariant, so
    // both are guarded. The failure this catches does not exist yet: it is a
    // future normaliser that blanks a refusal back to '', reintroducing the
    // sentinel the design deliberately avoids. Guarding only profileAge would
    // let such a normaliser land on experience unnoticed.
    //
    // The empties are written explicitly rather than inherited from
    // resetForTesting(): a normaliser that rewrites an explicit '' is a
    // different mutation from one that only affects defaults.
    setSettings({ profileAge: '', profileExperience: '' });
    const empty = getSettings();
    expect(empty.profileAge).toBe('');
    expect(empty.profileExperience).toBe('');

    setSettings({
      profileAge: 'prefer not to say',
      profileExperience: 'rather not answer',
    });
    const refused = getSettings();
    expect(refused.profileAge).toBe('prefer not to say');
    expect(refused.profileExperience).toBe('rather not answer');
  });

  test('coach-onboarding.AC1.4 Edge: Both profile fields may be empty; the settings module behaves normally with none of them set', async () => {
    setSettings({
      profileAge: '',
      profileExperience: '',
      onboardingState: 'unseen',
    });
    await new Promise(resolve => setTimeout(resolve, 10));

    const stored = JSON.parse(fakeStorage.bridge_settings);
    expect(stored.profileAge).toBe('');
    expect(stored.profileExperience).toBe('');
    expect(stored.onboardingState).toBe('unseen');

    const settings = getSettings();
    expect(settings.profileAge).toBe('');
    expect(settings.profileExperience).toBe('');
    expect(settings.onboardingState).toBe('unseen');
  });
});
