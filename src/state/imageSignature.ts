// pattern: Functional Core
/**
 * Recognises an image file by its leading bytes (#335).
 *
 * `File.downloadFileAsync` checks only the HTTP status — the iOS
 * implementation accepts any 2xx and never reads the content type — so a
 * pasted page URL (an image-search result, a product page) downloads HTML
 * that would otherwise be saved as the exercise image. The downloader reads
 * the first IMAGE_SIGNATURE_BYTES bytes of what it fetched and rejects the
 * file unless this returns true.
 *
 * Accepted: JPEG, PNG, GIF, WebP, and ISO BMFF (`ftyp`) files whose major
 * brand is a HEIF or AVIF still-image or image-sequence brand. Video brands
 * that share the same container (isom, mp41, mp42, qt, M4V …) are rejected:
 * `ftyp` alone says "ISO BMFF", not "image". SVG, BMP and TIFF are not
 * accepted — SVG is text with no fixed signature to tell it from an HTML
 * page, and no exercise photo arrives in the other two.
 */

/** Bytes the caller must supply; the longest check below ends at byte 12. */
export const IMAGE_SIGNATURE_BYTES = 16;

const ascii = (text: string): readonly number[] => Array.from(text, (char) => char.charCodeAt(0));

const JPEG_SOI = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF87A = ascii('GIF87a');
const GIF89A = ascii('GIF89a');
const RIFF = ascii('RIFF');
const WEBP = ascii('WEBP');
const FTYP = ascii('ftyp');

/**
 * HEIF (ISO/IEC 23008-12) and AVIF major brands: heic/heix (HEVC stills),
 * hevc/hevx (HEVC image sequences), mif1/msf1 (generic HEIF image / image
 * sequence), avif/avis (AV1 image / image sequence). Case-sensitive four-CCs.
 */
const IMAGE_FTYP_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis'].map(ascii);

function matchesAt(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (bytes.length < offset + expected.length) return false;
  return expected.every((byte, index) => bytes[offset + index] === byte);
}

export function looksLikeImageBytes(bytes: Uint8Array): boolean {
  // The SOI is always followed by a marker, so a real JPEG has a 4th byte.
  if (bytes.length > JPEG_SOI.length && matchesAt(bytes, 0, JPEG_SOI)) return true;
  if (matchesAt(bytes, 0, PNG)) return true;
  if (matchesAt(bytes, 0, GIF87A) || matchesAt(bytes, 0, GIF89A)) return true;
  // RIFF <4-byte size> WEBP — RIFF alone is also WAVE audio and AVI video.
  if (matchesAt(bytes, 0, RIFF) && matchesAt(bytes, 8, WEBP)) return true;
  // <4-byte box size> ftyp <major brand>
  if (matchesAt(bytes, 4, FTYP)) return IMAGE_FTYP_BRANDS.some((brand) => matchesAt(bytes, 8, brand));
  return false;
}

/** The downloaded file is not an image; the downloader deletes it before throwing. */
export class NotAnImageError extends Error {
  constructor(url: string) {
    super(`downloaded file is not an image: ${url}`);
    this.name = 'NotAnImageError';
  }
}
