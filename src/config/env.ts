import { z } from 'zod';
import { AppError } from '../errors/app-error';
import { ConfigErrors } from '../errors/modules/config.errors';
import type { Env } from '../types/config';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

/**
 * Parses environment variables into a validated Env, applying defaults.
 * @param source - Environment variables to parse.
 * @returns The validated environment.
 * @throws {AppError} CFG-001 when a variable has an invalid value.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new AppError({
      module: 'CONFIG',
      definition: ConfigErrors.INVALID_ENV,
      details: {
        invalid: result.error.issues.map((issue) => issue.path.map(String).join('.')).join(', '),
      },
    });
  }
  return result.data;
}

let cached: Env | undefined;

/**
 * Returns the validated environment, parsing `process.env` on the first call and caching it.
 * @returns The validated environment.
 * @throws {AppError} CFG-001 when `process.env` has an invalid value.
 */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
