import type { LogLevel } from './logger';

export interface Env {
  readonly NODE_ENV: 'development' | 'production' | 'test';
  readonly LOG_LEVEL: LogLevel;
}
