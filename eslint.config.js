import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';

export default [
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.js'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    plugins: {
      'simple-import-sort': simpleImportSort
    },
    rules: {
      ...js.configs.recommended.rules,
      'simple-import-sort/imports': 'error',
      curly: 'error',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  },
  {
    files: ['**/__tests__/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.jest
      }
    }
  },
  prettier
];
