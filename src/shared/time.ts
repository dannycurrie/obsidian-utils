export const TIME_ZONE = 'Europe/London';

/** `YYYY-MM-DD HH:mm` in London time (or `timeZone`), for "Generated …" footers. */
export function formatGeneratedAt(now: Date, timeZone: string = TIME_ZONE): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
