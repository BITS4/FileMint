// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

/**
 * Several libraries ship an ESM build (their `module` field) that imports
 * tslib's ESM `modules/index.js`, which destructures `tslib.default` — that is
 * `undefined` under Metro and throws "Cannot destructure property '__extends'"
 * at runtime on web. Force pdf-lib to its self-contained CommonJS build.
 */
const CJS_OVERRIDES = {
  'pdf-lib': path.resolve(__dirname, 'node_modules/pdf-lib/cjs/index.js'),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const override = CJS_OVERRIDES[moduleName];
  if (override) {
    return { type: 'sourceFile', filePath: override };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
