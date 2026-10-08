import { batch, createSignal } from "solid-js";
import {
  addDays,
  addMonths,
  getViewportRangeSeconds,
  startOfDay,
} from "../lib/dateUtils";
import { api } from "../lib/tauri";
import type {
  Account,
  Calendar,
  CalendarViewMode,
  OAuthConfig,
  OutboxMutation,
  SettingsTab,
  SyncStatusSnapshot,
  UpsertEventInput,
  UserPreferences,
  ViewportEvent,
} from "../types/calendar";

const PREFS_STORAGE_KEY = "rapidcal.preferences.v1";
const THEME_STORAGE_KEY = "rapidcal.theme.v1";

const DEFAULT_PREFERENCES: UserPreferences = {
  defaultView: "week",
  timeFormat: "12h",
  weekStartsOn: "monday",
  defaultEventDurationMins: 60,
  workingHoursStart: 8,
  workingHoursEnd: 17,
  showSecondaryTimezone: true,
  highlightWeekends: true,
};

function loadInitialPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function loadInitialTheme(): "dark" | "light" {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // ignore
  }
  return "dark";
}

const initialPrefs = loadInitialPreferences();
const [userPreferences, setUserPreferencesSignal] =
  createSignal<UserPreferences>(initialPrefs);

const [viewMode, setViewModeSignal] = createSignal<CalendarViewMode>(
  initialPrefs.defaultView
);
const [lastCalendarViewMode, setLastCalendarViewMode] = createSignal<
  Exclude<CalendarViewMode, "settings">
>(initialPrefs.defaultView);
const [activeSettingsTab, setActiveSettingsTab] =
  createSignal<SettingsTab>("general");

const [anchorDate, setAnchorDateSignal] = createSignal<Date>(new Date());
const [theme, setThemeSignal] = createSignal<"dark" | "light">(
  loadInitialTheme()
);

const [leftSidebarOpen, setLeftSidebarOpen] = createSignal<boolean>(true);
const [rightInspectorOpen, setRightInspectorOpen] = createSignal<boolean>(true);
const [commandPaletteOpen, setCommandPaletteOpen] =
  createSignal<boolean>(false);
const [commandPaletteInitialMode, setCommandPaletteInitialMode] = createSignal<
  "search" | "nlp"
>("nlp");
const [accountsModalOpen, setAccountsModalOpenSignal] =
  createSignal<boolean>(false);

const [accounts, setAccounts] = createSignal<Account[]>([]);
const [calendars, setCalendars] = createSignal<Calendar[]>([]);
const [viewportEvents, setViewportEvents] = createSignal<ViewportEvent[]>([]);
const [selectedEvent, setSelectedEvent] = createSignal<ViewportEvent | null>(
  null
);
const [inspectorEditScope, setInspectorEditScope] = createSignal<
  "single" | "all"
>("single");
const [draftSlot, setDraftSlot] = createSignal<{
  startTs: number;
  endTs: number;
  isAllDay: boolean;
} | null>(null);

const [syncStatus, setSyncStatus] = createSignal<SyncStatusSnapshot>({
  state: "idle",
  pendingOutboxCount: 0,
  lastSyncAt: null,
  lastMessage: "Ready",
  upNextLabel: null,
  upNextEventId: null,
  upNextConferenceUrl: null,
  hibernationEnabled: true,
});

const [oauthConfig, setOAuthConfig] = createSignal<OAuthConfig>({
  googleClientId: "",
  googleClientSecret: null,
  msClientId: "",
  msTenantId: "common",
  hibernationEnabled: true,
  secondaryTimezone: "UTC",
  syncIntervalSecs: 60,
});

const [outboxMutations, setOutboxMutations] = createSignal<OutboxMutation[]>(
  []
);
const [toastMessage, setToastMessage] = createSignal<string | null>(null);

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function showToast(msg: string) {
  setToastMessage(msg);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setToastMessage(null), 3200);
}

export function applyThemeToDom(next: "dark" | "light") {
  const root = document.documentElement;
  if (next === "dark") {
    root.classList.add("dark");
    root.classList.remove("light");
  } else {
    root.classList.add("light");
    root.classList.remove("dark");
  }
}

export function setTheme(next: "dark" | "light") {
  setThemeSignal(next);
  applyThemeToDom(next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // ignore
  }
}

export function updateUserPreferences(partial: Partial<UserPreferences>) {
  const prev = userPreferences();
  const next: UserPreferences = { ...prev, ...partial };
  setUserPreferencesSignal(next);
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  if (partial.weekStartsOn && partial.weekStartsOn !== prev.weekStartsOn) {
    void refreshViewport();
  }
}

