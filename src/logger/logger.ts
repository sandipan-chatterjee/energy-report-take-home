import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { paths } from '../config/constants';
import { getEnv } from '../config/env';
import type { LogFields, Logger, LogLevel } from '../types/logger';

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Infinity,
};

let warned = false;

/**
 * Creates a logger that appends entries at or above a minimum level to a file as JSON lines.
 * @param file - Log file path; its directory is created on write.
 * @param minLevel - Returns the minimum level to write; defaults to the env `LOG_LEVEL`.
 * @returns A logger whose write failures warn once on stderr instead of throwing.
 */
export function createLogger(
  file: string,
  minLevel: () => LogLevel = () => getEnv().LOG_LEVEL,
): Logger {
  const write = (level: Exclude<LogLevel, 'silent'>, fields: LogFields, msg?: string): void => {
    try {
      if (LEVEL_RANK[level] < LEVEL_RANK[minLevel()]) return;
      mkdirSync(path.dirname(file), { recursive: true });
      appendFileSync(
        file,
        `${JSON.stringify({ ...fields, time: new Date().toISOString(), level, msg })}\n`,
      );
    } catch {
      if (!warned) {
        warned = true;
        process.stderr.write('warning: logging unavailable; continuing without log files\n');
      }
    }
  };
  return {
    debug: (fields, msg) => {
      write('debug', fields, msg);
    },
    info: (fields, msg) => {
      write('info', fields, msg);
    },
    warn: (fields, msg) => {
      write('warn', fields, msg);
    },
    error: (fields, msg) => {
      write('error', fields, msg);
    },
  };
}

export const appLogger = createLogger(paths.appLogFile);
