import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Account,
  Calendar,
  EventMaster,
  NlpParseResult,
  OAuthConfig,
  OutboxMutation,
  ReleaseAsset,
  SyncStatusSnapshot,
  UpdateCheckResult,
  UpsertEventInput,
  ViewportEvent,
} from "../types/calendar";
import { startOfWeekMonday } from "./dateUtils";

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

// ============================================================================
// Browser Fallback Engine (used only when previewing outside Tauri WebView)
// ============================================================================

const nowSec = () => Math.floor(Date.now() / 1000);
const nowIso = () => new Date().toISOString();

let fallbackAccounts: Account[] = [];
let fallbackCalendars: Calendar[] = [];
let fallbackEvents: EventMaster[] = [];
let fallbackOutbox: OutboxMutation[] = [];
let fallbackOAuthConfig: OAuthConfig = {
  googleClientId: "",
  googleClientSecret: null,
  msClientId: "",
  msTenantId: "common",
  hibernationEnabled: true,
  secondaryTimezone: "UTC",
  syncIntervalSecs: 60,
};

function initFallbackSeed() {
  if (import.meta.env.PROD) return;
  if (fallbackAccounts.length > 0) return;
  const iso = nowIso();
  fallbackAccounts = [
    {
      id: "acc-google-work",
      provider: "google",
      email: "alex@acme.com",
      displayName: "Alex Morgan (Work)",
      avatarUrl: null,
      status: "demo",
      lastSyncedAt: iso,
      createdAt: iso,
    },
    {
      id: "acc-ms-outlook",
      provider: "microsoft",
      email: "alex.morgan@contoso.com",
      displayName: "Alex Morgan (Contoso)",
      avatarUrl: null,
      status: "demo",
      lastSyncedAt: iso,
      createdAt: iso,
    },
    {
      id: "acc-google-personal",
      provider: "google",
      email: "alex.personal@gmail.com",
      displayName: "Alex Personal",
      avatarUrl: null,
      status: "demo",
      lastSyncedAt: iso,
      createdAt: iso,
    },
  ];

  fallbackCalendars = [
    {
      id: "cal-acme-eng",
      accountId: "acc-google-work",
      remoteId: "alex@acme.com",
      name: "Work Schedule",
      colorHex: "#6366f1",
      isVisible: true,
      isPrimary: true,
      accessRole: "owner",
      syncToken: "gcal-sync-token-v3-demo",
      timezone: "UTC",
    },
    {
      id: "cal-acme-launches",
      accountId: "acc-google-work",
      remoteId: "launches@acme.com",
      name: "Product & Launches",
      colorHex: "#ec4899",
      isVisible: true,
      isPrimary: false,
      accessRole: "writer",
      syncToken: "gcal-sync-token-v3-launches",
      timezone: "UTC",
    },
    {
      id: "cal-contoso-ent",
      accountId: "acc-ms-outlook",
      remoteId: "AAMkADk2-outlook-primary",
      name: "Contoso Team",
      colorHex: "#0ea5e9",
      isVisible: true,
      isPrimary: true,
      accessRole: "owner",
      syncToken: "ms-graph-deltalink-v1-demo",
      timezone: "UTC",
    },
    {
      id: "cal-contoso-exec",
      accountId: "acc-ms-outlook",
      remoteId: "AAMkADk2-outlook-exec",
      name: "Leadership & Planning",
      colorHex: "#f59e0b",
      isVisible: true,
      isPrimary: false,
      accessRole: "writer",
      syncToken: "ms-graph-deltalink-v1-exec",
      timezone: "UTC",
    },
    {
      id: "cal-personal",
      accountId: "acc-google-personal",
      remoteId: "alex.personal@gmail.com",
      name: "Personal & Wellness",
      colorHex: "#10b981",
      isVisible: true,
      isPrimary: true,
      accessRole: "owner",
      syncToken: "gcal-sync-token-v3-personal",
      timezone: "UTC",
    },
  ];

  const mon = startOfWeekMonday(new Date());
  const slot = (dayOffset: number, h: number, m: number) =>
    Math.floor(
      new Date(
        mon.getFullYear(),
        mon.getMonth(),
        mon.getDate() + dayOffset,
        h,
        m,
        0
      ).getTime() / 1000
    );

  const upNextStart = Math.floor(nowSec() / 300) * 300 + 15 * 60;

  fallbackEvents = [
    {
      id: "evt-standup-series",
      calendarId: "cal-acme-eng",
      remoteId: null,
      etag: null,
      icalUid: "standup@rapidcal.local",
      recurringEventId: null,
      originalStartTime: null,
      title: "Daily Team Check-In",
      description:
        "Quick morning check-in to coordinate priorities for the day.",
      location: "Google Meet",
      startTs: slot(0, 9, 30),
      endTs: slot(0, 10, 0),
      isAllDay: false,
      timezone: "UTC",
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      exdates: [],
      status: "confirmed",
      selfRsvp: "accepted",
      attendees: [
        {
          email: "alex@acme.com",
          displayName: "Alex Morgan",
          responseStatus: "accepted",
          isOrganizer: true,
          isSelf: true,
        },
        {
          email: "sarah.chen@acme.com",
          displayName: "Sarah Chen",
          responseStatus: "accepted",
          isOrganizer: false,
          isSelf: false,
        },
      ],
      conferenceUrl: "https://meet.google.com/rcd-core-sync",
      conferenceProvider: "meet",
      busyMirrorOfEventId: null,
      updatedAt: iso,
      isDirty: false,
    },
    {
      id: "evt-rust-arch",
      calendarId: "cal-acme-eng",
      remoteId: null,
      etag: null,
      icalUid: "rust-arch@rapidcal.local",
      recurringEventId: null,
      originalStartTime: null,
      title: "Product Strategy & Roadmap Review",
      description:
        "Reviewing upcoming quarterly milestones, customer feedback, and team goals.",
      location: "Google Meet • Room 4B",
      startTs: slot(0, 11, 0),
      endTs: slot(0, 12, 15),
      isAllDay: false,
      timezone: "UTC",
      rrule: null,
      exdates: [],
      status: "confirmed",
      selfRsvp: "accepted",
      attendees: [],
      conferenceUrl: "https://meet.google.com/wal-fts-perf",
      conferenceProvider: "meet",
      busyMirrorOfEventId: null,
      updatedAt: iso,
      isDirty: false,
    },
    {
      id: "evt-contoso-arch",
      calendarId: "cal-contoso-ent",
      remoteId: null,
      etag: null,
      icalUid: "contoso-arch@rapidcal.local",
      recurringEventId: null,
      originalStartTime: null,
      title: "Client Partnership Sync — Contoso",
      description:
        "Aligning on project deliverables, timeline, and next steps with the Contoso team.",
      location: "Microsoft Teams",
      startTs: slot(0, 11, 30),
      endTs: slot(0, 12, 30),
      isAllDay: false,
      timezone: "UTC",
      rrule: null,
      exdates: [],
      status: "confirmed",
      selfRsvp: "accepted",
      attendees: [],
      conferenceUrl:
        "https://teams.microsoft.com/l/meetup-join/contoso-delta-sync",
      conferenceProvider: "teams",
      busyMirrorOfEventId: null,
      updatedAt: iso,
      isDirty: false,
    },
    {
      id: "evt-tentative-roadmap",
      calendarId: "cal-contoso-exec",
      remoteId: null,
      etag: null,
      icalUid: "tentative@rapidcal.local",
      recurringEventId: null,
      originalStartTime: null,
      title: "Quarterly Budget & Operations Planning",
      description:
        "Reviewing department goals, resource allocation, and upcoming hiring plans.",
      location: "Microsoft Teams",
      startTs: slot(1, 14, 0),
      endTs: slot(1, 15, 0),
      isAllDay: false,
      timezone: "UTC",
      rrule: "FREQ=WEEKLY;BYDAY=TU,TH",
      exdates: [],
      status: "tentative",
      selfRsvp: "tentative",
      attendees: [],
      conferenceUrl: "https://teams.microsoft.com/l/meetup-join/exec-sec-audit",
      conferenceProvider: "teams",
      busyMirrorOfEventId: null,
      updatedAt: iso,
      isDirty: false,
    },
    {
      id: "evt-personal-dentist",
      calendarId: "cal-personal",
      remoteId: null,
      etag: null,
      icalUid: "dentist@rapidcal.local",
      recurringEventId: null,
      originalStartTime: null,
      title: "Dr. Nguyen — Dental Checkup",
      description:
        "Routine checkup — time also marked as Busy on the Contoso work calendar.",
      location: "450 Sutter St, Suite 1200",
      startTs: slot(2, 16, 0),
      endTs: slot(2, 17, 0),
      isAllDay: false,
      timezone: "UTC",
      rrule: null,
      exdates: [],
      status: "confirmed",
      selfRsvp: "accepted",
      attendees: [],
      conferenceUrl: null,
      conferenceProvider: null,
      busyMirrorOfEventId: null,
      updatedAt: iso,
      isDirty: false,
    },
    {
      id: "evt-mirror-dentist",
      calendarId: "cal-contoso-ent",
      remoteId: null,
      etag: null,
      icalUid: "mirror-dentist@rapidcal.local",
      recurringEventId: null,
      originalStartTime: null,
      title: "[Busy] Dr. Nguyen — Dental Checkup",
      description: "Automatically blocked by RapidCal",
      location: "",
      startTs: slot(2, 16, 0),
      endTs: slot(2, 17, 0),
      isAllDay: false,
      timezone: "UTC",
      rrule: null,
      exdates: [],
      status: "confirmed",
      selfRsvp: "accepted",
      attendees: [],
      conferenceUrl: null,
      conferenceProvider: null,
      busyMirrorOfEventId: "evt-personal-dentist",
      updatedAt: iso,
      isDirty: false,
    },
    {
      id: "evt-live-up-next",
      calendarId: "cal-acme-eng",
      remoteId: null,
      etag: null,
      icalUid: "upnext@rapidcal.local",
      recurringEventId: null,
      originalStartTime: null,
      title: "Weekly Design & Product Sync",
      description: "Catching up on weekly progress and upcoming milestones.",
      location: "Google Meet",
      startTs: upNextStart,
      endTs: upNextStart + 45 * 60,
      isAllDay: false,
      timezone: "UTC",
      rrule: null,
      exdates: [],
      status: "confirmed",
      selfRsvp: "accepted",
      attendees: [],
      conferenceUrl: "https://meet.google.com/rapidcal-live-demo",
      conferenceProvider: "meet",
      busyMirrorOfEventId: null,
      updatedAt: iso,
      isDirty: false,
    },
  ];
}

