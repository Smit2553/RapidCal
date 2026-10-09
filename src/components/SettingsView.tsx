import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { getPrimaryTimezoneAbbr } from "../lib/dateUtils";
import { api } from "../lib/tauri";
import {
  deleteKeyLabel,
  detectSystemPlatform,
  enterKeyLabel,
  formatKeyCombo,
  formatModKey,
  getEffectivePlatformStyle,
  getSystemPlatformLabel,
  isMac,
} from "../lib/platform";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarIcon,
  CheckIcon,
  DatabaseIcon,
  DownloadIcon,
  GlobeIcon,
  KeyboardIcon,
  MoonIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldIcon,
  SlidersIcon,
  SparklesIcon,
  SunIcon,
  UploadIcon,
  UsersIcon,
} from "./icons/Icons";
import type { IconProps } from "./icons/Icons";
import {
  accounts,
  activeSettingsTab,
  calendars,
  closeSettings,
  DEFAULT_HOUR_HEIGHT,
  hourHeightPx,
  oauthConfig,
  outboxMutations,
  refreshMetadata,
  refreshViewport,
  setActiveSettingsTab,
  setGridDensity,
  setHourHeight,
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
import {
  applyImportedPreferences,
  copyPreferencesJsonToClipboard,
  downloadPreferencesJsonFile,
  resetToSampleDataset,
  validatePreferencesImport,
} from "../lib/preferencesIo";

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

interface NavItem {
  id: SettingsTab;
  label: string;
  description: string;
  icon: (props: IconProps) => any;
}

const SETTINGS_NAV: NavItem[] = [
  {
    id: "general",
    label: "General & Appearance",
    description: "Theme, time format, and calendar layout",
    icon: SparklesIcon,
  },
  {
    id: "accounts",
    label: "Connected Accounts",
    description: "Google Calendar and Microsoft Outlook",
    icon: UsersIcon,
  },
  {
    id: "calendars",
    label: "My Calendars",
    description: "Visibility and custom colors",
    icon: CalendarIcon,
  },
  {
    id: "timezones",
    label: "Time Zones",
    description: "Local and secondary world clock",
    icon: GlobeIcon,
  },
  {
    id: "sync",
    label: "Sync & Notifications",
    description: "Background updates and system tray",
    icon: RefreshCwIcon,
  },
  {
    id: "shortcuts",
    label: "Keyboard Shortcuts",
    description: "Quick keys for navigation and actions",
    icon: KeyboardIcon,
  },
  {
    id: "advanced",
    label: "Advanced & Power-User",
    description: "Developer OAuth, sync polling, and power controls",
    icon: SlidersIcon,
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
  const [showClientSecret, setShowClientSecret] = createSignal(false);

  // Diagnostics & Modals state
  const [selectedPayload, setSelectedPayload] = createSignal<string | null>(null);
  const [isRefreshingDiagnostics, setIsRefreshingDiagnostics] = createSignal(false);
  const [pasteModalOpen, setPasteModalOpen] = createSignal(false);
  const [pasteText, setPasteText] = createSignal("");
  const [importErrorMessage, setImportErrorMessage] = createSignal<string | null>(null);
  let fileInputRef: HTMLInputElement | undefined;
  const [resetModalOpen, setResetModalOpen] = createSignal(false);
  const [resetPrefsChecked, setResetPrefsChecked] = createSignal(true);
  const [isResetting, setIsResetting] = createSignal(false);

  const hasCustomOAuth = createMemo(() => {
    const cfg = oauthConfig();
    return !!(cfg.googleClientId?.trim() || cfg.msClientId?.trim());
  });

  function formatTimeAgo(isoString: string): string {
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 60) return `${Math.max(1, diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  function getOperationBadgeClass(op: string): string {
    switch (op) {
      case "create":
        return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
      case "update":
        return "bg-sky-500/15 text-sky-400 border-sky-500/30";
      case "delete":
        return "bg-rose-500/15 text-rose-400 border-rose-500/30";
      case "rsvp":
        return "bg-amber-500/15 text-amber-400 border-amber-500/30";
      case "busy_mirror":
        return "bg-purple-500/15 text-purple-400 border-purple-500/30";
      default:
        return "bg-zinc-800 text-zinc-300 border-zinc-700";
    }
  }

  function getPayloadTitle(rawJson: string): string {
    try {
      const obj = JSON.parse(rawJson);
      return obj.title || obj.responseStatus || `Event ${obj.id || "change"}`;
    } catch {
      return rawJson.slice(0, 30);
    }
  }

  const handleFileImport = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const content = ev.target?.result as string;
      const res = validatePreferencesImport(content);
      if (res.ok) {
        await applyImportedPreferences(res);
      } else {
        showToast(`Import rejected: ${res.error}`);
      }
      target.value = "";
    };
    reader.readAsText(file);
  };

  const handlePasteImportSubmit = async () => {
    setImportErrorMessage(null);
    const res = validatePreferencesImport(pasteText().trim());
    if (res.ok) {
      await applyImportedPreferences(res);
      setPasteModalOpen(false);
      setPasteText("");
    } else {
      setImportErrorMessage(res.error);
    }
  };

  const handleConfirmResetDataset = async () => {
    setIsResetting(true);
    try {
      await resetToSampleDataset({
        resetPreferences: resetPrefsChecked(),
      });
      setResetModalOpen(false);
    } catch (e: any) {
      showToast(`Reset failed: ${e?.message || "Unknown error"}`);
    } finally {
      setIsResetting(false);
    }
  };

  const handleRefreshDiagnostics = async () => {
    setIsRefreshingDiagnostics(true);
    try {
      await triggerSyncNowAction();
      await Promise.all([refreshMetadata(), refreshViewport()]);
      showToast("Sync cache refreshed and outbox processed");
    } catch (e: any) {
      showToast(`Sync failed: ${e?.message || "Unknown error"}`);
    } finally {
      setIsRefreshingDiagnostics(false);
    }
  };


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
                const IconComponent = item.icon;
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
                    <span class="mt-0.5 shrink-0">
                      <IconComponent class="w-4 h-4 text-zinc-400 group-hover:text-zinc-200" />
                    </span>
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
            <ArrowLeftIcon class="w-3.5 h-3.5 shrink-0 text-zinc-400" />
            <span>Back to Calendar</span>
          </button>
        </div>
      </div>

      {/* Right Settings Content Pane */}
      <div class="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
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
                      <span class="w-8 h-8 rounded-lg bg-zinc-950 border border-zinc-700 flex items-center justify-center">
                        <MoonIcon class="w-4 h-4 text-amber-300 shrink-0" />
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
                      <span class="w-8 h-8 rounded-lg bg-white border border-zinc-300 flex items-center justify-center">
                        <SunIcon class="w-4 h-4 text-amber-500 shrink-0" />
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
                  <div class="space-y-1.5 md:col-span-2">
                    <div class="flex items-center justify-between">
                      <label class="text-xs font-medium text-zinc-300 light:text-zinc-700">
                        Time Grid Density
                      </label>
                      <span class="text-[11px] font-mono text-zinc-500">
                        {hourHeightPx()} px / hr
                      </span>
                    </div>
                    <div class="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setGridDensity("compact");
                          showToast("Set density to Compact (44px)");
                        }}
                        class={`py-2 px-3 rounded-lg border text-xs font-medium transition-colors text-center ${
                          (userPreferences().gridDensity || "standard") === "compact"
                            ? "border-indigo-500 bg-indigo-500/15 text-indigo-300 light:text-indigo-700 font-semibold"
                            : "border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-zinc-300 light:text-zinc-700 hover:border-zinc-700"
                        }`}
                      >
                        Compact (44px)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setGridDensity("standard");
                          showToast("Set density to Standard (56px)");
                        }}
                        class={`py-2 px-3 rounded-lg border text-xs font-medium transition-colors text-center ${
                          (userPreferences().gridDensity || "standard") === "standard"
                            ? "border-indigo-500 bg-indigo-500/15 text-indigo-300 light:text-indigo-700 font-semibold"
                            : "border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-zinc-300 light:text-zinc-700 hover:border-zinc-700"
                        }`}
                      >
                        Standard (56px)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setGridDensity("spacious");
                          showToast("Set density to Spacious (72px)");
                        }}
                        class={`py-2 px-3 rounded-lg border text-xs font-medium transition-colors text-center ${
                          (userPreferences().gridDensity || "standard") === "spacious"
                            ? "border-indigo-500 bg-indigo-500/15 text-indigo-300 light:text-indigo-700 font-semibold"
                            : "border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-zinc-300 light:text-zinc-700 hover:border-zinc-700"
                        }`}
                      >
                        Spacious (72px)
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </Show>

          {/* TAB 2: CONNECTED ACCOUNTS (Refactored: Approachable Everyday UX) */}
          <Show when={activeSettingsTab() === "accounts"}>
            <div class="space-y-6">
              <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 sm:p-5 space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 light:text-zinc-700">
                      Connected Accounts ({accounts().length})
                    </h3>
                    <p class="text-xs text-zinc-500">
                      Link your Google Calendar or Microsoft Outlook accounts to view and manage all your schedules in one unified view.
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleConnectProvider("google")}
                      class="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm"
                    >
                      <PlusIcon class="w-3.5 h-3.5 shrink-0" />
                      <span>Connect Google</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleConnectProvider("microsoft")}
                      class="h-8 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm"
                    >
                      <PlusIcon class="w-3.5 h-3.5 shrink-0" />
                      <span>Connect Outlook</span>
                    </button>
                  </div>
                </div>

                <Show when={authStatusMsg()}>
                  <div class="p-3 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-xs text-indigo-200 light:text-indigo-800 flex items-center justify-between">
                    <span>{authStatusMsg()}</span>
                    <button
                      type="button"
                      onClick={() => setAuthStatusMsg(null)}
                      class="text-[11px] underline opacity-80 hover:opacity-100 ml-2"
                    >
                      Dismiss
                    </button>
                  </div>
                </Show>

                {/* Account List or Empty State */}
                <Show
                  when={accounts().length > 0}
                  fallback={
                    <div class="p-8 rounded-xl border border-dashed border-zinc-800 light:border-zinc-300 bg-zinc-900/20 light:bg-zinc-50/50 text-center space-y-2">
                      <div class="w-10 h-10 mx-auto rounded-full bg-zinc-800 light:bg-zinc-200 flex items-center justify-center text-zinc-400">
                        <UsersIcon class="w-5 h-5" />
                      </div>
                      <div class="text-xs font-medium text-zinc-300 light:text-zinc-700">
                        No calendar accounts connected yet
                      </div>
                      <p class="text-[11px] text-zinc-500 max-w-sm mx-auto">
                        Click either button above to sign in securely with your standard Google Workspace or Microsoft 365 credentials.
                      </p>
                    </div>
                  }
                >
                  <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                    <For each={accounts()}>
                      {(acc) => (
                        <div class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/60 light:bg-white p-3.5 flex flex-col justify-between gap-3 shadow-xs">
                          <div class="space-y-1.5">
                            <div class="flex items-center justify-between">
                              <span
                                class={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                  acc.provider === "microsoft"
                                    ? "bg-sky-500/15 text-sky-400"
                                    : "bg-indigo-500/15 text-indigo-400"
                                }`}
                              >
                                {acc.provider === "microsoft" ? "Outlook" : "Google"}
                              </span>
                              <span class="text-[11px] text-emerald-400 flex items-center gap-1">
                                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                {acc.status === "demo" ? "Sample Account" : "Connected"}
                              </span>
                            </div>
                            <div class="text-xs font-semibold text-zinc-100 light:text-zinc-900 truncate">
                              {acc.displayName || acc.email}
                            </div>
                            <div class="text-[11px] text-zinc-400 truncate">
                              {acc.email}
                            </div>
                          </div>

                          <div class="flex items-center justify-between pt-2 border-t border-zinc-800/60 light:border-zinc-200">
                            <span class="text-[11px] text-zinc-500">
                              {calendars().filter((c) => c.accountId === acc.id).length} calendars
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                await api.removeAccount(acc.id);
                                await Promise.all([refreshMetadata(), refreshViewport()]);
                                showToast(`Disconnected ${acc.email}`);
                              }}
                              class="text-xs text-rose-400 hover:text-rose-300 font-medium transition-colors"
                            >
                              Disconnect
                            </button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </section>

              {/* Discreet Enterprise & Power-User Referral Card */}
              <section class="rounded-xl border border-zinc-800/80 light:border-zinc-200 bg-zinc-900/20 light:bg-zinc-50/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="flex items-start gap-3">
                  <span class="w-8 h-8 rounded-lg bg-zinc-800/60 light:bg-zinc-200 flex items-center justify-center shrink-0 mt-0.5">
                    <ShieldIcon class="w-4 h-4 text-zinc-400 light:text-zinc-600" />
                  </span>
                  <div>
                    <h4 class="text-xs font-semibold text-zinc-200 light:text-zinc-800">
                      Enterprise Tenant or Custom OAuth Applications
                    </h4>
                    <p class="text-[11px] text-zinc-400 light:text-zinc-600 max-w-lg">
                      Need to sign in with custom Google Cloud Console keys, Microsoft Entra ID (Azure AD) client credentials, or a specific corporate tenant GUID?
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSettingsTab("advanced")}
                  class="h-8 px-3 rounded-lg border border-zinc-700 light:border-zinc-300 hover:bg-zinc-800 light:hover:bg-zinc-200 text-xs font-medium text-zinc-200 light:text-zinc-800 flex items-center justify-center gap-1.5 shrink-0 transition-colors"
                >
                  <SlidersIcon class="w-3.5 h-3.5 text-zinc-400" />
                  <span>Configure in Advanced</span>
                  <ArrowRightIcon class="w-3 h-3 text-zinc-400" />
                </button>
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
                                  class="w-4 h-4 rounded border-zinc-700 light:border-zinc-300 accent-indigo-600 cursor-pointer"
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
                      class="w-4 h-4 rounded border-zinc-700 light:border-zinc-300 accent-indigo-600 cursor-pointer"
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
                      class="w-4 h-4 rounded border-zinc-700 light:border-zinc-300 accent-indigo-600 cursor-pointer"
                    />
                  </div>
                </div>
              </section>
            </div>
          </Show>

          {/* TAB 6: KEYBOARD SHORTCUTS */}
          <Show when={activeSettingsTab() === "shortcuts"}>
            {(() => {
              const navigationShortcuts = [
                ["Day View", "D"],
                ["3-Day View", "3"],
                ["Work Week View", "5"],
                ["Full Week View", "W"],
                ["Month View", "M"],
                ["Schedule List View", "A"],
                ["Go to Today", "T"],
                ["Previous / Next Period", "← / →"],
              ];

              const actionShortcuts = () => [
                ["Quick Add Event", `C or ${formatModKey("K")}`],
                ["Search Events", formatModKey("F")],
                ["Join Video Call", formatModKey("J")],
                ["Sync Calendars Now", formatModKey("R")],
                ["Open Settings", formatModKey(",")],
                ["Show / Hide Left Sidebar", "["],
                ["Show / Hide Event Details", "]"],
                ["Delete Selected Event", deleteKeyLabel()],
              ];

              return (
                <div class="space-y-4">
                  <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 space-y-3">
                    <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 light:text-zinc-700">
                      Calendar Views & Navigation
                    </h3>
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-2 text-xs">
                      {navigationShortcuts.map(([label, key]) => (
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
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-2 text-xs">
                      <For each={actionShortcuts()}>
                        {([label, key]) => (
                          <div class="flex items-center justify-between p-2.5 rounded-lg border border-zinc-800/70 light:border-zinc-200 bg-zinc-900/50 light:bg-white">
                            <span class="text-zinc-200 light:text-zinc-800">
                              {label}
                            </span>
                            <kbd class="px-2 py-0.5 rounded bg-zinc-800 light:bg-zinc-200 text-zinc-300 light:text-zinc-700 font-mono-tabular text-[11px]">
                              {key}
                            </kbd>
                          </div>
                        )}
                      </For>
                    </div>
                  </section>

                  <div class="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setViewMode(userPreferences().defaultView)}
                      class="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <span>Return to Calendar</span>
                      <ArrowRightIcon class="w-3.5 h-3.5 shrink-0" />
                    </button>
                  </div>
                </div>
              );
            })()}
          </Show>

          {/* TAB 7: ADVANCED & POWER-USER */}
          <Show when={activeSettingsTab() === "advanced"}>
            <div class="space-y-6">
              {/* SECTION 1: DEVELOPER OAUTH CREDENTIALS */}
              <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 sm:p-5 space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/60 light:border-zinc-200 pb-3">
                  <div>
                    <div class="flex items-center gap-2">
                      <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 light:text-zinc-700">
                        Developer OAuth Credentials
                      </h3>
                      <span
                        class={`px-2 py-0.5 rounded text-[10px] font-medium ${
                          hasCustomOAuth()
                            ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                            : "bg-zinc-800 light:bg-zinc-200 text-zinc-400 light:text-zinc-600"
                        }`}
                      >
                        {hasCustomOAuth() ? "Custom OAuth Active" : "Using Built-in Defaults"}
                      </span>
                    </div>
                    <p class="text-xs text-zinc-500 mt-0.5">
                      Override default RapidCal OAuth client registrations with your organization's Google Cloud or Microsoft Entra ID app credentials.
                    </p>
                  </div>
                </div>

                <form onSubmit={(e) => void handleSaveSignInSetup(e)} class="space-y-4">
                  {/* Google Credentials */}
                  <div class="rounded-lg border border-zinc-800/80 light:border-zinc-200 bg-zinc-900/50 light:bg-white p-3.5 space-y-3">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-indigo-500" />
                        <h4 class="text-xs font-semibold text-zinc-200 light:text-zinc-800">
                          Google Workspace / Cloud Console
                        </h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setGoogleClientId("");
                          setGoogleClientSecret("");
                          void persistBackendSettings();
                          showToast("Reverted to built-in Google OAuth client");
                        }}
                        class="text-[11px] text-zinc-400 hover:text-zinc-200 underline"
                      >
                        Reset to Default Google Client
                      </button>
                    </div>

                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      <div class="space-y-1">
                        <label class="text-[11px] font-medium text-zinc-400 light:text-zinc-600">
                          Google Client ID
                        </label>
                        <input
                          type="text"
                          value={googleClientId()}
                          onInput={(e) => setGoogleClientId(e.currentTarget.value)}
                          placeholder="Using built-in default (or enter custom .apps.googleusercontent.com)"
                          class="w-full h-8 px-2.5 rounded-md border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800 font-mono text-[11px]"
                        />
                      </div>

                      <div class="space-y-1">
                        <div class="flex items-center justify-between">
                          <label class="text-[11px] font-medium text-zinc-400 light:text-zinc-600">
                            Google Client Secret (Optional for PKCE)
                          </label>
                          <button
                            type="button"
                            onClick={() => setShowClientSecret(!showClientSecret())}
                            class="text-[10px] text-zinc-500 hover:text-zinc-300"
                          >
                            {showClientSecret() ? "Hide" : "Show"}
                          </button>
                        </div>
                        <input
                          type={showClientSecret() ? "text" : "password"}
                          value={googleClientSecret()}
                          onInput={(e) => setGoogleClientSecret(e.currentTarget.value)}
                          placeholder="••••••••••••••••"
                          class="w-full h-8 px-2.5 rounded-md border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800 font-mono text-[11px]"
                        />
                      </div>
                    </div>
                    <p class="text-[10px] text-zinc-500">
                      Requires an OAuth client ID of type <strong>Desktop app</strong> in Google Cloud Console (loopback redirect <code>http://127.0.0.1</code>).
                    </p>
                  </div>

                  {/* Microsoft Entra ID Credentials */}
                  <div class="rounded-lg border border-zinc-800/80 light:border-zinc-200 bg-zinc-900/50 light:bg-white p-3.5 space-y-3">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-sky-500" />
                        <h4 class="text-xs font-semibold text-zinc-200 light:text-zinc-800">
                          Microsoft Entra ID (Azure AD)
                        </h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setMsClientId("");
                          setMsTenantId("common");
                          void persistBackendSettings();
                          showToast("Reverted to built-in Microsoft OAuth client");
                        }}
                        class="text-[11px] text-zinc-400 hover:text-zinc-200 underline"
                      >
                        Reset to Default Microsoft Client
                      </button>
                    </div>

                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      <div class="space-y-1">
                        <label class="text-[11px] font-medium text-zinc-400 light:text-zinc-600">
                          Application (Client) ID
                        </label>
                        <input
                          type="text"
                          value={msClientId()}
                          onInput={(e) => setMsClientId(e.currentTarget.value)}
                          placeholder="Using built-in default (or enter custom Application Client ID)"
                          class="w-full h-8 px-2.5 rounded-md border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800 font-mono text-[11px]"
                        />
                      </div>

                      <div class="space-y-1">
                        <label class="text-[11px] font-medium text-zinc-400 light:text-zinc-600">
                          Tenant / Authority Scope
                        </label>
                        <div class="flex gap-1.5">
                          <select
                            value={
                              ["common", "organizations", "consumers"].includes(msTenantId())
                                ? msTenantId()
                                : "custom"
                            }
                            onChange={(e) => {
                              const val = e.currentTarget.value;
                              if (val !== "custom") {
                                setMsTenantId(val);
                              }
                            }}
                            class="h-8 px-2 rounded-md border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800 shrink-0"
                          >
                            <option value="common">common (All Microsoft Accounts)</option>
                            <option value="organizations">organizations (Work/School Only)</option>
                            <option value="consumers">consumers (Personal Outlook Only)</option>
                            <option value="custom">Custom Tenant GUID...</option>
                          </select>
                          <input
                            type="text"
                            value={msTenantId()}
                            onInput={(e) => setMsTenantId(e.currentTarget.value)}
                            placeholder="common or tenant-guid"
                            class="flex-1 h-8 px-2 rounded-md border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800 font-mono text-[11px]"
                          />
                        </div>
                      </div>
                    </div>
                    <p class="text-[10px] text-zinc-500">
                      Register as <strong>Mobile and desktop applications</strong> with loopback redirect URI <code>http://127.0.0.1</code>.
                    </p>
                  </div>

                  <div class="flex justify-end pt-1">
                    <button
                      type="submit"
                      class="h-8 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-colors"
                    >
                      Save Developer Credentials
                    </button>
                  </div>
                </form>
              </section>

              {/* SECTION 2: SYNC POLLING FREQUENCY TUNING */}
              <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 sm:p-5 space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/60 light:border-zinc-200 pb-3">
                  <div>
                    <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 light:text-zinc-700">
                      Sync Polling Frequency & Timing
                    </h3>
                    <p class="text-xs text-zinc-500 mt-0.5">
                      Configure how frequently the background sync daemon polls remote Google and Microsoft APIs.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void triggerSyncNowAction()}
                    class="h-7 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm"
                  >
                    <RefreshCwIcon class="w-3 h-3" />
                    <span>Trigger Sync Now</span>
                  </button>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Polling Interval Presets & Custom Input */}
                  <div class="space-y-2">
                    <label class="text-xs font-medium text-zinc-300 light:text-zinc-700">
                      Background Polling Interval
                    </label>
                    <div class="space-y-2">
                      <select
                        value={
                          [15, 30, 60, 120, 300, 600, 900, 1800, 3600].includes(syncIntervalSecs())
                            ? syncIntervalSecs()
                            : "custom"
                        }
                        onChange={(e) => {
                          const val = e.currentTarget.value;
                          if (val !== "custom") {
                            const secs = parseInt(val, 10);
                            setSyncIntervalSecs(secs);
                            void persistBackendSettings({ syncIntervalSecs: secs });
                            showToast(`Sync interval updated to ${secs}s`);
                          }
                        }}
                        class="w-full h-9 px-2.5 rounded-lg border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                      >
                        <option value={15}>Every 15 seconds (Aggressive / Real-time)</option>
                        <option value={30}>Every 30 seconds</option>
                        <option value={60}>Every 1 minute (Recommended Default)</option>
                        <option value={120}>Every 2 minutes</option>
                        <option value={300}>Every 5 minutes</option>
                        <option value={600}>Every 10 minutes</option>
                        <option value={900}>Every 15 minutes</option>
                        <option value={1800}>Every 30 minutes</option>
                        <option value={3600}>Every 1 hour (Battery Saver)</option>
                        <option value="custom">Custom Duration (seconds)...</option>
                      </select>

                      <div class="flex items-center gap-2">
                        <input
                          type="number"
                          min="15"
                          max="86400"
                          step="5"
                          value={syncIntervalSecs()}
                          onInput={(e) => {
                            const val = Math.max(15, parseInt(e.currentTarget.value, 10) || 15);
                            setSyncIntervalSecs(val);
                          }}
                          onChange={() => {
                            void persistBackendSettings({ syncIntervalSecs: syncIntervalSecs() });
                            showToast(`Custom sync interval set to ${syncIntervalSecs()}s`);
                          }}
                          class="w-28 h-8 px-2.5 rounded-md border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs text-zinc-200 light:text-zinc-800 font-mono-tabular"
                        />
                        <span class="text-xs text-zinc-400 light:text-zinc-600">seconds (minimum 15s enforced)</span>
                      </div>
                    </div>
                    <p class="text-[11px] text-zinc-500">
                      Shorter intervals increase API quota consumption and CPU wakeups. Minimum interval allowed by the SQLite sync engine is 15 seconds.
                    </p>
                  </div>

                  {/* Live Engine Diagnostic Card */}
                  <div class="rounded-lg border border-zinc-800/80 light:border-zinc-200 bg-zinc-900/50 light:bg-white p-3.5 space-y-2.5 flex flex-col justify-between">
                    <div class="space-y-1.5">
                      <div class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                        Sync Engine Status
                      </div>
                      <div class="flex items-center justify-between text-xs">
                        <span class="text-zinc-400 light:text-zinc-600">Current Interval:</span>
                        <span class="font-mono text-zinc-200 light:text-zinc-800 font-semibold">
                          {syncIntervalSecs()}s ({Math.round(syncIntervalSecs() / 60 * 10) / 10}m)
                        </span>
                      </div>
                      <div class="flex items-center justify-between text-xs">
                        <span class="text-zinc-400 light:text-zinc-600">Last Successful Sync:</span>
                        <span class="text-zinc-300 light:text-zinc-700">{formattedLastSync()}</span>
                      </div>
                      <div class="flex items-center justify-between text-xs">
                        <span class="text-zinc-400 light:text-zinc-600">Engine State:</span>
                        <span class="text-emerald-400 font-medium capitalize">{syncStatus().state}</span>
                      </div>
                    </div>

                    <div class="pt-2 border-t border-zinc-800/60 light:border-zinc-200 flex items-center justify-between">
                      <div>
                        <div class="text-xs font-medium text-zinc-200 light:text-zinc-800">
                          System Tray Hibernation
                        </div>
                        <div class="text-[10px] text-zinc-500">Keep daemon running on window close</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={hibernationEnabled()}
                        onChange={(e) => {
                          const val = e.currentTarget.checked;
                          setHibernationEnabled(val);
                          void persistBackendSettings({ hibernationEnabled: val });
                          showToast("Updated tray hibernation");
                        }}
                        class="w-4 h-4 rounded border-zinc-700 light:border-zinc-300 accent-indigo-600 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* SECTION 3: PLATFORM SHORTCUT STYLE OVERRIDE & LIVE PREVIEW */}
              <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 sm:p-5 space-y-4">
                <div class="border-b border-zinc-800/60 light:border-zinc-200 pb-3">
                  <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 light:text-zinc-700">
                    Platform Shortcut Style Override
                  </h3>
                  <p class="text-xs text-zinc-500 mt-0.5">
                    Choose whether shortcut badges render macOS typographic symbols (⌘ / ⌥) or Windows/Linux keys (Ctrl / Alt), or adapt automatically.
                  </p>
                </div>

                {/* Style Selection Cards */}
                <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                  {/* Option 1: Auto */}
                  {(() => {
                    const isSelected = () =>
                      (userPreferences().platformShortcutStyle || "auto") === "auto";
                    const systemLabel = getSystemPlatformLabel();
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          updateUserPreferences({ platformShortcutStyle: "auto" });
                          showToast("Shortcut style set to Auto (System Detected)");
                        }}
                        class={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between gap-3 ${
                          isSelected()
                            ? "border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40"
                            : "border-zinc-800 light:border-zinc-200 bg-zinc-900/60 light:bg-white hover:border-zinc-700"
                        }`}
                      >
                        <div>
                          <div class="flex items-center justify-between">
                            <span class="text-xs font-semibold text-zinc-100 light:text-zinc-900">
                              Auto (Detected)
                            </span>
                            <Show when={isSelected()}>
                              <span class="text-[10px] font-semibold text-indigo-400">Active</span>
                            </Show>
                          </div>
                          <p class="text-[11px] text-zinc-500 mt-1">
                            Adapts to host OS ({systemLabel})
                          </p>
                        </div>
                        <div class="flex items-center gap-1.5 font-mono-tabular text-[11px]">
                          <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 light:bg-zinc-200 text-zinc-300 light:text-zinc-700">
                            {formatModKey("K", getEffectivePlatformStyle("auto"))}
                          </kbd>
                          <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 light:bg-zinc-200 text-zinc-300 light:text-zinc-700">
                            {deleteKeyLabel(getEffectivePlatformStyle("auto"))}
                          </kbd>
                        </div>
                      </button>
                    );
                  })()}

                  {/* Option 2: macOS */}
                  {(() => {
                    const isSelected = () =>
                      userPreferences().platformShortcutStyle === "mac";
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          updateUserPreferences({ platformShortcutStyle: "mac" });
                          showToast("Shortcut style set to macOS (⌘ / ⌥)");
                        }}
                        class={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between gap-3 ${
                          isSelected()
                            ? "border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40"
                            : "border-zinc-800 light:border-zinc-200 bg-zinc-900/60 light:bg-white hover:border-zinc-700"
                        }`}
                      >
                        <div>
                          <div class="flex items-center justify-between">
                            <span class="text-xs font-semibold text-zinc-100 light:text-zinc-900">
                              macOS Notation
                            </span>
                            <Show when={isSelected()}>
                              <span class="text-[10px] font-semibold text-indigo-400">Active</span>
                            </Show>
                          </div>
                          <p class="text-[11px] text-zinc-500 mt-1">
                            Symbols: ⌘ Command, ⌥ Option, ⌫
                          </p>
                        </div>
                        <div class="flex items-center gap-1.5 font-mono-tabular text-[11px]">
                          <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 light:bg-zinc-200 text-zinc-300 light:text-zinc-700">
                            ⌘K
                          </kbd>
                          <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 light:bg-zinc-200 text-zinc-300 light:text-zinc-700">
                            ⌥
                          </kbd>
                          <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 light:bg-zinc-200 text-zinc-300 light:text-zinc-700">
                            ⌫
                          </kbd>
                        </div>
                      </button>
                    );
                  })()}

                  {/* Option 3: Windows & Linux */}
                  {(() => {
                    const isSelected = () =>
                      userPreferences().platformShortcutStyle === "windows_linux";
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          updateUserPreferences({ platformShortcutStyle: "windows_linux" });
                          showToast("Shortcut style set to Windows & Linux (Ctrl / Alt)");
                        }}
                        class={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between gap-3 ${
                          isSelected()
                            ? "border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40"
                            : "border-zinc-800 light:border-zinc-200 bg-zinc-900/60 light:bg-white hover:border-zinc-700"
                        }`}
                      >
                        <div>
                          <div class="flex items-center justify-between">
                            <span class="text-xs font-semibold text-zinc-100 light:text-zinc-900">
                              Windows & Linux
                            </span>
                            <Show when={isSelected()}>
                              <span class="text-[10px] font-semibold text-indigo-400">Active</span>
                            </Show>
                          </div>
                          <p class="text-[11px] text-zinc-500 mt-1">
                            Standard keys: Ctrl, Alt, Del, Enter
                          </p>
                        </div>
                        <div class="flex items-center gap-1.5 font-mono-tabular text-[11px]">
                          <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 light:bg-zinc-200 text-zinc-300 light:text-zinc-700">
                            Ctrl+K
                          </kbd>
                          <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 light:bg-zinc-200 text-zinc-300 light:text-zinc-700">
                            Alt
                          </kbd>
                          <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 light:bg-zinc-200 text-zinc-300 light:text-zinc-700">
                            Del
                          </kbd>
                        </div>
                      </button>
                    );
                  })()}
                </div>

                {/* Live Interactive Shortcut Preview Card */}
                {(() => {
                  const effectiveStyle = () => getEffectivePlatformStyle();
                  const previewList = () => [
                    { action: "Quick Add Event", key: formatModKey("K", effectiveStyle()) },
                    { action: "Search Events", key: formatModKey("F", effectiveStyle()) },
                    { action: "Join Video Call", key: formatModKey("J", effectiveStyle()) },
                    { action: "Sync Calendars", key: formatModKey("R", effectiveStyle()) },
                    { action: "Open Settings", key: formatModKey(",", effectiveStyle()) },
                    {
                      action: "Command Palette",
                      key: formatKeyCombo({ mod: true, shift: true, key: "P" }, effectiveStyle()),
                    },
                    { action: "Delete Event", key: deleteKeyLabel(effectiveStyle()) },
                    { action: "Save / Confirm", key: enterKeyLabel(effectiveStyle()) },
                  ];

                  return (
                    <div class="rounded-lg border border-zinc-800/80 light:border-zinc-200 bg-zinc-900/50 light:bg-white p-3.5 space-y-3">
                      <div class="flex items-center justify-between">
                        <div>
                          <div class="text-xs font-semibold text-zinc-200 light:text-zinc-800">
                            Live Shortcut Preview
                          </div>
                          <div class="text-[11px] text-zinc-500">
                            These badges immediately demonstrate how key combinations render in menus, tooltips, and the command palette:
                          </div>
                        </div>
                        <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-500/15 text-indigo-300 light:text-indigo-700">
                          {effectiveStyle() === "mac" ? "macOS Mode" : "Windows/Linux Mode"}
                        </span>
                      </div>

                      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <For each={previewList()}>
                          {(item) => (
                            <div class="p-2 rounded-md border border-zinc-800/60 light:border-zinc-200 bg-zinc-950/60 light:bg-zinc-50 flex items-center justify-between gap-1.5">
                              <span class="text-[11px] text-zinc-400 truncate">
                                {item.action}
                              </span>
                              <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 light:bg-zinc-200 text-zinc-200 light:text-zinc-800 font-mono-tabular text-[10px] font-semibold shrink-0">
                                {item.key}
                              </kbd>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  );
                })()}
              </section>

              {/* SECTION 4: TIME-GRID DENSITY & DYNAMIC HOUR HEIGHT */}
              <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 sm:p-5 space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/60 light:border-zinc-200 pb-3">
                  <div>
                    <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 light:text-zinc-700">
                      Time-Grid Density & Scaling
                    </h3>
                    <p class="text-xs text-zinc-500 mt-0.5">
                      Fine-tune the vertical hour slot height for your screen size and calendar event complexity.
                    </p>
                  </div>
                  <Show when={hourHeightPx() !== DEFAULT_HOUR_HEIGHT}>
                    <button
                      type="button"
                      onClick={() => {
                        setHourHeight(DEFAULT_HOUR_HEIGHT);
                        showToast("Reset hour height to 56px default");
                      }}
                      class="text-xs text-indigo-400 hover:text-indigo-300 underline"
                    >
                      Reset to Default (56px)
                    </button>
                  </Show>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setGridDensity("compact");
                      showToast("Set density to Compact (44px)");
                    }}
                    class={`p-3 rounded-xl border text-left transition-all ${
                      hourHeightPx() === 44
                        ? "border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40"
                        : "border-zinc-800 light:border-zinc-200 bg-zinc-900/60 light:bg-white hover:border-zinc-700"
                    }`}
                  >
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-semibold text-zinc-100 light:text-zinc-900">
                        Compact (44px)
                      </span>
                      <Show when={hourHeightPx() === 44}>
                        <span class="text-[10px] font-semibold text-indigo-400">Active</span>
                      </Show>
                    </div>
                    <p class="text-[11px] text-zinc-500 mt-1">
                      Maximum overview for dense schedules and small laptop screens.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setGridDensity("standard");
                      showToast("Set density to Standard (56px)");
                    }}
                    class={`p-3 rounded-xl border text-left transition-all ${
                      hourHeightPx() === 56
                        ? "border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40"
                        : "border-zinc-800 light:border-zinc-200 bg-zinc-900/60 light:bg-white hover:border-zinc-700"
                    }`}
                  >
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-semibold text-zinc-100 light:text-zinc-900">
                        Standard (56px)
                      </span>
                      <Show when={hourHeightPx() === 56}>
                        <span class="text-[10px] font-semibold text-indigo-400">Active</span>
                      </Show>
                    </div>
                    <p class="text-[11px] text-zinc-500 mt-1">
                      Balanced everyday readability, standard font scale, and padding.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setGridDensity("spacious");
                      showToast("Set density to Spacious (72px)");
                    }}
                    class={`p-3 rounded-xl border text-left transition-all ${
                      hourHeightPx() === 72
                        ? "border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40"
                        : "border-zinc-800 light:border-zinc-200 bg-zinc-900/60 light:bg-white hover:border-zinc-700"
                    }`}
                  >
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-semibold text-zinc-100 light:text-zinc-900">
                        Spacious (72px)
                      </span>
                      <Show when={hourHeightPx() === 72}>
                        <span class="text-[10px] font-semibold text-indigo-400">Active</span>
                      </Show>
                    </div>
                    <p class="text-[11px] text-zinc-500 mt-1">
                      Generous vertical space for detailed event summaries, tags, and links.
                    </p>
                  </button>
                </div>

                {/* Fine-Grained Range Slider */}
                <div class="rounded-lg border border-zinc-800/80 light:border-zinc-200 bg-zinc-900/50 light:bg-white p-3.5 space-y-3">
                  <div class="flex items-center justify-between">
                    <div>
                      <div class="text-xs font-medium text-zinc-200 light:text-zinc-800">
                        Custom Hour Height Slider
                      </div>
                      <div class="text-[11px] text-zinc-500">
                        Adjust vertical hour size continuously between 40px and 96px:
                      </div>
                    </div>
                    <span class="px-2.5 py-1 rounded-md text-xs font-mono font-semibold bg-zinc-800 light:bg-zinc-200 text-zinc-200 light:text-zinc-800">
                      {hourHeightPx()} px / hr
                    </span>
                  </div>

                  <input
                    type="range"
                    min="40"
                    max="96"
                    step="2"
                    value={hourHeightPx()}
                    onInput={(e) => setHourHeight(parseInt(e.currentTarget.value, 10))}
                    class="w-full h-1.5 bg-zinc-800 light:bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />

                  <div class="grid grid-cols-3 gap-2 pt-2 border-t border-zinc-800/60 light:border-zinc-200 text-xs">
                    <div class="p-2 rounded-md bg-zinc-950/60 light:bg-zinc-50 border border-zinc-800/60 light:border-zinc-200">
                      <div class="text-[10px] text-zinc-500 uppercase tracking-wider">15-Min Slot</div>
                      <div class="font-mono text-zinc-200 light:text-zinc-800 font-semibold mt-0.5">
                        {hourHeightPx() / 4} px
                      </div>
                    </div>
                    <div class="p-2 rounded-md bg-zinc-950/60 light:bg-zinc-50 border border-zinc-800/60 light:border-zinc-200">
                      <div class="text-[10px] text-zinc-500 uppercase tracking-wider">24-Hr Canvas</div>
                      <div class="font-mono text-zinc-200 light:text-zinc-800 font-semibold mt-0.5">
                        {24 * hourHeightPx()} px
                      </div>
                    </div>
                    <div class="p-2 rounded-md bg-zinc-950/60 light:bg-zinc-50 border border-zinc-800/60 light:border-zinc-200">
                      <div class="text-[10px] text-zinc-500 uppercase tracking-wider">Visible at 640px</div>
                      <div class="font-mono text-zinc-200 light:text-zinc-800 font-semibold mt-0.5">
                        ~{Math.round((640 - 120) / hourHeightPx() * 10) / 10} hrs
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* SECTION 5: LOCAL DATABASE & SYNC DIAGNOSTICS */}
              <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 sm:p-5 space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/60 light:border-zinc-200 pb-3">
                  <div>
                    <div class="flex items-center gap-2">
                      <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 light:text-zinc-700">
                        Sync Queue & Outbox Diagnostics
                      </h3>
                      <span
                        class={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                          outboxMutations().length === 0
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        }`}
                      >
                        {outboxMutations().length === 0
                          ? "Queue Clean"
                          : `${outboxMutations().length} Pending`}
                      </span>
                    </div>
                    <p class="text-xs text-zinc-500 mt-0.5">
                      Offline mutations waiting to be pushed to Google Calendar or Microsoft Graph
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleRefreshDiagnostics()}
                    disabled={isRefreshingDiagnostics()}
                    class="h-8 px-3 rounded-lg border border-zinc-700 light:border-zinc-300 hover:bg-zinc-800 light:hover:bg-zinc-200 text-xs font-medium text-zinc-200 light:text-zinc-800 flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <RefreshCwIcon
                      class={`w-3.5 h-3.5 ${
                        isRefreshingDiagnostics() ? "animate-spin text-indigo-400" : "text-zinc-400"
                      }`}
                    />
                    <span>{isRefreshingDiagnostics() ? "Syncing…" : "Refresh Sync Cache / Retry"}</span>
                  </button>
                </div>

                {/* Database Metrics Overview */}
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div class="p-2.5 rounded-lg border border-zinc-800/80 light:border-zinc-200 bg-zinc-900/50 light:bg-white">
                    <div class="text-[10px] text-zinc-500 uppercase tracking-wider">Database Mode</div>
                    <div class="font-semibold text-zinc-200 light:text-zinc-800 mt-0.5">SQLite WAL</div>
                  </div>
                  <div class="p-2.5 rounded-lg border border-zinc-800/80 light:border-zinc-200 bg-zinc-900/50 light:bg-white">
                    <div class="text-[10px] text-zinc-500 uppercase tracking-wider">Connected Accounts</div>
                    <div class="font-semibold text-zinc-200 light:text-zinc-800 mt-0.5">{accounts().length} Active</div>
                  </div>
                  <div class="p-2.5 rounded-lg border border-zinc-800/80 light:border-zinc-200 bg-zinc-900/50 light:bg-white">
                    <div class="text-[10px] text-zinc-500 uppercase tracking-wider">Active Calendars</div>
                    <div class="font-semibold text-zinc-200 light:text-zinc-800 mt-0.5">{calendars().length} Loaded</div>
                  </div>
                  <div class="p-2.5 rounded-lg border border-zinc-800/80 light:border-zinc-200 bg-zinc-900/50 light:bg-white">
                    <div class="text-[10px] text-zinc-500 uppercase tracking-wider">Outbox Mutations</div>
                    <div class="font-semibold text-zinc-200 light:text-zinc-800 mt-0.5">{outboxMutations().length} Queued</div>
                  </div>
                </div>

                {/* Empty State */}
                <Show when={outboxMutations().length === 0}>
                  <div class="py-6 px-4 text-center rounded-lg border border-dashed border-zinc-800 light:border-zinc-300 bg-zinc-950/40 light:bg-zinc-100/50">
                    <CheckIcon class="w-6 h-6 mx-auto text-emerald-500 mb-1.5" />
                    <div class="text-xs font-semibold text-zinc-300 light:text-zinc-700">Outbox Queue Clean</div>
                    <div class="text-[11px] text-zinc-500 mt-0.5">
                      All offline mutations have been pushed and synced. Local database is consistent.
                    </div>
                  </div>
                </Show>

                {/* Non-Empty Outbox Table */}
                <Show when={outboxMutations().length > 0}>
                  <div class="overflow-x-auto rounded-lg border border-zinc-800 light:border-zinc-200">
                    <table class="w-full text-left text-xs">
                      <thead class="bg-zinc-900/80 light:bg-zinc-100 text-zinc-400 light:text-zinc-600 border-b border-zinc-800 light:border-zinc-200">
                        <tr>
                          <th class="py-2 px-3 font-medium">ID & Age</th>
                          <th class="py-2 px-3 font-medium">Operation</th>
                          <th class="py-2 px-3 font-medium">Target</th>
                          <th class="py-2 px-3 font-medium">Payload Preview</th>
                          <th class="py-2 px-3 font-medium text-center">Retries</th>
                          <th class="py-2 px-3 font-medium">Status / Error</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-zinc-800/60 light:divide-zinc-200 bg-zinc-950/60 light:bg-white">
                        <For each={outboxMutations()}>
                          {(m) => {
                            const acc = () => accounts().find((a) => a.id === m.accountId);
                            const cal = () => calendars().find((c) => c.id === m.calendarId);

                            return (
                              <tr class="hover:bg-zinc-900/40 light:hover:bg-zinc-50 transition-colors">
                                <td class="py-2.5 px-3 whitespace-nowrap">
                                  <span class="font-mono text-zinc-300 light:text-zinc-700">#{m.id}</span>
                                  <div class="text-[10px] text-zinc-500">{formatTimeAgo(m.createdAt)}</div>
                                </td>
                                <td class="py-2.5 px-3 whitespace-nowrap">
                                  <span
                                    class={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${getOperationBadgeClass(
                                      m.operation
                                    )}`}
                                  >
                                    {m.operation}
                                  </span>
                                </td>
                                <td class="py-2.5 px-3 max-w-[140px] truncate">
                                  <div class="text-zinc-300 light:text-zinc-700 truncate">
                                    {acc()?.displayName || m.accountId}
                                  </div>
                                  <div class="flex items-center gap-1.5 text-[10px] text-zinc-500 truncate">
                                    <span
                                      class="w-2 h-2 rounded-full shrink-0"
                                      style={{ "background-color": cal()?.colorHex || "#6366f1" }}
                                    />
                                    <span class="truncate">{cal()?.name || m.calendarId}</span>
                                  </div>
                                </td>
                                <td class="py-2.5 px-3 max-w-[200px]">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedPayload(m.payloadJson)}
                                    class="text-left group truncate w-full"
                                    title="Click to view full JSON"
                                  >
                                    <div class="text-zinc-200 light:text-zinc-800 group-hover:text-indigo-400 truncate font-medium">
                                      {getPayloadTitle(m.payloadJson)}
                                    </div>
                                    <div class="font-mono text-[10px] text-zinc-500 truncate">
                                      {m.payloadJson}
                                    </div>
                                  </button>
                                </td>
                                <td class="py-2.5 px-3 whitespace-nowrap text-center">
                                  <span
                                    class={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                      m.retryCount > 0
                                        ? "bg-amber-500/15 text-amber-400"
                                        : "bg-zinc-800 light:bg-zinc-200 text-zinc-400"
                                    }`}
                                  >
                                    {m.retryCount}
                                  </span>
                                </td>
                                <td class="py-2.5 px-3 max-w-[160px]">
                                  <Show
                                    when={m.lastError}
                                    fallback={
                                      <span class="text-[11px] text-zinc-500">Queued</span>
                                    }
                                  >
                                    <span
                                      class="text-rose-400 text-[11px] truncate block"
                                      title={m.lastError || ""}
                                    >
                                      {m.lastError}
                                    </span>
                                  </Show>
                                </td>
                              </tr>
                            );
                          }}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>

                {/* JSON Inspection Modal */}
                <Show when={selectedPayload()}>
                  <div
                    onClick={() => setSelectedPayload(null)}
                    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
                  >
                    <div
                      onClick={(e) => e.stopPropagation()}
                      class="w-full max-w-lg rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-950 light:bg-white p-5 shadow-2xl space-y-4"
                    >
                      <div class="flex items-center justify-between">
                        <h4 class="text-xs font-semibold uppercase tracking-wider text-zinc-200 light:text-zinc-800">
                          Outbox Mutation Payload JSON
                        </h4>
                        <button
                          type="button"
                          onClick={() => setSelectedPayload(null)}
                          class="text-zinc-400 hover:text-zinc-200 text-xs"
                        >
                          Close
                        </button>
                      </div>
                      <pre class="max-h-72 overflow-y-auto p-3 rounded-lg bg-zinc-900 light:bg-zinc-100 border border-zinc-800 light:border-zinc-200 text-zinc-300 light:text-zinc-800 font-mono text-[11px] whitespace-pre-wrap select-text">
                        {(() => {
                          try {
                            return JSON.stringify(JSON.parse(selectedPayload() || "{}"), null, 2);
                          } catch {
                            return selectedPayload();
                          }
                        })()}
                      </pre>
                      <div class="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(selectedPayload() || "");
                            showToast("Payload copied to clipboard");
                          }}
                          class="h-8 px-3 rounded-lg border border-zinc-700 light:border-zinc-300 hover:bg-zinc-800 light:hover:bg-zinc-200 text-xs font-medium text-zinc-200 light:text-zinc-800"
                        >
                          Copy JSON
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedPayload(null)}
                          class="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  </div>
                </Show>
              </section>

              {/* SECTION 6: PREFERENCES BACKUP & PORTABILITY */}
              <section class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 sm:p-5 space-y-4">
                <div class="border-b border-zinc-800/60 light:border-zinc-200 pb-3">
                  <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 light:text-zinc-700">
                    Preferences Backup & Portability
                  </h3>
                  <p class="text-xs text-zinc-500 mt-0.5">
                    Export your theme, view configurations, and settings to a JSON file or restore from a backup.
                  </p>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Export Card */}
                  <div class="p-3.5 rounded-lg border border-zinc-800/80 light:border-zinc-200 bg-zinc-900/50 light:bg-white space-y-3">
                    <div>
                      <div class="text-xs font-semibold text-zinc-200 light:text-zinc-800">Export Settings</div>
                      <div class="text-[11px] text-zinc-500 mt-0.5">
                        Download your preferences and non-sensitive configurations as formatted JSON
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={downloadPreferencesJsonFile}
                        class="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm"
                      >
                        <DownloadIcon class="w-3.5 h-3.5" />
                        <span>Download JSON</span>
                      </button>
                      <button
                        type="button"
                        onClick={copyPreferencesJsonToClipboard}
                        class="h-8 px-3 rounded-lg border border-zinc-700 light:border-zinc-300 hover:bg-zinc-800 light:hover:bg-zinc-200 text-xs font-medium text-zinc-300 light:text-zinc-700 transition-colors"
                      >
                        Copy to Clipboard
                      </button>
                    </div>
                  </div>

                  {/* Import Card */}
                  <div class="p-3.5 rounded-lg border border-zinc-800/80 light:border-zinc-200 bg-zinc-900/50 light:bg-white space-y-3">
                    <div>
                      <div class="text-xs font-semibold text-zinc-200 light:text-zinc-800">Import Settings</div>
                      <div class="text-[11px] text-zinc-500 mt-0.5">
                        Upload a .json backup file with schema validation and safety checks
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileImport}
                        accept=".json,application/json"
                        class="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef?.click()}
                        class="h-8 px-3 rounded-lg bg-zinc-800 light:bg-zinc-200 hover:bg-zinc-700 light:hover:bg-zinc-300 text-zinc-200 light:text-zinc-800 text-xs font-medium flex items-center gap-1.5 transition-colors"
                      >
                        <UploadIcon class="w-3.5 h-3.5" />
                        <span>Upload File</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setImportErrorMessage(null);
                          setPasteModalOpen(true);
                        }}
                        class="h-8 px-3 rounded-lg border border-zinc-700 light:border-zinc-300 hover:bg-zinc-800 light:hover:bg-zinc-200 text-xs font-medium text-zinc-300 light:text-zinc-700 transition-colors"
                      >
                        Paste JSON…
                      </button>
                    </div>
                  </div>
                </div>

                {/* Paste Modal */}
                <Show when={pasteModalOpen()}>
                  <div
                    onClick={() => setPasteModalOpen(false)}
                    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
                  >
                    <div
                      onClick={(e) => e.stopPropagation()}
                      class="w-full max-w-md rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-950 light:bg-white p-5 shadow-2xl space-y-4"
                    >
                      <div class="flex items-center justify-between">
                        <h4 class="text-xs font-semibold uppercase tracking-wider text-zinc-200 light:text-zinc-800">
                          Paste Preferences JSON
                        </h4>
                        <button
                          type="button"
                          onClick={() => setPasteModalOpen(false)}
                          class="text-zinc-400 hover:text-zinc-200 text-xs"
                        >
                          Close
                        </button>
                      </div>
                      <textarea
                        rows={8}
                        value={pasteText()}
                        onInput={(e) => setPasteText(e.currentTarget.value)}
                        placeholder='Paste {"preferences": {...}} or {"defaultView": "week", ...}'
                        class="w-full p-2.5 rounded-lg border border-zinc-800 light:border-zinc-300 bg-zinc-900 light:bg-white text-zinc-200 light:text-zinc-800 font-mono text-xs select-text focus:outline-none focus:border-indigo-500"
                      />
                      <Show when={importErrorMessage()}>
                        <div class="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2 rounded-lg">
                          {importErrorMessage()}
                        </div>
                      </Show>
                      <div class="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setPasteModalOpen(false)}
                          class="h-8 px-3 rounded-lg border border-zinc-700 light:border-zinc-300 text-xs font-medium text-zinc-300 light:text-zinc-700"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void handlePasteImportSubmit()}
                          disabled={!pasteText().trim()}
                          class="h-8 px-3.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium"
                        >
                          Validate & Import
                        </button>
                      </div>
                    </div>
                  </div>
                </Show>
              </section>

              {/* DANGER ZONE: RESET SAMPLE DATASET */}
              <section class="rounded-xl border border-rose-950/60 light:border-rose-200 bg-rose-950/10 light:bg-rose-50/50 p-4 sm:p-5 space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 class="text-xs font-semibold uppercase tracking-wider text-rose-400 light:text-rose-700">
                      Reset Sample Dataset & Local Storage
                    </h3>
                    <p class="text-xs text-zinc-500 light:text-zinc-600 mt-0.5">
                      Clear all local modifications and reseed default demo accounts, calendars, and schedules.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setResetModalOpen(true)}
                    class="h-8 px-3.5 rounded-lg border border-rose-800/80 hover:bg-rose-950/40 light:border-rose-300 light:hover:bg-rose-100 text-xs font-semibold text-rose-400 light:text-rose-700 transition-colors"
                  >
                    Reset Sample Dataset…
                  </button>
                </div>

                {/* Confirmation Modal */}
                <Show when={resetModalOpen()}>
                  <div
                    onClick={() => !isResetting() && setResetModalOpen(false)}
                    class="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
                  >
                    <div
                      onClick={(e) => e.stopPropagation()}
                      class="w-full max-w-md rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-950 light:bg-white p-6 shadow-2xl space-y-4"
                    >
                      <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
                          <AlertTriangleIcon class="w-5 h-5 text-rose-500" />
                        </div>
                        <div>
                          <h4 class="text-sm font-semibold text-zinc-100 light:text-zinc-900">
                            Reset to Sample Dataset?
                          </h4>
                          <div class="text-[11px] text-zinc-400 light:text-zinc-600">
                            This action clears your local SQLite database and cannot be undone.
                          </div>
                        </div>
                      </div>

                      <div class="p-3 rounded-lg bg-zinc-900/60 light:bg-zinc-50 border border-zinc-800 light:border-zinc-200 text-xs text-zinc-300 light:text-zinc-700 space-y-2">
                        <p>The following operations will be performed:</p>
                        <ul class="list-disc pl-4 space-y-1 text-[11px] text-zinc-400 light:text-zinc-600">
                          <li>Purge all pending outbox sync mutations</li>
                          <li>Restore 3 demo accounts (Work Google, Contoso, Personal)</li>
                          <li>Reseed 5 sample calendars with original color coding</li>
                          <li>Re-index recurring team check-ins and sample meetings</li>
                        </ul>
                      </div>

                      <label class="flex items-center gap-2.5 text-xs text-zinc-300 light:text-zinc-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={resetPrefsChecked()}
                          onChange={(e) => setResetPrefsChecked(e.currentTarget.checked)}
                          class="w-4 h-4 rounded border-zinc-700 light:border-zinc-300 accent-indigo-600 cursor-pointer"
                        />
                        <span>Also reset display preferences to factory defaults</span>
                      </label>

                      <div class="flex justify-end gap-2 pt-2 border-t border-zinc-800/80 light:border-zinc-200">
                        <button
                          type="button"
                          onClick={() => setResetModalOpen(false)}
                          disabled={isResetting()}
                          class="h-8 px-3 rounded-lg border border-zinc-700 light:border-zinc-300 hover:bg-zinc-800 light:hover:bg-zinc-100 text-xs font-medium text-zinc-300 light:text-zinc-700 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleConfirmResetDataset()}
                          disabled={isResetting()}
                          class="h-8 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center gap-1.5"
                        >
                          <Show when={isResetting()}>
                            <RefreshCwIcon class="w-3.5 h-3.5 animate-spin" />
                          </Show>
                          <span>{isResetting() ? "Resetting…" : "Confirm Reset"}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </Show>
              </section>
            </div>
          </Show>

        </div>
      </div>
    </div>
  );
}
