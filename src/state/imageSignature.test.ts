import { IMAGE_SIGNATURE_BYTES, looksLikeImageBytes, NotAnImageError } from './imageSignature';

const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));
const bytesOf = (...parts: (number[] | string)[]): Uint8Array =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === 'string' ? ascii(part) : part)));

/** An ISO BMFF header: 4-byte box size, `ftyp`, the major brand, a zero minor version. */
const ftyp = (brand: string): Uint8Array => bytesOf([0x00, 0x00, 0x00, 0x18], 'ftyp', brand, [0, 0, 0, 0]);

const ACCEPTED: readonly (readonly [string, Uint8Array])[] = [
  ['JPEG (JFIF)', bytesOf([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'JFIF')],
  ['JPEG (Exif)', bytesOf([0xff, 0xd8, 0xff, 0xe1])],
  ['PNG', bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])],
  ['GIF87a', bytesOf('GIF87a', [0x01, 0x00])],
  ['GIF89a', bytesOf('GIF89a', [0x01, 0x00])],
  ['WebP', bytesOf('RIFF', [0x24, 0x00, 0x00, 0x00], 'WEBPVP8 ')],
  ...(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis'] as const).map(
    (brand) => [`ISO BMFF ftyp ${brand}`, ftyp(brand)] as const
  ),
];

const REJECTED: readonly (readonly [string, Uint8Array])[] = [
  ['empty', new Uint8Array(0)],
  ['HTML doctype', bytesOf('<!DOCTYPE html><html>')],
  ['HTML tag', bytesOf('<html lang="en"><head>')],
  ['HTML after leading whitespace', bytesOf('\n  <!doctype html>')],
  ['JSON', bytesOf('{"error":"not found"}')],
  // A JPEG SOI is 3 bytes, but a real JPEG always has a marker after it; three
  // bytes alone is a truncated body, not an image.
  ['3-byte JPEG prefix', bytesOf([0xff, 0xd8, 0xff])],
  ['3-byte GIF prefix', bytesOf('GIF')],
  ['GIF with an unknown version', bytesOf('GIF88a', [0x01, 0x00])],
  ['PNG with a corrupted byte', bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00])],
  ['RIFF that is WAVE audio, not WebP', bytesOf('RIFF', [0x24, 0x00, 0x00, 0x00], 'WAVEfmt ')],
  ['RIFF that is AVI video, not WebP', bytesOf('RIFF', [0x24, 0x00, 0x00, 0x00], 'AVI LIST')],
  ['RIFF cut off before its form type', bytesOf('RIFF', [0x24, 0x00, 0x00, 0x00], 'WEB')],
  ['ftyp isom (MP4 video)', ftyp('isom')],
  ['ftyp mp42 (MP4 video)', ftyp('mp42')],
  ['ftyp qt (QuickTime video)', ftyp('qt  ')],
  ['ftyp M4V (video)', ftyp('M4V ')],
  // Four-CC brands are case-sensitive.
  ['ftyp HEIC in upper case', ftyp('HEIC')],
  ['ftyp cut off before its brand', bytesOf([0x00, 0x00, 0x00, 0x18], 'ftyp', 'he')],
  ['ftyp at offset 0 instead of 4', bytesOf('ftypheic', [0, 0, 0, 0])],
];

describe('looksLikeImageBytes — #335 paste-URL guard', () => {
  it.each(ACCEPTED)('accepts %s', (_name, bytes) => {
    expect(looksLikeImageBytes(bytes)).toBe(true);
  });

  it.each(REJECTED)('rejects %s', (_name, bytes) => {
    expect(looksLikeImageBytes(bytes)).toBe(false);
  });

  it('decides every accepted signature from the first IMAGE_SIGNATURE_BYTES bytes alone', () => {
    // The real reader reads only this many bytes of the downloaded file, so a
    // signature that needs more would be rejected on device and pass here.
    for (const [name, header] of ACCEPTED) {
      const padded = new Uint8Array(64);
      padded.set(header);
      expect([name, looksLikeImageBytes(padded.slice(0, IMAGE_SIGNATURE_BYTES))]).toStrictEqual([name, true]);
    }
  });

  it('accepts a full-length buffer, not only a bare header', () => {
    const body = new Uint8Array(4096).fill(0x41);
    body.set([0xff, 0xd8, 0xff, 0xdb]);
    expect(looksLikeImageBytes(body)).toBe(true);
  });
});

describe('NotAnImageError', () => {
  it('names the URL and is an Error the override can catch', () => {
    const error = new NotAnImageError('https://example.com/page');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('NotAnImageError');
    expect(error.message).toBe('downloaded file is not an image: https://example.com/page');
  });
});
