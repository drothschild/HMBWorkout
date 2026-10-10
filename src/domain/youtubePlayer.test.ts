import {
  YOUTUBE_PLAYER_BASE_URL,
  buildYouTubePlayerHtml,
  describeYouTubePlayerFailure,
  parseYouTubePlayerMessage,
  youtubePlayerErrorReason,
} from './youtubePlayer';

describe('youtubePlayerErrorReason (#390 failure reporting)', () => {
  it.each([
    [2, 'invalid-parameter'],
    [5, 'html5-player-error'],
    [100, 'video-not-found'],
    [101, 'embedding-disabled'],
    [150, 'embedding-disabled'],
    [153, 'missing-embedder-identity'],
  ])('maps Player API error code %s to %s', (code, reason) => {
    expect(youtubePlayerErrorReason(code)).toBe(reason);
  });

  it('maps an unrecognized code to unknown', () => {
    expect(youtubePlayerErrorReason(999)).toBe('unknown');
  });
});

describe('describeYouTubePlayerFailure', () => {
  it('names the numeric code and reason for a Player API error', () => {
    const text = describeYouTubePlayerFailure({ cause: 'player-error', code: 153 });
    expect(text).toContain('153');
    expect(text).toContain('Player API error');
  });

  it('distinguishes an API script failure from a Player API error and a timeout', () => {
    const script = describeYouTubePlayerFailure({ cause: 'api-script-failed' });
    const timeout = describeYouTubePlayerFailure({ cause: 'timeout' });
    const player = describeYouTubePlayerFailure({ cause: 'player-error', code: 2 });

    expect(script).toContain('API script');
    expect(timeout).toContain('ready signal');
    expect(new Set([script, timeout, player]).size).toBe(3);
  });
});

describe('parseYouTubePlayerMessage', () => {
  it('reads the ready signal', () => {
    expect(parseYouTubePlayerMessage(JSON.stringify({ type: 'youtube-demo', status: 'ready' }))).toEqual({
      kind: 'ready',
    });
  });

  it('keeps the numeric Player API code instead of discarding it', () => {
    const raw = JSON.stringify({ type: 'youtube-demo', status: 'error', code: 101 });
    expect(parseYouTubePlayerMessage(raw)).toEqual({
      kind: 'failed',
      failure: { cause: 'player-error', code: 101 },
    });
  });

  it('reads an API script failure', () => {
    const raw = JSON.stringify({ type: 'youtube-demo', status: 'script-error' });
    expect(parseYouTubePlayerMessage(raw)).toEqual({
      kind: 'failed',
      failure: { cause: 'api-script-failed' },
    });
  });

  it.each(['not json', '{}', JSON.stringify({ type: 'other', status: 'ready' }), JSON.stringify({ type: 'youtube-demo', status: 'error' })])(
    'ignores a message outside the protocol: %s',
    (raw) => {
      expect(parseYouTubePlayerMessage(raw)).toBeNull();
    }
  );
});

describe('buildYouTubePlayerHtml', () => {
  const html = buildYouTubePlayerHtml('dQw4w9WgXcQ');

  it('serves the player from a real https origin so YouTube receives a referrer', () => {
    expect(YOUTUBE_PLAYER_BASE_URL).toBe('https://www.youtube.com');
  });

  it('loads the IFrame Player API and reports script failure, readiness and error codes', () => {
    expect(html).toContain('https://www.youtube.com/iframe_api');
    expect(html).toContain('"dQw4w9WgXcQ"');
    expect(html).toContain('ReactNativeWebView.postMessage');
    expect(html).toContain("status: 'ready'");
    expect(html).toContain("status: 'script-error'");
    expect(html).toContain('code: event.data');
  });

  it('does not autoplay', () => {
    expect(html).not.toMatch(/autoplay/i);
  });

  it('refuses a value that is not an 11 character video id', () => {
    expect(() => buildYouTubePlayerHtml('"><script>alert(1)</script>')).toThrow();
  });
});
