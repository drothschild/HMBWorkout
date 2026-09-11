import { parseWebImageResults, searchExerciseWebImages } from './exerciseWebImages';

const result = (
  url: string,
  metadata: { purl?: string; t?: string; desc?: string } = {},
  anchorLabel = ''
) => `<a aria-label="${anchorLabel}" class="iusc" m="${JSON.stringify({
  murl: url,
  purl: metadata.purl ?? 'https://example.org/page',
  t: metadata.t,
  desc: metadata.desc,
}).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">image</a>`;

describe('web exercise image search', () => {
  it('extracts distinct original URLs in result order, decodes entities and caps at five', () => {
    const urls = Array.from({length: 8}, (_, i) => `https://example.org/${i}.jpg?a=1&b=2`);
    expect(parseWebImageResults(result(urls[0]) + urls.map((url) => result(url)).join(''))).toEqual(urls.slice(0, 5));
  });
  it('ignores scripts, thumbnails, malformed metadata and non-https URLs', () => {
    expect(parseWebImageResults('<script>{"murl":"https://bad.org/a.jpg"}</script><a class="iusc" m="broken">' + result('file:///tmp/a') + result('https://good.org/a.png'))).toEqual(['https://good.org/a.png']);
  });
  it('rejects malformed URLs instead of recording a permanent miss', () => {
    expect(() => parseWebImageResults(result('not a URL'))).toThrow();
  });
  it('rejects unexpected markup instead of permanently recording a miss', () => {
    expect(() => parseWebImageResults('<html>captcha</html>')).toThrow();
  });
  it('encodes the exercise name, checks HTTP status and supplies cancellation', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => result('https://example.org/a.jpg', { t: 'DB Row and Pull exercise' }),
    });
    await expect(searchExerciseWebImages('DB Row & Pull', fetcher)).resolves.toEqual(['https://example.org/a.jpg']);
    const [url, options] = fetcher.mock.calls[0];
    expect(new URL(url).searchParams.get('q')).toBe('DB Row & Pull exercise');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    fetcher.mockResolvedValue({ok: false, status: 429});
    await expect(searchExerciseWebImages('row', fetcher)).rejects.toThrow('429');
  });

  it('rejects an unrelated portrait despite query text in anchor markup and keeps a later relevant result', async () => {
    const portrait = 'https://iv1.lisimg.com/image/14503880/740full-lauren-de-graaf.jpg';
    const relevant = 'https://cdn.example.org/assets/opaque-123.jpg';
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        result(
          portrait,
          {
            purl: 'https://www.famousfix.com/topic/lauren-de-graaf',
            t: 'Lauren de Graaf portrait',
            desc: 'Fashion model headshot',
          },
          'Image result for dumbbell glute bridge exercise'
        ) +
        result(relevant, {
          purl: 'https://training.example.org/dumbbell-glute-bridge',
          t: 'Dumbbell Glute Bridge',
          desc: 'Dumbbell glute bridge exercise demonstration',
        }),
    });

    await expect(searchExerciseWebImages('dumbbell-glute-bridge', fetcher)).resolves.toEqual([relevant]);
  });

  it('requires equipment and variant tokens instead of accepting a generic movement result', async () => {
    const generic = 'https://example.org/glute-bridge.jpg';
    const exact = 'https://example.org/dumbbell-glute-bridge.jpg';
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        result(generic, { t: 'Glute Bridge Exercise', desc: 'How to perform a glute bridge' }) +
        result(exact, { t: 'Dumbbell Glute Bridge Exercise', desc: 'Weighted glute bridge with a dumbbell' }),
    });

    await expect(searchExerciseWebImages('Dumbbell Glute Bridge', fetcher)).resolves.toEqual([exact]);
  });

  it('preserves relevant result order and caps after relevance filtering', async () => {
    const relevant = Array.from({ length: 6 }, (_, index) =>
      result(`https://example.org/relevant-${index}.jpg`, { t: `Dumbbell Glute Bridge ${index}` })
    );
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        result('https://example.org/unrelated.jpg', { t: 'Generic Glute Bridge' }) + relevant.join(''),
    });

    await expect(searchExerciseWebImages('Dumbbell Glute Bridge', fetcher)).resolves.toEqual(
      Array.from({ length: 5 }, (_, index) => `https://example.org/relevant-${index}.jpg`)
    );
  });
});
