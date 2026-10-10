const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

export interface YouTubeDemoUrl {
  readonly videoId: string;
  readonly canonicalUrl: string;
}

export function parseYouTubeDemoUrl(value: string): YouTubeDemoUrl | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== ''
  ) {
    return null;
  }

  let videoId: string | null = null;
  if (url.hostname === 'youtu.be') {
    const [pathId, ...rest] = url.pathname.split('/').filter(Boolean);
    videoId = rest.length === 0 ? pathId ?? null : null;
  } else if (YOUTUBE_HOSTS.has(url.hostname)) {
    if (url.pathname === '/watch' && !url.searchParams.has('list')) {
      videoId = url.searchParams.get('v');
    } else {
      const [kind, pathId, ...rest] = url.pathname.split('/').filter(Boolean);
      if ((kind === 'embed' || kind === 'shorts') && rest.length === 0) {
        videoId = pathId ?? null;
      }
    }
  }

  if (!videoId || !YOUTUBE_VIDEO_ID.test(videoId)) return null;

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
