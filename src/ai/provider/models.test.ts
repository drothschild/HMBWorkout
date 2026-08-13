import {resolveModels, AI_MODEL_CHOICES} from './models';

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

  // Only possible now that AI_MODEL_CHOICES holds a real second id per provider
  // (#245). Before that, every listed id WAS the default, so "returns the
  // configured id" and "returns the fallback" produced identical output and no
  // fixture could tell them apart.
  it('returns a genuinely listed non-default id unchanged', () => {
    expect(resolveModels('anthropic', { chat: 'claude-opus-5', oneShot: 'claude-opus-5' })).toStrictEqual(
      { chat: 'claude-opus-5', oneShot: 'claude-opus-5' }
    );
    expect(resolveModels('openai', { chat: 'gpt-5.6-luna', oneShot: 'gpt-5.4-mini' })).toStrictEqual(
      { chat: 'gpt-5.6-luna', oneShot: 'gpt-5.4-mini' }
    );
  });

  // Binds the DEFAULT `choices` argument to AI_MODEL_CHOICES. Called without a
  // third argument, so an implementation defaulting to an empty allow-list (or
  // to anything other than the real constant) falls back and fails here.
  // Untestable while each list held one id equal to the default.
  it('defaults its allow-list to AI_MODEL_CHOICES', () => {
    expect(resolveModels('anthropic', { chat: 'claude-opus-5', oneShot: 'claude-sonnet-5' }).chat).toBe(
      'claude-opus-5'
    );
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

describe('AI_MODEL_CHOICES', () => {
  it('pins the list of model ids - any addition requires a live call per surface and a deliberate test edit', () => {
    // Phase 6 Task 1: every id added here requires:
    // 1. A live GET /v1/models call on both providers
    // 2. One live call PER SURFACE (4 surfaces × 2 providers = 8 calls)
    // 3. Each surface must return rendered, non-empty text (not status: 'ok' with empty body)
    // 4. Results recorded in the PR with max_output_tokens, status, and first line of output
    //
    // This test fails if an id is added without updating this assertion, ensuring
    // the constraint is remembered and enforced.
    expect(AI_MODEL_CHOICES).toStrictEqual({
      anthropic: ['claude-sonnet-5', 'claude-opus-5'],
      openai: ['gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.4-mini'],
    });
  });
});
