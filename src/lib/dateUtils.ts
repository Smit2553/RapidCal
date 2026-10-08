import type { CalendarViewMode } from "../types/calendar";

export function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

export function addDays(d: Date, days: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + days);
  return c;
}

export function addMonths(d: Date, months: number): Date {
  const c = new Date(d);
  c.setMonth(c.getMonth() + months);
  return c;
}

export function startOfWeek(
  d: Date,
  weekStartsOn: "monday" | "sunday" = "monday"
): Date {
  const c = startOfDay(d);
  const day = c.getDay(); // 0=Sun..6=Sat
  const diff =
    weekStartsOn === "sunday" ? -day : day === 0 ? -6 : 1 - day;
  c.setDate(c.getDate() + diff);
  return c;
}

export function startOfWeekMonday(d: Date): Date {
  return startOfWeek(d, "monday");
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function getVisibleDaysForView(
  anchor: Date,
  view: CalendarViewMode,
  weekStartsOn: "monday" | "sunday" = "monday"
): Date[] {
  if (view === "day") {
    return [startOfDay(anchor)];
  }
  if (view === "3day") {
    const s = startOfDay(anchor);
    return [s, addDays(s, 1), addDays(s, 2)];
  }
  if (view === "workweek") {
    const mon = startOfWeekMonday(anchor);
    return [0, 1, 2, 3, 4].map((i) => addDays(mon, i));
  }
  const wkStart = startOfWeek(anchor, weekStartsOn);
  return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(wkStart, i));
}

export function getViewportRangeSeconds(
  anchor: Date,
  view: CalendarViewMode,
  weekStartsOn: "monday" | "sunday" = "monday"
): [number, number] {
  if (view === "month") {
    const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = startOfWeek(firstOfMonth, weekStartsOn);
    const gridEnd = endOfDay(addDays(gridStart, 41));
    return [
      Math.floor(gridStart.getTime() / 1000) - 86400,
      Math.floor(gridEnd.getTime() / 1000) + 86400,
    ];
  }
  if (view === "agenda" || view === "settings") {
    const start = startOfDay(addDays(anchor, -1));
    const end = endOfDay(addDays(anchor, 30));
    return [
      Math.floor(start.getTime() / 1000),
      Math.floor(end.getTime() / 1000),
    ];
  }
  const days = getVisibleDaysForView(anchor, view, weekStartsOn);
  const first = startOfDay(days[0]);
  const last = endOfDay(days[days.length - 1]);
  return [
    Math.floor(first.getTime() / 1000) - 86400,
    Math.floor(last.getTime() / 1000) + 86400,
  ];
}

export function getMonthGridDays(
  anchor: Date,
  weekStartsOn: "monday" | "sunday" = "monday"
): Date[] {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(firstOfMonth, weekStartsOn);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(addDays(start, i));
  }
  return days;
}

export function formatHeaderTitle(anchor: Date, view: CalendarViewMode): string {
  if (view === "settings") {
    return "Settings";
  }
  const monthFmt = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  });
  if (view === "day") {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(anchor);
  }
  return monthFmt.format(anchor);
}

export function formatTimeShort(
  tsSeconds: number,
  timeFormat: "12h" | "24h" = "12h"
): string {
  const d = new Date(tsSeconds * 1000);
  const hours = d.getHours();
  const mins = d.getMinutes();
  if (timeFormat === "24h") {
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  }
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  if (mins === 0) {
    return `${h12} ${ampm}`;
  }
  return `${h12}:${mins.toString().padStart(2, "0")} ${ampm}`;
}

export function formatTimeRange(
  startTs: number,
  endTs: number,
  timeFormat: "12h" | "24h" = "12h"
): string {
  return `${formatTimeShort(startTs, timeFormat)} – ${formatTimeShort(endTs, timeFormat)}`;
}

export function formatHourLabel(
  hour24: number,
  timeFormat: "12h" | "24h" = "12h"
): string {
  if (timeFormat === "24h") {
    return `${String(hour24).padStart(2, "0")}:00`;
  }
  const ampm = hour24 >= 12 ? "PM" : "AM";
  const h12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${h12} ${ampm}`;
}

export function formatDateInputValue(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatTimeInputValue(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function combineDateAndTimeInputs(
  dateStr: string,
  timeStr: string
): number {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  const [hh, mm] = timeStr.split(":").map((n) => parseInt(n, 10));
  const dt = new Date(y || 2026, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  return Math.floor(dt.getTime() / 1000);
}

export function formatSecondaryTzHour(
  hour24: number,
  secondaryTz: string,
  timeFormat: "12h" | "24h" = "12h"
): string {
  try {
    const ref = new Date();
    ref.setHours(hour24, 0, 0, 0);
    if (timeFormat === "24h") {
      const fmt = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hour12: false,
        timeZone: secondaryTz,
      });
      return `${fmt.format(ref)}:00`;
    }
    const fmt = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: true,
      timeZone: secondaryTz,
    });
    return fmt.format(ref);
  } catch {
    return `${String(hour24).padStart(2, "0")}:00`;
  }
}

export function getPrimaryTimezoneAbbr(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZoneName: "short",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value || "Local";
  } catch {
    return "Local";
  }
}
