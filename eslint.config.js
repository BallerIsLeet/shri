// Flat ESLint config (ESLint v9). One config, every package.
// Targets Node 20 + TypeScript sources under packages/*/src/**.

import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/prisma/generated/**",
      "**/*.config.js",
      "**/*.config.mjs",
      "**/*.config.cjs",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // Node 20 ambient globals our source uses.
        process: "readonly",
        Buffer: "readonly",
        console: "readonly",
        URL: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly",
        Uint8Array: "readonly",
        globalThis: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
    rules: {
      // Allow `_`-prefixed unused identifiers (the conventional escape hatch).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Hand-rolled globals declarations (e.g. the Prisma client singleton)
      // are intentionally `var`.
      "no-var": "off",
    },
  },
  {
    // Test files: vitest globals + slightly looser rules.
    files: ["**/*.test.ts"],
    languageOptions: {
      globals: {
        process: "readonly",
        Buffer: "readonly",
        console: "readonly",
        URL: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly",
        Uint8Array: "readonly",
        globalThis: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
);
