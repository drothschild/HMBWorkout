/**
 * #335 live proof: real models answer the catalog-pick prompt in a shape
 * `parseCatalogPick` trusts. SKIPPED unless a key is supplied at run time:
 *
 *   HMB_LIVE_ANTHROPIC_KEY=<anthropic-key> HMB_LIVE_OPENAI_KEY=<openai-key> \
 *     npx jest src/ai/catalogPickPrompt.live.test.ts
 *
 * Why this exists at all: every AI failure in the resolver is swallowed, and
 * an untrusted reply quietly falls back to the score rule. A model that always
 * wraps its answer (quotes, backticks, "The answer is …") would degrade the
 * feature to no-key quality with no error anywhere. Unit tests can pin the
 * prompt's wording; only a live call proves a model follows it.
 *
 * Never put a key in this file. If a reply does not parse, do not loosen
 * `parseCatalogPick` silently — record the raw reply (logged below) and decide
 * between tightening the prompt and a deliberate, tested normalization.
 */
import { EXERCISE_CATALOG } from '@/state/exerciseCatalog';
import { createCatalogMatcher } from '@/state/exerciseImageMatch';
import { buildCatalogPickPrompt, parseCatalogPick, type CatalogPick } from './catalogPickPrompt';
import { IMMUTABLE_DIRECTIVES } from './coachDirectives';
import { createAiClient } from './provider/factory';
import type { AiClient, ProviderConfig } from './provider/types';

const anthropicKey = process.env.HMB_LIVE_ANTHROPIC_KEY;
const openaiKey = process.env.HMB_LIVE_OPENAI_KEY;
const liveAnthropic = anthropicKey ? it : it.skip;
const liveOpenai = openaiKey ? it : it.skip;

const LIVE_TIMEOUT_MS = 60_000;

const matcher = createCatalogMatcher(EXERCISE_CATALOG);

async function pick(client: AiClient, label: string, title: string): Promise<CatalogPick> {
  const candidates = matcher.shortlist(title).map((hit) => hit.entry);
  // Precondition, not the claim under test: an empty shortlist never reaches ask.
  expect(candidates.length).toBeGreaterThan(0);

  const reply = await client.ask(
    buildCatalogPickPrompt({ title, candidates, directives: IMMUTABLE_DIRECTIVES })
  );
  console.log(`[${label}] ${title} -> raw reply: ${JSON.stringify(reply)}`);
  return parseCatalogPick(
    reply,
    candidates.map((entry) => entry.id)
  );
}

async function assertBothPicks(config: ProviderConfig, label: string): Promise<void> {
  const client = createAiClient(config);

  const romanian = await pick(client, label, 'Romanian Deadlift');
  expect(romanian).toStrictEqual({ kind: 'id', id: 'Romanian_Deadlift' });

  // The shortlist holds no couch stretch, so NONE is the right answer. An id
  // is a wrong-image risk worth noting in the PR, but it still PARSED; only
  // 'untrusted' means the reply shape is broken.
  const couch = await pick(client, label, 'Couch Stretch');
  if (couch.kind === 'id') {
    console.log(`[${label}] Couch Stretch picked ${couch.id} — wrong-image risk, not a parse failure`);
  }
  expect(couch.kind).not.toBe('untrusted');
}

describe('catalog pick, live (#335)', () => {
  liveAnthropic(
    'Anthropic replies parse',
    () => assertBothPicks({ anthropicKey, aiProvider: 'anthropic' }, 'anthropic'),
    LIVE_TIMEOUT_MS
  );

  liveOpenai(
    'OpenAI replies parse',
    () => assertBothPicks({ openaiKey, aiProvider: 'openai' }, 'openai'),
    LIVE_TIMEOUT_MS
  );
});
