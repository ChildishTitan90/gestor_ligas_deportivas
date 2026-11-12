function partsAt(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function venueLocalTime(date: Date, timeZone: string) {
  return partsAt(date, timeZone);
}

/** Reject nonexistent or ambiguous local times around a time zone transition. */
export function venueTimeToIso(value: unknown, timeZone: string) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(value)) return "";
  const local = value.length === 16 ? `${value}:00` : value;
  const wallTime = Date.parse(`${local}Z`);
  if (!Number.isFinite(wallTime)) return "";
  const day = 86_400_000;
  const offsets = new Set([-day, 0, day].map(delta => {
    const probe = wallTime + delta;
    return Date.parse(`${partsAt(new Date(probe), timeZone)}Z`) - probe;
  }));
  const matches = [...offsets].map(offset => new Date(wallTime - offset))
    .filter(date => partsAt(date, timeZone) === local);
  return matches.length === 1 ? matches[0].toISOString() : "";
}
