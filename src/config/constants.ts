import path from 'node:path';
import type { MeterId } from '../types/telemetry';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

export const paths = {
  projectRoot: PROJECT_ROOT,
  inputDir: path.join(PROJECT_ROOT, 'input'),
  appLogFile: path.join(PROJECT_ROOT, 'logs', 'app.log'),
  errorLogFile: path.join(PROJECT_ROOT, 'logs', 'error.log'),
} as const;

export const EXIT_CODE = { FAILURE: 1 } as const;

export const SITE_TIMEZONE = 'Europe/Berlin';
export const REPORT_DAYS = ['2026-10-24', '2026-10-25', '2026-10-26'] as const;
export const METERS = ['M1', 'M2', 'M3'] as const satisfies readonly MeterId[];
export const METER_UNIT_IDS: Readonly<Record<MeterId, number>> = { M1: 1, M2: 2, M3: 3 };

export const GAP_THRESHOLD_SECONDS = 450;
export const MAX_INPUT_BYTES = 50 * 1024 * 1024;
export const ENERGY_DECIMALS = 2;
export const POWER_DECIMALS = 1;
export const OUTPUT_JSON_INDENT = 2;

export const MODBUS_FC_READ_HOLDING = 3;
export const MODBUS_MAX_READ_QTY = 125;
export const UINT16_MAX = 0xffff;

export const REG_MODEL_ID = 99;
export const REG_ACTIVE_POWER = { low: 100, high: 101 } as const;
export const REG_ENERGY_COUNTER = { low: 102, high: 103 } as const;
export const REG_SCALE_FACTOR = 104;
export const REG_UPTIME = { low: 105, high: 106 } as const;

export const PM3_MODEL_ID = 0x1f4a;
export const FLOAT32_NOT_AVAILABLE = 0x7fc00000;
export const WORD_MODULUS = 0x10000;
export const INT16_SIGN_BIT = 0x8000;
export const COUNTER_MODULUS = 2 ** 32;
export const COUNTER_ROLLOVER_LIMIT = 2 ** 31;
export const SCALE_FACTOR_BASE = 10;
export const WH_PER_KWH = 1000;
export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60_000;
export const MINUTES_PER_HOUR = 60;
export const TRANSITION_PROBE_MS = 24 * 60 * MS_PER_MINUTE;
export const ISO_SECONDS_LENGTH = 19;
export const ISO_DATE_LENGTH = 10;
export const ISO_FIELD_WIDTH = 2;
