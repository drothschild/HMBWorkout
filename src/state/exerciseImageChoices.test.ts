import * as webImages from './exerciseWebImages';

type Choice = { url: string; thumbnailUrl: string; title: string; sourceUrl?: string };
const search = (query: string, signal?: AbortSignal, fetcher?: typeof fetch): Promise<readonly Choice[]> => {
  const api = webImages as unknown as { searchExerciseImageChoices?: (query: string, signal?: AbortSignal, fetcher?: typeof fetch) => Promise<readonly Choice[]> };
  expect(typeof api.searchExerciseImageChoices).toBe('function');
  return api.searchExerciseImageChoices!(query, signal, fetcher);
};
const anchor = (data: Record<string, unknown>) => `<a class="iusc" m="${JSON.stringify(data).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></a>`;
const response = (html: string, status = 200) => ({ ok: status === 200, status, text: async () => html }) as Response;
const fetchHtml = (html: string) => jest.fn().mockResolvedValue(response(html)) as jest.MockedFunction<typeof fetch>;

describe('manual exercise image choices', () => {
  afterEach(() => jest.useRealTimers());

  it('uses exact search terms and returns metadata without automatic relevance filtering', async () => {
    const fetcher = fetchHtml(anchor({ murl: 'https://images.example/a.jpg', turl: 'https://thumb.example/a.jpg', purl: 'https://source.example/page', t: 'Unrelated title & detail' }));
    await expect(search('custom + search', undefined, fetcher)).resolves.toEqual([{ url: 'https://images.example/a.jpg', thumbnailUrl: 'https://thumb.example/a.jpg', title: 'Unrelated title & detail', sourceUrl: 'https://source.example/page' }]);
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('q')).toBe('custom + search');
  });

  it('deduplicates HTTPS originals, limits to 24, skips malformed records and falls back safely', async () => {
    const fetcher = fetchHtml('<a class="iusc" m="bad"></a>' + anchor({ murl: 'https://u:p@bad.example/a' }) + anchor({ murl: 'http://bad.example/a' }) + Array.from({ length: 27 }, (_, n) => anchor({ murl: `https://images.example/${n}.jpg`, turl: 'javascript:alert(1)', purl: 'http://source.example', t: '' }) + anchor({ murl: `https://images.example/${n}.jpg` })).join(''));
    const result = await search('anything', undefined, fetcher);
    expect(result).toHaveLength(24);
    expect(result[0]).toEqual({ url: 'https://images.example/0.jpg', thumbnailUrl: 'https://images.example/0.jpg', title: 'images.example' });
    expect(result[23].url).toBe('https://images.example/23.jpg');
  });

  it('rejects credential-bearing thumbnail/source URLs and nonstring titles', async () => {
    const fetcher = fetchHtml(anchor({ murl: 'https://images.example/a', turl: 'https://u:p@thumb.example/a', purl: 'https://u:p@source.example', t: 42 }));
    await expect(search('anything', undefined, fetcher)).resolves.toEqual([{ url: 'https://images.example/a', thumbnailUrl: 'https://images.example/a', title: 'images.example' }]);
  });

  it('does not fetch blank or overlong queries', async () => {
    const fetcher = fetchHtml('');
    await expect(search('  ', undefined, fetcher)).resolves.toEqual([]);
    await expect(search('x'.repeat(201), undefined, fetcher)).rejects.toThrow('200');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['HTTP', response('', 503)],
    ['too large', response('x'.repeat(5_000_001))],
    ['Unrecognized', response('<html>captcha challenge</html>')],
  ])('reports %s as failure rather than an empty search', async (message, res) => {
    const fetcher = jest.fn().mockResolvedValue(res) as typeof fetch;
    await expect(search('query', undefined, fetcher)).rejects.toThrow(String(message));
  });

  it('allows an empty eligible list from recognized records', async () => {
    await expect(search('query', undefined, fetchHtml(anchor({ murl: 'http://images.example/a.jpg' })))).resolves.toEqual([]);
  });

  it('does not fetch an already-aborted request', async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = fetchHtml('');
    await expect(search('query', controller.signal, fetcher)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('forwards external abort and removes its listener and timer', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    let nativeSignal!: AbortSignal;
    const fetcher = jest.fn((_url, options) => new Promise<Response>((_resolve, reject) => {
      nativeSignal = options!.signal as AbortSignal;
      nativeSignal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) as typeof fetch;
    const pending = search('query', controller.signal, fetcher);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    expect(nativeSignal.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(jest.getTimerCount()).toBe(0);
  });

  it('aborts a request at 15 seconds and clears the timer', async () => {
    jest.useFakeTimers();
    let nativeSignal!: AbortSignal;
    const fetcher = jest.fn((_url, options) => new Promise<Response>((_resolve, reject) => {
      nativeSignal = options!.signal as AbortSignal;
      nativeSignal.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch;
    const pending = search('query', undefined, fetcher);
    const rejection = expect(pending).rejects.toThrow('aborted');
    jest.advanceTimersByTime(14_999); expect(nativeSignal.aborted).toBe(false);
    jest.advanceTimersByTime(1); await rejection;
    expect(nativeSignal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cleans listener and timer on success and ignores later abort', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    const fetcher = fetchHtml(anchor({ murl: 'https://images.example/a' }));
    await search('query', controller.signal, fetcher);
    const nativeSignal = fetcher.mock.calls[0][1]!.signal!;
    controller.abort();
    expect(nativeSignal.aborted).toBe(false);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(jest.getTimerCount()).toBe(0);
  });
});
