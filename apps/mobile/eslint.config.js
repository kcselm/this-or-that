// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", ".expo/*"],
  },
  {
    rules: {
      // An HTML-escaping rule; React Native <Text> renders ' and " as-is.
      "react/no-unescaped-entities": "off",
    },
  },
]);
