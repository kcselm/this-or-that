import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".wrangler/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // Unused args are allowed when prefixed with _ (e.g. Workers handler params).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Tests poke at loosely-typed JSON response bodies.
    files: ["test/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  }
);
