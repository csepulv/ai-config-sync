export default {
  testEnvironment: 'node',
  transform: {},
  moduleFileExtensions: ['js', 'mjs'],
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: ['lib/**/*.js'],
  coverageDirectory: 'coverage',
  verbose: true
};
