// pattern: Imperative Shell
/** Public search HTML is not an API. Unexpected markup rejects so it cannot
 * permanently mark an exercise missing; callers retain their existing images. */
const MAX_CANDIDATES = 5;
const SEARCH_TIMEOUT_MS = 15_000;

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

export function parseWebImageResults(html: string): string[] {
  const urls: string[] = [];
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
      recognized = true;
      const url = new URL(data.murl);
      if (url.protocol !== 'https:' || url.username || url.password || urls.includes(url.href)) continue;
      urls.push(url.href);
      if (urls.length === MAX_CANDIDATES) break;
    } catch {
      // One malformed result must not hide later valid results.
    }
  }
  if (!recognized) throw new Error('Unrecognized image search response');
  return urls;
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
    return parseWebImageResults(html);
  } finally {
    clearTimeout(timer);
  }
}
