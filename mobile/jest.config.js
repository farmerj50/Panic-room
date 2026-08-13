module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/src/**/__tests__/**/*.test.ts?(x)"],
  moduleNameMapper: {
    "^@react-native-async-storage/async-storage$": "@react-native-async-storage/async-storage/jest",
  },
};