export async function refreshViewport() {
  const activeCalView =
    viewMode() === "settings" ? lastCalendarViewMode() : viewMode();
  const [startTs, endTs] = getViewportRangeSeconds(
    anchorDate(),
    activeCalView,
    userPreferences().weekStartsOn
  );
  const events = await api.getViewportEvents(startTs, endTs);
  setViewportEvents(events);

  // Keep selectedEvent synchronized if still in viewport
  const sel = selectedEvent();
  if (sel) {
    const updated =
      events.find((e) => e.instanceId === sel.instanceId) ||
      events.find((e) => e.eventId === sel.eventId) ||
      null;
    setSelectedEvent(updated);
  }
}

export async function refreshMetadata() {
  const [accs, cals, status, cfg, outbox] = await Promise.all([
    api.listAccounts(),
    api.listCalendars(),
    api.getSyncStatus(),
    api.getOAuthConfig(),
    api.listOutboxMutations(),
  ]);
  batch(() => {
    setAccounts(accs);
    setCalendars(cals);
    setSyncStatus(status);
    setOAuthConfig(cfg);
    setOutboxMutations(outbox);
  });
}

export async function initializeCalendarStore() {
  applyThemeToDom(theme());
  await refreshMetadata();
  await refreshViewport();

  // Select the live "Up Next" event or first event by default so the right details pane is immediately populated
  const evs = viewportEvents();
  const upNextId = syncStatus().upNextEventId;
  const initialSelection =
    evs.find((e) => e.eventId === upNextId) || evs[0] || null;
  if (initialSelection) {
    setSelectedEvent(initialSelection);
  }

  // Subscribe to background sync & tray events
  void api.onSyncStatus((snap) => {
    setSyncStatus(snap);
  });
  void api.onOpenCommandPalette(() => {
    openCommandPalette("nlp");
  });
}

export function setViewMode(mode: CalendarViewMode) {
  if (mode !== "settings") {
    setLastCalendarViewMode(mode);
  }
  setViewModeSignal(mode);
  void refreshViewport();
}

export function openSettings(tab: SettingsTab = "general") {
  const cur = viewMode();
  if (cur !== "settings") {
    setLastCalendarViewMode(cur);
  }
  setActiveSettingsTab(tab);
  setViewModeSignal("settings");
}

export function closeSettings() {
  setViewModeSignal(lastCalendarViewMode());
  void refreshViewport();
}

export function setAccountsModalOpen(open: boolean) {
  if (open) {
    openSettings("accounts");
  } else {
    setAccountsModalOpenSignal(false);
    if (viewMode() === "settings") {
      closeSettings();
    }
  }
}

export function setAnchorDate(d: Date) {
  setAnchorDateSignal(startOfDay(d));
  void refreshViewport();
}

export function jumpToday() {
  setAnchorDate(new Date());
  if (viewMode() === "settings") {
    closeSettings();
  }
  showToast("Jumped to Today");
}

export function stepDate(direction: -1 | 1) {
  const mode = viewMode() === "settings" ? lastCalendarViewMode() : viewMode();
  const cur = anchorDate();
  if (mode === "day") {
    setAnchorDate(addDays(cur, direction));
  } else if (mode === "3day") {
    setAnchorDate(addDays(cur, direction * 3));
  } else if (mode === "month") {
    setAnchorDate(addMonths(cur, direction));
  } else {
    setAnchorDate(addDays(cur, direction * 7));
  }
}

export function toggleTheme() {
  const next = theme() === "dark" ? "light" : "dark";
  setTheme(next);
}

export function openCommandPalette(mode: "search" | "nlp" = "nlp") {
  setCommandPaletteInitialMode(mode);
  setCommandPaletteOpen(true);
}

export async function toggleCalendar(calendarId: string, isVisible: boolean) {
  setCalendars((prev) =>
    prev.map((c) => (c.id === calendarId ? { ...c, isVisible } : c))
  );
  await api.toggleCalendarVisibility(calendarId, isVisible);
  await refreshViewport();
}

export async function updateCalendarColorAction(
  calendarId: string,
  colorHex: string
) {
  setCalendars((prev) =>
    prev.map((c) => (c.id === calendarId ? { ...c, colorHex } : c))
  );
  await api.updateCalendarColor(calendarId, colorHex);
  await refreshViewport();
  showToast("Updated calendar color");
}

export async function saveEventOptimistic(input: UpsertEventInput) {
  const saved = await api.upsertEvent(input);
  await Promise.all([refreshViewport(), refreshMetadata()]);
  const match = viewportEvents().find((e) => e.eventId === saved.id) || null;
  if (match) {
    setSelectedEvent(match);
  }
  setDraftSlot(null);
  showToast(`Saved "${saved.title}"`);
  return saved;
}

