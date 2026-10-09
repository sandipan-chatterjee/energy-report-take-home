import type { ErrorDefinition } from '../../types/errors';

export const TelemetryErrors = {
  INPUT_NOT_FOUND: { code: 'TEL-001', message: 'Input file not found.' },
  INPUT_UNREADABLE: { code: 'TEL-002', message: 'Input file could not be read.' },
  INPUT_TOO_LARGE: { code: 'TEL-003', message: 'Input file exceeds the maximum supported size.' },
  NO_VALID_RECORDS: {
    code: 'TEL-004',
    message: 'Input file contains no valid telemetry records.',
  },
} as const satisfies Record<string, ErrorDefinition>;
