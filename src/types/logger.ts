export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export type LogValue =
  string | number | boolean | null | Readonly<Record<string, string | number | boolean>>;

export type LogFields = Readonly<Record<string, LogValue | undefined>>;

export interface Logger {
  debug(fields: LogFields, msg?: string): void;
  info(fields: LogFields, msg?: string): void;
  warn(fields: LogFields, msg?: string): void;
  error(fields: LogFields, msg?: string): void;
}
