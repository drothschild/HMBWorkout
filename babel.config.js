// Loose class fields are needed only by the WatermelonDB models (so a decorated
// field like `@field('x') foo!: string` doesn't emit a property that shadows the
// decorator getter). But `loose` compiles class fields as assignments, which crashes
// React Native's DOM Event class ("Cannot assign to read-only property 'NONE'"), so it
// must NOT apply globally. Scope it to the model files with a FUNCTION matcher — a
// regex/string `test` breaks Metro's cache-key computation (it loads the config with no
// filename); a function matcher returns false for that call, exactly like the preset does.
function isWatermelonModel(filename) {
  return !!filename && filename.includes('/src/db/models/');
}

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // WatermelonDB needs legacy decorators.
      ['@babel/plugin-proposal-decorators', { version: 'legacy' }],
      ['babel-plugin-inline-import', { extensions: ['.lv'] }],
    ],
    overrides: [
      {
        test: isWatermelonModel,
        plugins: [
          ['@babel/plugin-transform-class-properties', { loose: true }],
          ['@babel/plugin-transform-private-methods', { loose: true }],
          ['@babel/plugin-transform-private-property-in-object', { loose: true }],
        ],
      },
    ],
  };
};
