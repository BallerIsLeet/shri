// Web ESLint config. Inherits the root flat config and registers the Next.js
// and jsx-a11y plugins so `eslint-disable-next-line @next/next/...` and
// `eslint-disable-next-line jsx-a11y/...` comments resolve to known rule
// names. Without these registered, ESLint warns "Definition for rule was not
// found" and the --max-warnings=0 lint fails.
//
// We do NOT use eslint-config-next directly — that package targets legacy
// .eslintrc, not flat config. Registering the underlying plugins is enough
// for our needs (suppressing rules in inline comments, plus the recommended
// rule sets for ongoing checks).

import rootConfig from "../../eslint.config.js";
import nextPlugin from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default [
  ...rootConfig,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "@next/next": nextPlugin,
      "jsx-a11y": jsxA11y,
    },
    linterOptions: {
      // @next/eslint-plugin-next@14 ships rules incompatible with ESLint 9
      // (context.getAncestors removed), so we register the plugin namespace
      // for inline disables but don't load its recommended rules. That makes
      // pre-existing `eslint-disable-next-line @next/next/...` comments
      // appear "unused" — silence those false positives until the plugin
      // upgrades to ESLint 9.
      reportUnusedDisableDirectives: false,
    },
    rules: {},
  },
];
