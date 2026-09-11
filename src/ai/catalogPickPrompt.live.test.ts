/**
 * #335 live proof: real models answer the catalog-pick prompt in a shape
 * `parseCatalogPick` trusts. SKIPPED unless a key is supplied at run time:
 *
 *   HMB_LIVE_ANTHROPIC_KEY=<anthropic-key> HMB_LIVE_OPENAI_KEY=<openai-key> \
 *     npx jest src/ai/catalogPickPrompt.live.test.ts
 *
 * That probes each provider's DEFAULT oneShot model. To probe a specific id —
 * required before a new id joins `AI_MODEL_CHOICES` (see AGENTS.md, AI Coach) —
 * add the optional `HMB_LIVE_MODEL`, with only the key of the provider that
 * owns the id:
 *
 *   HMB_LIVE_OPENAI_KEY=<openai-key> HMB_LIVE_MODEL=<model-id> \
 *     npx jest src/ai/catalogPickPrompt.live.test.ts
 *
 * `HMB_LIVE_MODEL` goes through the same `aiModel` setting the app uses, and
 * `resolveModels` SILENTLY IGNORES an id that is not on that provider's
 * `AI_MODEL_CHOICES` list, falling back to the default. An off-list id would
 * therefore probe the default while looking like a probe of the new id, so the
 * test fails instead: add the id to the list first, then run this. Every log
 * line names the model actually used, as `<provider>/<model>`.
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
import { resolveModels } from './provider/models';
import type { AiClient, AiProvider, ProviderConfig } from './provider/types';

const anthropicKey = process.env.HMB_LIVE_ANTHROPIC_KEY;
const openaiKey = process.env.HMB_LIVE_OPENAI_KEY;
const liveModel = process.env.HMB_LIVE_MODEL;
const liveAnthropic = anthropicKey ? it : it.skip;
const liveOpenai = openaiKey ? it : it.skip;

const LIVE_TIMEOUT_MS = 60_000;

const matcher = createCatalogMatcher(EXERCISE_CATALOG);

/**
 * Without `HMB_LIVE_MODEL` the config is returned untouched, so the default run
 * is exactly the provider-default probe. With it, the id is set on both fields
 * of `AiModelConfig` (the type requires both); only `oneShot` reaches `ask`.
 */
function withLiveModel(config: ProviderConfig): ProviderConfig {
  return liveModel ? { ...config, aiModel: { chat: liveModel, oneShot: liveModel } } : config;
}

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

async function assertBothPicks(baseConfig: ProviderConfig, provider: AiProvider): Promise<void> {
  const config = withLiveModel(baseConfig);
  // The same resolution createAiClient performs, so the label is the model the
  // call really goes to.
  const modelUsed = resolveModels(provider, config.aiModel).oneShot;
  if (liveModel && modelUsed !== liveModel) {
    throw new Error(
      `HMB_LIVE_MODEL=${liveModel} is not on AI_MODEL_CHOICES.${provider}; resolveModels would silently ` +
        `probe ${modelUsed} instead. Add the id to the list first, then run this test.`
    );
  }
  const label = `${provider}/${modelUsed}`;
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
