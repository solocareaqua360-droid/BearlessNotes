const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Metro's default package-exports resolution picks some packages' ESM build
// (e.g. zustand's "import" condition, which uses `import.meta.env`) for the
// web platform instead of their CJS/react-native build, which breaks the
// static web export (its <script> tags are never type="module").
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
