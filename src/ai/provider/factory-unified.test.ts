/**
 * Test the unified AiClient interface that supports all four surfaces:
 * - chat: structured JSON output (AiTurn)
 * - comment: prose one-shot for rest screen
 * - suggest: structured JSON output for exercise alternatives
 * - ask: prose one-shot for exercise question
 *
 * This test verifies Phase 3's widened interface before implementation.
 */

import { createAiClient } from './factory';
import type { ProviderConfig } from './types';

describe('Unified AiClient supporting all surfaces', () => {
  it('anthropic provider creates client with all four methods', () => {
    const config: ProviderConfig = {
      anthropicKey: 'test-key',
    };

    const client = createAiClient(config);

    expect(typeof client.chat).toBe('function');
    expect(typeof client.comment).toBe('function');
    expect(typeof client.suggest).toBe('function');
    expect(typeof client.ask).toBe('function');
  });

  it('openai provider creates client with all four methods', () => {
    const config: ProviderConfig = {
      openaiKey: 'test-key',
    };

    const client = createAiClient(config);

    expect(typeof client.chat).toBe('function');
    expect(typeof client.comment).toBe('function');
    expect(typeof client.suggest).toBe('function');
    expect(typeof client.ask).toBe('function');
  });
});
