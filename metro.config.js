const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// rill-lang's entry (dist/lib.js) re-exports its Node CLI runner, which
// imports node:fs / node:path at module scope. The app never calls those
// runner functions (runSource/createFsResolver), but Metro resolves the whole
// module graph eagerly, so bundling fails on the Node built-ins. Resolve them
// to Metro's empty module — scoped to rill-lang so a genuine Node built-in
// import anywhere else still fails loudly.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    (moduleName === 'node:fs' || moduleName === 'node:path') &&
    context.originModulePath.includes(`${path.sep}rill-lang${path.sep}`)
  ) {
    return { type: 'empty' };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
