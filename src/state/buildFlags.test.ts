import { webImageFallbackEnabled } from './buildFlags';

describe('webImageFallbackEnabled (#397)', () => {
  it('is true only when EXPO_PUBLIC_WEB_IMAGE_FALLBACK is exactly "1"', () => {
    expect(webImageFallbackEnabled({ EXPO_PUBLIC_WEB_IMAGE_FALLBACK: '1' })).toBe(true);
  });

  it.each([undefined, '', '0', 'true', ' 1', '1 ', 'yes'])('is false for %p', value => {
    expect(webImageFallbackEnabled({ EXPO_PUBLIC_WEB_IMAGE_FALLBACK: value })).toBe(false);
  });

  it('is false when the variable is absent from the environment', () => {
    expect(webImageFallbackEnabled({})).toBe(false);
  });
});
