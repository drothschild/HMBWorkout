#!/usr/bin/env node

/**
 * Measures the *intrinsic* line-height ratio of the SF system fonts by reading
 * their own vertical metrics out of the font binaries on this Mac.
 *
 * Why this exists: `src/theme/typography.ts` sets `LINE_HEIGHT_FLOOR` from a
 * claim about "SF's natural line height". That claim was carried in prose from
 * PR to PR (#104, #108, #118) and re-derived by hand each time. Issue #126
 * asked for it to be settled. This script is the settlement — run it instead of
 * re-reading a comment.
 *
 *   node scripts/sf-line-height.js
 *
 * Zero dependencies: it parses the TrueType tables directly.
 *
 * What it reports, and why each part matters:
 *
 *   - `head.unitsPerEm`, `hhea` ascender/descender/lineGap, and the OS/2 typo
 *     and win metrics. The intrinsic default line height is
 *     `(ascender - descender + lineGap) / unitsPerEm`, and that ratio is the
 *     number the floor is supposed to be about.
 *   - `fvar` axes. Modern SF is ONE variable font with an `opsz` (optical size)
 *     axis, not the separate SF Text / SF Display faces it shipped as before
 *     macOS 10.13 / iOS 11.
 *   - `MVAR` value tags. MVAR is the only table that can make a font's vertical
 *     metrics vary along an axis (via the `hasc` / `hdsc` / `hlgp` / `tasc` /
 *     `tdsc` / `tlgp` / `wasc` / `wdsc` tags). If none of those tags are
 *     present, the line-height ratio is CONSTANT across every optical size and
 *     every weight — no matter what the optical-size axis does to the glyphs.
 *
 * Cross-check with the OS text engine itself (not just the binary):
 *
 *     swift -e 'import CoreText
 *     for s in [14.0, 16.0, 32.0, 48.0, 96.0] as [CGFloat] {
 *       let f = CTFontCreateUIFontForLanguage(.system, s, nil)!
 *       let lh = CTFontGetAscent(f) + CTFontGetDescent(f) + CTFontGetLeading(f)
 *       print(s, lh, lh / Double(s)) }'
 *
 * As of macOS 26 / SF Pro (SFNS.ttf), both agree: the ratio is 1.17773 at every
 * size. See the docstring in src/theme/typography.ts for what that means for
 * the ramp.
 */

const fs = require('fs');

const FONTS = [
  ['SFNS.ttf', 'SF Pro — the Latin system font React Native renders by default'],
  ['SFNSRounded.ttf', 'SF Pro Rounded'],
  ['SFNSMono.ttf', 'SF Mono'],
  ['SFCompact.ttf', 'SF Compact — watchOS / tight UI'],
];
const FONT_DIR = '/System/Library/Fonts';

/** The MVAR tags that would make vertical metrics vary along an axis. */
const VERTICAL_MVAR_TAGS = new Set([
  'hasc', 'hdsc', 'hlgp', // hhea
  'tasc', 'tdsc', 'tlgp', // OS/2 typo
  'wasc', 'wdsc', // OS/2 win
]);

const tag = (buf, off) => buf.toString('latin1', off, off + 4);

/** Reads the SFNT table directory. Handles bare .ttf and .ttc collections. */
function readTables(buf) {
  let base = 0;
  if (tag(buf, 0) === 'ttcf') base = buf.readUInt32BE(12); // first font in collection
  const numTables = buf.readUInt16BE(base + 4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const rec = base + 12 + i * 16;
    tables[tag(buf, rec)] = { offset: buf.readUInt32BE(rec + 8), length: buf.readUInt32BE(rec + 12) };
  }
  return tables;
}

function readAxes(buf, t) {
  if (!t.fvar) return [];
  const o = t.fvar.offset;
  const axesArrayOffset = buf.readUInt16BE(o + 4);
  const axisCount = buf.readUInt16BE(o + 8);
  const axisSize = buf.readUInt16BE(o + 10);
  const axes = [];
  for (let i = 0; i < axisCount; i++) {
    const a = o + axesArrayOffset + i * axisSize;
    axes.push({
      tag: tag(buf, a),
      min: buf.readInt32BE(a + 4) / 65536,
      def: buf.readInt32BE(a + 8) / 65536,
      max: buf.readInt32BE(a + 12) / 65536,
    });
  }
  return axes;
}

