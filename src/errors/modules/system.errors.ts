import type { ErrorDefinition } from '../../types/errors';

export const SystemErrors = {
  UNEXPECTED: {
    code: 'SYS-000',
    message: 'An unexpected error occurred. See logs/error.log for details.',
  },
  NON_ERROR_THROWN: {
    code: 'SYS-001',
    message: 'An unexpected non-error value was thrown. See logs/error.log for details.',
  },
} as const satisfies Record<string, ErrorDefinition>;
