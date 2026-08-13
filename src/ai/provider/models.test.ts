import {resolveModels} from './models';

describe('resolveModels', () => {
  it('returns anthropic hardcoded ids when nothing is configured', () => {
    expect(resolveModels('anthropic', undefined)).toStrictEqual({
      chat: 'claude-sonnet-5',
      oneShot: 'claude-sonnet-5',
    });
  });

  it('returns openai hardcoded ids when nothing is configured', () => {
    expect(resolveModels('openai', undefined)).toStrictEqual({
      chat: 'gpt-5.6-sol',
      oneShot: 'gpt-5.6-sol',
    });
  });

  it('ignores a cross-provider id and falls back to the provider default', () => {
    // Cross-provider ids: 'gpt-5.6-sol' is OpenAI, not Anthropic
    expect(resolveModels('anthropic', { chat: 'gpt-5.6-sol', oneShot: 'gpt-5.6-sol' })).toStrictEqual(
      { chat: 'claude-sonnet-5', oneShot: 'claude-sonnet-5' }
    );
  });

  it('falls back per field, not per object', () => {
    // Test fixture adds a second Anthropic id to exercise per-field fallback
    const testChoices = { anthropic: ['claude-sonnet-5', 'claude-haiku'], openai: ['gpt-5.6-sol'] };

    expect(
      resolveModels('anthropic', { chat: 'retired-id', oneShot: 'claude-haiku' }, testChoices)
    ).toStrictEqual({ chat: 'claude-sonnet-5', oneShot: 'claude-haiku' });
  });

  it('returns a listed id unchanged', () => {
    // Test fixture provides a second id so we can verify a non-default choice is returned
    const testChoices = { anthropic: ['claude-sonnet-5', 'claude-haiku'], openai: ['gpt-5.6-sol'] };
    const configured = { chat: 'claude-sonnet-5', oneShot: 'claude-haiku' };
    expect(resolveModels('anthropic', configured, testChoices)).toStrictEqual({
      chat: 'claude-sonnet-5',
      oneShot: 'claude-haiku',
    });
  });

  it('I1: asserts non-default chat value when configured', () => {
    // I1 fix: prior tests only asserted oneShot against non-defaults, never chat.
    // This test pins that both fields are independently configurable and returned.
    const testChoices = { anthropic: ['claude-sonnet-5', 'claude-haiku'], openai: ['gpt-5.6-sol', 'gpt-4o'] };
    const configured = { chat: 'claude-haiku', oneShot: 'claude-sonnet-5' };
    expect(resolveModels('anthropic', configured, testChoices)).toStrictEqual({
      chat: 'claude-haiku',
      oneShot: 'claude-sonnet-5',
    });
  });

  it('does not write settings', () => {
    const configured = { chat: 'gpt-5.6-sol', oneShot: 'gpt-5.6-sol' };
    const before = JSON.stringify(configured);
    resolveModels('anthropic', configured);
    expect(JSON.stringify(configured)).toBe(before);
  });
});
