import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { EXERCISE_CATALOG, EXERCISE_LIBRARY_CATALOG } from './exerciseCatalog';

const ROOT = join(__dirname, '..', '..');
const ASSET_DIR = join(ROOT, 'assets', 'seeded-exercise-images');
const MANIFEST = join(__dirname, 'bundledCatalogImages.ts');
const GENERATOR = join(ROOT, 'scripts', 'build-seeded-catalog-images.mjs');
const IMAGE_COMPONENT = join(ROOT, 'src', 'components', 'ExerciseImage.tsx');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('seeded catalog image packaging (#374)', () => {
  it('has a complete deterministic static-require manifest for every available first upstream image', () => {
    const manifest = source(MANIFEST);
    expect(EXERCISE_LIBRARY_CATALOG).toHaveLength(876);
    expect(EXERCISE_CATALOG).toHaveLength(873);

    for (const entry of EXERCISE_CATALOG) {
      const asset = `${entry.id}.jpg`;
      expect(manifest).toContain(`'${entry.id}': require('../../assets/seeded-exercise-images/${asset}')`);
      expect(existsSync(join(ASSET_DIR, asset))).toBe(true);
    }
    expect(readdirSync(ASSET_DIR).sort()).toEqual(EXERCISE_CATALOG.map(entry => `${entry.id}.jpg`).sort());
  });

  it('checks the pinned commit, JPEG signatures, byte ceiling, paths, and manifest without network access', () => {
    const check = spawnSync('node', [GENERATOR, '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(check.status).toBe(0);
    expect(check.stdout).toContain('OK: 873 bundled JPEGs for 876 catalog entries');
  });

  it('rejects a different valid JPEG substituted under a catalog asset filename', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'hmb-seeded-image-provenance-'));
    const copiedAssets = join(sandbox, 'assets');
    try {
      cpSync(ASSET_DIR, copiedAssets, { recursive: true });
      copyFileSync(
        join(copiedAssets, '90_90_Hamstring.jpg'),
        join(copiedAssets, '3_4_Sit-Up.jpg')
      );
      const check = spawnSync('node', [GENERATOR, '--check'], {
        cwd: ROOT,
        env: { ...process.env, HMB_SEEDED_CATALOG_ASSET_DIR: copiedAssets },
        encoding: 'utf8',
      });
      expect(check.status).not.toBe(0);
      expect(check.stderr).toContain('SHA-256 mismatch for 3_4_Sit-Up.jpg');

      const refresh = spawnSync('node', [GENERATOR, '--refresh-manifest'], {
        cwd: ROOT,
        env: { ...process.env, HMB_SEEDED_CATALOG_ASSET_DIR: copiedAssets },
        encoding: 'utf8',
      });
      expect(refresh.status).not.toBe(0);
      expect(refresh.stderr).toContain('SHA-256 mismatch for 3_4_Sit-Up.jpg');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('renders bundle paths through the static manifest and never treats them as Documents files', () => {
    const component = source(IMAGE_COMPONENT);
    expect(component).toContain("import { bundledCatalogImageModule } from '@/state/bundledCatalogImages';");
    expect(component).toContain("import { isBundledCatalogImagePath } from '@/state/exerciseImageState';");
    expect(component).toContain('const bundledImage = bundledCatalogImageModule(imagePath);');
    expect(component).toContain('if (bundledImage === null && isBundledCatalogImagePath(imagePath))');
    expect(component).toContain('source={bundledImage ?? { uri: new File(Paths.document, imagePath).uri }}');
  });
});
