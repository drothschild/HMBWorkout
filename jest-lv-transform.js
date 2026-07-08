/**
 * Jest transformer for .lv files
 * Reads Rill source files and exports them as strings
 */
const fs = require('fs');

module.exports = {
  process(src, filename, options) {
    const source = fs.readFileSync(filename, 'utf-8');
    return {
      code: `module.exports = ${JSON.stringify(source)};`,
    };
  },
};
