import { parseTelemetry } from '../../src/telemetry/parse';
import { AppError } from '../../src/errors/app-error';
import { TelemetryErrors } from '../../src/errors/modules/telemetry.errors';

const REGS_M1 = [0, 0x3f80, 1000, 0, 0, 500, 0];
const REGS_M3 = [0x1f4a, 0, 0x3f80, 1000, 0, 0, 500, 0];

interface LineFields {
  gw_seq: number;
  ts: string;
  meter: string;
  unit_id: number;
  fc: number;
  start_addr: number;
  qty: number;
  regs: number[];
  fw_msg: string;
}

function fields(overrides: Partial<Record<keyof LineFields, string | number | number[]>>): string {
  const base: LineFields = {
    gw_seq: 1,
    ts: '2026-10-24 00:00:00',
    meter: 'M1',
    unit_id: 1,
    fc: 3,
    start_addr: 100,
    qty: 7,
    regs: REGS_M1,
    fw_msg: 'OK',
  };
  return JSON.stringify({ ...base, ...overrides });
}

function reasonOf(line: string): string | undefined {
  const parsed = parseTelemetry(`${fields({ gw_seq: 99 })}\n${line}`);
  const finding = parsed.findings[0];
  return finding?.type === 'malformed_record' ? finding.reason : undefined;
}

describe('parseTelemetry', () => {
  it('accepts a valid line and decodes its registers', () => {
    const parsed = parseTelemetry(fields({}));
    expect(parsed.findings).toEqual([]);
    expect(parsed.duplicatesDropped).toBe(0);
    expect(parsed.records).toEqual([
      {
        line: 1,
        gwSeq: 1,
        meter: 'M1',
        wallMs: Date.UTC(2026, 9, 24),
        registers: { powerW: 1, counter: 1000, sf: 0, uptimeS: 500 },
      },
    ]);
  });

  it('accepts an M3 line whose window starts at 99', () => {
    const parsed = parseTelemetry(
      fields({ meter: 'M3', unit_id: 3, start_addr: 99, qty: 8, regs: REGS_M3 }),
    );
    expect(parsed.records[0]?.registers).toEqual({ powerW: 1, counter: 1000, sf: 0, uptimeS: 500 });
  });

  it.each([
    ['invalid_json', '{not json'],
    ['schema', '[]'],
    ['schema', fields({ regs: [0, 0.5, 1, 0, 0, 5, 0] })],
    ['schema', fields({ regs: [0, 65536, 1, 0, 0, 5, 0] })],
    ['schema', fields({ regs: [0, -1, 1, 0, 0, 5, 0] })],
    ['schema', fields({ gw_seq: -1 })],
    ['schema', fields({ qty: 0 })],
    ['schema', fields({ start_addr: 65536 })],
    ['schema', JSON.stringify({ gw_seq: 5 })],
    ['qty_mismatch', fields({ qty: 6 })],
    ['unknown_meter', fields({ meter: 'M9' })],
    ['unit_id_mismatch', fields({ unit_id: 2 })],
    ['function_code', fields({ fc: 4 })],
    ['invalid_ts', fields({ ts: '2026-10-24T00:00:00' })],
    ['invalid_ts', fields({ ts: '2026-02-30 00:00:00' })],
    [
      'model_id',
      fields({ meter: 'M3', unit_id: 3, start_addr: 99, qty: 8, regs: [1, ...REGS_M3.slice(1)] }),
    ],
    ['address_window', fields({ start_addr: 101, qty: 6, regs: REGS_M1.slice(1) })],
  ])('skips a line with reason %s', (reason, line) => {
    expect(reasonOf(line)).toBe(reason);
  });

  it('keeps the valid lines when others are malformed', () => {
    const parsed = parseTelemetry(`bad\n${fields({})}`);
    expect(parsed.records).toHaveLength(1);
  });

  it('ignores blank lines but keeps physical line numbers in findings', () => {
    const parsed = parseTelemetry(`${fields({})}\n\n   \nbad\n`);
    expect(parsed.findings).toEqual([
      { type: 'malformed_record', line: 4, reason: 'invalid_json' },
    ]);
  });

  it('accepts CRLF line endings', () => {
    const parsed = parseTelemetry(`${fields({})}\r\n${fields({ gw_seq: 2 })}\r\n`);
    expect(parsed.records).toHaveLength(2);
    expect(parsed.findings).toEqual([]);
  });

  it('ignores extra keys', () => {
    const line = JSON.stringify({ ...JSON.parse(fields({})), extra: 'x', nested: { a: 1 } });
    expect(parseTelemetry(line).records).toHaveLength(1);
  });

  it('does not pollute Object.prototype from a __proto__ key', () => {
    const line = fields({}).replace('{', '{"__proto__":{"polluted":true},');
    const parsed = parseTelemetry(line);
    expect(parsed.records).toHaveLength(1);
    expect(Reflect.get({}, 'polluted')).toBeUndefined();
    expect(Reflect.get(parsed.records[0] ?? {}, 'polluted')).toBeUndefined();
  });

  it('drops identical duplicates and counts each extra copy', () => {
    const line = fields({});
    const parsed = parseTelemetry(`${line}\n${line}\n${line}`);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.duplicatesDropped).toBe(2);
    expect(parsed.findings).toEqual([]);
  });

  it('treats a copy differing only in fw_msg as identical', () => {
    const parsed = parseTelemetry(`${fields({})}\n${fields({ fw_msg: 'other' })}`);
    expect(parsed.duplicatesDropped).toBe(1);
    expect(parsed.findings).toEqual([]);
  });

  it('reports a conflicting duplicate and keeps the first delivered', () => {
    const parsed = parseTelemetry(
      `${fields({})}\n${fields({ regs: [0, 0x3f80, 2000, 0, 0, 500, 0] })}`,
    );
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]?.registers.counter).toBe(1000);
    expect(parsed.duplicatesDropped).toBe(1);
    expect(parsed.findings).toEqual([{ meter: 'M1', type: 'duplicate_conflict', gw_seq: 1 }]);
  });

  it('does not count a malformed copy as a duplicate', () => {
    const parsed = parseTelemetry(`${fields({})}\n${fields({ fc: 4 })}`);
    expect(parsed.duplicatesDropped).toBe(0);
    expect(parsed.findings).toHaveLength(1);
  });

  it('sorts records by gw_seq and gives the same result for shuffled input', () => {
    const lines = [1, 2, 3, 4, 5].map((n) =>
      fields({ gw_seq: n, ts: `2026-10-24 00:0${String(n)}:00` }),
    );
    const shuffled = [lines[3], lines[0], lines[4], lines[2], lines[1]].join('\n');
    const withoutLine = (text: string): { gwSeq: number; wallMs: number }[] =>
      parseTelemetry(text).records.map(({ gwSeq, wallMs }) => ({ gwSeq, wallMs }));
    expect(withoutLine(shuffled)).toEqual(withoutLine(lines.join('\n')));
    expect(withoutLine(shuffled).map((r) => r.gwSeq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('throws TEL-004 when no line is valid', () => {
    for (const text of ['', '\n\n', 'bad\nworse']) {
      let caught: AppError | undefined;
      try {
        parseTelemetry(text);
      } catch (e) {
        if (e instanceof AppError) caught = e;
      }
      expect(caught?.code).toBe(TelemetryErrors.NO_VALID_RECORDS.code);
    }
  });
});
