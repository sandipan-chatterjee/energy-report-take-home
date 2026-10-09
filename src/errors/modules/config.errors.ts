import type { ErrorDefinition } from '../../types/errors';

export const ConfigErrors = {
  INVALID_ENV: {
    code: 'CFG-001',
    message: 'Invalid environment configuration (check NODE_ENV and LOG_LEVEL).',
  },
} as const satisfies Record<string, ErrorDefinition>;
