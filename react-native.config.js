// WatermelonDB 0.28 ships @nozbe/simdjson, which React Native autolinking picks up
// via its podspec (source spelled `../node_modules/@nozbe/simdjson`). The
// @morrowdigital/watermelondb-expo-plugin ALSO injects `pod 'simdjson'` into the
// Podfile, but with an absolute path — so CocoaPods sees two sources for the same
// pod and fails ("multiple dependencies with different sources for `simdjson`").
//
// Disable autolinking for @nozbe/simdjson on iOS so the plugin's explicit pod
// (which sets modular_headers, required by WatermelonDB's JSI) is the single source.
// This file is a source file, so it survives `expo prebuild --clean`.
module.exports = {
  dependencies: {
    '@nozbe/simdjson': {
      platforms: {
        ios: null,
      },
    },
  },
};
