// Runs after the test framework is set up, before each test file.
//
// AsyncStorage's real module reaches for a native binding that doesn't exist in
// Node, so importing anything that imports it (like Database.js) would throw.
// The library ships an official in-memory Jest mock; wire it up globally.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
