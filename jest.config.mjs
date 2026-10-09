export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/setup-env.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageThreshold: {
    './src/telemetry/': { lines: 90, branches: 90 },
    './src/report/': { lines: 90, branches: 90 },
    './src/utils/': { lines: 90, branches: 90 },
  },
};
