import type { MeterId, TelemetryFinding } from './telemetry';

export type UnknownEnergyReason = 'power_loss' | 'counter_decrease' | 'scale_factor_change';

/** A gap event; `T` is epoch ms before formatting and a local ISO string after. */
export interface GapEvent<T> {
  readonly meter: MeterId;
  readonly type: 'gap';
  readonly from: T;
  readonly to: T;
  readonly energy_counted: boolean;
  readonly reason?: UnknownEnergyReason;
}

export interface EnergyUnknownEvent<T> {
  readonly meter: MeterId;
  readonly type: 'energy_unknown';
  readonly from: T;
  readonly to: T;
  readonly reason: UnknownEnergyReason;
}

export interface CounterRolloverEvent<T> {
  readonly meter: MeterId;
  readonly type: 'counter_rollover';
  readonly from: T;
  readonly to: T;
}

export type IntervalEvent<T> = GapEvent<T> | EnergyUnknownEvent<T> | CounterRolloverEvent<T>;

export interface PowerPeak {
  readonly powerW: number;
  readonly at: number;
}

/** Unrounded totals for one meter on one report day. */
export interface DayTotals {
  readonly date: string;
  readonly meter: MeterId;
  readonly energyKwh: number;
  readonly intervals: number;
  readonly peak: PowerPeak | null;
}

/** Unformatted report contents: day totals in output order, interval events and invalid count. */
export interface ReportTotals {
  readonly days: readonly DayTotals[];
  readonly events: readonly IntervalEvent<number>[];
  readonly invalidPowerReadings: number;
}

export interface DailyRow {
  readonly date: string;
  readonly meter: MeterId;
  readonly energy_kwh: number;
  readonly intervals: number;
  readonly peak_power_w: number | null;
  readonly peak_at: string | null;
}

export type ReportEvent = TelemetryFinding | IntervalEvent<string>;

export interface Report {
  readonly site_timezone: string;
  readonly daily: readonly DailyRow[];
  readonly events: readonly ReportEvent[];
  readonly duplicates_dropped: number;
  readonly invalid_power_readings: number;
}
