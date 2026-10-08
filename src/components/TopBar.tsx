import { For, Show } from "solid-js";
import { formatHeaderTitle } from "../lib/dateUtils";
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
    <header class="h-12 shrink-0 border-b border-zinc-800/80 light:border-zinc-200 bg-zinc-950/95 light:bg-white/95 backdrop-blur flex items-center justify-between px-3 gap-2 select-none z-20">
      {/* Left: Sidebar Toggle + Brand + Date Navigation */}
      <div class="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={() => setLeftSidebarOpen(!leftSidebarOpen())}
          title="Show / Hide Sidebar ([)"
          class="h-7 w-7 rounded-md border border-zinc-800 light:border-zinc-200 bg-zinc-900/70 light:bg-zinc-100 hover:bg-zinc-800 light:hover:bg-zinc-200 flex items-center justify-center text-zinc-400 light:text-zinc-600 transition-colors"
        >
          <svg
            class="w-3.5 h-3.5"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <rect x="2" y="2.5" width="12" height="11" rx="2" />
            <line x1="6" y1="2.5" x2="6" y2="13.5" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => {
            if (viewMode() === "settings") closeSettings();
          }}
          class="flex items-center gap-1.5 pr-1 hover:opacity-90"
        >
          <div class="w-2.5 h-2.5 rounded-sm bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.75)]" />
          <span class="font-semibold tracking-tight text-sm text-zinc-100 light:text-zinc-900">
            RapidCal
          </span>
        </button>

        <div class="h-4 w-[1px] bg-zinc-800 light:bg-zinc-200 mx-0.5" />

        <button
          type="button"
          onClick={jumpToday}
          title="Go to Today (T)"
          class="h-7 px-2.5 rounded-md border border-zinc-800 light:border-zinc-200 bg-zinc-900/70 light:bg-zinc-100 hover:bg-zinc-800 light:hover:bg-zinc-200 text-xs font-medium text-zinc-200 light:text-zinc-800 transition-colors"
        >
          Today
        </button>

        <div class="flex items-center rounded-md border border-zinc-800 light:border-zinc-200 bg-zinc-900/50 light:bg-zinc-100 overflow-hidden">
          <button
            type="button"
            onClick={() => stepDate(-1)}
            title="Previous (←)"
            class="h-7 w-6 flex items-center justify-center hover:bg-zinc-800 light:hover:bg-zinc-200 text-zinc-400 light:text-zinc-600"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => stepDate(1)}
            title="Next (→)"
            class="h-7 w-6 flex items-center justify-center hover:bg-zinc-800 light:hover:bg-zinc-200 text-zinc-400 light:text-zinc-600 border-l border-zinc-800 light:border-zinc-200"
          >
            ›
          </button>
        </div>

        <h1 class="text-sm font-semibold tracking-tight text-zinc-100 light:text-zinc-900 truncate pl-1">
          {formatHeaderTitle(anchorDate(), viewMode())}
        </h1>
      </div>

      {/* Center: View Switcher + Up Next Countdown Pill */}
      <div class="flex items-center gap-2">
        <div class="flex items-center p-0.5 rounded-lg border border-zinc-800/90 light:border-zinc-200 bg-zinc-900/80 light:bg-zinc-100">
          <For each={VIEW_TABS}>
            {(tab) => (
              <button
                type="button"
                onClick={() => setViewMode(tab.id)}
                title={`${tab.label} (${tab.key})`}
                class={`h-6 px-2.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                  viewMode() === tab.id
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-zinc-400 light:text-zinc-600 hover:text-zinc-200 light:hover:text-zinc-900"
                }`}
              >
                <span>{tab.label}</span>
                <kbd
                  class={`text-[10px] font-mono-tabular px-1 rounded ${
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
          <div class="hidden xl:flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 light:text-indigo-700 text-xs">
            <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            <span class="font-medium truncate max-w-[210px]">
              {syncStatus().upNextLabel}
            </span>
            <Show when={syncStatus().upNextConferenceUrl}>
              <button
                type="button"
                onClick={joinActiveOrNextMeeting}
                title="Join Video Call (Cmd/Ctrl+J)"
                class="ml-1 px-1.5 py-0.5 rounded bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-[10px] transition-colors"
              >
                Join ⌘J
              </button>
            </Show>
          </div>
        </Show>
      </div>

      {/* Right: Quick Add, Sync Status, Settings, Theme, Event Details */}
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => openCommandPalette("nlp")}
          class="h-7 px-2.5 rounded-md border border-zinc-800 light:border-zinc-200 bg-zinc-900/90 light:bg-zinc-100 hover:border-indigo-500/50 text-xs text-zinc-400 light:text-zinc-600 flex items-center gap-2 transition-colors"
        >
          <span>Quick Add / Search…</span>
          <kbd class="text-[10px] font-mono-tabular px-1.5 py-0.5 rounded bg-zinc-800 light:bg-zinc-200 text-zinc-300 light:text-zinc-700">
            ⌘K
          </kbd>
        </button>

        <button
          type="button"
          onClick={() => startNewEventDraft()}
          title="New Event"
          class="h-7 px-2.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
        >
          + Event
        </button>

        <button
          type="button"
          onClick={() => void triggerSyncNowAction()}
          title={syncStatus().lastMessage || "Click to sync calendars"}
          class="h-7 px-2 rounded-md border border-zinc-800 light:border-zinc-200 bg-zinc-900/70 light:bg-zinc-100 hover:bg-zinc-800 light:hover:bg-zinc-200 text-xs flex items-center gap-1.5 text-zinc-300 light:text-zinc-700"
        >
          <span
            class={`w-2 h-2 rounded-full ${
              syncStatus().state === "syncing"
                ? "bg-amber-400 animate-ping"
                : syncStatus().pendingOutboxCount > 0
                  ? "bg-amber-400"
                  : "bg-emerald-400"
            }`}
          />
          <span class="text-[11px]">
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
          title="Settings & Connected Accounts (⌘,)"
          class={`h-7 px-2.5 rounded-md border text-xs flex items-center gap-1.5 transition-colors ${
            viewMode() === "settings"
              ? "border-indigo-500 bg-indigo-600 text-white font-medium"
              : "border-zinc-800 light:border-zinc-200 bg-zinc-900/70 light:bg-zinc-100 hover:bg-zinc-800 light:hover:bg-zinc-200 text-zinc-300 light:text-zinc-700"
          }`}
        >
          <svg
            class="w-3.5 h-3.5"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <circle cx="8" cy="8" r="2.2" />
            <path d="M13.4 8a5.4 5.4 0 0 0-.1-1l1.4-1.1-1.3-2.2-1.7.6a5.4 5.4 0 0 0-1.7-1L9.7 1.5H7.1L6.8 3.3a5.4 5.4 0 0 0-1.7 1l-1.7-.6-1.3 2.2 1.4 1.1a5.4 5.4 0 0 0 0 2l-1.4 1.1 1.3 2.2 1.7-.6a5.4 5.4 0 0 0 1.7 1l.3 1.8h2.6l.3-1.8a5.4 5.4 0 0 0 1.7-1l1.7.6 1.3-2.2-1.4-1.1c.1-.3.1-.7.1-1Z" />
          </svg>
          <span>Settings</span>
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          title="Switch Dark / Light Mode"
          class="h-7 w-7 rounded-md border border-zinc-800 light:border-zinc-200 bg-zinc-900/70 light:bg-zinc-100 hover:bg-zinc-800 light:hover:bg-zinc-200 flex items-center justify-center text-zinc-400 light:text-zinc-600"
        >
          {theme() === "dark" ? "☀" : "☾"}
        </button>

        <Show when={viewMode() !== "settings"}>
          <button
            type="button"
            onClick={() => setRightInspectorOpen(!rightInspectorOpen())}
            title="Show / Hide Event Details (])"
            class="h-7 w-7 rounded-md border border-zinc-800 light:border-zinc-200 bg-zinc-900/70 light:bg-zinc-100 hover:bg-zinc-800 light:hover:bg-zinc-200 flex items-center justify-center text-zinc-400 light:text-zinc-600"
          >
            <svg
              class="w-3.5 h-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <rect x="2" y="2.5" width="12" height="11" rx="2" />
              <line x1="10" y1="2.5" x2="10" y2="13.5" />
            </svg>
          </button>
        </Show>
      </div>
    </header>
  );
}
