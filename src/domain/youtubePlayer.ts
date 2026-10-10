// Pure pieces of the inline YouTube demonstration player (#390): the page the
// WebView renders, the status protocol it speaks, and the failure vocabulary the
// detail screen reports. Imports nothing, like the rest of src/domain.

/**
 * The WebView loads the player page with this origin as its base URL. YouTube
 * refuses an embed that has no web origin/referrer (Player API error 153), and
 * a page served from file:// or a null origin provides none.
 */
export const YOUTUBE_PLAYER_BASE_URL = 'https://www.youtube.com';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MESSAGE_TYPE = 'youtube-demo';

export type YouTubePlayerFailure =
  | { readonly cause: 'api-script-failed' }
  | { readonly cause: 'player-error'; readonly code: number }
  | { readonly cause: 'timeout' }
  | { readonly cause: 'webview-error'; readonly detail?: string };

export type YouTubePlayerMessage =
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly failure: YouTubePlayerFailure };

/** What a YouTube IFrame Player API `onError` code means. */
export function youtubePlayerErrorReason(code: number): string {
  switch (code) {
    case 2:
      return 'invalid-parameter';
    case 5:
      return 'html5-player-error';
    case 100:
      return 'video-not-found';
    case 101:
    case 150:
      return 'embedding-disabled';
    case 153:
      return 'missing-embedder-identity';
    default:
      return 'unknown';
  }
}

const REASON_TEXT: Record<string, string> = {
  'invalid-parameter': 'the video ID or player parameter is invalid',
  'html5-player-error': 'the HTML5 player hit an error',
  'video-not-found': 'the video was not found or is private',
  'embedding-disabled': 'the video owner does not allow embedded playback',
  'missing-embedder-identity': 'YouTube received no web origin or referrer for the player',
  unknown: 'YouTube did not say why',
};

export function describeYouTubePlayerFailure(failure: YouTubePlayerFailure): string {
  switch (failure.cause) {
    case 'api-script-failed':
      return 'The YouTube API script failed to load.';
    case 'player-error': {
      const reason = REASON_TEXT[youtubePlayerErrorReason(failure.code)];
      return `Player API error ${failure.code}: ${reason}.`;
    }
    case 'timeout':
      return 'The player gave no ready signal within the time limit.';
    case 'webview-error':
      return failure.detail ? `The player page failed to load (${failure.detail}).` : 'The player page failed to load.';
  }
}

/** Reads one WebView message from the player page; null for anything else. */
export function parseYouTubePlayerMessage(raw: string): YouTubePlayerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const message = value as { type?: unknown; status?: unknown; code?: unknown };
  if (message.type !== MESSAGE_TYPE) return null;

  if (message.status === 'ready') return { kind: 'ready' };
  if (message.status === 'script-error') {
    return { kind: 'failed', failure: { cause: 'api-script-failed' } };
  }
  if (message.status === 'error' && typeof message.code === 'number' && Number.isFinite(message.code)) {
    return { kind: 'failed', failure: { cause: 'player-error', code: message.code } };
  }
  return null;
}

/**
 * The HTML document for the WebView. It loads the IFrame Player API on demand
 * and reports readiness, API script failure and the Player API error code over
 * the React Native WebView bridge. It never autoplays.
 */
export function buildYouTubePlayerHtml(videoId: string): string {
  if (!VIDEO_ID.test(videoId)) {
    throw new Error('buildYouTubePlayerHtml: expected an 11 character YouTube video id');
  }

  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>html, body, #player { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }</style>
</head>
<body>
<div id="player"></div>
<script>
  function post(message) {
    message.type = '${MESSAGE_TYPE}';
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  window.onYouTubeIframeAPIReady = function () {
    try {
      new YT.Player('player', {
        videoId: ${JSON.stringify(videoId)},
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0 },
        events: {
          onReady: function () { post({ status: 'ready' }); },
          onError: function (event) { post({ status: 'error', code: event.data }); }
        }
      });
    } catch (error) {
      post({ status: 'script-error' });
    }
  };
  var script = document.createElement('script');
  script.src = 'https://www.youtube.com/iframe_api';
  script.onerror = function () { post({ status: 'script-error' }); };
  document.head.appendChild(script);
</script>
</body>
</html>`;
}
