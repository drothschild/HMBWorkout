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
