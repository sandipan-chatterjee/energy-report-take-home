import type { ErrorDefinition } from '../../types/errors';

export const CliErrors = {
  MISSING_INPUT_PATH: {
    code: 'CLI-001',
    message: 'Missing input file. Usage: npm start -- <file.jsonl>',
  },
  INVALID_ARGUMENTS: {
    code: 'CLI-002',
    message: 'Unexpected arguments. Usage: npm start -- <file.jsonl>',
  },
} as const satisfies Record<string, ErrorDefinition>;
