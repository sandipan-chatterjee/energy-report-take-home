import {
  ISO_DATE_LENGTH,
  ISO_FIELD_WIDTH,
  ISO_SECONDS_LENGTH,
  MINUTES_PER_HOUR,
  MS_PER_MINUTE,
  TRANSITION_PROBE_MS,
} from '../config/constants';

const WALL_TIME_PATTERN =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})$/;
const OFFSET_PATTERN = /^GMT(?:(?<sign>[+-])(?<hours>\d{2}):(?<minutes>\d{2}))?$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().slice(0, ISO_SECONDS_LENGTH);
}

/**
 * Parses a `YYYY-MM-DD HH:mm:ss` wall time into epoch ms as if it were UTC.
 * @param ts - Wall time text.
 * @returns The wall time as UTC epoch ms, or null when the text is not a real date and time.
 */
export function parseWallTime(ts: string): number | null {
  const parts = WALL_TIME_PATTERN.exec(ts)?.groups;
  if (parts === undefined) return null;
  const wallMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return isoSeconds(wallMs).replace('T', ' ') === ts ? wallMs : null;
}

/**
 * Returns the UTC offset of a time zone at an instant.
 * @param instant - Epoch ms.
 * @param timeZone - IANA time zone name.
 * @returns The offset in minutes east of UTC, or NaN if the zone's offset text cannot be read.
 */
export function offsetMinutesAt(instant: number, timeZone: string): number {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
    formatters.set(timeZone, formatter);
  }
  const name = formatter.formatToParts(instant).find((p) => p.type === 'timeZoneName')?.value;
  const match = OFFSET_PATTERN.exec(name ?? '');
  if (match === null) return NaN;
  const { sign, hours, minutes } = match.groups ?? {};
  if (sign === undefined) return 0;
  const total = Number(hours) * MINUTES_PER_HOUR + Number(minutes);
  return sign === '-' ? -total : total;
}

/**
 * Converts a wall time in a time zone to every instant that shows that wall time.
 * @param wallMs - Wall time as UTC epoch ms (see `parseWallTime`).
 * @param timeZone - IANA time zone name.
 * @returns Matching instants in ascending order: none for a skipped time, two for a repeated one.
 */
export function instantCandidates(wallMs: number, timeZone: string): number[] {
  const offsets = new Set([
    offsetMinutesAt(wallMs - TRANSITION_PROBE_MS, timeZone),
    offsetMinutesAt(wallMs + TRANSITION_PROBE_MS, timeZone),
  ]);
  return [...offsets]
    .filter((offset) => offsetMinutesAt(wallMs - offset * MS_PER_MINUTE, timeZone) === offset)
    .map((offset) => wallMs - offset * MS_PER_MINUTE)
    .sort((a, b) => a - b);
}

/**
 * Formats an instant as ISO 8601 local time with offset, `YYYY-MM-DDTHH:mm:ss±HH:MM`.
 * @param instant - Epoch ms.
 * @param timeZone - IANA time zone name.
 * @returns The local time text.
 */
export function toLocalIso(instant: number, timeZone: string): string {
  const offset = offsetMinutesAt(instant, timeZone);
  const abs = Math.abs(offset);
  const hours = String(Math.floor(abs / MINUTES_PER_HOUR)).padStart(ISO_FIELD_WIDTH, '0');
  const minutes = String(abs % MINUTES_PER_HOUR).padStart(ISO_FIELD_WIDTH, '0');
  const sign = offset < 0 ? '-' : '+';
  return `${isoSeconds(instant + offset * MS_PER_MINUTE)}${sign}${hours}:${minutes}`;
}

/**
 * Returns the local calendar date of an instant.
 * @param instant - Epoch ms.
 * @param timeZone - IANA time zone name.
 * @returns The date as `YYYY-MM-DD`.
 */
export function localDateOf(instant: number, timeZone: string): string {
  return toLocalIso(instant, timeZone).slice(0, ISO_DATE_LENGTH);
}
