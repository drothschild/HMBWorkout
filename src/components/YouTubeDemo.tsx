'use dom';

import type { DOMProps } from 'expo/dom';

type YouTubeDemoProps = {
  videoId: string;
  dom?: DOMProps;
};

type YouTubeDemoStatus = 'ready' | 'failed';

function postStatus(status: YouTubeDemoStatus) {
  const bridge = (window as Window & {
    ReactNativeWebView?: { postMessage: (message: string) => void };
  }).ReactNativeWebView;

  bridge?.postMessage(JSON.stringify({ type: 'youtube-demo-status', data: status }));
}

/**
 * An intentionally small, on-demand YouTube embed. Its native parent only
 * renders this after a person taps "Watch demonstration", so exercise-detail
 * loading never contacts YouTube. The app has no custom video download/cache
 * path; platform and YouTube playback caching remain outside this component.
 */
export default function YouTubeDemo({ videoId }: YouTubeDemoProps) {
  const src = `https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1&rel=0`;

  return (
    <iframe
      title="YouTube demonstration"
      src={src}
      loading="lazy"
      sandbox="allow-scripts allow-same-origin allow-presentation"
      referrerPolicy="strict-origin-when-cross-origin"
      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      style={{ border: 0, height: '100%', width: '100%' }}
      onLoad={() => postStatus('ready')}
      onError={() => postStatus('failed')}
    />
  );
}
