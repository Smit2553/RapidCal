import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { getPrimaryTimezoneAbbr } from "../lib/dateUtils";
import { api } from "../lib/tauri";
import {
  accounts,
  activeSettingsTab,
  calendars,
  closeSettings,
  oauthConfig,
  outboxMutations,
  refreshMetadata,
  refreshViewport,
  setActiveSettingsTab,
  setOAuthConfig,
  setTheme,
  setViewMode,
  showToast,
  syncStatus,
  theme,
  toggleCalendar,
  triggerSyncNowAction,
  updateCalendarColorAction,
  updateUserPreferences,
  userPreferences,
} from "../store/calendarStore";
import type { CalendarViewMode, SettingsTab } from "../types/calendar";

const TIMEZONE_OPTIONS: { value: string; label: string; region: string }[] = [
  {
    value: "America/New_York",
    label: "New York — Eastern Time",
    region: "Americas",
  },
  {
    value: "America/Chicago",
    label: "Chicago — Central Time",
    region: "Americas",
  },
  {
    value: "America/Denver",
    label: "Denver — Mountain Time",
    region: "Americas",
  },
  {
    value: "America/Los_Angeles",
    label: "Los Angeles — Pacific Time",
    region: "Americas",
  },
  {
    value: "Europe/London",
    label: "London — UK Time",
    region: "Europe",
  },
  {
    value: "Europe/Berlin",
    label: "Berlin / Paris — Central European Time",
    region: "Europe",
  },
  {
    value: "Asia/Kolkata",
    label: "Mumbai / New Delhi — India Time",
    region: "Asia",
  },
  {
    value: "Asia/Singapore",
    label: "Singapore — Singapore Time",
    region: "Asia",
  },
  {
    value: "Asia/Tokyo",
    label: "Tokyo — Japan Time",
    region: "Asia",
  },
  {
    value: "Australia/Sydney",
    label: "Sydney — Eastern Australia Time",
    region: "Pacific",
  },
  {
    value: "UTC",
    label: "Coordinated Universal Time (UTC)",
    region: "Global",
  },
];

const CALENDAR_COLOR_SWATCHES = [
  { hex: "#6366f1", name: "Indigo" },
  { hex: "#0ea5e9", name: "Sky" },
  { hex: "#10b981", name: "Emerald" },
  { hex: "#f59e0b", name: "Amber" },
  { hex: "#ec4899", name: "Pink" },
  { hex: "#8b5cf6", name: "Violet" },
  { hex: "#f43f5e", name: "Rose" },
  { hex: "#14b8a6", name: "Teal" },
];

const SETTINGS_NAV: {
  id: SettingsTab;
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    id: "general",
    label: "General & Appearance",
    description: "Theme, time format, and calendar layout",
    icon: "✨",
  },
  {
    id: "accounts",
    label: "Connected Accounts",
    description: "Google Calendar and Microsoft Outlook",
    icon: "👤",
  },
  {
    id: "calendars",
    label: "My Calendars",
    description: "Visibility and custom colors",
    icon: "🗓",
  },
  {
    id: "timezones",
    label: "Time Zones",
    description: "Local and secondary world clock",
    icon: "🌍",
  },
  {
    id: "sync",
    label: "Sync & Notifications",
    description: "Background updates and system tray",
    icon: "🔄",
  },
  {
    id: "shortcuts",
    label: "Keyboard Shortcuts",
    description: "Quick keys for navigation and actions",
    icon: "⌨️",
  },
];

const HOURS_LIST = Array.from({ length: 24 }, (_, i) => {
  const ampm = i >= 12 ? "PM" : "AM";
  const h12 = i % 12 === 0 ? 12 : i % 12;
  return { value: i, label: `${h12}:00 ${ampm}` };
});

