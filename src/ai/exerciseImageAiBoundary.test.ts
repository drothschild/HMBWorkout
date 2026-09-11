/**
 * #335 AC5.3: exercise images add a prompt builder, not an AI surface.
 *
 * The catalog pick rides the existing `AiClient.ask` — the exercise-question
 * surface, with its fixed request contract and budget. A new client method, a
 * new model field, or a resolver dep with a different shape would each be a
 * new surface, and every surface here costs one live probe per model id
 * (AGENTS.md, "The model list is constrained"). These are structural reads of
 * the source, because the thing being pinned is a declaration, not behaviour.
 *
 * `AI_MODEL_CHOICES` itself is value-pinned by `provider/models.test.ts`; that
 * pin is not duplicated here.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

function read(relative: string): string {
  return readFileSync(join(SRC, relative), 'utf8');
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** The text between the brace at `openIndex` and its matching close. */
function braceBody(source: string, openIndex: number, what: string): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  throw new Error(`unbalanced braces in ${what}; re-anchor this gate`);
}

/** Member names declared directly in a type body — nested parameter types excluded. */
function topLevelMemberNames(body: string): string[] {
  let depth = 0;
  let topLevel = '';
  for (const ch of body) {
    if (depth === 0) topLevel += ch;
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
  }
  return topLevel
    .split(/[;,\n]/)
    .map((statement) => /^\s*(?:readonly\s+)?(\w+)\??\s*(?:<[^>]*>)?\s*[(:]/.exec(statement))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1]);
}

/** One member's declaration, `name: …` up to its terminating `;` at depth 0. */
function memberDeclaration(body: string, name: string, what: string): string {
  const match = new RegExp(`\\b${name}\\s*:`).exec(body);
  if (!match) throw new Error(`${what} has no \`${name}:\` member; re-anchor this gate`);
  let depth = 0;
  for (let i = match.index; i < body.length; i++) {
    const ch = body[i];
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    else if (ch === ';' && depth === 0) return body.slice(match.index, i);
  }
  throw new Error(`unterminated \`${name}\` member in ${what}; re-anchor this gate`);
}

const normalize = (s: string) => s.replace(/\breadonly\b/g, '').replace(/\s+/g, '');

describe('exercise images add no AI surface (#335 AC5.3)', () => {
  it('AiClient declares exactly chat, comment, suggest and ask', () => {
    const source = stripComments(read('ai/provider/types.ts'));
    const anchor = /export\s+(?:interface\s+AiClient|type\s+AiClient\s*=)\s*\{/.exec(source);
    if (!anchor) throw new Error('AiClient declaration not found in provider/types.ts; re-anchor this gate');

    const body = braceBody(source, anchor.index + anchor[0].length - 1, 'AiClient');
    const members = topLevelMemberNames(body);

    expect(members).toHaveLength(new Set(members).size);
    expect(new Set(members)).toStrictEqual(new Set(['chat', 'comment', 'suggest', 'ask']));
  });

  it('catalogPickPrompt.ts touches no model-selection symbol', () => {
    const source = read('ai/catalogPickPrompt.ts');
    if (!/export function buildCatalogPickPrompt\b/.test(source)) {
      throw new Error('catalogPickPrompt.ts no longer exports buildCatalogPickPrompt; re-anchor this gate');
    }
    for (const symbol of ['AI_MODEL_CHOICES', 'resolveModels', 'AiModelConfig']) {
      expect(source).not.toMatch(new RegExp(`\\b${symbol}\\b`));
    }
  });

  it("the resolver's ask dep is the existing AiClient.ask shape, nothing wider", () => {
    const source = stripComments(read('state/exerciseImageResolver.ts'));
    const anchor = /export\s+type\s+ExerciseImageResolverDeps\s*=\s*\{/.exec(source);
    if (!anchor) {
      throw new Error('ExerciseImageResolverDeps not found in exerciseImageResolver.ts; re-anchor this gate');
    }
    const body = braceBody(source, anchor.index + anchor[0].length - 1, 'ExerciseImageResolverDeps');

    expect(normalize(memberDeclaration(body, 'ask', 'ExerciseImageResolverDeps'))).toBe(
      'ask:(request:{system:string;message:string})=>Promise<string>'
    );
  });
});
