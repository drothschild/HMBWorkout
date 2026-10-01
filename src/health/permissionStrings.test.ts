import { readFileSync } from 'fs';
import { join } from 'path';

const app = JSON.parse(readFileSync(join(__dirname, '../../app.json'), 'utf8'));
const plugins: unknown[] = app.expo.plugins;
const entry = plugins.find(
  (p) => Array.isArray(p) && p[0] === '@kingstinct/react-native-healthkit',
) as [string, Record<string, string>];
const props = entry[1];

describe('HealthKit permission strings in app.json', () => {
  it('app never requests HealthKit read authorization (write-only integration)', () => {
    const src = readFileSync(join(__dirname, 'healthkit.ts'), 'utf8');
    expect(src).not.toMatch(/toRead/);
  });

  it('read (share) string no longer claims the app writes data and says it does not read Health data', () => {
    const s = props.NSHealthShareUsageDescription;
    expect(s).toMatch(/does not read/i);
    expect(s).not.toMatch(/write/i);
  });

  it('update (write) string clearly explains completed workouts are saved to Apple Health', () => {
    const s = props.NSHealthUpdateUsageDescription;
    expect(s).toMatch(/completed workouts/i);
    expect(s).toMatch(/save/i);
    expect(s).toMatch(/Apple Health/);
  });
});
