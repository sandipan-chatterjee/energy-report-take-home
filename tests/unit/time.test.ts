import {
  instantCandidates,
  localDateOf,
  offsetMinutesAt,
  parseWallTime,
  toLocalIso,
} from '../../src/utils/time';

const BERLIN = 'Europe/Berlin';

function candidates(wall: string): string[] {
  const wallMs = parseWallTime(wall);
  if (wallMs === null) throw new Error('bad wall time in test');
  return instantCandidates(wallMs, BERLIN).map((ms) => new Date(ms).toISOString());
}

describe('parseWallTime', () => {
  it('parses a valid wall time as UTC epoch ms', () => {
    expect(parseWallTime('2026-10-24 12:30:15')).toBe(Date.UTC(2026, 9, 24, 12, 30, 15));
  });

  it.each(['2026-02-30 10:00:00', '2026-10-24T10:00:00', '2026-10-24 24:00:00', '', 'nonsense'])(
    'rejects %p',
    (text) => {
      expect(parseWallTime(text)).toBeNull();
    },
  );
});

describe('instantCandidates', () => {
  it('converts a summer time with the +02:00 offset', () => {
    expect(candidates('2026-10-24 12:00:00')).toEqual(['2026-10-24T10:00:00.000Z']);
  });

  it('converts a winter time with the +01:00 offset', () => {
    expect(candidates('2026-10-26 12:00:00')).toEqual(['2026-10-26T11:00:00.000Z']);
  });

  it('returns both instants for 02:30 on the 2026-10-25 fall-back day, earliest first', () => {
    expect(candidates('2026-10-25 02:30:00')).toEqual([
      '2026-10-25T00:30:00.000Z',
      '2026-10-25T01:30:00.000Z',
    ]);
  });

  it('returns no instant for a nonexistent spring-forward time', () => {
    expect(candidates('2026-03-29 02:30:00')).toEqual([]);
  });
});

describe('toLocalIso', () => {
  it('formats the two 02:30 instants with +02:00 then +01:00', () => {
    expect(toLocalIso(Date.UTC(2026, 9, 25, 0, 30), BERLIN)).toBe('2026-10-25T02:30:00+02:00');
    expect(toLocalIso(Date.UTC(2026, 9, 25, 1, 30), BERLIN)).toBe('2026-10-25T02:30:00+01:00');
  });

  it('formats a negative offset zone', () => {
    expect(toLocalIso(Date.UTC(2026, 9, 24, 12), 'America/New_York')).toBe(
      '2026-10-24T08:00:00-04:00',
    );
  });

  it('formats a half-hour offset zone', () => {
    expect(toLocalIso(Date.UTC(2026, 9, 24, 12), 'Asia/Kolkata')).toBe('2026-10-24T17:30:00+05:30');
  });

  it('formats UTC with a zero offset', () => {
    expect(toLocalIso(Date.UTC(2026, 9, 24, 12), 'UTC')).toBe('2026-10-24T12:00:00+00:00');
  });
});

describe('offsetMinutesAt', () => {
  it('reports minutes east of UTC', () => {
    expect(offsetMinutesAt(Date.UTC(2026, 9, 24, 12), BERLIN)).toBe(120);
    expect(offsetMinutesAt(Date.UTC(2026, 9, 26, 12), BERLIN)).toBe(60);
  });
});

describe('offsetMinutesAt with unreadable offset text', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns NaN when the formatter yields no time zone name', () => {
    jest.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockReturnValue([]);
    expect(offsetMinutesAt(Date.UTC(2026, 9, 24), 'Africa/Abidjan')).toBeNaN();
  });
});

describe('localDateOf', () => {
  it('rolls the date at local midnight, not UTC midnight', () => {
    expect(localDateOf(Date.UTC(2026, 9, 23, 21, 59, 59), BERLIN)).toBe('2026-10-23');
    expect(localDateOf(Date.UTC(2026, 9, 23, 22, 0, 0), BERLIN)).toBe('2026-10-24');
  });

  it('rolls at local midnight after the offset change', () => {
    expect(localDateOf(Date.UTC(2026, 9, 25, 22, 59, 59), BERLIN)).toBe('2026-10-25');
    expect(localDateOf(Date.UTC(2026, 9, 25, 23, 0, 0), BERLIN)).toBe('2026-10-26');
  });
});

describe('host time zone independence', () => {
  const original = process.env.TZ;

  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it.each(['UTC', 'Asia/Kolkata', 'America/New_York'])(
    'gives the same results under TZ=%s',
    (tz) => {
      process.env.TZ = tz;
      expect(candidates('2026-10-25 02:30:00')).toEqual([
        '2026-10-25T00:30:00.000Z',
        '2026-10-25T01:30:00.000Z',
      ]);
      expect(toLocalIso(Date.UTC(2026, 9, 24, 12), BERLIN)).toBe('2026-10-24T14:00:00+02:00');
      expect(localDateOf(Date.UTC(2026, 9, 23, 22), BERLIN)).toBe('2026-10-24');
    },
  );
});
