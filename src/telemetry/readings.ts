import {
  FLOAT32_NOT_AVAILABLE,
  INT16_SIGN_BIT,
  PM3_MODEL_ID,
  REG_ACTIVE_POWER,
  REG_ENERGY_COUNTER,
  REG_MODEL_ID,
  REG_SCALE_FACTOR,
  REG_UPTIME,
  SITE_TIMEZONE,
  WORD_MODULUS,
} from '../config/constants';
import type {
  ClockAnomalyEvent,
  DecodeFailure,
  MeterId,
  Reading,
  RegisterValues,
  ResolvedReadings,
  TelemetryRecord,
} from '../types/telemetry';
import { instantCandidates } from '../utils/time';

function uint32(low: number, high: number): number {
  return high * WORD_MODULUS + low;
}

function int16(word: number): number {
  return word >= INT16_SIGN_BIT ? word - WORD_MODULUS : word;
}

function float32(bits: number): number | null {
  if (bits === FLOAT32_NOT_AVAILABLE) return null;
  const view = new DataView(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT));
  view.setUint32(0, bits);
  const value = view.getFloat32(0);
  return Number.isFinite(value) ? value : null;
}

/**
 * Decodes power, energy counter, scale factor and uptime from a register window by PDU address.
 * @param startAddr - PDU address of the first register in `regs`.
 * @param regs - Register values in address order.
 * @returns The decoded values, or the reason the window cannot be decoded.
 */
export function decodeRegisters(
  startAddr: number,
  regs: readonly number[],
): RegisterValues | DecodeFailure {
  const word = (address: number): number | undefined => regs[address - startAddr];
  const modelId = word(REG_MODEL_ID);
  if (modelId !== undefined && modelId !== PM3_MODEL_ID) return 'model_id';
  const powerLow = word(REG_ACTIVE_POWER.low);
  const powerHigh = word(REG_ACTIVE_POWER.high);
  const counterLow = word(REG_ENERGY_COUNTER.low);
  const counterHigh = word(REG_ENERGY_COUNTER.high);
  const sf = word(REG_SCALE_FACTOR);
  const uptimeLow = word(REG_UPTIME.low);
  const uptimeHigh = word(REG_UPTIME.high);
  if (
    powerLow === undefined ||
    powerHigh === undefined ||
    counterLow === undefined ||
    counterHigh === undefined ||
    sf === undefined ||
    uptimeLow === undefined ||
    uptimeHigh === undefined
  ) {
    return 'address_window';
  }
  return {
    powerW: float32(uint32(powerLow, powerHigh)),
    counter: uint32(counterLow, counterHigh),
    sf: int16(sf),
    uptimeS: uint32(uptimeLow, uptimeHigh),
  };
}

/**
 * Resolves each record's Europe/Berlin wall time to an instant, taking the earliest candidate after
 * the same meter's previous read, and drops records with no such candidate.
 * @param records - Accepted records in `gw_seq` order.
 * @returns Readings in `gw_seq` order and a clock_anomaly event per dropped record.
 */
export function resolveReadings(records: readonly TelemetryRecord[]): ResolvedReadings {
  const previousAt = new Map<MeterId, number>();
  const readings: Reading[] = [];
  const findings: ClockAnomalyEvent[] = [];
  for (const record of records) {
    const candidates = instantCandidates(record.wallMs, SITE_TIMEZONE);
    const after = previousAt.get(record.meter) ?? -Infinity;
    const at = candidates.find((candidate) => candidate > after);
    if (at === undefined) {
      findings.push({
        meter: record.meter,
        type: 'clock_anomaly',
        gw_seq: record.gwSeq,
        reason: candidates.length === 0 ? 'nonexistent_time' : 'non_increasing_time',
      });
      continue;
    }
    previousAt.set(record.meter, at);
    readings.push({ gwSeq: record.gwSeq, meter: record.meter, at, ...record.registers });
  }
  return { readings, findings };
}