function packFallbackViewport(events: ViewportEvent[]): ViewportEvent[] {
  events.sort(
    (a, b) => a.startTs - b.startTs || b.endTs - b.startTs - (a.endTs - a.startTs)
  );
  const timed = events.filter((e) => !e.isAllDay);
  let clusterId = 1;
  let clusterMembers: ViewportEvent[] = [];
  let colEnds: number[] = [];
  let maxEnd = -Infinity;

  for (const ev of timed) {
    const vEnd = Math.max(ev.endTs, ev.startTs + 900);
    if (clusterMembers.length > 0 && ev.startTs >= maxEnd) {
      for (const m of clusterMembers) {
        m.totalCols = Math.max(1, colEnds.length);
        m.clusterId = clusterId;
      }
      clusterId++;
      clusterMembers = [];
      colEnds = [];
      maxEnd = -Infinity;
    }
    let col = colEnds.findIndex((end) => end <= ev.startTs);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(vEnd);
    } else {
      colEnds[col] = vEnd;
    }
    ev.colIndex = col;
    clusterMembers.push(ev);
    if (vEnd > maxEnd) maxEnd = vEnd;
  }
  for (const m of clusterMembers) {
    m.totalCols = Math.max(1, colEnds.length);
    m.clusterId = clusterId;
  }
  return events;
}

let nextOutboxId = 1;

function enqueueFallbackOutbox(
  calendarId: string,
  eventId: string,
  operation: string,
  payload: unknown
) {
  const cal = fallbackCalendars.find((c) => c.id === calendarId);
  const accountId = cal?.accountId || "acc-google-work";
  fallbackOutbox = fallbackOutbox.filter(
    (m) => !(m.calendarId === calendarId && m.eventId === eventId)
  );
  fallbackOutbox.push({
    id: nextOutboxId++,
    accountId,
    calendarId,
    eventId,
    operation,
    payloadJson: JSON.stringify(payload),
    retryCount: 0,
    nextRetryAt: nowSec(),
    lastError: null,
    createdAt: nowIso(),
  });
}

const FALLBACK_DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const FALLBACK_DAY_LABELS: Record<string, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};
const FALLBACK_MONDAY_ORDER: Record<string, number> = {
  MO: 0,
  TU: 1,
  WE: 2,
  TH: 3,
  FR: 4,
  SA: 5,
  SU: 6,
};

