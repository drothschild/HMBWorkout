// pattern: Imperative Shell
/** Public search HTML is not an API. Unexpected markup rejects so it cannot
 * permanently mark an exercise missing; callers retain their existing images. */
import { normalizeExerciseTitle } from './exerciseImageMatch';

const MAX_CANDIDATES = 5;
const SEARCH_TIMEOUT_MS = 15_000;
const TITLE_STOP_WORDS = new Set(['a', 'an', 'and', 'at', 'for', 'from', 'in', 'of', 'on', 'the', 'to', 'with', 'without']);

type WebImageCandidate = {
  readonly url: string;
  readonly evidence: string;
};

function decodeAttribute(value: string): string {
  return value.replace(/&(?:quot|amp|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const named: Record<string, string> = { '&quot;': '"', '&amp;': '&', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    const lower = entity.toLowerCase();
    if (named[lower]) return named[lower];
    const hex = lower.startsWith('&#x');
    const point = parseInt(lower.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

function parseCandidates(html: string): WebImageCandidate[] {
  const candidates: WebImageCandidate[] = [];
  let recognized = false;
  for (const anchor of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = anchor[0];
    const classes = /\bclass\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2].split(/\s+/) ?? [];
    if (!classes.includes('iusc')) continue;
    const metadata = /\bm\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2];
    if (!metadata) continue;
    try {
      const data: unknown = JSON.parse(decodeAttribute(metadata));
      if (!data || typeof data !== 'object' || !('murl' in data) || typeof data.murl !== 'string') continue;
      const url = new URL(data.murl);
      recognized = true;
      if (url.protocol !== 'https:' || url.username || url.password || candidates.some(candidate => candidate.url === url.href)) continue;
      const fields = data as Record<string, unknown>;
      const evidence = ['murl', 'purl', 't', 'desc']
        .map(field => typeof fields[field] === 'string' ? fields[field] as string : '')
        .join(' ');
      candidates.push({ url: url.href, evidence });
    } catch {
      // One malformed result must not hide later valid results.
    }
  }
  if (!recognized) throw new Error('Unrecognized image search response');
  return candidates;
}

export function parseWebImageResults(html: string): string[] {
  return parseCandidates(html).slice(0, MAX_CANDIDATES).map(candidate => candidate.url);
}

function meaningfulTokens(value: string): string[] {
  return normalizeExerciseTitle(value)
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 0 && !TITLE_STOP_WORDS.has(token));
}

function isRelevant(title: string, candidate: WebImageCandidate): boolean {
  const titleTokens = meaningfulTokens(title);
  const evidenceTokens = new Set(meaningfulTokens(candidate.evidence));
  return titleTokens.length > 0 && titleTokens.every(token => evidenceTokens.has(token));
}

export async function searchExerciseWebImages(
  title: string,
  fetcher: typeof fetch = fetch
): Promise<readonly string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(`${title} exercise`)}&first=1`;
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Image search HTTP ${response.status}`);
    const html = await response.text();
    if (html.length > 5_000_000) throw new Error('Image search response too large');
    return parseCandidates(html)
      .filter(candidate => isRelevant(title, candidate))
      .slice(0, MAX_CANDIDATES)
      .map(candidate => candidate.url);
  } finally {
    clearTimeout(timer);
  }
}
