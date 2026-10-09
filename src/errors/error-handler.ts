import { EXIT_CODE } from '../config/constants';
import { errorLogger } from '../logger/error-logger';
import { AppError } from './app-error';
import { SystemErrors } from './modules/system.errors';

/** Handles fatal errors by logging them, printing their code and message to stderr and exiting. */
export class ErrorHandler {
  private static instance: ErrorHandler | undefined;

  private constructor() {}

  /**
   * Returns the shared ErrorHandler, creating it on the first call.
   * @returns The shared instance.
   */
  static getInstance(): ErrorHandler {
    ErrorHandler.instance ??= new ErrorHandler();
    return ErrorHandler.instance;
  }

  /**
   * Wraps a non-AppError as SYS-000, logs it, prints its code and message to stderr and exits 1.
   * @param error - Error to handle.
   */
  handle(error: Error): never {
    const appError = error instanceof AppError ? error : this.wrap(error);
    const cause = appError.cause instanceof Error ? appError.cause : undefined;
    errorLogger.error({
      code: appError.code,
      module: appError.module,
      message: appError.message,
      details: appError.details,
      cause: cause?.message,
      stack: cause?.stack ?? appError.stack,
    });
    process.stderr.write(`\n✖ [${appError.code}] ${appError.message}\n`);
    process.exit(EXIT_CODE.FAILURE);
  }

  private wrap(error: Error): AppError {
    return new AppError({ module: 'SYSTEM', definition: SystemErrors.UNEXPECTED, cause: error });
  }
}

export const errorHandler = ErrorHandler.getInstance();
