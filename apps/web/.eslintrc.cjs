/* Self-contained ESLint config for the apps/web React app.
 * root:true so it does NOT inherit the backend root config (which has no
 * React support and treats explicit-module-boundary-types as a warning).
 * The repo-root `eslint .` ignores apps/web; lint this app via `npm run lint`
 * inside apps/web. */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  env: { browser: true, es2022: true },
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    'no-console': 'off',
    // Mirror the backend convention: an underscore prefix marks a binding as deliberately unused. Adds
    // varsIgnorePattern so the `const { x: _omit, ...rest } = obj` omit idiom is allowed (the backend only
    // needed argsIgnorePattern; the web app has this destructure-and-drop case too).
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  },
  ignorePatterns: ['dist/', 'node_modules/', 'vite.config.ts', '*.cjs'],
};
