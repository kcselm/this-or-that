const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

// Tell expo-router where to find the app/ directory
process.env.EXPO_ROUTER_APP_ROOT = path.resolve(projectRoot, "app");

const config = getDefaultConfig(projectRoot);

// Watch the monorepo root for changes (hoisted node_modules)
config.watchFolders = [monorepoRoot];

// Resolve modules from both the project and the monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

module.exports = config;
