'use dom';

import type { DOMProps } from 'expo/dom';
import { useEffect, useRef } from 'react';

type YouTubeDemoProps = {
  videoId: string;
  dom?: DOMProps;
};

type YouTubeDemoStatus = 'ready' | 'failed';

type YouTubePlayer = {
  destroy: () => void;
};

type YouTubeApi = {
  Player: new (
    element: HTMLIFrameElement,
    options: {
      events: {
        onReady: () => void;
        onError: () => void;
      };
    }
  ) => YouTubePlayer;
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

function postStatus(status: YouTubeDemoStatus) {
  const bridge = (window as Window & {
    ReactNativeWebView?: { postMessage: (message: string) => void };
  }).ReactNativeWebView;

  bridge?.postMessage(JSON.stringify({ type: 'youtube-demo-status', data: status }));
}

function waitForYouTubeIframeApi(onReady: () => void, onFailure: () => void) {
  if (window.YT?.Player) {
    onReady();
    return () => {};
  }

  const previousReady = window.onYouTubeIframeAPIReady;
  const handleReady = () => {
    previousReady?.();
    onReady();
  };
  window.onYouTubeIframeAPIReady = handleReady;

  const scriptId = 'youtube-iframe-api';
  let script = document.getElementById(scriptId) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  }
  script.addEventListener('error', onFailure, { once: true });

  return () => {
    script?.removeEventListener('error', onFailure);
    if (window.onYouTubeIframeAPIReady === handleReady) {
      window.onYouTubeIframeAPIReady = previousReady;
    }
  };
}

/**
 * On-demand YouTube playback. The native parent mounts this only after an
 * explicit tap, so opening exercise details makes no YouTube request. The
 * app has no custom video download/cache path; platform and YouTube playback
 * caching remain outside this component.
 */
export default function YouTubeDemo({ videoId }: YouTubeDemoProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let disposed = false;
    let player: YouTubePlayer | null = null;

    const createPlayer = () => {
      if (disposed || !iframeRef.current || !window.YT?.Player) return;
      try {
        player = new window.YT.Player(iframeRef.current, {
          events: {
            onReady: () => postStatus('ready'),
            onError: () => postStatus('failed'),
          },
        });
      } catch {
        postStatus('failed');
      }
    };

    const stopWaiting = waitForYouTubeIframeApi(createPlayer, () => postStatus('failed'));

    return () => {
      disposed = true;
      stopWaiting();
      player?.destroy();
    };
  }, [videoId]);

  const src = `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1&playsinline=1&rel=0`;

  return (
    <iframe
      ref={iframeRef}
      title="YouTube demonstration"
      src={src}
      loading="lazy"
      sandbox="allow-scripts allow-same-origin allow-presentation"
      referrerPolicy="strict-origin-when-cross-origin"
      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      style={{ border: 0, height: '100%', width: '100%' }}
    />
  );
}