export function describeFallbackRrule(rrule: string | null): string | null {
  if (!rrule) return null;
  const u = rrule.toUpperCase().replace(/^RRULE:/, "").trim();
  if (!u) return null;
  if (
    u === "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" ||
    u.startsWith("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;")
  ) {
    return "Every weekday (Mon–Fri)";
  }

  let freq = "";
  let interval = 1;
  let byday: string[] = [];
  for (const kv of u.split(";")) {
    const eq = kv.indexOf("=");
    if (eq === -1) continue;
    const k = kv.slice(0, eq).trim();
    const v = kv.slice(eq + 1).trim();
    if (k === "FREQ") freq = v;
    else if (k === "INTERVAL") interval = Math.max(1, parseInt(v, 10) || 1);
    else if (k === "BYDAY") byday = v.split(",").map((s) => s.trim()).filter(Boolean);
  }

  const dayNames = byday.map((d) => FALLBACK_DAY_LABELS[d] || d);
  if (freq === "DAILY") return interval === 1 ? "Every day" : `Every ${interval} days`;
  if (freq === "WEEKLY") {
    if (dayNames.length > 0) {
      return interval === 1
        ? `Weekly on ${dayNames.join(", ")}`
        : `Every ${interval} weeks on ${dayNames.join(", ")}`;
    }
    return interval === 1 ? "Every week" : `Every ${interval} weeks`;
  }
  if (freq === "MONTHLY") return interval === 1 ? "Every month" : `Every ${interval} months`;
  if (freq === "YEARLY") return interval === 1 ? "Every year" : `Every ${interval} years`;
  return `Recurring (${u})`;
}

function shiftFallbackRruleByDay(
  rrule: string | null,
  oldOccTs: number,
  newOccTs: number
): string | null {
  if (!rrule) return null;
  const oldWd = FALLBACK_DAY_CODES[new Date(oldOccTs * 1000).getDay()];
  const newWd = FALLBACK_DAY_CODES[new Date(newOccTs * 1000).getDay()];
  if (!oldWd || !newWd || oldWd === newWd) return rrule;

  return rrule
    .split(";")
    .map((clause) => {
      const eqIdx = clause.indexOf("=");
      if (eqIdx === -1) return clause;
      const key = clause.slice(0, eqIdx).trim().toUpperCase();
      const val = clause.slice(eqIdx + 1).trim();
      if (key !== "BYDAY") return clause;

      const updated: string[] = [];
      for (const rawTok of val.split(",")) {
        const tok = rawTok.trim().toUpperCase();
        if (!tok) continue;
        const nextTok =
          tok.length >= 2 && tok.endsWith(oldWd)
            ? `${tok.slice(0, tok.length - 2)}${newWd}`
            : tok;
        if (!updated.includes(nextTok)) {
          updated.push(nextTok);
        }
      }
      if (
        updated.length > 1 &&
        updated.every((t) => FALLBACK_MONDAY_ORDER[t] !== undefined)
      ) {
        updated.sort(
          (a, b) => (FALLBACK_MONDAY_ORDER[a] ?? 9) - (FALLBACK_MONDAY_ORDER[b] ?? 9)
        );
      }
      return updated.length > 0 ? `BYDAY=${updated.join(",")}` : clause;
    })
    .join(";");
}

function resolveFallbackSeriesMasterStartTs(
  masterStartTs: number,
  oldOccTs: number,
  newOccTs: number,
  rrule: string | null
): number {
  if (rrule) {
    const clean = rrule.toUpperCase();
    let isWeekly = false;
    let plainByDays: string[] = [];
    for (const clause of clean.split(";")) {
      const eq = clause.indexOf("=");
      if (eq === -1) continue;
      const k = clause.slice(0, eq).trim();
      const v = clause.slice(eq + 1).trim();
      if (k === "FREQ" && v === "WEEKLY") isWeekly = true;
      else if (k === "BYDAY") {
        const toks = v.split(",").map((s) => s.trim()).filter(Boolean);
        if (
          toks.length > 0 &&
          toks.every((t) => FALLBACK_MONDAY_ORDER[t] !== undefined)
        ) {
          plainByDays = toks;
        }
      }
    }

    if (isWeekly && plainByDays.length > 0) {
      const mDate = new Date(masterStartTs * 1000);
      const oDate = new Date(oldOccTs * 1000);
      const nDate = new Date(newOccTs * 1000);
      const mMonday = startOfWeekMonday(mDate);
      const oMonday = startOfWeekMonday(oDate);
      const nMonday = startOfWeekMonday(nDate);
      const weekShiftDays = Math.round(
        (nMonday.getTime() - oMonday.getTime()) / (86400 * 1000)
      );

      for (let d = 0; d < 7; d++) {
        const candidate = new Date(
          mMonday.getFullYear(),
          mMonday.getMonth(),
          mMonday.getDate() + weekShiftDays + d,
          nDate.getHours(),
          nDate.getMinutes(),
          nDate.getSeconds()
        );
        const code = FALLBACK_DAY_CODES[candidate.getDay()];
        if (code && plainByDays.includes(code)) {
          return Math.floor(candidate.getTime() / 1000);
        }
      }
    }
  }

  if (oldOccTs === masterStartTs) return newOccTs;
  return masterStartTs + (newOccTs - oldOccTs);
}

function shiftFallbackSeriesExdates(
  exdates: number[],
  oldOccTs: number,
  newOccTs: number,
  rrule: string | null
): number[] {
  if (exdates.length === 0 || oldOccTs === newOccTs) return [...exdates];
  const hasByDay = Boolean(rrule && rrule.toUpperCase().includes("BYDAY="));
  const oDate = new Date(oldOccTs * 1000);
  const nDate = new Date(newOccTs * 1000);
  const oDayMidnight = new Date(oDate.getFullYear(), oDate.getMonth(), oDate.getDate());
  const nDayMidnight = new Date(nDate.getFullYear(), nDate.getMonth(), nDate.getDate());
  const dayDelta = Math.round(
    (nDayMidnight.getTime() - oDayMidnight.getTime()) / (86400 * 1000)
  );

  const out: number[] = [];
  for (const exTs of exdates) {
    const exDate = new Date(exTs * 1000);
    const shiftDays = !hasByDay || exDate.getDay() === oDate.getDay() ? dayDelta : 0;
    const shifted = Math.floor(
      new Date(
        exDate.getFullYear(),
        exDate.getMonth(),
        exDate.getDate() + shiftDays,
        nDate.getHours(),
        nDate.getMinutes(),
        nDate.getSeconds()
      ).getTime() / 1000
    );
    if (!out.includes(shifted)) {
      out.push(shifted);
    }
  }
  return out;
}

// ============================================================================
// Typed IPC API
// ============================================================================

