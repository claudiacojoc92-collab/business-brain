module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    // No console.log in production code
    'no-console': 'error',
    // Enforce explicit return types on exported functions
    '@typescript-eslint/explicit-module-boundary-types': 'warn',
    // No any without comment
    '@typescript-eslint/no-explicit-any': 'error',
    // Import boundary enforcement (module isolation)
    'import/no-cycle': 'error',
    // No unused variables
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.js', 'apps/web/'],
  overrides: [
    {
      // Allow .eslintrc.js itself to use CommonJS
      files: ['.eslintrc.js'],
      rules: { '@typescript-eslint/no-var-requires': 'off' },
    },
  ],
};
