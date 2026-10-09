import { decodeRegisters, resolveReadings } from '../../src/telemetry/readings';
import type { MeterId, RegisterValues, TelemetryRecord } from '../../src/types/telemetry';

function floatWords(value: number): [number, number] {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value);
  return [view.getUint16(2), view.getUint16(0)];
}

function window100(power: [number, number], counter: [number, number], sf: number): number[] {
  return [...power, ...counter, sf, 7, 0];
}

function decoded(regs: number[], start = 100): RegisterValues {
  const result = decodeRegisters(start, regs);
  if (typeof result === 'string') throw new Error(`decode failed: ${result}`);
  return result;
}

describe('decodeRegisters', () => {
  it('combines uint32 words low word first', () => {
    const values = decoded([0, 0, 0x0001, 0x0002, 0, 0x0003, 0x0004]);
    expect(values.counter).toBe(2 * 65536 + 1);
    expect(values.uptimeS).toBe(4 * 65536 + 3);
  });

  it('decodes float32 power low word first', () => {
    expect(decoded(window100(floatWords(1234.5), [0, 0], 0)).powerW).toBe(1234.5);
  });

  it('decodes a negative float32 power as valid', () => {
    expect(decoded(window100(floatWords(-250.25), [0, 0], 0)).powerW).toBe(-250.25);
  });

  it('treats 0x7FC00000 as not available', () => {
    expect(decoded(window100([0, 0x7fc0], [0, 0], 0)).powerW).toBeNull();
  });

  it.each([
    ['other NaN', [1, 0x7fc0]],
    ['+Infinity', [0, 0x7f80]],
    ['-Infinity', [0, 0xff80]],
  ])('treats %s power as invalid', (_name, power) => {
    expect(decoded(window100([power[0] ?? 0, power[1] ?? 0], [0, 0], 0)).powerW).toBeNull();
  });

  it.each([
    [0xffff, -1],
    [0, 0],
    [1, 1],
    [0x8000, -32768],
    [0x7fff, 32767],
  ])('decodes scale factor %i as %i', (word, expected) => {
    expect(decoded(window100([0, 0x3f80], [0, 0], word)).sf).toBe(expected);
  });

  it('decodes the largest counter value', () => {
    expect(decoded(window100([0, 0x3f80], [0xffff, 0xffff], 0)).counter).toBe(4294967295);
  });

  it('finds the same values when the window starts at 100 or 99', () => {
    const regs = window100(floatWords(5), [10, 0], 1);
    expect(decoded(regs, 100)).toEqual(decoded([0x1f4a, ...regs], 99));
  });

  it('rejects a model id other than 0x1F4A', () => {
    expect(decodeRegisters(99, [0x1f4b, ...window100([0, 0], [0, 0], 0)])).toBe('model_id');
  });

  it.each([
    ['starts after 100', 101, [0, 0, 0, 0, 0, 0]],
    ['ends before 106', 100, [0, 0, 0, 0, 0, 0]],
    ['is empty', 100, []],
  ])('rejects a window that %s', (_name, start, regs) => {
    expect(decodeRegisters(start, regs)).toBe('address_window');
  });

  it('accepts a wider window and indexes by address', () => {
    const regs = [0x1f4a, ...window100(floatWords(9), [3, 0], 0), 111, 222];
    expect(decoded(regs, 99).counter).toBe(3);
  });
});

function record(meter: MeterId, gwSeq: number, wall: string): TelemetryRecord {
  return {
    line: gwSeq,
    gwSeq,
    meter,
    wallMs: Date.parse(`${wall}Z`),
    registers: { powerW: 1, counter: 0, sf: 0, uptimeS: 0 },
  };
}

describe('resolveReadings', () => {
  const instants = (
    records: TelemetryRecord[],
  ): { at: string[]; reasons: (string | undefined)[] } => {
    const result = resolveReadings(records);
    return {
      at: result.readings.map((r) => new Date(r.at).toISOString()),
      reasons: result.findings.map((f) => f.reason),
    };
  };

  it('resolves an ordinary time with the +02:00 offset', () => {
    expect(instants([record('M1', 1, '2026-10-24T12:00:00')]).at).toEqual([
      '2026-10-24T10:00:00.000Z',
    ]);
  });

  it('resolves the repeated hour by the same meter previous read', () => {
    const result = instants([
      record('M1', 1, '2026-10-25T02:25:00'),
      record('M1', 2, '2026-10-25T02:30:00'),
      record('M1', 3, '2026-10-25T02:25:00'),
      record('M1', 4, '2026-10-25T02:30:00'),
    ]);
    expect(result.at).toEqual([
      '2026-10-25T00:25:00.000Z',
      '2026-10-25T00:30:00.000Z',
      '2026-10-25T01:25:00.000Z',
      '2026-10-25T01:30:00.000Z',
    ]);
    expect(result.reasons).toEqual([]);
  });

  it('resolves each meter independently', () => {
    const result = instants([
      record('M1', 1, '2026-10-25T02:30:00'),
      record('M1', 2, '2026-10-25T02:30:00'),
      record('M2', 3, '2026-10-25T02:30:00'),
    ]);
    expect(result.at).toEqual([
      '2026-10-25T00:30:00.000Z',
      '2026-10-25T01:30:00.000Z',
      '2026-10-25T00:30:00.000Z',
    ]);
  });

  it('drops a nonexistent time as a clock_anomaly', () => {
    const result = resolveReadings([record('M2', 7, '2026-03-29T02:30:00')]);
    expect(result.readings).toEqual([]);
    expect(result.findings).toEqual([
      { meter: 'M2', type: 'clock_anomaly', gw_seq: 7, reason: 'nonexistent_time' },
    ]);
  });

  it('drops a third read of a repeated time as non_increasing_time', () => {
    const result = instants([
      record('M1', 1, '2026-10-25T02:30:00'),
      record('M1', 2, '2026-10-25T02:30:00'),
      record('M1', 3, '2026-10-25T02:30:00'),
    ]);
    expect(result.at).toHaveLength(2);
    expect(result.reasons).toEqual(['non_increasing_time']);
  });

  it('drops a read that goes backwards in time', () => {
    const result = instants([
      record('M1', 1, '2026-10-24T12:00:00'),
      record('M1', 2, '2026-10-24T11:00:00'),
    ]);
    expect(result.at).toHaveLength(1);
    expect(result.reasons).toEqual(['non_increasing_time']);
  });
});
