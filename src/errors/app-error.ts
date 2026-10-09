import type { AppErrorOptions, ErrorDetails, ErrorModule } from '../types/errors';

/** Represents an application error with a dictionary code, owning module and optional details. */
export class AppError extends Error {
  readonly code: string;
  readonly module: ErrorModule;
  readonly details: ErrorDetails | undefined;
  readonly isOperational = true;

  /**
   * Creates an error from a dictionary entry.
   * @param options - Owning module, dictionary entry, and optional details and cause.
   */
  constructor(options: AppErrorOptions) {
    super(options.definition.message, { cause: options.cause });
    this.name = 'AppError';
    this.code = options.definition.code;
    this.module = options.module;
    this.details = options.details;
  }
}
