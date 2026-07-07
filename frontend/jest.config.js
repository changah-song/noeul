// Jest configuration for FluentFable.
//
// We use the `jest-expo` preset because Database.js and its imports resolve
// Expo/React Native modules; the preset wires up the right Babel transform and
// transformIgnorePatterns so those modules can be imported in tests.
//
// `expo-sqlite` is remapped to an in-memory SQLite mock (see test/mocks) so DB
// logic runs against a real SQL engine without a device.
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/test/jest.setup.js'],
  moduleNameMapper: {
    '^expo-sqlite$': '<rootDir>/test/mocks/expoSqliteMock.js',
  },
  testMatch: ['**/__tests__/**/*.test.js'],
};
