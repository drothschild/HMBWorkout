'use dom';

import type { DOMProps } from 'expo/dom';

type YouTubeDemoProps = {
  videoId: string;
  dom?: DOMProps;
};

/**
 * An intentionally small, on-demand YouTube embed. Its native parent only
 * renders this after a person taps "Watch demonstration", so exercise-detail
 * loading never contacts YouTube. No video data is downloaded or cached here.
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
    />
  );
}
