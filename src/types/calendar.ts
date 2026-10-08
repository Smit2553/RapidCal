export type CalendarViewMode =
  | "day"
  | "3day"
  | "workweek"
  | "week"
  | "month"
  | "agenda";

export interface Account {
  id: string;
  provider: "google" | "microsoft" | "local" | string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  status: "connected" | "syncing" | "offline" | "demo" | "error" | string;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface Calendar {
  id: string;
  accountId: string;
  remoteId: string;
  name: string;
  colorHex: string;
  isVisible: boolean;
  isPrimary: boolean;
  accessRole: "owner" | "writer" | "reader" | string;
  syncToken: string | null;
  timezone: string;
}

export interface Attendee {
  email: string;
  displayName: string | null;
  responseStatus: "accepted" | "tentative" | "declined" | "needsAction" | string;
  isOrganizer: boolean;
  isSelf: boolean;
}

export interface EventMaster {
  id: string;
  calendarId: string;
  remoteId: string | null;
  etag: string | null;
  icalUid: string | null;
  recurringEventId: string | null;
  originalStartTime: number | null;
  title: string;
  description: string;
  location: string;
  startTs: number;
  endTs: number;
  isAllDay: boolean;
  timezone: string;
  rrule: string | null;
  exdates: number[];
  status: "confirmed" | "tentative" | "cancelled" | string;
  selfRsvp: "accepted" | "tentative" | "declined" | "needsAction" | string;
  attendees: Attendee[];
  conferenceUrl: string | null;
  conferenceProvider: "meet" | "teams" | "zoom" | "webex" | string | null;
  busyMirrorOfEventId: string | null;
  updatedAt: string;
  isDirty: boolean;
}

export interface ViewportEvent {
  instanceId: string;
  eventId: string;
  masterEventId: string | null;
  calendarId: string;
  accountId: string;
  provider: string;
  calendarName: string;
  colorHex: string;
  title: string;
  description: string;
  location: string;
  startTs: number;
  endTs: number;
  isAllDay: boolean;
  timezone: string;
  rrule: string | null;
  rruleHuman: string | null;
  isRecurring: boolean;
  isException: boolean;
  status: string;
  selfRsvp: string;
  attendees: Attendee[];
  conferenceUrl: string | null;
  conferenceProvider: string | null;
  busyMirrorOfEventId: string | null;
  isDirty: boolean;
  colIndex: number;
  totalCols: number;
  clusterId: number;
}

export interface UpsertEventInput {
  id?: string | null;
  calendarId: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startTs: number;
  endTs: number;
  isAllDay: boolean;
  timezone?: string | null;
  rrule?: string | null;
  status?: string | null;
  selfRsvp?: string | null;
  attendees?: Attendee[] | null;
  conferenceUrl?: string | null;
  conferenceProvider?: string | null;
  editScope?: "single" | "all" | null;
  instanceStartTs?: number | null;
}

export interface OutboxMutation {
  id: number;
  accountId: string;
  calendarId: string;
  eventId: string;
  operation: string;
  payloadJson: string;
  retryCount: number;
  nextRetryAt: number;
  lastError: string | null;
  createdAt: string;
}

export interface OAuthConfig {
  googleClientId: string;
  googleClientSecret: string | null;
  msClientId: string;
  msTenantId: string;
  hibernationEnabled: boolean;
  secondaryTimezone: string;
  syncIntervalSecs: number;
}

export interface SyncStatusSnapshot {
  state: "idle" | "syncing" | "offline" | "error" | string;
  pendingOutboxCount: number;
  lastSyncAt: string | null;
  lastMessage: string;
  upNextLabel: string | null;
  upNextEventId: string | null;
  upNextConferenceUrl: string | null;
  hibernationEnabled: boolean;
}

export interface NlpParseResult {
  rawInput: string;
  title: string;
  startTs: number;
  endTs: number;
  isAllDay: boolean;
  rrule: string | null;
  rruleHuman: string | null;
  location: string | null;
  conferenceUrl: string | null;
  conferenceProvider: string | null;
  calendarHint: string | null;
  matchedCalendarId: string | null;
  attendees: string[];
  confidence: number;
}
