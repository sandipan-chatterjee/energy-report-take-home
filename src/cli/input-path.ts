import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { paths } from '../config/constants';
import { withInputFsErrors } from '../telemetry/read-input';

/**
 * Resolves the input argument against the working directory, falling back to `input/` when that
 * path does not exist, and follows symlinks.
 * @param arg - Input path from the command line.
 * @param cwd - Directory the argument is resolved against first.
 * @returns The real absolute path of the input file.
 * @throws {AppError} TEL-001 when neither candidate path exists.
 * @throws {AppError} TEL-002 when the path cannot be resolved for any other reason.
 */
export function resolveInputPath(arg: string, cwd: string = process.cwd()): string {
  const fromCwd = path.resolve(cwd, arg);
  const candidate = existsSync(fromCwd) ? fromCwd : path.resolve(paths.inputDir, arg);
  return withInputFsErrors(() => realpathSync(candidate));
}
