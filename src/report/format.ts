import { ENERGY_DECIMALS, POWER_DECIMALS, SITE_TIMEZONE } from '../config/constants';
import type { DailyRow, DayTotals, IntervalEvent, Report, ReportTotals } from '../types/report';
import type {
  ClockAnomalyEvent,
  DuplicateConflictEvent,
  MalformedRecordEvent,
  TelemetryFinding,
} from '../types/telemetry';
import { toLocalIso } from '../utils/time';

function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function formatDay(day: DayTotals): DailyRow {
  return {
    date: day.date,
    meter: day.meter,
    energy_kwh: round(day.energyKwh, ENERGY_DECIMALS),
    intervals: day.intervals,
    peak_power_w: day.peak === null ? null : round(day.peak.powerW, POWER_DECIMALS),
    peak_at: day.peak === null ? null : toLocalIso(day.peak.at, SITE_TIMEZONE),
  };
}

function formatEvent(event: IntervalEvent<number>): IntervalEvent<string> {
  return {
    ...event,
    from: toLocalIso(event.from, SITE_TIMEZONE),
    to: toLocalIso(event.to, SITE_TIMEZONE),
  };
}

function orderFindings(findings: readonly TelemetryFinding[]): TelemetryFinding[] {
  const malformed = findings
    .flatMap((f): MalformedRecordEvent[] => (f.type === 'malformed_record' ? [f] : []))
    .sort((a, b) => a.line - b.line);
  const bySeq = findings
    .flatMap((f): (DuplicateConflictEvent | ClockAnomalyEvent)[] =>
      f.type === 'malformed_record' ? [] : [f],
    )
    .sort((a, b) => a.gw_seq - b.gw_seq || compareText(a.type, b.type));
  return [...malformed, ...bySeq];
}

function orderIntervalEvents(events: readonly IntervalEvent<number>[]): IntervalEvent<number>[] {
  return [...events].sort(
    (a, b) => a.from - b.from || compareText(a.meter, b.meter) || compareText(a.type, b.type),
  );
}

/**
 * Formats the report: rounds energy and power once, renders local ISO times and orders the events.
 * @param totals - Unrounded day totals, interval events and the invalid power count.
 * @param findings - Malformed, duplicate-conflict and clock-anomaly findings.
 * @param duplicatesDropped - Number of dropped duplicate copies.
 * @returns The report in output key order.
 */
export function formatReport(
  totals: ReportTotals,
  findings: readonly TelemetryFinding[],
  duplicatesDropped: number,
): Report {
  return {
    site_timezone: SITE_TIMEZONE,
    daily: totals.days.map(formatDay),
    events: [...orderFindings(findings), ...orderIntervalEvents(totals.events).map(formatEvent)],
    duplicates_dropped: duplicatesDropped,
    invalid_power_readings: totals.invalidPowerReadings,
  };
}
