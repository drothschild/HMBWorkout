// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // react-hooks v6's compiler-era rules flag legitimate pre-Compiler patterns
    // (impure calls inside event handlers, async loads setting state in effects,
    // including Expo's own use-color-scheme.web template shim). Keep them visible
    // as warnings; promote back to errors as the codebase adopts those idioms.
    rules: {
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  }
]);
