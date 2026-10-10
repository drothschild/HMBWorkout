/**
 * Structural contract for the exercise-detail-only YouTube demonstration UI.
 *
 * Jest runs in Node and cannot render expo-router or a WebView, so this reads
 * the native screen and player source. The URL parser, player protocol and
 * repository have behavioural tests; these assertions protect the wiring.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..');
const APP = join(SRC, 'app', 'exercise', '[id].tsx');
const PLAYER = join(SRC, 'components', 'YouTubeDemo.tsx');

function source(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function compact(path: string): string {
  return source(path).replace(/\s+/g, '');
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe('exercise YouTube demonstrations (#390)', () => {
  it('keeps playback and editing on the exercise detail screen', () => {
    const screen = compact(APP);

    expect(screen).toContain("importYouTubeDemofrom'@/components/YouTubeDemo';");
    expect(screen).toContain('Watchdemonstration');
    expect(screen).toContain('<YouTubeDemovideoId={youtubeDemo.videoId}');
    expect(screen).toContain('YouTubedemonstrationURL');
    expect(screen).toContain('Usethisvideo');
    expect(screen).toContain('EnteravalidHTTPSYouTubevideoURL.');
    expect(screen).toContain('updateExerciseYouTubeDemoUrl(database,id,youtubeDemoUrl)');
    expect(screen).not.toContain('WebBrowser');
  });

  it('does not contact YouTube until the person explicitly opens the player', () => {
    const screen = compact(APP);

    expect(screen).toContain("typeYouTubeDemoPlayerState='idle'|'loading'|'ready'|'failed';");
    expect(screen).toContain("useState<YouTubeDemoPlayerState>('idle')");
    expect(screen).toContain("youtubeDemoPlayerState==='loading'||youtubeDemoPlayerState==='ready'");
    expect(screen).toContain('onPress={openYouTubeDemo}');
    expect(screen).toContain('youtubeDemoPlayerVisible&&');
  });

  it('keeps every new hook above the early return', () => {
    const screen = compact(APP);
    const earlyReturn = screen.indexOf('if(!id||loading){');

    expect(earlyReturn).toBeGreaterThan(-1);
    expect(screen.indexOf("useState<YouTubeDemoPlayerState>('idle')")).toBeLessThan(earlyReturn);
    expect(screen.indexOf('useEffect(()=>()=>clearYouTubeDemoLoadTimer()')).toBeLessThan(earlyReturn);
  });

  it('shows the failure cause and offers Retry and Dismiss that act only on a tap', () => {
    const screen = compact(APP);

    expect(screen).toContain('describeYouTubePlayerFailure(youtubeDemoFailure)');
    expect(screen).toContain("cause:'timeout'");
    expect(screen).toContain('Retrydemonstration');
    expect(screen).toContain('onPress={dismissYouTubeDemo}');
    expect(screen).toContain('console.warn');
    // Changing the saved URL returns the player to the unopened state.
    expect(screen).toContain("setYoutubeDemoPlayerState('idle');");
  });

  it('plays inside react-native-webview with a real https origin and surfaces failure data', () => {
    const player = source(PLAYER);
    const compactPlayer = compact(PLAYER);

    expect(player).not.toContain("'use dom'");
    expect(player).toContain("from 'react-native-webview'");
    expect(compactPlayer).toContain('html:buildYouTubePlayerHtml(videoId)');
    expect(compactPlayer).toContain('baseUrl:YOUTUBE_PLAYER_BASE_URL');
    expect(player).toContain('parseYouTubePlayerMessage');
    expect(player).toContain('onError');
    expect(player).toContain('onHttpError');
    expect(player).toContain('allowsInlineMediaPlayback');
    expect(player).not.toMatch(/expo-file-system|FileSystem|AsyncStorage|cacheDirectory|downloadAsync/);
    expect(player).not.toMatch(/autoplay/i);
  });

  it('declares react-native-webview as a dependency', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8'));
    expect(pkg.dependencies['react-native-webview']).toEqual(expect.any(String));
  });

  it('keeps the video URL out of session, routine, history, export, engine and AI context modules', () => {
    const allowed = new Set(
      [
        'app/exercise/[id].tsx',
        'components/YouTubeDemo.tsx',
        'db/migrations.ts',
        'db/schema.ts',
        'db/models/Exercise.ts',
        'db/repository.ts',
        'domain/youtubeDemoUrl.ts',
        'domain/youtubePlayer.ts',
        'ai/draftSchema.ts',
        'ai/acceptDraft.ts',
        'ai/contextBuilder.ts',
      ].map((p) => p.split('/').join(sep))
    );
    const pattern = /youtubeDemoUrl|youtube_demo_url|YouTubeDemo|youtubePlayer/i;

    const offenders = walk(SRC)
      .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
      .map((path) => relative(SRC, path))
      .filter((rel) => !allowed.has(rel))
      .filter((rel) => pattern.test(readFileSync(join(SRC, rel), 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('lets the AI prompt describe the draft field but never read an exercise row for it', () => {
    const context = readFileSync(join(SRC, 'ai', 'contextBuilder.ts'), 'utf8');

    expect(context).not.toMatch(/youtube_demo_url|\.youtubeDemoUrl/);
  });
});
