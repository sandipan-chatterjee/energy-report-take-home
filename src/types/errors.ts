export interface ErrorDefinition {
  readonly code: string;
  readonly message: string;
}

export type ErrorModule = 'SYSTEM' | 'CONFIG' | 'CLI' | 'TELEMETRY';

export type ErrorDetails = Readonly<Record<string, string | number | boolean>>;

export interface AppErrorOptions {
  readonly module: ErrorModule;
  readonly definition: ErrorDefinition;
  readonly details?: ErrorDetails;
  readonly cause?: Error;
}
