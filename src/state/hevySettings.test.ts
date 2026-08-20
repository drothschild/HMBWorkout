/**
 * `hevyApiKeyPatch` / `hasHevyApiKey` — the stored Hevy key (#267 Phase 3).
 *
 * Sits beside `aiProviderSettings.ts` and follows its rules exactly, because
 * this is the same hazard class: a secret typed into a screen that no jest
 * project can load. The decisions therefore live here, and the screen calls in.
 *
 * The trim is the reason this function exists at all. `hevyClient.ts` trims
 * again at the wire, which is deliberate double-normalisation — and which is
 * also why an untrimmed STORE would be invisible to every wire-level assertion.
 * This test is the only cover for that layer, exactly as `apiKeyPatch`'s is.
 */

import { hasHevyApiKey, hevyApiKeyPatch } from './hevySettings';

describe('hevyApiKeyPatch', () => {
  it('stores the key under `hevyApiKey`, trimmed', () => {
    expect(hevyApiKeyPatch('  abc-123  ')).toEqual({ hevyApiKey: 'abc-123' });
  });

  it('clears with an empty string, never `undefined`', () => {
    // `setSettings` persists through `JSON.stringify`, which DROPS `undefined`
    // — a cleared key would leave no evidence of the clear in the blob. This is
    // the same rule the AI provider switch follows, and for the same reason.
    expect(hevyApiKeyPatch('   ')).toEqual({ hevyApiKey: '' });
    expect(Object.prototype.hasOwnProperty.call(hevyApiKeyPatch('   '), 'hevyApiKey')).toBe(true);
    expect(JSON.stringify(hevyApiKeyPatch('   '))).toBe('{"hevyApiKey":""}');
  });

  it('touches no other field, so a patch can never blank the AI keys', () => {
    expect(Object.keys(hevyApiKeyPatch('abc'))).toEqual(['hevyApiKey']);
  });
});

describe('hasHevyApiKey', () => {
  it('is false for absent, empty and whitespace-only keys', () => {
    expect(hasHevyApiKey({})).toBe(false);
    expect(hasHevyApiKey({ hevyApiKey: '' })).toBe(false);
    expect(hasHevyApiKey({ hevyApiKey: '   ' })).toBe(false);
  });

  it('is true once a real key is stored', () => {
    expect(hasHevyApiKey({ hevyApiKey: 'abc-123' })).toBe(true);
  });
});
