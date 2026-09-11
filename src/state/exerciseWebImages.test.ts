import { parseWebImageResults, searchExerciseWebImages } from './exerciseWebImages';

const result = (url: string) => `<a class="iusc" m="${JSON.stringify({murl: url, purl: 'https://example.org/page'}).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">image</a>`;

describe('web exercise image search', () => {
  it('extracts distinct original URLs in result order, decodes entities and caps at five', () => {
    const urls = Array.from({length: 8}, (_, i) => `https://example.org/${i}.jpg?a=1&b=2`);
    expect(parseWebImageResults(result(urls[0]) + urls.map(result).join(''))).toEqual(urls.slice(0, 5));
  });
  it('ignores scripts, thumbnails, malformed metadata and non-https URLs', () => {
    expect(parseWebImageResults('<script>{"murl":"https://bad.org/a.jpg"}</script><a class="iusc" m="broken">' + result('file:///tmp/a') + result('https://good.org/a.png'))).toEqual(['https://good.org/a.png']);
  });
  it('rejects unexpected markup instead of permanently recording a miss', () => {
    expect(() => parseWebImageResults('<html>captcha</html>')).toThrow();
  });
  it('encodes the exercise name, checks HTTP status and supplies cancellation', async () => {
    const fetcher = jest.fn().mockResolvedValue({ok: true, text: async () => result('https://example.org/a.jpg')});
    await expect(searchExerciseWebImages('DB Row & Pull', fetcher)).resolves.toEqual(['https://example.org/a.jpg']);
    const [url, options] = fetcher.mock.calls[0];
    expect(new URL(url).searchParams.get('q')).toBe('DB Row & Pull exercise');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    fetcher.mockResolvedValue({ok: false, status: 429});
    await expect(searchExerciseWebImages('row', fetcher)).rejects.toThrow('429');
  });
});
