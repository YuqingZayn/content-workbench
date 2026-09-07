import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: [
      "src/services/codex/generated/**",
      "dist/**",
      "release/**",
      "node_modules/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