export function SettingsView() {
  const [googleClientId, setGoogleClientId] = createSignal("");
  const [googleClientSecret, setGoogleClientSecret] = createSignal("");
  const [msClientId, setMsClientId] = createSignal("");
  const [msTenantId, setMsTenantId] = createSignal("common");
  const [hibernationEnabled, setHibernationEnabled] = createSignal(true);
  const [secondaryTimezone, setSecondaryTimezone] = createSignal("UTC");
  const [syncIntervalSecs, setSyncIntervalSecs] = createSignal(60);
  const [authStatusMsg, setAuthStatusMsg] = createSignal<string | null>(null);
  const [showCustomSignInSetup, setShowCustomSignInSetup] = createSignal(false);

  createEffect(() => {
    const cfg = oauthConfig();
    setGoogleClientId(cfg.googleClientId);
    setGoogleClientSecret(cfg.googleClientSecret || "");
    setMsClientId(cfg.msClientId);
    setMsTenantId(cfg.msTenantId || "common");
    setHibernationEnabled(cfg.hibernationEnabled);
    setSecondaryTimezone(cfg.secondaryTimezone || "UTC");
    setSyncIntervalSecs(cfg.syncIntervalSecs || 60);
  });

  const persistBackendSettings = async (
    overrides?: Partial<{
      hibernationEnabled: boolean;
      secondaryTimezone: string;
      syncIntervalSecs: number;
    }>
  ) => {
    const updated = await api.saveOAuthConfig({
      googleClientId: googleClientId(),
      googleClientSecret: googleClientSecret() || null,
      msClientId: msClientId(),
      msTenantId: msTenantId() || "common",
      hibernationEnabled:
        overrides?.hibernationEnabled ?? hibernationEnabled(),
      secondaryTimezone: overrides?.secondaryTimezone ?? secondaryTimezone(),
      syncIntervalSecs: overrides?.syncIntervalSecs ?? syncIntervalSecs(),
    });
    setOAuthConfig(updated);
  };

  const handleSaveSignInSetup = async (e: Event) => {
    e.preventDefault();
    await persistBackendSettings();
    showToast("Saved sign-in settings");
  };

  const handleConnectProvider = async (provider: "google" | "microsoft") => {
    const providerLabel =
      provider === "google" ? "Google Calendar" : "Microsoft Outlook";
    setAuthStatusMsg(
      `Opening your web browser to sign in to ${providerLabel}…`
    );
    try {
      await persistBackendSettings();
      const acc = await api.connectOAuthAccount(provider);
      await Promise.all([refreshMetadata(), refreshViewport()]);
      setAuthStatusMsg(`Connected ${acc.email}!`);
      showToast(`Connected ${acc.email}`);
    } catch (err) {
      setAuthStatusMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const localTimezoneName = createMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "Local Time";
    } catch {
      return "Local Time";
    }
  });

  const formattedLastSync = createMemo(() => {
    const iso = syncStatus().lastSyncAt;
    if (!iso) return "Just now";
    try {
      const dt = new Date(iso);
      return new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }).format(dt);
    } catch {
      return "Recently";
    }
  });

  return (
    <div class="flex-1 flex min-w-0 min-h-0 bg-zinc-950 light:bg-white select-none overflow-hidden">
      {/* Left Settings Navigation Column */}
      <div class="w-64 shrink-0 border-r border-zinc-800/80 light:border-zinc-200 bg-zinc-950 light:bg-zinc-50/80 p-4 flex flex-col justify-between overflow-y-auto">
        <div class="space-y-4">
          <div class="flex items-center justify-between px-1">
            <div>
              <h2 class="text-sm font-semibold text-zinc-100 light:text-zinc-900">
                Settings
              </h2>
              <p class="text-[11px] text-zinc-500">
                Customize your calendar experience
              </p>
            </div>
          </div>

          <nav class="space-y-1">
            <For each={SETTINGS_NAV}>
              {(item) => {
                const isActive = () => activeSettingsTab() === item.id;
                return (
                  <button
                    type="button"
                    onClick={() => setActiveSettingsTab(item.id)}
                    class={`w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-start gap-2.5 ${
                      isActive()
                        ? "bg-indigo-600/15 border border-indigo-500/40 text-indigo-300 light:text-indigo-700 light:bg-indigo-50"
                        : "text-zinc-400 light:text-zinc-600 hover:bg-zinc-900 light:hover:bg-zinc-200/60 hover:text-zinc-200 light:hover:text-zinc-900 border border-transparent"
                    }`}
                  >
                    <span class="text-sm mt-0.5">{item.icon}</span>
                    <div class="min-w-0">
                      <div class="text-xs font-semibold truncate">
                        {item.label}
                      </div>
                      <div class="text-[10px] text-zinc-500 truncate">
                        {item.description}
                      </div>
                    </div>
                  </button>
                );
              }}
            </For>
          </nav>
        </div>

        <div class="pt-4 border-t border-zinc-800/80 light:border-zinc-200">
          <button
            type="button"
            onClick={closeSettings}
            class="w-full h-8 px-3 rounded-lg border border-zinc-800 light:border-zinc-300 bg-zinc-900 light:bg-white hover:bg-zinc-800 light:hover:bg-zinc-100 text-xs font-medium text-zinc-200 light:text-zinc-800 flex items-center justify-center gap-1.5 transition-colors"
          >
            <span>← Back to Calendar</span>
          </button>
        </div>
      </div>

      {/* Right Settings Content Pane */}
      <div class="flex-1 overflow-y-auto p-6 md:p-8">
        <div class="max-w-3xl mx-auto space-y-6">
          {/* Top Bar inside Settings */}
          <div class="flex items-center justify-between border-b border-zinc-800/80 light:border-zinc-200 pb-4">
            <div>
              <h1 class="text-lg font-semibold text-zinc-100 light:text-zinc-900">
                {
                  SETTINGS_NAV.find((n) => n.id === activeSettingsTab())
                    ?.label
                }
              </h1>
              <p class="text-xs text-zinc-400 light:text-zinc-600">
                {
                  SETTINGS_NAV.find((n) => n.id === activeSettingsTab())
                    ?.description
                }
              </p>
            </div>
            <button
              type="button"
              onClick={closeSettings}
              class="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
            >
              Done
            </button>
          </div>

          {/* TAB 1: GENERAL & APPEARANCE */}
          <Show when={activeSettingsTab() === "general"}>
            <div class="space-y-6">
              {/* Theme Selection */}
              <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 space-y-3">
                <div>
                  <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 light:text-zinc-700">
                    Appearance
                  </h3>
                  <p class="text-xs text-zinc-500">
                    Choose between a dark or light look for your calendar
                  </p>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setTheme("dark")}
                    class={`p-3.5 rounded-xl border text-left transition-all flex items-center justify-between ${
                      theme() === "dark"
                        ? "border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40"
                        : "border-zinc-800 light:border-zinc-200 bg-zinc-900/60 light:bg-white hover:border-zinc-700"
                    }`}
                  >
                    <div class="flex items-center gap-3">
                      <span class="w-8 h-8 rounded-lg bg-zinc-950 border border-zinc-700 flex items-center justify-center text-amber-300">
                        ☾
                      </span>
                      <div>
                        <div class="text-xs font-semibold text-zinc-100 light:text-zinc-900">
                          Dark Mode
                        </div>
                        <div class="text-[11px] text-zinc-500">
                          Easy on the eyes in low light
                        </div>
                      </div>
                    </div>
                    <Show when={theme() === "dark"}>
                      <span class="text-xs font-semibold text-indigo-400">
                        Active
                      </span>
                    </Show>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTheme("light")}
                    class={`p-3.5 rounded-xl border text-left transition-all flex items-center justify-between ${
                      theme() === "light"
                        ? "border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40"
                        : "border-zinc-800 light:border-zinc-200 bg-zinc-900/60 light:bg-white hover:border-zinc-700"
                    }`}
                  >
                    <div class="flex items-center gap-3">
                      <span class="w-8 h-8 rounded-lg bg-white border border-zinc-300 flex items-center justify-center text-amber-500">
                        ☀
                      </span>
                      <div>
                        <div class="text-xs font-semibold text-zinc-100 light:text-zinc-900">
                          Light Mode
                        </div>
                        <div class="text-[11px] text-zinc-500">
                          Crisp daylight contrast
                        </div>
                      </div>
                    </div>
                    <Show when={theme() === "light"}>
                      <span class="text-xs font-semibold text-indigo-500">
                        Active
                      </span>
                    </Show>
                  </button>
                </div>
              </section>

              {/* Calendar Layout & Formatting */}
              <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 space-y-4">
                <div>
                  <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 light:text-zinc-700">
                    Calendar Layout & Time Format
                  </h3>
                  <p class="text-xs text-zinc-500">
                    Set how dates, times, and new events behave by default
                  </p>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div class="space-y-1.5">
                    <label class="text-xs font-medium text-zinc-300 light:text-zinc-700">
                      Default Calendar View
                    </label>
                    <select
                      value={userPreferences().defaultView}
                      onChange={(e) => {
                        const val = e.currentTarget.value as Exclude<
                          CalendarViewMode,
                          "settings"
                        >;
                        updateUserPreferences({ defaultView: val });
                        showToast("Updated default calendar view");
                      }}
                      class="w-full h-9 px-2.5 rounded-lg border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800"
                    >
                      <option value="day">Day View</option>
                      <option value="3day">3-Day View</option>
                      <option value="workweek">Work Week (Mon–Fri)</option>
                      <option value="week">Full Week</option>
                      <option value="month">Month View</option>
                      <option value="agenda">Schedule List</option>
                    </select>
                  </div>

                  <div class="space-y-1.5">
                    <label class="text-xs font-medium text-zinc-300 light:text-zinc-700">
                      Time Format
                    </label>
                    <select
                      value={userPreferences().timeFormat}
                      onChange={(e) => {
                        updateUserPreferences({
                          timeFormat: e.currentTarget.value as "12h" | "24h",
                        });
                        showToast("Updated time format");
                      }}
                      class="w-full h-9 px-2.5 rounded-lg border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800"
                    >
                      <option value="12h">12-hour (1:00 PM)</option>
                      <option value="24h">24-hour (13:00)</option>
                    </select>
                  </div>

                  <div class="space-y-1.5">
                    <label class="text-xs font-medium text-zinc-300 light:text-zinc-700">
                      Start Week On
                    </label>
                    <select
                      value={userPreferences().weekStartsOn}
                      onChange={(e) => {
                        updateUserPreferences({
                          weekStartsOn: e.currentTarget.value as
                            | "monday"
                            | "sunday",
                        });
                        showToast("Updated first day of week");
                      }}
                      class="w-full h-9 px-2.5 rounded-lg border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800"
                    >
                      <option value="monday">Monday</option>
                      <option value="sunday">Sunday</option>
                    </select>
                  </div>

                  <div class="space-y-1.5">
                    <label class="text-xs font-medium text-zinc-300 light:text-zinc-700">
                      Default Event Length
                    </label>
                    <select
                      value={userPreferences().defaultEventDurationMins}
                      onChange={(e) => {
                        updateUserPreferences({
                          defaultEventDurationMins: parseInt(
                            e.currentTarget.value,
                            10
                          ) as 15 | 30 | 45 | 60,
                        });
                        showToast("Updated default event length");
                      }}
                      class="w-full h-9 px-2.5 rounded-lg border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800"
                    >
                      <option value={15}>15 minutes</option>
                      <option value={30}>30 minutes</option>
                      <option value={45}>45 minutes</option>
                      <option value={60}>1 hour</option>
                    </select>
                  </div>

                  <div class="space-y-1.5">
                    <label class="text-xs font-medium text-zinc-300 light:text-zinc-700">
                      Workday Starts At
                    </label>
                    <select
                      value={userPreferences().workingHoursStart}
                      onChange={(e) => {
                        updateUserPreferences({
                          workingHoursStart: parseInt(
                            e.currentTarget.value,
                            10
                          ),
                        });
                        showToast("Updated workday hours");
                      }}
                      class="w-full h-9 px-2.5 rounded-lg border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800"
                    >
                      <For each={HOURS_LIST}>
                        {(h) => <option value={h.value}>{h.label}</option>}
                      </For>
                    </select>
                  </div>

                  <div class="space-y-1.5">
                    <label class="text-xs font-medium text-zinc-300 light:text-zinc-700">
                      Workday Ends At
                    </label>
                    <select
                      value={userPreferences().workingHoursEnd}
                      onChange={(e) => {
                        updateUserPreferences({
                          workingHoursEnd: parseInt(
                            e.currentTarget.value,
                            10
                          ),
                        });
                        showToast("Updated workday hours");
                      }}
                      class="w-full h-9 px-2.5 rounded-lg border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800"
                    >
                      <For each={HOURS_LIST}>
                        {(h) => <option value={h.value}>{h.label}</option>}
                      </For>
                    </select>
                  </div>
                </div>
              </section>
            </div>
          </Show>

          {/* TAB 2: CONNECTED ACCOUNTS */}
          <Show when={activeSettingsTab() === "accounts"}>
            <div class="space-y-6">
              <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 light:text-zinc-700">
                      Your Calendar Accounts ({accounts().length})
                    </h3>
                    <p class="text-xs text-zinc-500">
                      Connect Google Calendar or Microsoft Outlook to view and
                      manage all your schedules in one place
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleConnectProvider("google")}
                      class="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
                    >
                      + Connect Google Calendar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleConnectProvider("microsoft")}
                      class="h-8 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors"
                    >
                      + Connect Microsoft Outlook
                    </button>
                  </div>
                </div>

                <Show when={authStatusMsg()}>
                  <div class="p-3 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-xs text-indigo-200 light:text-indigo-800">
                    {authStatusMsg()}
                  </div>
                </Show>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <For each={accounts()}>
                    {(acc) => (
                      <div class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/60 light:bg-white p-3.5 flex flex-col justify-between gap-3">
                        <div class="space-y-1.5">
                          <div class="flex items-center justify-between">
                            <span
                              class={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                acc.provider === "microsoft"
                                  ? "bg-sky-500/15 text-sky-400"
                                  : "bg-indigo-500/15 text-indigo-400"
                              }`}
                            >
                              {acc.provider === "microsoft"
                                ? "Outlook"
                                : "Google"}
                            </span>
                            <span class="text-[11px] text-emerald-400 flex items-center gap-1">
                              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              {acc.status === "demo"
                                ? "Sample Account"
                                : "Connected"}
                            </span>
                          </div>
                          <div class="text-xs font-semibold text-zinc-100 light:text-zinc-900 truncate">
                            {acc.displayName}
                          </div>
                          <div class="text-[11px] text-zinc-400 truncate">
                            {acc.email}
                          </div>
                        </div>

                        <div class="flex items-center justify-between pt-2 border-t border-zinc-800/60 light:border-zinc-200">
                          <span class="text-[11px] text-zinc-500">
                            {
                              calendars().filter((c) => c.accountId === acc.id)
                                .length
                            }{" "}
                            calendars
                          </span>
                          <button
                            type="button"
                            onClick={async () => {
                              await api.removeAccount(acc.id);
                              await Promise.all([
                                refreshMetadata(),
                                refreshViewport(),
                              ]);
                              showToast(`Disconnected ${acc.email}`);
                            }}
                            class="text-xs text-rose-400 hover:text-rose-300 font-medium"
                          >
                            Disconnect
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </section>

              {/* Optional Sign-In App Setup */}
              <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 space-y-3">
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="text-xs font-semibold text-zinc-200 light:text-zinc-800">
                      Custom Sign-In App Credentials (Optional)
                    </h3>
                    <p class="text-[11px] text-zinc-500">
                      Only needed if your organization requires a custom Google
                      or Microsoft App ID for sign-in
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setShowCustomSignInSetup(!showCustomSignInSetup())
                    }
                    class="h-7 px-2.5 rounded-md border border-zinc-800 light:border-zinc-300 text-xs text-zinc-300 light:text-zinc-700 hover:bg-zinc-800 light:hover:bg-zinc-200"
                  >
                    {showCustomSignInSetup() ? "Hide Setup" : "Configure"}
                  </button>
                </div>

                <Show when={showCustomSignInSetup()}>
                  <form
                    onSubmit={(e) => void handleSaveSignInSetup(e)}
                    class="pt-3 border-t border-zinc-800/80 light:border-zinc-200 space-y-3"
                  >
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div class="space-y-1">
                        <label class="text-[11px] font-medium text-zinc-400">
                          Google App Client ID
                        </label>
                        <input
                          type="text"
                          value={googleClientId()}
                          onInput={(e) =>
                            setGoogleClientId(e.currentTarget.value)
                          }
                          placeholder="xxxx.apps.googleusercontent.com"
                          class="w-full h-8 px-2.5 rounded-md border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800"
                        />
                      </div>
                      <div class="space-y-1">
                        <label class="text-[11px] font-medium text-zinc-400">
                          Google Client Secret (Optional)
                        </label>
                        <input
                          type="password"
                          value={googleClientSecret()}
                          onInput={(e) =>
                            setGoogleClientSecret(e.currentTarget.value)
                          }
                          placeholder="••••••••••••"
                          class="w-full h-8 px-2.5 rounded-md border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800"
                        />
                      </div>
                      <div class="space-y-1">
                        <label class="text-[11px] font-medium text-zinc-400">
                          Microsoft App ID
                        </label>
                        <input
                          type="text"
                          value={msClientId()}
                          onInput={(e) => setMsClientId(e.currentTarget.value)}
                          placeholder="00000000-0000-0000-0000-000000000000"
                          class="w-full h-8 px-2.5 rounded-md border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800"
                        />
                      </div>
                      <div class="space-y-1">
                        <label class="text-[11px] font-medium text-zinc-400">
                          Microsoft Organization / Tenant
                        </label>
                        <input
                          type="text"
                          value={msTenantId()}
                          onInput={(e) => setMsTenantId(e.currentTarget.value)}
                          placeholder="common"
                          class="w-full h-8 px-2.5 rounded-md border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800"
                        />
                      </div>
                    </div>
                    <div class="flex justify-end">
                      <button
                        type="submit"
                        class="h-8 px-3.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                      >
                        Save Sign-In Credentials
                      </button>
                    </div>
                  </form>
                </Show>
              </section>
            </div>
          </Show>

          {/* TAB 3: MY CALENDARS */}
          <Show when={activeSettingsTab() === "calendars"}>
            <div class="space-y-4">
              <For each={accounts()}>
                {(acc) => {
                  const accCals = createMemo(() =>
                    calendars().filter((c) => c.accountId === acc.id)
                  );
                  return (
                    <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 space-y-3">
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                          <span
                            class={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              acc.provider === "microsoft"
                                ? "bg-sky-500/15 text-sky-400"
                                : "bg-indigo-500/15 text-indigo-400"
                            }`}
                          >
                            {acc.provider === "microsoft"
                              ? "Outlook"
                              : "Google"}
                          </span>
                          <h3 class="text-xs font-semibold text-zinc-200 light:text-zinc-800">
                            {acc.displayName}
                          </h3>
                          <span class="text-xs text-zinc-500">
                            ({acc.email})
                          </span>
                        </div>
                      </div>

                      <div class="divide-y divide-zinc-800/60 light:divide-zinc-200">
                        <For each={accCals()}>
                          {(cal) => (
                            <div class="py-3 flex flex-wrap items-center justify-between gap-3">
                              <label class="flex items-center gap-2.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={cal.isVisible}
                                  onChange={(e) =>
                                    void toggleCalendar(
                                      cal.id,
                                      e.currentTarget.checked
                                    )
                                  }
                                  class="rounded border-zinc-700"
                                />
                                <span
                                  class="w-3 h-3 rounded-full shrink-0"
                                  style={{ "background-color": cal.colorHex }}
                                />
                                <span class="text-xs font-medium text-zinc-100 light:text-zinc-900">
                                  {cal.name}
                                </span>
                                <Show when={cal.isPrimary}>
                                  <span class="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 light:bg-zinc-200 text-zinc-400 light:text-zinc-600">
                                    Default
                                  </span>
                                </Show>
                              </label>

                              <div class="flex items-center gap-1.5">
                                <For each={CALENDAR_COLOR_SWATCHES}>
                                  {(swatch) => (
                                    <button
                                      type="button"
                                      title={swatch.name}
                                      onClick={() =>
                                        void updateCalendarColorAction(
                                          cal.id,
                                          swatch.hex
                                        )
                                      }
                                      class={`w-5 h-5 rounded-full transition-transform ${
                                        cal.colorHex.toLowerCase() ===
                                        swatch.hex.toLowerCase()
                                          ? "scale-110 ring-2 ring-white light:ring-zinc-900"
                                          : "opacity-75 hover:opacity-100"
                                      }`}
                                      style={{ "background-color": swatch.hex }}
                                    />
                                  )}
                                </For>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </section>
                  );
                }}
              </For>
            </div>
          </Show>

          {/* TAB 4: TIME ZONES */}
          <Show when={activeSettingsTab() === "timezones"}>
            <div class="space-y-6">
              <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 space-y-4">
                <div>
                  <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 light:text-zinc-700">
                    Primary & World Time Zones
                  </h3>
                  <p class="text-xs text-zinc-500">
                    Compare your local time with another city side-by-side on
                    the calendar grid
                  </p>
                </div>

                <div class="rounded-lg border border-zinc-800 light:border-zinc-200 bg-zinc-900/50 light:bg-white p-3.5 flex items-center justify-between">
                  <div>
                    <div class="text-xs font-semibold text-zinc-200 light:text-zinc-800">
                      Primary Time Zone
                    </div>
                    <div class="text-[11px] text-zinc-500">
                      Automatically detected from your system clock
                    </div>
                  </div>
                  <span class="px-2.5 py-1 rounded-md bg-indigo-500/15 text-indigo-300 light:text-indigo-700 text-xs font-medium">
                    {localTimezoneName()} ({getPrimaryTimezoneAbbr()})
                  </span>
                </div>

                <div class="rounded-lg border border-zinc-800 light:border-zinc-200 bg-zinc-900/50 light:bg-white p-3.5 space-y-3">
                  <div class="flex items-center justify-between">
                    <div>
                      <div class="text-xs font-semibold text-zinc-200 light:text-zinc-800">
                        Show Second Time Zone on Calendar
                      </div>
                      <div class="text-[11px] text-zinc-500">
                        Displays a secondary time column alongside your local
                        hours in Day and Week views
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={userPreferences().showSecondaryTimezone}
                      onChange={(e) => {
                        updateUserPreferences({
                          showSecondaryTimezone: e.currentTarget.checked,
                        });
                        showToast(
                          e.currentTarget.checked
                            ? "Second time zone enabled"
                            : "Second time zone hidden"
                        );
                      }}
                      class="w-4 h-4 rounded"
                    />
                  </div>

                  <Show when={userPreferences().showSecondaryTimezone}>
                    <div class="pt-2 border-t border-zinc-800/60 light:border-zinc-200 space-y-1.5">
                      <label class="text-xs font-medium text-zinc-300 light:text-zinc-700">
                        Second Time Zone City / Region
                      </label>
                      <select
                        value={secondaryTimezone()}
                        onChange={(e) => {
                          const nextTz = e.currentTarget.value;
                          setSecondaryTimezone(nextTz);
                          void persistBackendSettings({
                            secondaryTimezone: nextTz,
                          });
                          showToast(`Second time zone set to ${nextTz}`);
                        }}
                        class="w-full h-9 px-2.5 rounded-lg border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800"
                      >
                        <For each={TIMEZONE_OPTIONS}>
                          {(tz) => <option value={tz.value}>{tz.label}</option>}
                        </For>
                      </select>
                    </div>
                  </Show>
                </div>
              </section>
            </div>
          </Show>

          {/* TAB 5: SYNC & NOTIFICATIONS */}
          <Show when={activeSettingsTab() === "sync"}>
            <div class="space-y-6">
              <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 light:text-zinc-700">
                      Calendar Sync Status
                    </h3>
                    <p class="text-xs text-zinc-500">
                      {outboxMutations().length > 0
                        ? `${outboxMutations().length} change(s) waiting to sync`
                        : `All changes saved • Last checked at ${formattedLastSync()}`}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void triggerSyncNowAction()}
                      class="h-8 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
                    >
                      Sync Now
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.resetDemoData();
                        await Promise.all([
                          refreshMetadata(),
                          refreshViewport(),
                        ]);
                        showToast("Restored sample events");
                      }}
                      class="h-8 px-3 rounded-lg border border-zinc-700 light:border-zinc-300 hover:bg-zinc-800 light:hover:bg-zinc-200 text-xs text-zinc-300 light:text-zinc-700 transition-colors"
                    >
                      Restore Sample Events
                    </button>
                  </div>
                </div>
              </section>

              <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 space-y-4">
                <div>
                  <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 light:text-zinc-700">
                    Background Preferences
                  </h3>
                  <p class="text-xs text-zinc-500">
                    Control how often RapidCal checks for new invitations and
                    how the window behaves when closed
                  </p>
                </div>

                <div class="space-y-3">
                  <div class="rounded-lg border border-zinc-800 light:border-zinc-200 bg-zinc-900/50 light:bg-white p-3.5 flex items-center justify-between gap-4">
                    <div>
                      <div class="text-xs font-semibold text-zinc-200 light:text-zinc-800">
                        Automatic Sync Frequency
                      </div>
                      <div class="text-[11px] text-zinc-500">
                        How often RapidCal checks your connected accounts for
                        schedule updates
                      </div>
                    </div>
                    <select
                      value={syncIntervalSecs()}
                      onChange={(e) => {
                        const secs = parseInt(e.currentTarget.value, 10) || 60;
                        setSyncIntervalSecs(secs);
                        void persistBackendSettings({ syncIntervalSecs: secs });
                        showToast("Updated sync frequency");
                      }}
                      class="h-8 px-2.5 rounded-lg border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800"
                    >
                      <option value={30}>Every 30 seconds</option>
                      <option value={60}>Every minute</option>
                      <option value={300}>Every 5 minutes</option>
                      <option value={600}>Every 10 minutes</option>
                    </select>
                  </div>

                  <div class="rounded-lg border border-zinc-800 light:border-zinc-200 bg-zinc-900/50 light:bg-white p-3.5 flex items-center justify-between gap-4">
                    <div>
                      <div class="text-xs font-semibold text-zinc-200 light:text-zinc-800">
                        Keep Running in System Tray
                      </div>
                      <div class="text-[11px] text-zinc-500">
                        When closing the window, keep RapidCal in your system
                        tray so you still see upcoming meeting reminders
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={hibernationEnabled()}
                      onChange={(e) => {
                        const enabled = e.currentTarget.checked;
                        setHibernationEnabled(enabled);
                        void persistBackendSettings({
                          hibernationEnabled: enabled,
                        });
                        showToast("Updated system tray preference");
                      }}
                      class="w-4 h-4 rounded"
                    />
                  </div>
                </div>
              </section>
            </div>
          </Show>

          {/* TAB 6: KEYBOARD SHORTCUTS */}
          <Show when={activeSettingsTab() === "shortcuts"}>
            <div class="space-y-4">
              <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 space-y-3">
                <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 light:text-zinc-700">
                  Calendar Views & Navigation
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  {[
                    ["Day View", "D"],
                    ["3-Day View", "3"],
                    ["Work Week View", "5"],
                    ["Full Week View", "W"],
                    ["Month View", "M"],
                    ["Schedule List View", "A"],
                    ["Go to Today", "T"],
                    ["Previous / Next Period", "← / →"],
                  ].map(([label, key]) => (
                    <div class="flex items-center justify-between p-2.5 rounded-lg border border-zinc-800/70 light:border-zinc-200 bg-zinc-900/50 light:bg-white">
                      <span class="text-zinc-200 light:text-zinc-800">
                        {label}
                      </span>
                      <kbd class="px-2 py-0.5 rounded bg-zinc-800 light:bg-zinc-200 text-zinc-300 light:text-zinc-700 font-mono-tabular text-[11px]">
                        {key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </section>

              <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 space-y-3">
                <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 light:text-zinc-700">
                  Events, Meetings & Workspace
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  {[
                    ["Quick Add Event", "C or ⌘K"],
                    ["Search Events", "⌘F"],
                    ["Join Video Call", "⌘J"],
                    ["Sync Calendars Now", "⌘R"],
                    ["Open Settings", "⌘,"],
                    ["Show / Hide Left Sidebar", "["],
                    ["Show / Hide Event Details", "]"],
                    ["Delete Selected Event", "Delete"],
                  ].map(([label, key]) => (
                    <div class="flex items-center justify-between p-2.5 rounded-lg border border-zinc-800/70 light:border-zinc-200 bg-zinc-900/50 light:bg-white">
                      <span class="text-zinc-200 light:text-zinc-800">
                        {label}
                      </span>
                      <kbd class="px-2 py-0.5 rounded bg-zinc-800 light:bg-zinc-200 text-zinc-300 light:text-zinc-700 font-mono-tabular text-[11px]">
                        {key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </section>

              <div class="flex justify-end">
                <button
                  type="button"
                  onClick={() => setViewMode(userPreferences().defaultView)}
                  class="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                >
                  Return to Calendar →
                </button>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
