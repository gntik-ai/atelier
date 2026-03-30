module.exports = {
  root: true,
  extends: ['eslint:recommended'],
  env: {
    es2022: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  ignorePatterns: ['coverage/', 'node_modules/'],
};