export const api = {
  async listAccounts(): Promise<Account[]> {
    if (isTauriRuntime()) return invoke<Account[]>("list_accounts");
    initFallbackSeed();
    return [...fallbackAccounts];
  },

  async removeAccount(accountId: string): Promise<void> {
    if (isTauriRuntime())
      return invoke<void>("remove_account", { accountId });
    const removedCalIds = new Set(
      fallbackCalendars.filter((c) => c.accountId === accountId).map((c) => c.id)
    );
    fallbackAccounts = fallbackAccounts.filter((a) => a.id !== accountId);
    fallbackCalendars = fallbackCalendars.filter(
      (c) => c.accountId !== accountId
    );
    fallbackEvents = fallbackEvents.filter(
      (e) => !removedCalIds.has(e.calendarId)
    );
    fallbackOutbox = fallbackOutbox.filter((m) => m.accountId !== accountId);
  },

  async connectOAuthAccount(provider: string): Promise<Account> {
    if (isTauriRuntime())
      return invoke<Account>("connect_oauth_account", { provider });
    throw new Error(
      "Connecting a live calendar account requires running the RapidCal desktop app."
    );
  },

  async connectIcsAccount(url: string, name?: string): Promise<Account> {
    if (isTauriRuntime())
      return invoke<Account>("connect_ics_account", {
        url,
        name: name?.trim() ? name.trim() : null,
      });
    throw new Error(
      "Subscribing to a live .ics calendar feed requires running the RapidCal desktop app."
    );
  },

  async listCalendars(): Promise<Calendar[]> {
    if (isTauriRuntime()) return invoke<Calendar[]>("list_calendars");
    initFallbackSeed();
    return [...fallbackCalendars];
  },

  async toggleCalendarVisibility(
    calendarId: string,
    isVisible: boolean
  ): Promise<void> {
    if (isTauriRuntime())
      return invoke<void>("toggle_calendar_visibility", {
        calendarId,
        isVisible,
      });
    fallbackCalendars = fallbackCalendars.map((c) =>
      c.id === calendarId ? { ...c, isVisible } : c
    );
  },

  async updateCalendarColor(
    calendarId: string,
    colorHex: string
  ): Promise<void> {
    if (isTauriRuntime())
      return invoke<void>("update_calendar_color", { calendarId, colorHex });
    fallbackCalendars = fallbackCalendars.map((c) =>
      c.id === calendarId ? { ...c, colorHex } : c
    );
  },

  async getViewportEvents(
    startTs: number,
    endTs: number
  ): Promise<ViewportEvent[]> {
    if (isTauriRuntime())
      return invoke<ViewportEvent[]>("get_viewport_events", {
        startTs,
        endTs,
      });
    initFallbackSeed();
    const out: ViewportEvent[] = [];
    for (const ev of fallbackEvents) {
      if (ev.status === "cancelled") continue;
      const cal = fallbackCalendars.find((c) => c.id === ev.calendarId);
      if (!cal || !cal.isVisible) continue;
      const acc = fallbackAccounts.find((a) => a.id === cal.accountId);
      const dur = Math.max(900, ev.endTs - ev.startTs);

      if (ev.rrule && (ev.rrule.includes("FREQ=WEEKLY") || ev.rrule.includes("FREQ=DAILY"))) {
        const startDayDelta = Math.floor((startTs - ev.startTs) / 86400) - 1;
        const endDayDelta = Math.ceil((endTs - ev.startTs) / 86400) + 1;
        const minD = Math.max(-365, startDayDelta);
        const maxD = Math.min(730, endDayDelta);
        const dayMap: Record<number, string> = {
          0: "SU",
          1: "MO",
          2: "TU",
          3: "WE",
          4: "TH",
          5: "FR",
          6: "SA",
        };
        const byDayMatch = ev.rrule.toUpperCase().match(/BYDAY=([A-Z,]+)/);
        const allowedDays = byDayMatch ? byDayMatch[1].split(",") : null;

        for (let d = minD; d <= maxD; d++) {
          const occStart = ev.startTs + d * 86400;
          if (occStart < ev.startTs) continue;
          if (ev.exdates.includes(occStart)) continue;
          const occEnd = occStart + dur;
          const dowCode = dayMap[new Date(occStart * 1000).getDay()];
          if (allowedDays && !allowedDays.includes(dowCode)) {
            continue;
          } else if (
            !allowedDays &&
            ev.rrule.toUpperCase().includes("FREQ=WEEKLY") &&
            new Date(occStart * 1000).getDay() !==
              new Date(ev.startTs * 1000).getDay()
          ) {
            continue;
          }
          if (occEnd >= startTs && occStart <= endTs) {
            out.push({
              instanceId: `${ev.id}:${occStart}`,
              eventId: ev.id,
              masterEventId: ev.recurringEventId,
              calendarId: cal.id,
              accountId: cal.accountId,
              provider: acc?.provider || "google",
              calendarName: cal.name,
              colorHex: cal.colorHex,
              title: ev.title,
              description: ev.description,
              location: ev.location,
              startTs: occStart,
              endTs: occEnd,
              isAllDay: ev.isAllDay,
              timezone: ev.timezone,
              rrule: ev.rrule,
              rruleHuman: describeFallbackRrule(ev.rrule),
              isRecurring: true,
              isException: Boolean(ev.recurringEventId),
              status: ev.status,
              selfRsvp: ev.selfRsvp,
              attendees: ev.attendees,
              conferenceUrl: ev.conferenceUrl,
              conferenceProvider: ev.conferenceProvider,
              busyMirrorOfEventId: ev.busyMirrorOfEventId,
              isDirty: ev.isDirty,
              colIndex: 0,
              totalCols: 1,
              clusterId: 0,
            });
          }
        }
      } else if (ev.endTs >= startTs && ev.startTs <= endTs) {
        out.push({
          instanceId: `${ev.id}:${ev.startTs}`,
          eventId: ev.id,
          masterEventId: ev.recurringEventId,
          calendarId: cal.id,
          accountId: cal.accountId,
          provider: acc?.provider || "google",
          calendarName: cal.name,
          colorHex: cal.colorHex,
          title: ev.title,
          description: ev.description,
          location: ev.location,
          startTs: ev.startTs,
          endTs: ev.endTs,
          isAllDay: ev.isAllDay,
          timezone: ev.timezone,
          rrule: ev.rrule,
          rruleHuman: describeFallbackRrule(ev.rrule),
          isRecurring: Boolean(ev.rrule || ev.recurringEventId),
          isException: Boolean(ev.recurringEventId),
          status: ev.status,
          selfRsvp: ev.selfRsvp,
          attendees: ev.attendees,
          conferenceUrl: ev.conferenceUrl,
          conferenceProvider: ev.conferenceProvider,
          busyMirrorOfEventId: ev.busyMirrorOfEventId,
          isDirty: ev.isDirty,
          colIndex: 0,
          totalCols: 1,
          clusterId: 0,
        });
      }
    }
    return packFallbackViewport(out);
  },

  async upsertEvent(input: UpsertEventInput): Promise<EventMaster> {
    if (isTauriRuntime()) return invoke<EventMaster>("upsert_event", { input });
    initFallbackSeed();
    const id = input.id || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const existing = fallbackEvents.find((e) => e.id === id);

    // Single-instance exception split on a recurring series
    if (
      existing &&
      existing.rrule &&
      input.editScope === "single" &&
      input.instanceStartTs != null
    ) {
      if (!existing.exdates.includes(input.instanceStartTs)) {
        existing.exdates = [...existing.exdates, input.instanceStartTs];
        existing.updatedAt = nowIso();
        existing.isDirty = true;
        enqueueFallbackOutbox(existing.calendarId, existing.id, "upsert", existing);
        fallbackEvents = fallbackEvents.map((e) => {
          if (e.busyMirrorOfEventId === existing.id) {
            const updatedMirror: EventMaster = {
              ...e,
              exdates: [...existing.exdates],
              updatedAt: nowIso(),
              isDirty: true,
            };
            enqueueFallbackOutbox(
              updatedMirror.calendarId,
              updatedMirror.id,
              "upsert",
              updatedMirror
            );
            return updatedMirror;
          }
          return e;
        });
      }
      const excId = `evt-exc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const exceptionEvent: EventMaster = {
        id: excId,
        calendarId: input.calendarId,
        remoteId: null,
        etag: null,
        icalUid: existing.icalUid,
        recurringEventId: existing.id,
        originalStartTime: input.instanceStartTs,
        title: input.title,
        description: input.description ?? existing.description,
        location: input.location ?? existing.location,
        startTs: input.startTs,
        endTs: Math.max(input.endTs, input.startTs + 900),
        isAllDay: input.isAllDay,
        timezone: input.timezone || existing.timezone || "UTC",
        rrule: null,
        exdates: [],
        status: input.status || existing.status || "confirmed",
        selfRsvp: input.selfRsvp || existing.selfRsvp || "accepted",
        attendees: input.attendees || existing.attendees || [],
        conferenceUrl: input.conferenceUrl ?? existing.conferenceUrl ?? null,
        conferenceProvider:
          input.conferenceProvider ?? existing.conferenceProvider ?? null,
        busyMirrorOfEventId: null,
        updatedAt: nowIso(),
        isDirty: true,
      };
      fallbackEvents = [...fallbackEvents, exceptionEvent];
      enqueueFallbackOutbox(
        exceptionEvent.calendarId,
        exceptionEvent.id,
        "upsert",
        exceptionEvent
      );
      return exceptionEvent;
    }

    const rawRrule =
      input.rrule !== undefined ? input.rrule : existing?.rrule || null;
    let nextRrule = rawRrule;
    let nextStartTs = input.startTs;
    let nextEndTs = Math.max(input.endTs, input.startTs + 900);
    let nextExdates = existing?.exdates || [];

    if (existing && existing.rrule) {
      const oldOccTs = input.instanceStartTs ?? existing.startTs;
      const newDuration = Math.max(900, input.endTs - input.startTs);
      nextRrule = shiftFallbackRruleByDay(rawRrule, oldOccTs, input.startTs);
      nextStartTs = resolveFallbackSeriesMasterStartTs(
        existing.startTs,
        oldOccTs,
        input.startTs,
        nextRrule
      );
      nextEndTs = nextStartTs + newDuration;
      nextExdates = shiftFallbackSeriesExdates(
        existing.exdates,
        oldOccTs,
        input.startTs,
        nextRrule
      );
    }

    const created: EventMaster = {
      id,
      calendarId: input.calendarId,
      remoteId: existing?.remoteId || null,
      etag: existing?.etag || null,
      icalUid: existing?.icalUid || `${id}@rapidcal.local`,
      recurringEventId: existing?.recurringEventId || null,
      originalStartTime: existing?.originalStartTime || null,
      title: input.title,
      description: input.description ?? existing?.description ?? "",
      location: input.location ?? existing?.location ?? "",
      startTs: nextStartTs,
      endTs: nextEndTs,
      isAllDay: input.isAllDay,
      timezone: input.timezone || existing?.timezone || "UTC",
      rrule: nextRrule,
      exdates: nextExdates,
      status: input.status || existing?.status || "confirmed",
      selfRsvp: input.selfRsvp || existing?.selfRsvp || "accepted",
      attendees: input.attendees || existing?.attendees || [],
      conferenceUrl: input.conferenceUrl ?? existing?.conferenceUrl ?? null,
      conferenceProvider:
        input.conferenceProvider ?? existing?.conferenceProvider ?? null,
      busyMirrorOfEventId: existing?.busyMirrorOfEventId || null,
      updatedAt: nowIso(),
      isDirty: true,
    };

    // Propagate updated time bounds and recurrence rules to linked Cross-Account Busy Mirrors
    fallbackEvents = fallbackEvents.map((e) => {
      if (e.busyMirrorOfEventId === id) {
        const updatedMirror: EventMaster = {
          ...e,
          startTs: created.startTs,
          endTs: created.endTs,
          isAllDay: created.isAllDay,
          rrule: created.rrule,
          exdates: [...created.exdates],
          updatedAt: nowIso(),
          isDirty: true,
        };
        enqueueFallbackOutbox(
          updatedMirror.calendarId,
          updatedMirror.id,
          "upsert",
          updatedMirror
        );
        return updatedMirror;
      }
      return e;
    });

    fallbackEvents = [
      ...fallbackEvents.filter((e) => e.id !== id),
      created,
    ];
    enqueueFallbackOutbox(created.calendarId, created.id, "upsert", created);
    return created;
  },

  async moveOrResizeEvent(
    eventId: string,
    instanceStartTs: number | null,
    newStartTs: number,
    newEndTs: number,
    editScope: string | null = null
  ): Promise<EventMaster> {
    if (isTauriRuntime())
      return invoke<EventMaster>("move_or_resize_event", {
        eventId,
        instanceStartTs,
        newStartTs,
        newEndTs,
        editScope,
      });
    initFallbackSeed();
    const ev = fallbackEvents.find((e) => e.id === eventId);
    if (!ev) throw new Error("Event not found");
    return this.upsertEvent({
      id: ev.id,
      calendarId: ev.calendarId,
      title: ev.title,
      description: ev.description,
      location: ev.location,
      startTs: newStartTs,
      endTs: newEndTs,
      isAllDay: ev.isAllDay,
      timezone: ev.timezone,
      rrule: ev.rrule,
      status: ev.status,
      selfRsvp: ev.selfRsvp,
      attendees: ev.attendees,
      conferenceUrl: ev.conferenceUrl,
      conferenceProvider: ev.conferenceProvider,
      editScope: editScope === "single" ? "single" : "all",
      instanceStartTs,
    });
  },

  async deleteEvent(
    eventId: string,
    instanceStartTs: number | null = null,
    deleteScope: string | null = null
  ): Promise<void> {
    if (isTauriRuntime())
      return invoke<void>("delete_event", {
        eventId,
        instanceStartTs,
        deleteScope,
      });
    initFallbackSeed();
    const ev = fallbackEvents.find((e) => e.id === eventId);
    if (!ev) return;

    if (ev.rrule && deleteScope === "single" && instanceStartTs != null) {
      if (!ev.exdates.includes(instanceStartTs)) {
        ev.exdates = [...ev.exdates, instanceStartTs];
        ev.updatedAt = nowIso();
        ev.isDirty = true;
        enqueueFallbackOutbox(ev.calendarId, ev.id, "upsert", ev);
        fallbackEvents = fallbackEvents.map((e) => {
          if (e.busyMirrorOfEventId === ev.id) {
            const updatedMirror: EventMaster = {
              ...e,
              exdates: [...ev.exdates],
              updatedAt: nowIso(),
              isDirty: true,
            };
            enqueueFallbackOutbox(
              updatedMirror.calendarId,
              updatedMirror.id,
              "upsert",
              updatedMirror
            );
            return updatedMirror;
          }
          return e;
        });
      }
      return;
    }

    const toDelete = fallbackEvents.filter(
      (e) => e.id === eventId || e.busyMirrorOfEventId === eventId
    );
    for (const item of toDelete) {
      enqueueFallbackOutbox(item.calendarId, item.id, "delete", {
        eventId: item.id,
        remoteId: item.remoteId,
      });
    }
    fallbackEvents = fallbackEvents.filter(
      (e) => e.id !== eventId && e.busyMirrorOfEventId !== eventId
    );
  },

  async updateRsvp(
    eventId: string,
    responseStatus: string
  ): Promise<EventMaster> {
    if (isTauriRuntime())
      return invoke<EventMaster>("update_rsvp", { eventId, responseStatus });
    initFallbackSeed();
    const ev = fallbackEvents.find((e) => e.id === eventId);
    if (!ev) throw new Error("Event not found");
    ev.selfRsvp = responseStatus;
    ev.status = responseStatus === "tentative" ? "tentative" : "confirmed";
    ev.attendees = ev.attendees.map((a) =>
      a.isSelf ? { ...a, responseStatus } : a
    );
    ev.updatedAt = nowIso();
    ev.isDirty = true;
    enqueueFallbackOutbox(ev.calendarId, ev.id, "rsvp", {
      eventId: ev.id,
      responseStatus,
    });
    return { ...ev };
  },

  async createBusyMirror(
    sourceEventId: string,
    targetCalendarId: string,
    redactTitle: boolean
  ): Promise<EventMaster> {
    if (isTauriRuntime())
      return invoke<EventMaster>("create_busy_mirror", {
        sourceEventId,
        targetCalendarId,
        redactTitle,
      });
    initFallbackSeed();
    const src = fallbackEvents.find((e) => e.id === sourceEventId);
    if (!src) throw new Error("Source event not found");
    const existingMirror = fallbackEvents.find(
      (e) =>
        e.busyMirrorOfEventId === sourceEventId &&
        e.calendarId === targetCalendarId
    );
    const mirrorTitle = redactTitle
      ? "[Busy] Private Commitment"
      : `[Busy] ${src.title}`;

    if (existingMirror) {
      existingMirror.title = mirrorTitle;
      existingMirror.startTs = src.startTs;
      existingMirror.endTs = src.endTs;
      existingMirror.isAllDay = src.isAllDay;
      existingMirror.rrule = src.rrule;
      existingMirror.exdates = [...src.exdates];
      existingMirror.updatedAt = nowIso();
      existingMirror.isDirty = true;
      enqueueFallbackOutbox(
        existingMirror.calendarId,
        existingMirror.id,
        "upsert",
        existingMirror
      );
      return { ...existingMirror };
    }

    const mirror: EventMaster = {
      ...src,
      id: `evt-mirror-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      calendarId: targetCalendarId,
      remoteId: null,
      etag: null,
      title: mirrorTitle,
      description: `Automatically busy-blocked by RapidCal from event ${src.id}`,
      location: "",
      attendees: [],
      conferenceUrl: null,
      conferenceProvider: null,
      busyMirrorOfEventId: src.id,
      updatedAt: nowIso(),
      isDirty: true,
    };
    fallbackEvents.push(mirror);
    enqueueFallbackOutbox(mirror.calendarId, mirror.id, "upsert", mirror);
    return mirror;
  },

  async searchEvents(query: string, limit = 25): Promise<ViewportEvent[]> {
    if (isTauriRuntime())
      return invoke<ViewportEvent[]>("search_events", { query, limit });
    const all = await this.getViewportEvents(
      nowSec() - 30 * 86400,
      nowSec() + 90 * 86400
    );
    const q = query.toLowerCase();
    return all
      .filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.location.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.attendees.some(
            (a) =>
              a.email.toLowerCase().includes(q) ||
              (a.displayName && a.displayName.toLowerCase().includes(q))
          )
      )
      .slice(0, limit);
  },

  async parseNaturalLanguageEvent(
    rawInput: string,
    referenceTs?: number,
    timezone?: string
  ): Promise<NlpParseResult> {
    if (isTauriRuntime())
      return invoke<NlpParseResult>("parse_natural_language_event", {
        rawInput,
        referenceTs,
        timezone,
      });
    initFallbackSeed();
    const baseSec = referenceTs || nowSec();
    const refDate = new Date(baseSec * 1000);
    let working = rawInput;

    // 1. Extract attendees (emails) and @Calendar hint
    const attendees: string[] = [];
    let calendarHint: string | null = null;
    working = working.replace(/(\S+)/g, (tok) => {
      const cleaned = tok.replace(/^[,;]+|[,;]+$/g, "");
      if (cleaned.includes("@") && !cleaned.startsWith("@") && cleaned.includes(".")) {
        attendees.push(cleaned);
        return "";
      }
      if (cleaned.startsWith("@") && cleaned.length > 1) {
        calendarHint = cleaned.slice(1);
        return "";
      }
      return tok;
    });

    const matchedCal = calendarHint
      ? fallbackCalendars.find((c) => {
          const h = calendarHint!.toLowerCase();
          return (
            c.name.toLowerCase().includes(h) ||
            c.remoteId.toLowerCase().includes(h) ||
            c.accountId.toLowerCase().includes(h)
          );
        })
      : fallbackCalendars.find((c) => c.isPrimary) || fallbackCalendars[0];

    // 2. Conference detection
    let conferenceProvider: string | null = null;
    let conferenceUrl: string | null = null;
    if (/\bzoom\b/i.test(working)) {
      conferenceProvider = "zoom";
      conferenceUrl = "https://zoom.us/j/rapidcal-instant";
      working = working.replace(/\b(?:at|on|in|via)?\s*zoom\b/gi, "");
    } else if (/\bteams\b/i.test(working)) {
      conferenceProvider = "teams";
      conferenceUrl = "https://teams.microsoft.com/l/meetup-join/rapidcal";
      working = working.replace(/\b(?:at|on|in|via)?\s*teams\b/gi, "");
    } else if (/\b(?:google\s+meet|gmeet|meet)\b/i.test(working)) {
      conferenceProvider = "meet";
      conferenceUrl = "https://meet.google.com/new";
      working = working.replace(/\b(?:at|on|in|via)?\s*(?:google\s+meet|gmeet|meet)\b/gi, "");
    }

    // 3. Recurrence detection
    let rrule: string | null = null;
    if (/\bevery\s+weekday\b/i.test(working)) {
      rrule = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
      working = working.replace(/\bevery\s+weekday\b/gi, "");
    } else if (/\b(?:every\s+day|daily)\b/i.test(working)) {
      rrule = "FREQ=DAILY";
      working = working.replace(/\b(?:every\s+day|daily)\b/gi, "");
    } else if (/\b(?:every\s+month|monthly)\b/i.test(working)) {
      rrule = "FREQ=MONTHLY";
      working = working.replace(/\b(?:every\s+month|monthly)\b/gi, "");
    } else {
      const everyDayMatch = working.match(
        /\bevery\s+(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i
      );
      if (everyDayMatch) {
        const code = everyDayMatch[1].slice(0, 2).toUpperCase();
        rrule = `FREQ=WEEKLY;BYDAY=${code}`;
        working = working.replace(everyDayMatch[0], "");
      } else if (/\b(?:every\s+week|weekly)\b/i.test(working)) {
        rrule = "FREQ=WEEKLY";
        working = working.replace(/\b(?:every\s+week|weekly)\b/gi, "");
      }
    }

    // 4. Date detection
    const targetDate = new Date(
      refDate.getFullYear(),
      refDate.getMonth(),
      refDate.getDate(),
      0,
      0,
      0
    );
    if (/\bday\s+after\s+tomorrow\b/i.test(working)) {
      targetDate.setDate(targetDate.getDate() + 2);
      working = working.replace(/\bday\s+after\s+tomorrow\b/gi, "");
    } else if (/\b(?:tomorrow|tmr|tmrw)\b/i.test(working)) {
      targetDate.setDate(targetDate.getDate() + 1);
      working = working.replace(/\b(?:tomorrow|tmr|tmrw)\b/gi, "");
    } else if (/\btoday\b/i.test(working)) {
      working = working.replace(/\btoday\b/gi, "");
    } else {
      const dowNames: Record<string, number> = {
        sun: 0,
        mon: 1,
        tue: 2,
        wed: 3,
        thu: 4,
        fri: 5,
        sat: 6,
      };
      const dowMatch = working.match(
        /\b(?:(next)\s+)?(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i
      );
      if (dowMatch) {
        const targetDow = dowNames[dowMatch[2].slice(0, 3).toLowerCase()];
        let delta = (targetDow - targetDate.getDay() + 7) % 7;
        if (delta === 0 || dowMatch[1]) delta += 7;
        targetDate.setDate(targetDate.getDate() + delta);
        working = working.replace(dowMatch[0], "");
      }
    }

    // 5. Time range or single time detection
    let startHour = refDate.getHours() + 1;
    let startMin = 0;
    let durationSecs = 3600;
    const isAllDay = /\ball[\s-]?day\b/i.test(working);
    if (isAllDay) {
      working = working.replace(/\ball[\s-]?day\b/gi, "");
      startHour = 0;
      startMin = 0;
      durationSecs = 86400;
    } else {
      const rangeMatch = working.match(
        /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i
      );
      if (rangeMatch) {
        let h1 = parseInt(rangeMatch[1], 10);
        const m1 = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : 0;
        const mer1 = rangeMatch[3]?.toLowerCase();
        let h2 = parseInt(rangeMatch[4], 10);
        const m2 = rangeMatch[5] ? parseInt(rangeMatch[5], 10) : 0;
        const mer2 = rangeMatch[6]?.toLowerCase();

        if (mer2 === "pm" && h2 < 12) h2 += 12;
        if (mer2 === "am" && h2 === 12) h2 = 0;
        if (mer1 === "pm" && h1 < 12) h1 += 12;
        if (mer1 === "am" && h1 === 12) h1 = 0;
        if (!mer1 && mer2 === "pm" && h1 < 12 && h1 + 12 < h2) {
          h1 += 12;
        }
        startHour = h1;
        startMin = m1;
        let endSecs = h2 * 3600 + m2 * 60;
        const startSecs = h1 * 3600 + m1 * 60;
        if (endSecs <= startSecs) endSecs += 12 * 3600;
        durationSecs = Math.max(900, endSecs - startSecs);
        working = working.replace(rangeMatch[0], "");
      } else {
        const singleMatch = working.match(
          /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(?:at\s+)?(\d{1,2}):(\d{2})\b/i
        );
        if (singleMatch) {
          if (singleMatch[1]) {
            let h = parseInt(singleMatch[1], 10);
            const m = singleMatch[2] ? parseInt(singleMatch[2], 10) : 0;
            const mer = singleMatch[3].toLowerCase();
            if (mer === "pm" && h < 12) h += 12;
            if (mer === "am" && h === 12) h = 0;
            startHour = h;
            startMin = m;
          } else if (singleMatch[4]) {
            startHour = parseInt(singleMatch[4], 10);
            startMin = parseInt(singleMatch[5], 10);
          }
          working = working.replace(singleMatch[0], "");
        }
      }

      const durMatch = working.match(
        /\bfor\s+(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours)\b/i
      );
      if (durMatch) {
        const n = parseInt(durMatch[1], 10);
        const unit = durMatch[2].toLowerCase();
        durationSecs = unit.startsWith("h") ? n * 3600 : n * 60;
        working = working.replace(durMatch[0], "");
      }
    }

    const startTs = Math.floor(
      new Date(
        targetDate.getFullYear(),
        targetDate.getMonth(),
        targetDate.getDate(),
        startHour,
        startMin,
        0
      ).getTime() / 1000
    );
    const endTs = startTs + durationSecs;

    const cleanTitle =
      working
        .replace(/\s+/g, " ")
        .replace(/^[\s,\-–•]+|[\s,\-–•]+$/g, "")
        .trim() || "New Event";

    return {
      rawInput,
      title: cleanTitle,
      startTs,
      endTs,
      isAllDay,
      rrule,
      rruleHuman: describeFallbackRrule(rrule),
      location: null,
      conferenceUrl,
      conferenceProvider,
      calendarHint,
      matchedCalendarId: matchedCal?.id || fallbackCalendars[0]?.id || null,
      attendees,
      confidence: 0.9,
    };
  },

  async getSyncStatus(): Promise<SyncStatusSnapshot> {
    if (isTauriRuntime()) return invoke<SyncStatusSnapshot>("get_sync_status");
    initFallbackSeed();
    const now = nowSec();
    const upcoming = (await this.getViewportEvents(now - 900, now + 86400))
      .filter((e) => !e.isAllDay && e.endTs > now && e.selfRsvp !== "declined")
      .sort((a, b) => a.startTs - b.startTs)[0];

    let upNextLabel = "No upcoming events today";
    if (upcoming) {
      const diffMins = Math.round((upcoming.startTs - now) / 60);
      if (diffMins < 0) {
        upNextLabel = `Now: ${upcoming.title} (${Math.max(1, Math.round((upcoming.endTs - now) / 60))}m left)`;
      } else if (diffMins === 0) {
        upNextLabel = `Starting now: ${upcoming.title}`;
      } else if (diffMins < 60) {
        upNextLabel = `In ${diffMins}m: ${upcoming.title}`;
      } else {
        upNextLabel = `In ${Math.floor(diffMins / 60)}h ${diffMins % 60}m: ${upcoming.title}`;
      }
    }

    return {
      state: "idle",
      pendingOutboxCount: fallbackOutbox.length,
      lastSyncAt: nowIso(),
      lastMessage: "All calendars up to date",
      upNextLabel,
      upNextEventId: upcoming?.eventId || null,
      upNextConferenceUrl: upcoming?.conferenceUrl || null,
      hibernationEnabled: fallbackOAuthConfig.hibernationEnabled,
    };
  },

  async triggerSyncNow(): Promise<SyncStatusSnapshot> {
    if (isTauriRuntime()) return invoke<SyncStatusSnapshot>("trigger_sync_now");
    fallbackOutbox = [];
    fallbackEvents = fallbackEvents.map((e) => ({ ...e, isDirty: false }));
    return this.getSyncStatus();
  },

  async listOutboxMutations(): Promise<OutboxMutation[]> {
    if (isTauriRuntime())
      return invoke<OutboxMutation[]>("list_outbox_mutations");
    return [...fallbackOutbox];
  },

  async getOAuthConfig(): Promise<OAuthConfig> {
    if (isTauriRuntime()) return invoke<OAuthConfig>("get_oauth_config");
    return { ...fallbackOAuthConfig };
  },

  async saveOAuthConfig(config: OAuthConfig): Promise<OAuthConfig> {
    if (isTauriRuntime())
      return invoke<OAuthConfig>("save_oauth_config", { config });
    fallbackOAuthConfig = { ...config };
    return { ...fallbackOAuthConfig };
  },

  async openExternalUrl(url: string): Promise<void> {
    const trimmed = url.trim();
    if (isTauriRuntime())
      return invoke<void>("open_external_url", { url: trimmed });
    if (/^https?:\/\//i.test(trimmed)) {
      window.open(trimmed, "_blank", "noopener,noreferrer");
    }
  },

  async resetDemoData(): Promise<void> {
    if (isTauriRuntime()) return invoke<void>("reset_demo_data");
    fallbackAccounts = [];
    fallbackOutbox = [];
    initFallbackSeed();
  },

  async checkForUpdates(): Promise<UpdateCheckResult> {
    if (isTauriRuntime())
      return invoke<UpdateCheckResult>("check_for_updates");

    const currentVersion = "0.1.1";
    try {
      const resp = await fetch(
        "https://api.github.com/repos/Smit2553/RapidCal/releases/latest",
        {
          headers: {
            Accept: "application/vnd.github+json",
          },
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        const latestVersion = String(data.tag_name || currentVersion).replace(
          /^[vV]/,
          ""
        );
        const curParts = currentVersion.split(".").map((n) => parseInt(n, 10) || 0);
        const latParts = latestVersion
          .split("-")[0]
          .split(".")
          .map((n) => parseInt(n, 10) || 0);
        let updateAvailable = false;
        for (let i = 0; i < 3; i++) {
          if ((latParts[i] || 0) > (curParts[i] || 0)) {
            updateAvailable = true;
            break;
          }
          if ((latParts[i] || 0) < (curParts[i] || 0)) {
            break;
          }
        }
        const assets: ReleaseAsset[] = Array.isArray(data.assets)
          ? data.assets
              .filter(
                (a: any) =>
                  typeof a?.name === "string" &&
                  !a.name.toLowerCase().endsWith(".sig")
              )
              .map((a: any) => ({
                name: String(a.name),
                downloadUrl: String(a.browser_download_url || ""),
                sizeBytes: Number(a.size || 0),
              }))
          : [];
        return {
          currentVersion,
          latestVersion,
          updateAvailable,
          releaseName: String(data.name || `RapidCal v${latestVersion}`),
          releaseNotes: String(
            data.body || "No release notes provided for this version."
          ),
          releaseUrl: String(
            data.html_url || "https://github.com/Smit2553/RapidCal/releases"
          ),
          publishedAt: data.published_at ? String(data.published_at) : null,
          checkedAt: nowIso(),
          recommendedAsset: assets[0] || null,
          assets,
        };
      }
    } catch {
      // Fallback when offline or rate-limited in browser preview
    }

    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
      releaseName: `RapidCal v${currentVersion}`,
      releaseNotes: "You are running the latest version of RapidCal.",
      releaseUrl: "https://github.com/Smit2553/RapidCal/releases",
      publishedAt: null,
      checkedAt: nowIso(),
      recommendedAsset: null,
      assets: [],
    };
  },

  async onSyncStatus(
    cb: (snapshot: SyncStatusSnapshot) => void
  ): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<SyncStatusSnapshot>("rapidcal://sync-status", (ev) =>
      cb(ev.payload)
    );
  },

  async onOpenCommandPalette(cb: () => void): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<string>("rapidcal://open-command-palette", () => cb());
  },
};
