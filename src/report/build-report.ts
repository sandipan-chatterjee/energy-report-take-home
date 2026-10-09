import {
  COUNTER_MODULUS,
  COUNTER_ROLLOVER_LIMIT,
  GAP_THRESHOLD_SECONDS,
  METERS,
  MS_PER_SECOND,
  REPORT_DAYS,
  SCALE_FACTOR_BASE,
  SITE_TIMEZONE,
  WH_PER_KWH,
} from '../config/constants';
import type { DayTotals, IntervalEvent, ReportTotals, UnknownEnergyReason } from '../types/report';
import type { MeterId, Reading } from '../types/telemetry';
import { localDateOf } from '../utils/time';

interface IntervalEnergy {
  readonly kwh: number;
  readonly unknownReason: UnknownEnergyReason | null;
  readonly rollover: boolean;
}

function dayKey(date: string, meter: MeterId): string {
  return `${date}|${meter}`;
}

function toKwh(counts: number, sf: number): number {
  return (counts * SCALE_FACTOR_BASE ** sf) / WH_PER_KWH;
}

function intervalEnergy(start: Reading, end: Reading): IntervalEnergy {
  const seconds = (end.at - start.at) / MS_PER_SECOND;
  if (end.uptimeS < seconds) return { kwh: 0, unknownReason: 'power_loss', rollover: false };
  if (end.sf !== start.sf) return { kwh: 0, unknownReason: 'scale_factor_change', rollover: false };
  if (end.counter >= start.counter) {
    return {
      kwh: toKwh(end.counter - start.counter, end.sf),
      unknownReason: null,
      rollover: false,
    };
  }
  const delta = (end.counter - start.counter + COUNTER_MODULUS) % COUNTER_MODULUS;
  return delta < COUNTER_ROLLOVER_LIMIT
    ? { kwh: toKwh(delta, end.sf), unknownReason: null, rollover: true }
    : { kwh: 0, unknownReason: 'counter_decrease', rollover: false };
}

function intervalEvents(
  meter: MeterId,
  start: Reading,
  end: Reading,
  energy: IntervalEnergy,
): IntervalEvent<number>[] {
  const span = { from: start.at, to: end.at };
  const events: IntervalEvent<number>[] = [];
  const reason = energy.unknownReason;
  if ((end.at - start.at) / MS_PER_SECOND > GAP_THRESHOLD_SECONDS) {
    events.push({
      meter,
      type: 'gap',
      ...span,
      energy_counted: reason === null,
      ...(reason === null ? {} : { reason }),
    });
  } else if (reason !== null) {
    events.push({ meter, type: 'energy_unknown', ...span, reason });
  }
  if (energy.rollover) events.push({ meter, type: 'counter_rollover', ...span });
  return events;
}

/**
 * Builds per-day energy, interval counts and power peaks for every report day and meter from
 * readings, with gap, unknown-energy and rollover events.
 * @param readings - Readings in `gw_seq` order.
 * @returns Day totals in date-then-meter order, interval events and the invalid power count.
 */
export function buildReport(readings: readonly Reading[]): ReportTotals {
  const days = new Map<string, DayTotals>(
    REPORT_DAYS.flatMap((date) =>
      METERS.map((meter): [string, DayTotals] => [
        dayKey(date, meter),
        { date, meter, energyKwh: 0, intervals: 0, peak: null },
      ]),
    ),
  );
  const events: IntervalEvent<number>[] = [];
  let invalidPowerReadings = 0;

  for (const meter of METERS) {
    let previous: Reading | undefined;
    for (const reading of readings.filter((r) => r.meter === meter)) {
      const key = dayKey(localDateOf(reading.at, SITE_TIMEZONE), meter);
      const day = days.get(key);
      if (day !== undefined) {
        if (reading.powerW === null) invalidPowerReadings += 1;
        else if (day.peak === null || reading.powerW > day.peak.powerW) {
          days.set(key, { ...day, peak: { powerW: reading.powerW, at: reading.at } });
        }
      }
      const start = previous;
      previous = reading;
      if (start === undefined) continue;
      const startKey = dayKey(localDateOf(start.at, SITE_TIMEZONE), meter);
      const startDay = days.get(startKey);
      if (startDay === undefined) continue;
      const energy = intervalEnergy(start, reading);
      days.set(startKey, {
        ...startDay,
        energyKwh: startDay.energyKwh + energy.kwh,
        intervals: startDay.intervals + 1,
      });
      events.push(...intervalEvents(meter, start, reading, energy));
    }
  }

  return { days: [...days.values()], events, invalidPowerReadings };
}
