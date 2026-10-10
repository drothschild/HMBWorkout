/**
 * #399: App Store privacy documentation stays in step with the source.
 *
 * Structural reads of the source and of docs/app-store/*.md. The things pinned
 * are declarations (which hosts the app can name, what the policy says), not
 * behaviour, so these are file reads rather than runtime tests.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../..');
const SRC = join(__dirname, '..');
const AUDIT = join(ROOT, 'docs/app-store/privacy-audit.md');
const POLICY = join(ROOT, 'docs/app-store/privacy-policy.md');

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.[jt]sx?$/.test(path) || /(^|\/)__tests__\//.test(path);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.[jt]sx?$/.test(name) && !isTestFile(full)) {
      out.push(full);
    }
  }
  return out;
}

/** Drops whole-line comments only; a `//` inside `https://` must survive. */
function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');
}

/**
 * Host literals that are compared against stored data and never fetched, so
 * they are not network destinations and need no audit row.
 */
const NON_NETWORK_HOST_LITERALS = new Set(['iv1.lisimg.com']);

describe('App Store privacy documentation (#399)', () => {
  it('docs/app-store/privacy-audit.md is present on main', () => {
    expect(existsSync(AUDIT)).toBe(true);
  });

  it('every https://<host> literal in non-test src/ files is named in privacy-audit.md', () => {
    const audit = readFileSync(AUDIT, 'utf8');
    const hosts = new Map<string, string>();
    for (const file of sourceFiles(SRC)) {
      const text = stripCommentLines(readFileSync(file, 'utf8'));
      for (const match of text.matchAll(/https:\/\/([A-Za-z0-9][A-Za-z0-9.-]*)/g)) {
        const host = match[1].replace(/\.$/, '');
        if (!hosts.has(host)) hosts.set(host, file.slice(ROOT.length + 1));
      }
    }
    // Guard against a scan that silently finds nothing.
    expect(hosts.size).toBeGreaterThan(0);
    const unaudited = [...hosts]
      .filter(([host]) => !NON_NETWORK_HOST_LITERALS.has(host))
      .filter(([host]) => !audit.includes(host))
      .map(([host, file]) => `${host} (${file})`);
    expect(unaudited).toEqual([]);
  });

  it('privacy-audit.md names the hosts currently expected', () => {
    const audit = readFileSync(AUDIT, 'utf8');
    for (const host of [
      'api.anthropic.com',
      'api.openai.com',
      'api.hevyapp.com',
      'www.bing.com',
      'raw.githubusercontent.com',
    ]) {
      expect(audit).toContain(host);
    }
  });

  it('privacy-policy.md names Anthropic, OpenAI and Hevy and states photos and selfies are not sent to AI providers', () => {
    const policy = readFileSync(POLICY, 'utf8');
    expect(policy).toContain('Anthropic');
    expect(policy).toContain('OpenAI');
    expect(policy).toContain('Hevy');
    expect(policy).toContain('Photos and selfies are not sent to AI providers.');
  });

  it('no module under src/ai/ builds an image content part (no base64, image_url or input_image in non-test source)', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(SRC, 'ai'))) {
      const text = stripCommentLines(readFileSync(file, 'utf8'));
      if (/base64|image_url|input_image/i.test(text)) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});
