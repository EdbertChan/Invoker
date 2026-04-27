import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "dist/",
      "coverage/",
      "packages/app/e2e/test-results/",
      "packages/app/e2e/visual-proof/",
      "packages/app/test-results/",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: tseslint.configs.recommended,
  },
  {
    rules: {
      "no-process-exit": "warn",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "no-process-exit": "off",
    },
  },
);
