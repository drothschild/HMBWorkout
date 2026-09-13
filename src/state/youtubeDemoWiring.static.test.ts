/**
 * Structural contract for the exercise-detail-only YouTube demonstration UI.
 *
 * Jest runs in Node and cannot render expo-router or an Expo DOM component, so
 * this reads the native screen and DOM source. The URL parser and repository
 * have behavioural tests; these assertions protect the native/DOM boundary.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = join(__dirname, '..', 'app', 'exercise', '[id].tsx');
const PLAYER = join(__dirname, '..', 'components', 'YouTubeDemo.tsx');

function source(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function compact(path: string): string {
  return source(path).replace(/\s+/g, '');
}

function parenthesizedBody(sourceText: string, marker: string): string {
  const markerAt = sourceText.indexOf(marker);
  if (markerAt === -1) throw new Error(`missing ${marker}`);
  const start = markerAt + marker.length - 1;
  let depth = 0;

  for (let index = start; index < sourceText.length; index++) {
    if (sourceText[index] === '(') depth++;
    if (sourceText[index] === ')') {
      depth--;
      if (depth === 0) return sourceText.slice(start + 1, index);
    }
  }
  throw new Error(`unterminated ${marker}`);
}

describe('exercise YouTube demonstrations (#390)', () => {
  it('keeps playback and editing on the exercise detail screen', () => {
    const screen = compact(APP);

    expect(screen).toContain("importYouTubeDemofrom'@/components/YouTubeDemo';");
    expect(screen).toContain('Watchdemonstration');
    expect(screen).toContain('<YouTubeDemovideoId={youtubeDemo.videoId}');
    expect(screen).toContain('YouTubedemonstrationURL');
    expect(screen).toContain('updateExerciseYouTubeDemoUrl(database,id,youtubeDemoUrl)');
    expect(screen).not.toContain('WebBrowser');
  });

  it('does not contact YouTube until the person explicitly opens the player', () => {
    const screen = compact(APP);

    expect(screen).toContain("typeYouTubeDemoPlayerState='idle'|'loading'|'ready'|'failed';");
    expect(screen).toContain("const[youtubeDemoPlayerState,setYoutubeDemoPlayerState]=useState<YouTubeDemoPlayerState>('idle');");
    expect(screen).toContain('youtubeDemoPlayerState===\'loading\'||youtubeDemoPlayerState===\'ready\'');
    expect(screen).toContain('onPress={openYouTubeDemo}');
    expect(screen).not.toMatch(/cacheEnabled|incognito/);
    expect(parenthesizedBody(screen, 'youtubeDemoPlayerVisible&&(')).toContain(
      '<YouTubeDemovideoId={youtubeDemo.videoId}'
    );
  });

  it('shows compact loading and recoverable failure states using the supported DOM message path', () => {
    const screen = compact(APP);
    const player = source(PLAYER);

    expect(screen).toContain('Loadingdemonstration…');
    expect(screen).toContain("Couldn'tloadtheYouTubedemonstration.Checkyourconnection,thenretryorreplaceitsURL.");
    expect(screen).toContain('Retrydemonstration');
    expect(screen).toContain('onError:handleYouTubeDemoFailure');
    expect(screen).toContain('onMessage:handleYouTubeDemoMessage');
    expect(player).toContain("{ type: 'youtube-demo-status', data: status }");
    expect(player).toContain("postStatus('ready')");
    expect(player).toContain("postStatus('failed')");
  });

  it('waits for the YouTube Player API rather than treating an iframe load as playback readiness', () => {
    const screen = compact(APP);
    const player = source(PLAYER);

    expect(screen).toContain('Dismiss');
    expect(screen).toContain('onPress={dismissYouTubeDemo}');
    expect(screen).toContain('useEffect(()=>()=>clearYouTubeDemoLoadTimer(),[clearYouTubeDemoLoadTimer]);');
    expect(player).toContain('enablejsapi=1');
    expect(player).toContain('window.onYouTubeIframeAPIReady');
    expect(player).toContain('new window.YT.Player');
    expect(player).toContain("onReady: () => postStatus('ready')");
    expect(player).toContain("onError: () => postStatus('failed')");
    expect(player).toContain('player?.destroy()');
    expect(player).not.toContain("onLoad={() => postStatus('ready')}");
  });

  it('replaces a failed IFrame Player API script before a retry mounts another player', () => {
    const player = source(PLAYER);

    expect(player).toContain("script?.dataset.youtubeIframeApiFailed === 'true'");
    expect(player).toContain('script.remove();');
    expect(player).toContain("script.dataset.youtubeIframeApiFailed = 'true';");
  });

  it('uses a sandboxed, lazy, cookie-reduced inline iframe without application download code', () => {
    const player = source(PLAYER);

    expect(player).toContain("'use dom';");
    expect(player).toContain('https://www.youtube-nocookie.com/embed/');
    expect(player).toContain('loading="lazy"');
    expect(player).toContain('sandbox="allow-scripts allow-same-origin allow-presentation"');
    expect(player).toContain('referrerPolicy="strict-origin-when-cross-origin"');
    expect(player).not.toMatch(/expo-file-system|FileSystem|AsyncStorage|cacheDirectory|downloadAsync/);
    expect(player).not.toContain('autoplay=1');
  });
});
