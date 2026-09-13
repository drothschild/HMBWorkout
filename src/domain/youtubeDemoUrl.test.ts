import { parseYouTubeDemoUrl } from './youtubeDemoUrl';

describe('parseYouTubeDemoUrl', () => {
  const videoId = 'dQw4w9WgXcQ';

  it.each([
    `https://www.youtube.com/watch?v=${videoId}`,
    `https://youtube.com/watch?v=${videoId}`,
    `https://m.youtube.com/watch?v=${videoId}&feature=share`,
    `https://youtu.be/${videoId}?si=sharing-token`,
    `https://www.youtube.com/embed/${videoId}`,
    `https://www.youtube.com/shorts/${videoId}`,
  ])('canonicalizes an allowed YouTube video URL: %s', (input) => {
    expect(parseYouTubeDemoUrl(input)).toEqual({
      videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    });
  });

  it.each([
    '',
    '   ',
    `http://www.youtube.com/watch?v=${videoId}`,
    `https://www.youtube.com/watch?list=PL123`,
    `https://www.youtube.com/watch?v=${videoId}&list=PL123`,
    `https://www.youtube.com/results?search_query=bench+press`,
    `https://www.youtube.com/v/${videoId}`,
    `https://www.youtube.com/watch?v=too-short`,
    `https://www.youtube.com/watch?v=${videoId}x`,
    `https://www.youtube.com.evil.example/watch?v=${videoId}`,
    `https://user:pass@www.youtube.com/watch?v=${videoId}`,
    `https://www.youtube.com:444/watch?v=${videoId}`,
    `https://vimeo.com/${videoId}`,
    `javascript:alert(1)`,
    videoId,
  ])('rejects a non-canonical or unsafe video URL: %s', (input) => {
    expect(parseYouTubeDemoUrl(input)).toBeNull();
  });
});
