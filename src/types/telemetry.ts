export type MeterId = 'M1' | 'M2' | 'M3';

/** One line of the telemetry file after schema validation, with the file's field names. */
export interface RawTelemetryRecord {
  readonly gw_seq: number;
  readonly ts: string;
  readonly meter: string;
  readonly unit_id: number;
  readonly fc: number;
  readonly start_addr: number;
  readonly qty: number;
  readonly regs: readonly number[];
  readonly fw_msg: string;
}

/** Register values decoded from one read; `powerW` is null when the power value is invalid. */
export interface RegisterValues {
  readonly powerW: number | null;
  readonly counter: number;
  readonly sf: number;
  readonly uptimeS: number;
}

/** An accepted record: `wallMs` is the Europe/Berlin wall time taken as if it were UTC. */
export interface TelemetryRecord {
  readonly line: number;
  readonly gwSeq: number;
  readonly meter: MeterId;
  readonly wallMs: number;
  readonly registers: RegisterValues;
}

/** A record with its resolved instant (`at`, epoch ms). */
export interface Reading extends RegisterValues {
  readonly gwSeq: number;
  readonly meter: MeterId;
  readonly at: number;
}

export type MalformedReason =
  | 'invalid_json'
  | 'schema'
  | 'unknown_meter'
  | 'unit_id_mismatch'
  | 'function_code'
  | 'qty_mismatch'
  | 'invalid_ts'
  | 'address_window'
  | 'model_id';

export type DecodeFailure = Extract<MalformedReason, 'address_window' | 'model_id'>;

export type ClockAnomalyReason = 'nonexistent_time' | 'non_increasing_time';

export interface MalformedRecordEvent {
  readonly type: 'malformed_record';
  readonly line: number;
  readonly reason: MalformedReason;
}

export interface DuplicateConflictEvent {
  readonly meter: MeterId;
  readonly type: 'duplicate_conflict';
  readonly gw_seq: number;
}

export interface ClockAnomalyEvent {
  readonly meter: MeterId;
  readonly type: 'clock_anomaly';
  readonly gw_seq: number;
  readonly reason: ClockAnomalyReason;
}

export type TelemetryFinding = MalformedRecordEvent | DuplicateConflictEvent | ClockAnomalyEvent;

/** Accepted records in `gw_seq` order, plus the findings and duplicate count from parsing. */
export interface ParsedTelemetry {
  readonly records: readonly TelemetryRecord[];
  readonly findings: readonly TelemetryFinding[];
  readonly duplicatesDropped: number;
}

export interface ResolvedReadings {
  readonly readings: readonly Reading[];
  readonly findings: readonly ClockAnomalyEvent[];
}