export async function moveOrResizeEventOptimistic(
  ev: ViewportEvent,
  newStartTs: number,
  newEndTs: number,
  editScope: "single" | "all" = "single"
) {
  setViewportEvents((prev) =>
    prev.map((item) =>
      item.instanceId === ev.instanceId
        ? { ...item, startTs: newStartTs, endTs: newEndTs, isDirty: true }
        : item
    )
  );

  await api.moveOrResizeEvent(
    ev.eventId,
    ev.startTs,
    newStartTs,
    newEndTs,
    ev.isRecurring ? editScope : "all"
  );
  await Promise.all([refreshViewport(), refreshMetadata()]);
}

export async function deleteEventOptimistic(
  ev: ViewportEvent,
  deleteScope: "single" | "all" = "all"
) {
  setViewportEvents((prev) =>
    prev.filter((item) =>
      deleteScope === "single"
        ? item.instanceId !== ev.instanceId
        : item.eventId !== ev.eventId
    )
  );
  if (selectedEvent()?.eventId === ev.eventId) {
    setSelectedEvent(null);
  }
  await api.deleteEvent(ev.eventId, ev.startTs, deleteScope);
  await Promise.all([refreshViewport(), refreshMetadata()]);
  showToast(`Deleted "${ev.title}"`);
}

export async function updateRsvpOptimistic(
  ev: ViewportEvent,
  status: "accepted" | "tentative" | "declined"
) {
  setViewportEvents((prev) =>
    prev.map((item) =>
      item.eventId === ev.eventId
        ? {
            ...item,
            selfRsvp: status,
            status: status === "tentative" ? "tentative" : "confirmed",
            isDirty: true,
          }
        : item
    )
  );
  await api.updateRsvp(ev.eventId, status);
  await Promise.all([refreshViewport(), refreshMetadata()]);
  const label =
    status === "accepted"
      ? "Going"
      : status === "tentative"
        ? "Maybe"
        : "Declined";
  showToast(`Response updated: ${label}`);
}

export async function createCrossAccountBusyMirror(
  sourceEvent: ViewportEvent,
  targetCalendarId: string,
  redactTitle: boolean
) {
  const mirror = await api.createBusyMirror(
    sourceEvent.eventId,
    targetCalendarId,
    redactTitle
  );
  await Promise.all([refreshViewport(), refreshMetadata()]);
  showToast(`Time blocked as "${mirror.title}"`);
}

export async function triggerSyncNowAction() {
  setSyncStatus((prev) => ({
    ...prev,
    state: "syncing",
    lastMessage: "Syncing your calendars…",
  }));
  const snap = await api.triggerSyncNow();
  setSyncStatus(snap);
  await Promise.all([refreshViewport(), refreshMetadata()]);
  showToast("All calendars synced");
}

export function joinActiveOrNextMeeting() {
  const sel = selectedEvent();
  const url = sel?.conferenceUrl || syncStatus().upNextConferenceUrl;
  if (url) {
    void api.openExternalUrl(url);
    showToast("Opening video call…");
  } else {
    showToast("No video link on selected or upcoming event");
  }
}

export function startNewEventDraft(
  startTs?: number,
  endTs?: number,
  isAllDay = false
) {
  if (viewMode() === "settings") {
    closeSettings();
  }
  const defaultDurSecs = userPreferences().defaultEventDurationMins * 60;
  const nowRounded = Math.floor(Date.now() / 1000 / 1800) * 1800 + 1800;
  const s = startTs ?? nowRounded;
  const e = endTs ?? (isAllDay ? s + 86400 : s + defaultDurSecs);
  setSelectedEvent(null);
  setDraftSlot({ startTs: s, endTs: e, isAllDay });
  setRightInspectorOpen(true);
}

export {
  accounts,
  accountsModalOpen,
  activeSettingsTab,
  anchorDate,
  calendars,
  commandPaletteInitialMode,
  commandPaletteOpen,
  draftSlot,
  inspectorEditScope,
  lastCalendarViewMode,
  leftSidebarOpen,
  oauthConfig,
  outboxMutations,
  rightInspectorOpen,
  selectedEvent,
  setActiveSettingsTab,
  setCommandPaletteOpen,
  setDraftSlot,
  setInspectorEditScope,
  setLeftSidebarOpen,
  setOAuthConfig,
  setRightInspectorOpen,
  setSelectedEvent,
  syncStatus,
  theme,
  toastMessage,
  userPreferences,
  viewMode,
  viewportEvents,
};
