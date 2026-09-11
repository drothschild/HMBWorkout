/**
 * Catalog-pick prompt (#335): the fifth builder under the directives-last
 * rule. The model chooses ONE id from a fixed shortlist, or NONE — it never
 * supplies an image URL. Sent through the existing `AiClient.ask` (the
 * exercise-question surface's fixed request contract and budget), so this is a
 * prompt builder, not a new AI surface. `ask` returns free text, so the reply's
 * shape is enforced here by `parseCatalogPick`, not by structured output.
 *
 * Carries data, never secrets: it is handed a title, catalog entries and the
 * directives string, and has no access to any key.
 */
import type { CatalogEntry } from '@/state/exerciseCatalog';
import { neutralizeForPrompt } from './neutralizeForPrompt';

export const CATALOG_PICK_NONE = 'NONE';

export type CatalogPickPromptInput = {
  readonly title: string;
  readonly candidates: readonly CatalogEntry[];
  /** `IMMUTABLE_DIRECTIVES` from `src/ai/coachDirectives.ts`. */
  readonly directives?: string;
};

export type CatalogPickPrompt = { readonly system: string; readonly message: string };

export type CatalogPick =
  | { readonly kind: 'id'; readonly id: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'untrusted' };

export function buildCatalogPickPrompt(input: CatalogPickPromptInput): CatalogPickPrompt {
  const directives = input.directives?.trim();
  const sections = [
    `You match an exercise from a workout app to the closest entry in a fixed exercise catalog, so the app can show that entry's photo.

Reply with EXACTLY one candidate id from the next message, copied character for character, or the single word ${CATALOG_PICK_NONE}.

Rules:
- Your whole reply is the id or ${CATALOG_PICK_NONE}. No other words, punctuation, quotes, or formatting.
- Choose a candidate only if its photo would correctly show the exercise named in the next message. A different movement is wrong even if it shares a word.
- If no candidate is a correct match, reply ${CATALOG_PICK_NONE}.`,
  ];
  if (directives) {
    sections.push(`## Coaching Directives\n\n${neutralizeForPrompt(directives)}`);
  }

  const candidateLines = input.candidates.map(
    (entry) =>
      `- ${entry.id}: ${neutralizeForPrompt(entry.name)} (${entry.equipment ?? 'no equipment'})`
  );
  const message = `## Exercise\n\n${neutralizeForPrompt(input.title)}\n\n## Candidates\n\n${candidateLines.join('\n')}`;

  return { system: sections.join('\n\n'), message };
}

/**
 * Trusted only if the reply, trimmed, is exactly one candidate id or exactly
 * NONE. Anything else — an id outside the shortlist, an id inside prose, an
 * empty reply — is 'untrusted', and the caller falls back to the score rule.
 */
export function parseCatalogPick(reply: string, candidateIds: readonly string[]): CatalogPick {
  const trimmed = reply.trim();
  if (trimmed === CATALOG_PICK_NONE) return { kind: 'none' };
  if (candidateIds.includes(trimmed)) return { kind: 'id', id: trimmed };
  return { kind: 'untrusted' };
}
