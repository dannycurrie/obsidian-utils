export const TIME_ZONE = 'Europe/London';

export type IsoWeek = { year: number; week: number };

const WEEK_PATTERN = /^(\d{4})-W(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseIsoWeek(input: string): IsoWeek {
  const match = WEEK_PATTERN.exec(input);
  if (!match) throw new Error(`Invalid ISO week "${input}", expected e.g. 2026-W43`);
  const week = { year: Number(match[1]), week: Number(match[2]) };
  if (week.week < 1 || week.week > weeksInYear(week.year)) {
    throw new Error(`Invalid ISO week "${input}": ${week.year} has ${weeksInYear(week.year)} weeks`);
  }
  return week;
}

/** 52 or 53: 28 December is always in the last ISO week of its year. */
export function weeksInYear(year: number): number {
  return isoWeekOf(new Date(Date.UTC(year, 11, 28))).week;
}

export function formatIsoWeek({ year, week }: IsoWeek): string {
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Monday of the ISO week, as a UTC midnight Date standing in for a calendar date. */
export function isoWeekMonday({ year, week }: IsoWeek): Date {
  // 4 January is always in week 1.
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Weekday = (new Date(jan4).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(jan4 - jan4Weekday * DAY_MS + (week - 1) * 7 * DAY_MS);
}

/** ISO week containing a calendar date (given as a UTC midnight Date). */
export function isoWeekOf(date: Date): IsoWeek {
  const weekday = (date.getUTCDay() + 6) % 7;
  const thursday = new Date(date.getTime() + (3 - weekday) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - isoWeekMonday({ year, week: 1 }).getTime()) / (7 * DAY_MS)) + 1;
  return { year, week };
}

/** London calendar date of an instant, as a UTC midnight Date. */
export function londonDate(instant: Date): Date {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(instant).split('-');
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

/** The most recent ISO week that has fully ended in London time. */
export function lastCompleteIsoWeek(now: Date): IsoWeek {
  return previousIsoWeek(isoWeekOf(londonDate(now)));
}

/** Instant the week ends: London midnight at the start of the following Monday. */
export function weekEnd(week: IsoWeek): Date {
  return new Date(weekWindow(week).to);
}

export function previousIsoWeek(week: IsoWeek): IsoWeek {
  return isoWeekOf(addDays(isoWeekMonday(week), -7));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** London midnight at the start of a calendar date, e.g. "2026-10-12T00:00:00+01:00". */
export function londonMidnight(date: Date): string {
  // UK clocks change at 01:00 UTC, so the offset at 00:00 UTC is the one in force at local midnight.
  const offsetName = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')!.value;
  const offset = offsetName === 'GMT' ? '+00:00' : offsetName.slice(3);
  return `${date.toISOString().slice(0, 10)}T00:00:00${offset}`;
}

/** Half-open request window [Mon 00:00, next Mon 00:00) in London time. */
export function weekWindow(week: IsoWeek): { from: string; to: string } {
  const monday = isoWeekMonday(week);
  return { from: londonMidnight(monday), to: londonMidnight(addDays(monday, 7)) };
}

/** Header range such as "12–18 Oct" or "28 Sep – 4 Oct". */
export function formatWeekRange(week: IsoWeek): string {
  const monday = isoWeekMonday(week);
  const sunday = addDays(monday, 6);
  // Fixed names: ICU's en-GB short month for September is "Sept".
  const month = (d: Date) => MONTHS[d.getUTCMonth()];
  if (month(monday) === month(sunday)) {
    return `${monday.getUTCDate()}–${sunday.getUTCDate()} ${month(sunday)}`;
  }
  return `${monday.getUTCDate()} ${month(monday)} – ${sunday.getUTCDate()} ${month(sunday)}`;
}
