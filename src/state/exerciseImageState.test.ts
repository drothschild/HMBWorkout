import {
  IMAGE_SOURCE_NONE,
  IMAGE_SOURCE_NONE_NOKEY,
  catalogImageSource,
  urlImageSource,
  isImageResolutionEligible,
} from './exerciseImageState';

describe('exerciseImageState', () => {
  describe('ImageSource vocabulary', () => {
    it('catalogImageSource creates correct source string', () => {
      expect(catalogImageSource('Face_Pull')).toBe('catalog:Face_Pull');
      expect(catalogImageSource('Barbell_Squat')).toBe('catalog:Barbell_Squat');
    });

    it('urlImageSource creates correct source string', () => {
      expect(urlImageSource('https://a/b.jpg')).toBe('url:https://a/b.jpg');
      expect(urlImageSource('https://example.com/x.jpg')).toBe(
        'url:https://example.com/x.jpg'
      );
    });

    it('constants have expected values', () => {
      expect(IMAGE_SOURCE_NONE).toBe('none');
      expect(IMAGE_SOURCE_NONE_NOKEY).toBe('none:nokey');
    });
  });

  describe('isImageResolutionEligible', () => {
    /**
     * Table-driven test covering every imageSource value × hasAiKey state.
     * Verifies exercise-images.AC2.4 and AC2.5.
     */
    it.each<readonly [string | null, boolean, boolean]>([
      // imageSource | hasAiKey | expected result
      [null, false, true],
      [null, true, true],
      ['none:nokey', false, false], // AC2.5: not re-resolved without key
      ['none:nokey', true, true], // AC2.4: re-resolved once key exists
      ['none', false, false],
      ['none', true, false],
      ['catalog:Barbell_Squat', false, false],
      ['catalog:Barbell_Squat', true, false],
      ['url:https://example.com/x.jpg', false, false],
      ['url:https://example.com/x.jpg', true, false],
      ['garbage', false, false], // unrecognised value, left alone
      ['garbage', true, false],
    ])(
      'isImageResolutionEligible(imageSource=%j, hasAiKey=%p) → %p',
      (imageSource, hasAiKey, expected) => {
        const row = { imageSource };
        expect(isImageResolutionEligible(row, hasAiKey)).toBe(expected);
      }
    );
  });
});
