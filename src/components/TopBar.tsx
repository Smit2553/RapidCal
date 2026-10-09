import { For, Show } from "solid-js";
import { formatHeaderTitle } from "../lib/dateUtils";
import { formatModKey } from "../lib/platform";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoonIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  VideoIcon,
} from "./icons/Icons";
import {
  anchorDate,
  closeSettings,
  joinActiveOrNextMeeting,
  jumpToday,
  leftSidebarOpen,
  openCommandPalette,
  openSettings,
  rightInspectorOpen,
  setLeftSidebarOpen,
  setRightInspectorOpen,
  setViewMode,
  startNewEventDraft,
  stepDate,
  syncStatus,
  theme,
  toggleTheme,
  triggerSyncNowAction,
  viewMode,
} from "../store/calendarStore";
import type { CalendarViewMode } from "../types/calendar";

const VIEW_TABS: { id: CalendarViewMode; label: string; key: string }[] = [
  { id: "day", label: "Day", key: "D" },
  { id: "3day", label: "3-Day", key: "3" },
  { id: "workweek", label: "Work Week", key: "5" },
  { id: "week", label: "Week", key: "W" },
  { id: "month", label: "Month", key: "M" },
  { id: "agenda", label: "Schedule", key: "A" },
];

export function TopBar() {
  return (
    <header class="h-12 shrink-0 border-b border-zinc-800/80 light:border-zinc-200 bg-zinc-950/95 light:bg-white/95 backdrop-blur flex items-center justify-between px-2.5 gap-1.5 select-none z-20">
      {/* Left: Sidebar Toggle + Brand + Date Navigation */}
      <div class="flex items-center gap-1.5 min-w-0">
        <button
          type="button"
          onClick={() => setLeftSidebarOpen(!leftSidebarOpen())}
          title="Show / Hide Sidebar ([)"
          class="h-7 w-7 rounded-md border border-zinc-800 light:border-zinc-200 bg-zinc-900/70 light:bg-zinc-100 hover:bg-zinc-800 light:hover:bg-zinc-200 flex items-center justify-center text-zinc-400 light:text-zinc-600 transition-colors shrink-0"
        >
          <PanelLeftIcon class="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={() => {
            if (viewMode() === "settings") closeSettings();
          }}
          class="flex items-center gap-1 pr-1 hover:opacity-90 shrink-0"
        >
          <div class="w-2.5 h-2.5 rounded-sm bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.75)]" />
          <span class="font-semibold tracking-tight text-sm text-zinc-100 light:text-zinc-900">
            RapidCal
          </span>
        </button>

        <div class="h-4 w-[1px] bg-zinc-800 light:bg-zinc-200 mx-0.5 shrink-0" />

        <button
          type="button"
          onClick={jumpToday}
          title="Go to Today (T)"
          class="h-7 px-1.5 rounded-md border border-zinc-800 light:border-zinc-200 bg-zinc-900/70 light:bg-zinc-100 hover:bg-zinc-800 light:hover:bg-zinc-200 text-xs font-medium text-zinc-200 light:text-zinc-800 transition-colors shrink-0"
        >
          Today
        </button>

        <div class="flex items-center rounded-md border border-zinc-800 light:border-zinc-200 bg-zinc-900/50 light:bg-zinc-100 overflow-hidden shrink-0">
          <button
            type="button"
            onClick={() => stepDate(-1)}
            title="Previous (←)"
            class="h-7 w-6 flex items-center justify-center hover:bg-zinc-800 light:hover:bg-zinc-200 text-zinc-400 light:text-zinc-600"
          >
            <ChevronLeftIcon class="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => stepDate(1)}
            title="Next (→)"
            class="h-7 w-6 flex items-center justify-center hover:bg-zinc-800 light:hover:bg-zinc-200 text-zinc-400 light:text-zinc-600 border-l border-zinc-800 light:border-zinc-200"
          >
            <ChevronRightIcon class="w-3.5 h-3.5" />
          </button>
        </div>

        <h1 class="text-sm font-semibold tracking-tight text-zinc-100 light:text-zinc-900 truncate pl-1 min-w-0">
          {formatHeaderTitle(anchorDate(), viewMode())}
        </h1>
      </div>

      {/* Center: View Switcher + Up Next Countdown Pill */}
      <div class="flex items-center gap-1.5 min-w-0">
        <div class="flex items-center p-0.5 rounded-lg border border-zinc-800/90 light:border-zinc-200 bg-zinc-900/80 light:bg-zinc-100 shrink-0">
          <For each={VIEW_TABS}>
            {(tab) => (
              <button
                type="button"
                onClick={() => setViewMode(tab.id)}
                title={`${tab.label} (${tab.key})`}
                class={`h-6 px-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${
                  viewMode() === tab.id
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-zinc-400 light:text-zinc-600 hover:text-zinc-200 light:hover:text-zinc-900"
                }`}
              >
                <span>{tab.label}</span>
                <kbd
                  class={`hidden 2xl:inline text-[10px] font-mono-tabular px-1 rounded ${
                    viewMode() === tab.id
                      ? "bg-indigo-500/70 text-indigo-100"
                      : "bg-zinc-800/80 light:bg-zinc-200 text-zinc-500"
                  }`}
                >
                  {tab.key}
                </kbd>
              </button>
            )}
          </For>
        </div>

        <Show when={syncStatus().upNextLabel}>
          <div class="hidden xl:flex items-center gap-1.5 h-7 px-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 light:text-indigo-700 text-xs min-w-0 shrink">
            <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse shrink-0" />
            <span class="font-medium truncate max-w-[50px] 2xl:max-w-[200px]">
              {syncStatus().upNextLabel}
            </span>
            <Show when={syncStatus().upNextConferenceUrl}>
              <a
                role="button"
                href={syncStatus().upNextConferenceUrl || undefined}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  joinActiveOrNextMeeting();
                }}
                title={`Join Video Call (${formatModKey("J")})`}
                class="ml-1 px-2 py-0.5 rounded bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-[10px] transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <VideoIcon class="w-3 h-3 shrink-0" />
                <span class="hidden 2xl:inline">Join {formatModKey("J")}</span>
                <span class="2xl:hidden">{formatModKey("J")}</span>
              </a>
            </Show>
          </div>
        </Show>
      </div>

      {/* Right: Quick Add, Sync Status, Settings, Theme, Event Details */}
      <div class="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => openCommandPalette("nlp")}
          title={`Quick Add / Search (${formatModKey("K")})`}
          class="h-7 px-2 rounded-md border border-zinc-800 light:border-zinc-200 bg-zinc-900/90 light:bg-zinc-100 hover:border-indigo-500/50 text-xs text-zinc-400 light:text-zinc-600 flex items-center gap-1.5 transition-colors shrink-0"
        >
          <span class="flex items-center gap-1.5 min-w-0">
            <SearchIcon class="w-3.5 h-3.5 text-zinc-400 light:text-zinc-500 shrink-0" />
            <span class="hidden xl:inline">Quick Add / Search…</span>
          </span>
          <kbd class="hidden xl:inline text-[10px] font-mono-tabular px-1 py-0.5 rounded bg-zinc-800 light:bg-zinc-200 text-zinc-300 light:text-zinc-700">
            {formatModKey("K")}
          </kbd>
        </button>

        <button
          type="button"
          onClick={() => startNewEventDraft()}
          title="New Event (C)"
          class="h-7 px-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors flex items-center gap-1 shrink-0"
        >
          <PlusIcon class="w-3.5 h-3.5 shrink-0" />
          <span>Event</span>
        </button>

        <button
          type="button"
          onClick={() => void triggerSyncNowAction()}
          title={syncStatus().lastMessage || "Click to sync calendars"}
          class="h-7 px-2 rounded-md border border-zinc-800 light:border-zinc-200 bg-zinc-900/70 light:bg-zinc-100 hover:bg-zinc-800 light:hover:bg-zinc-200 text-xs flex items-center gap-1.5 text-zinc-300 light:text-zinc-700 shrink-0"
        >
          <span
            class={`w-2 h-2 rounded-full shrink-0 ${
              syncStatus().state === "syncing"
                ? "bg-amber-400 animate-ping"
                : syncStatus().pendingOutboxCount > 0
                  ? "bg-amber-400"
                  : "bg-emerald-400"
            }`}
          />
          <span class="hidden 2xl:inline text-[11px]">
            {syncStatus().state === "syncing"
              ? "Syncing…"
              : syncStatus().pendingOutboxCount > 0
                ? "Saving…"
                : "Up to date"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (viewMode() === "settings") {
              closeSettings();
            } else {
              openSettings("general");
            }
          }}
          title={`Settings & Connected Accounts (${formatModKey(",")})`}
          class={`w-7 h-7 justify-center p-0 lg:w-auto lg:h-7 lg:px-2 rounded-md border text-xs flex items-center gap-1.5 transition-colors shrink-0 ${
            viewMode() === "settings"
              ? "border-indigo-500 bg-indigo-600 text-white font-medium"
              : "border-zinc-800 light:border-zinc-200 bg-zinc-900/70 light:bg-zinc-100 hover:bg-zinc-800 light:hover:bg-zinc-200 text-zinc-300 light:text-zinc-700"
          }`}
        >
          <SettingsIcon class="w-3.5 h-3.5 shrink-0" />
          <span class="hidden lg:inline">Settings</span>
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          title="Switch Dark / Light Mode"
          class="h-7 w-7 rounded-md border border-zinc-800 light:border-zinc-200 bg-zinc-900/70 light:bg-zinc-100 hover:bg-zinc-800 light:hover:bg-zinc-200 flex items-center justify-center text-zinc-400 light:text-zinc-600 transition-colors shrink-0"
        >
          <Show
            when={theme() === "dark"}
            fallback={<MoonIcon class="w-3.5 h-3.5 text-zinc-600 light:text-zinc-600" />}
          >
            <SunIcon class="w-3.5 h-3.5 text-amber-400" />
          </Show>
        </button>

        <Show when={viewMode() !== "settings"}>
          <button
            type="button"
            onClick={() => setRightInspectorOpen(!rightInspectorOpen())}
            title="Show / Hide Event Details / Inspector (])"
            class="h-7 w-7 rounded-md border border-zinc-800 light:border-zinc-200 bg-zinc-900/70 light:bg-zinc-100 hover:bg-zinc-800 light:hover:bg-zinc-200 flex items-center justify-center text-zinc-400 light:text-zinc-600 transition-colors shrink-0"
          >
            <PanelRightIcon class="w-3.5 h-3.5" />
          </button>
        </Show>
      </div>
    </header>
  );
}