function readMvarTags(buf, t) {
  if (!t.MVAR) return null;
  const o = t.MVAR.offset;
  const valueRecordSize = buf.readUInt16BE(o + 6);
  const valueRecordCount = buf.readUInt16BE(o + 8);
  const tags = [];
  for (let i = 0; i < valueRecordCount; i++) {
    tags.push(tag(buf, o + 12 + i * valueRecordSize));
  }
  return tags;
}

function report(file, blurb) {
  const path = `${FONT_DIR}/${file}`;
  if (!fs.existsSync(path)) {
    console.log(`\n${file}: not present on this machine — skipped`);
    return;
  }
  const buf = fs.readFileSync(path);
  const t = readTables(buf);

  const upm = buf.readUInt16BE(t.head.offset + 18);
  const h = t.hhea.offset;
  const hhea = {
    asc: buf.readInt16BE(h + 4),
    desc: buf.readInt16BE(h + 6),
    gap: buf.readInt16BE(h + 8),
  };
  const o2 = t['OS/2'].offset;
  const typo = {
    asc: buf.readInt16BE(o2 + 68),
    desc: buf.readInt16BE(o2 + 70),
    gap: buf.readInt16BE(o2 + 72),
  };
  const win = { asc: buf.readUInt16BE(o2 + 74), desc: buf.readUInt16BE(o2 + 76) };

  const ratio = (m) => (m.asc - m.desc + (m.gap ?? 0)) / upm;

  console.log(`\n=== ${file} — ${blurb}`);
  console.log(`  unitsPerEm            ${upm}`);
  console.log(
    `  hhea  ${hhea.asc}/${hhea.desc}/${hhea.gap}`.padEnd(24) +
      `ratio ${ratio(hhea).toFixed(5)}`,
  );
  console.log(
    `  typo  ${typo.asc}/${typo.desc}/${typo.gap}`.padEnd(24) +
      `ratio ${ratio(typo).toFixed(5)}`,
  );
  console.log(
    `  win   ${win.asc}/${win.desc}`.padEnd(24) +
      `ratio ${((win.asc + win.desc) / upm).toFixed(5)}`,
  );

  const axes = readAxes(buf, t);
  console.log(
    `  axes                  ${axes.length ? axes.map((a) => `${a.tag} ${a.min}-${a.max} (def ${a.def})`).join(', ') : 'none (static font)'}`,
  );

  const mvarTags = readMvarTags(buf, t);
  if (mvarTags === null) {
    console.log('  MVAR                  absent — metrics cannot vary by axis');
  } else {
    const vertical = mvarTags.filter((x) => VERTICAL_MVAR_TAGS.has(x));
    console.log(`  MVAR tags             ${mvarTags.sort().join(' ')}`);
    console.log(
      `  vertical-metric vars  ${vertical.length ? vertical.join(' ') + ' — RATIO VARIES BY AXIS' : 'NONE — ratio is constant across every axis'}`,
    );
  }
}

console.log('SF intrinsic line-height metrics, read from the font binaries.');
console.log('Intrinsic ratio = (ascender - descender + lineGap) / unitsPerEm.');
for (const [file, blurb] of FONTS) report(file, blurb);

// What the app's own ramp asks for, against SF Pro's measured ratio.
const sfns = (() => {
  const buf = fs.readFileSync(`${FONT_DIR}/SFNS.ttf`);
  const t = readTables(buf);
  const upm = buf.readUInt16BE(t.head.offset + 18);
  const h = t.hhea.offset;
  return (
    (buf.readInt16BE(h + 4) - buf.readInt16BE(h + 6) + buf.readInt16BE(h + 8)) / upm
  );
})();

const RAMP = [
  ['small', 14, 20],
  ['smallBold', 14, 20],
  ['default', 16, 24],
  ['subtitle', 32, 44],
  ['title', 48, 57],
  ['link', 14, 30],
];

console.log(`\n=== src/theme/typography.ts ramp vs SF Pro's measured ${sfns.toFixed(5)}`);
console.log('  role        size  lineHeight   ratio    intrinsic wants   verdict');
for (const [role, size, lineHeight] of RAMP) {
  const wants = size * sfns;
  const ok = lineHeight >= wants;
  console.log(
    `  ${role.padEnd(11)} ${String(size).padStart(4)}  ${String(lineHeight).padStart(10)}   ` +
      `${(lineHeight / size).toFixed(5)}  ${wants.toFixed(2).padStart(15)}   ` +
      `${ok ? 'clears' : `SHORT by ${(wants - lineHeight).toFixed(2)}pt`}`,
  );
}
