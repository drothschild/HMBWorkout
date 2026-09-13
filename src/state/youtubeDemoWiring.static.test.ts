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

    expect(screen).toContain('showYouTubeDemo&&youtubeDemo&&(');
    expect(screen).toContain('onPress={()=>setShowYouTubeDemo(true)}');
  });

  it('uses a sandboxed, lazy, cookie-reduced inline iframe without local caching', () => {
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
