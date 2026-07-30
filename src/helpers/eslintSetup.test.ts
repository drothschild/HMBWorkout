// `npm run lint` (expo lint) needs a working on-device ESLint setup, and the
// repo's @babel/plugin-proposal-decorators pin must stay on a major whose
// @babel/core peer matches the installed toolchain core — a Babel-8 pin makes
// every fresh `npm ci`/`npm install` (including expo lint's auto-configuration)
// fail with ERESOLVE. These tests lock both halves in place.
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..');

describe('expo lint setup', () => {
  it('pins a decorators plugin whose @babel/core peer admits the installed core', () => {
    const semver = require('semver');
    const coreVersion = require('@babel/core/package.json').version;
    const peerRange =
      require('@babel/plugin-proposal-decorators/package.json').peerDependencies?.[
        '@babel/core'
      ];

    expect(peerRange).toBeDefined();
    expect(semver.satisfies(coreVersion, peerRange)).toBe(true);
  });

  it('lints a source file through the repo flat config without fatal errors', async () => {
    let ESLint: any;
    try {
      ({ ESLint } = require('eslint'));
    } catch {
      throw new Error('eslint is not installed (expo lint would try to auto-install it)');
    }

    // ESLint discovers eslint.config.js via dynamic import(), which jest's CJS
    // VM rejects (--experimental-vm-modules). The config is CJS, so require it
    // and feed it in directly; `npm run lint` covers the discovery path.
    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: true,
      overrideConfig: require(path.join(repoRoot, 'eslint.config.js')),
    });
    const results = await eslint.lintFiles(['src/interop/format.ts']);
    const fatal = results.flatMap((r: any) => r.messages).filter((m: any) => m.fatal);

    expect(fatal).toEqual([]);
  });
});
