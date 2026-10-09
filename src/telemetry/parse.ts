import { z } from 'zod';
import {
  METER_UNIT_IDS,
  METERS,
  MODBUS_FC_READ_HOLDING,
  MODBUS_MAX_READ_QTY,
  UINT16_MAX,
} from '../config/constants';
import { AppError } from '../errors/app-error';
import { TelemetryErrors } from '../errors/modules/telemetry.errors';
import type {
  MalformedReason,
  ParsedTelemetry,
  RawTelemetryRecord,
  TelemetryFinding,
  TelemetryRecord,
} from '../types/telemetry';
import { parseWallTime } from '../utils/time';
import { decodeRegisters } from './readings';

const RecordSchema = z.object({
  gw_seq: z.number().int().nonnegative(),
  ts: z.string(),
  meter: z.string(),
  unit_id: z.number().int(),
  fc: z.number().int(),
  start_addr: z.number().int().min(0).max(UINT16_MAX),
  qty: z.number().int().min(1).max(MODBUS_MAX_READ_QTY),
  regs: z.array(z.number().int().min(0).max(UINT16_MAX)),
  fw_msg: z.string(),
});

interface AcceptedRecord {
  readonly record: TelemetryRecord;
  readonly contentKey: string;
}

function parseLine(text: string): RawTelemetryRecord | MalformedReason {
  try {
    const result = RecordSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : 'schema';
  } catch {
    return 'invalid_json';
  }
}

function acceptLine(text: string, line: number): AcceptedRecord | MalformedReason {
  const raw = parseLine(text);
  if (typeof raw === 'string') return raw;
  const meter = METERS.find((id) => id === raw.meter);
  if (meter === undefined) return 'unknown_meter';
  if (raw.unit_id !== METER_UNIT_IDS[meter]) return 'unit_id_mismatch';
  if (raw.fc !== MODBUS_FC_READ_HOLDING) return 'function_code';
  if (raw.regs.length !== raw.qty) return 'qty_mismatch';
  const wallMs = parseWallTime(raw.ts);
  if (wallMs === null) return 'invalid_ts';
  const registers = decodeRegisters(raw.start_addr, raw.regs);
  if (typeof registers === 'string') return registers;
  return {
    record: { line, gwSeq: raw.gw_seq, meter, wallMs, registers },
    contentKey: JSON.stringify([
      raw.ts,
      raw.meter,
      raw.unit_id,
      raw.fc,
      raw.start_addr,
      raw.qty,
      raw.regs,
    ]),
  };
}

/**
 * Parses JSONL telemetry: validates each non-blank line, drops duplicate `gw_seq` copies and sorts
 * the accepted records by `gw_seq`.
 * @param text - Whole file contents.
 * @returns Accepted records, malformed_record and duplicate_conflict findings, and the count of
 * dropped duplicate copies.
 * @throws {AppError} TEL-004 when no line is accepted.
 */
export function parseTelemetry(text: string): ParsedTelemetry {
  const accepted = new Map<number, AcceptedRecord>();
  const findings: TelemetryFinding[] = [];
  let duplicatesDropped = 0;
  text.split('\n').forEach((lineText, index) => {
    if (lineText.trim() === '') return;
    const line = index + 1;
    const entry = acceptLine(lineText, line);
    if (typeof entry === 'string') {
      findings.push({ type: 'malformed_record', line, reason: entry });
      return;
    }
    const first = accepted.get(entry.record.gwSeq);
    if (first === undefined) {
      accepted.set(entry.record.gwSeq, entry);
      return;
    }
    duplicatesDropped += 1;
    if (first.contentKey !== entry.contentKey) {
      findings.push({
        meter: first.record.meter,
        type: 'duplicate_conflict',
        gw_seq: entry.record.gwSeq,
      });
    }
  });
  if (accepted.size === 0) {
    throw new AppError({ module: 'TELEMETRY', definition: TelemetryErrors.NO_VALID_RECORDS });
  }
  const records = [...accepted.values()]
    .map((entry) => entry.record)
    .sort((a, b) => a.gwSeq - b.gwSeq);
  return { records, findings, duplicatesDropped };
}
