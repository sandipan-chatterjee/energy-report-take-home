import { getEnv } from '../config/env';
import { AppError } from '../errors/app-error';
import { errorHandler } from '../errors/error-handler';
import { SystemErrors } from '../errors/modules/system.errors';
import { appLogger } from '../logger/logger';

/**
 * Runs a command body after validating the environment, logging its timing and handling any throw.
 * @param command - Command name written to the app log.
 * @param body - Command implementation.
 */
export function runCommand(command: string, body: () => void): void {
  const startedAt = Date.now();
  try {
    getEnv();
    appLogger.info({ command }, 'command started');
    body();
    appLogger.info({ command, durationMs: Date.now() - startedAt }, 'command completed');
  } catch (e) {
    errorHandler.handle(
      e instanceof Error
        ? e
        : new AppError({ module: 'SYSTEM', definition: SystemErrors.NON_ERROR_THROWN }),
    );
  }
}
