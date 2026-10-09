import { readFileSync, statSync } from 'node:fs';
import { MAX_INPUT_BYTES } from '../config/constants';
import { AppError } from '../errors/app-error';
import { TelemetryErrors } from '../errors/modules/telemetry.errors';

/**
 * Runs a filesystem operation on the input file and translates its failure into an AppError.
 * @param operation - Filesystem call to run.
 * @returns The operation's result.
 * @throws {AppError} TEL-001 when the file does not exist.
 * @throws {AppError} TEL-002 when the operation fails for any other reason.
 */
export function withInputFsErrors<T>(operation: () => T): T {
  try {
    return operation();
  } catch (e) {
    const code =
      e instanceof Error && 'code' in e && typeof e.code === 'string' ? e.code : 'UNKNOWN';
    throw new AppError({
      module: 'TELEMETRY',
      definition:
        code === 'ENOENT' ? TelemetryErrors.INPUT_NOT_FOUND : TelemetryErrors.INPUT_UNREADABLE,
      details: { reason: code },
      ...(e instanceof Error ? { cause: e } : {}),
    });
  }
}

/**
 * Reads the input file as UTF-8 after checking that it is a regular file within the size limit.
 * @param file - Absolute path of the input file.
 * @returns The file contents.
 * @throws {AppError} TEL-001 when the file does not exist.
 * @throws {AppError} TEL-002 when the path is not a regular file or cannot be read.
 * @throws {AppError} TEL-003 when the file is larger than `MAX_INPUT_BYTES`.
 */
export function readInput(file: string): string {
  const stats = withInputFsErrors(() => statSync(file));
  if (!stats.isFile()) {
    throw new AppError({
      module: 'TELEMETRY',
      definition: TelemetryErrors.INPUT_UNREADABLE,
      details: { reason: 'not_a_regular_file' },
    });
  }
  if (stats.size > MAX_INPUT_BYTES) {
    throw new AppError({
      module: 'TELEMETRY',
      definition: TelemetryErrors.INPUT_TOO_LARGE,
      details: { sizeBytes: stats.size, maxBytes: MAX_INPUT_BYTES },
    });
  }
  return withInputFsErrors(() => readFileSync(file, 'utf8'));
}
