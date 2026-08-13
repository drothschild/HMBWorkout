/**
 * Every user-visible chat error string.
 *
 * These lived in a switch inside `src/app/ai-coach.tsx`, which no jest project
 * can load. Here they are testable — including the assertion that none of them
 * can carry key material.
 *
 * The parameter type is the AiChatError union, which has no key field, so a
 * leak is impossible by construction rather than by filtering.
 */

import type { AiChatError } from '@/state/aiChatStore';
import { PROVIDER_LABEL } from '@/state/aiProviderSettings';

export function aiChatErrorMessage(error: AiChatError): string {
  const name = error.provider ? PROVIDER_LABEL[error.provider] : null;

  switch (error.kind) {
    case 'missing_key':
      return name
        ? `Add your ${name} API key in Settings to use the AI Coach`
        : 'Add an AI provider API key in Settings to use the AI Coach';
    case 'unauthorized':
      return name
        ? `${name} rejected your API key — check Settings`
        : 'API key rejected — check Settings';
    case 'network':
      return name
        ? `Couldn't reach ${name}. Check your connection.`
        : "Couldn't reach the AI service. Check your connection.";
    case 'http':
      return name
        ? `${name} returned an error (${error.status}). Try again.`
        : `The AI service returned an error (${error.status}). Try again.`;
    case 'parse':
      return name
        ? `Got an unreadable response from ${name}. Try again.`
        : 'Got an unreadable response. Try again.';
    case 'unknown':
      return 'Something went wrong. Try again.';
  }
}

/**
 * Whether the error bubble offers a Retry button.
 *
 * Lives here, beside the copy, for the same reason the copy moved out of the
 * screen: this is a per-kind decision and `src/app` has no jest coverage.
 *
 * Written as an exhaustive switch rather than `error.kind !== 'missing_key'`
 * so that adding a seventh `AiChatError` kind is a **TS2366 compile error**
 * here (strict mode, no `default` arm) instead of that kind silently
 * inheriting a Retry button. The screen used to carry the negation *plus* a
 * `const _exhaustive: never`; the Phase 4 move kept the negation and dropped
 * the guard, which is issue #248.
 *
 * `missing_key` is the only kind Retry cannot help: there is nothing to retry
 * until a key exists, which is why that bubble offers the Settings link instead.
 */
export function aiChatErrorAllowsRetry(error: AiChatError): boolean {
  switch (error.kind) {
    case 'missing_key':
      return false;
    case 'unauthorized':
    case 'network':
    case 'http':
    case 'parse':
    case 'unknown':
      return true;
  }
}
