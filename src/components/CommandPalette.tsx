import { createEffect, createSignal, For, Show } from "solid-js";
import { formatDateInputValue, formatTimeRange } from "../lib/dateUtils";
import { api } from "../lib/tauri";
import {
  calendars,
  closeSettings,
  commandPaletteInitialMode,
  commandPaletteOpen,
  joinActiveOrNextMeeting,
  jumpToday,
  openSettings,
  saveEventOptimistic,
  setAnchorDate,
  setCommandPaletteOpen,
  setRightInspectorOpen,
  setSelectedEvent,
  setViewMode,
  toggleTheme,
  triggerSyncNowAction,
  userPreferences,
  viewMode,
} from "../store/calendarStore";
import { enterKeyLabel, formatModKey } from "../lib/platform";
import {
  CalendarIcon,
  CornerDownLeftIcon,
  FolderIcon,
  ListIcon,
  MapPinIcon,
  RefreshCwIcon,
  RepeatIcon,
  SearchIcon,
  SettingsIcon,
  SunMoonIcon,
  TagIcon,
  VideoIcon,
  ZapIcon,
} from "./icons/Icons";
import type { NlpParseResult, ViewportEvent } from "../types/calendar";

export function CommandPalette() {
  let inputRef: HTMLInputElement | undefined;

  const [mode, setMode] = createSignal<"nlp" | "search">("nlp");
  const [input, setInput] = createSignal("");
  const [nlpPreview, setNlpPreview] = createSignal<NlpParseResult | null>(null);
  const [searchResults, setSearchResults] = createSignal<ViewportEvent[]>([]);

  createEffect(() => {
    if (commandPaletteOpen()) {
      setMode(commandPaletteInitialMode());
      setInput("");
      setTimeout(() => inputRef?.focus(), 10);
    }
  });

  createEffect(() => {
    const q = input().trim();
    const currentMode = mode();
    if (!commandPaletteOpen()) return;

    if (!q) {
      setNlpPreview(null);
      setSearchResults([]);
      return;
    }

    const localTz =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    if (currentMode === "nlp") {
      void api
        .parseNaturalLanguageEvent(q, Math.floor(Date.now() / 1000), localTz)
        .then((res) => setNlpPreview(res));
      void api.searchEvents(q, 5).then((res) => setSearchResults(res));
    } else {
      void api.searchEvents(q, 15).then((res) => setSearchResults(res));
    }
  });

  const handleConfirmNlpCreate = async (e?: Event) => {
    e?.preventDefault();
    const preview = nlpPreview();
    if (!preview) return;

    const targetCalId =
      preview.matchedCalendarId ||
      calendars().find((c) => c.isPrimary)?.id ||
      calendars()[0]?.id ||
      "";
    const localTz =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    await saveEventOptimistic({
      calendarId: targetCalId,
      title: preview.title,
      description: "",
      location: preview.location,
      startTs: preview.startTs,
      endTs: preview.endTs,
      isAllDay: preview.isAllDay,
      timezone: localTz,
      rrule: preview.rrule,
      conferenceUrl: preview.conferenceUrl,
      conferenceProvider: preview.conferenceProvider,
      attendees: preview.attendees.map((email) => ({
        email,
        displayName: null,
        responseStatus: "needsAction",
        isOrganizer: false,
        isSelf: false,
      })),
    });

    if (viewMode() === "settings") {
      closeSettings();
    }
    setAnchorDate(new Date(preview.startTs * 1000));
    setCommandPaletteOpen(false);
  };

  const matchedCalName = () => {
    const id = nlpPreview()?.matchedCalendarId;
    return calendars().find((c) => c.id === id)?.name || "Default Calendar";
  };

  return (
    <Show when={commandPaletteOpen()}>
      <div
        onClick={() => setCommandPaletteOpen(false)}
        class="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-start justify-center pt-20 px-4 select-none"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          class="w-full max-w-2xl rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-950 light:bg-white shadow-2xl overflow-hidden"
        >
          {/* Mode Switcher Bar */}
          <div class="flex items-center justify-between px-3.5 py-2 border-b border-zinc-800/80 light:border-zinc-200 bg-zinc-900/60 light:bg-zinc-50">
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMode("nlp")}
                class={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  mode() === "nlp"
                    ? "bg-indigo-600 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <ZapIcon class={`w-3.5 h-3.5 ${mode() === "nlp" ? "text-white" : "text-amber-400"}`} />
                <span>Quick Add Event (C)</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("search")}
                class={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  mode() === "search"
                    ? "bg-indigo-600 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <SearchIcon class={`w-3.5 h-3.5 ${mode() === "search" ? "text-white" : "text-indigo-400"}`} />
                <span>Search Events ({formatModKey("F")})</span>
              </button>
            </div>
            <kbd class="text-[10px] font-mono-tabular px-1.5 py-0.5 rounded bg-zinc-800 light:bg-zinc-200 text-zinc-400">
              ESC
            </kbd>
          </div>

          {/* Input Box */}
          <form onSubmit={handleConfirmNlpCreate} class="p-3 border-b border-zinc-800/80 light:border-zinc-200">
            <input
              ref={inputRef}
              type="text"
              value={input()}
              onInput={(e) => setInput(e.currentTarget.value)}
              placeholder={
                mode() === "nlp"
                  ? 'Type an event, e.g., "Coffee with Sarah tomorrow 2pm-3pm at Google Meet"'
                  : "Search events by title, location, notes, or guests…"
              }
              class="w-full bg-transparent text-sm text-zinc-100 light:text-zinc-900 placeholder:text-zinc-500 focus:outline-none"
            />
          </form>

          {/* New Event Preview */}
          <Show when={mode() === "nlp" && nlpPreview()}>
            {(preview) => (
              <div class="p-3.5 border-b border-zinc-800/80 light:border-zinc-200 bg-indigo-950/20 light:bg-indigo-50/60 space-y-2.5">
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
                    New Event Preview
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleConfirmNlpCreate()}
                    class="h-6 px-2.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5"
                  >
                    <span>Create Event</span>
                    <kbd class="text-[10px] font-mono-tabular px-1 py-0.5 rounded bg-indigo-700/60 text-indigo-100 flex items-center gap-0.5">
                      <CornerDownLeftIcon class="w-2.5 h-2.5" />
                      <span>{enterKeyLabel()}</span>
                    </kbd>
                  </button>
                </div>

                <div class="flex flex-wrap items-center gap-1.5 text-xs">
                  <span class="px-2 py-0.5 rounded bg-zinc-900 light:bg-white border border-zinc-700 light:border-zinc-300 font-semibold text-zinc-100 light:text-zinc-900 flex items-center gap-1">
                    <TagIcon class="w-3 h-3 text-zinc-400 shrink-0" />
                    <span>{preview().title}</span>
                  </span>
                  <span class="px-2 py-0.5 rounded bg-zinc-900 light:bg-white border border-zinc-800 font-mono-tabular text-zinc-300 light:text-zinc-700 flex items-center gap-1">
                    <CalendarIcon class="w-3 h-3 text-zinc-400 shrink-0" />
                    <span>
                      {formatDateInputValue(preview().startTs)} •{" "}
                      {preview().isAllDay
                        ? "All Day"
                        : formatTimeRange(
                            preview().startTs,
                            preview().endTs,
                            userPreferences().timeFormat
                          )}
                    </span>
                  </span>
                  <span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 light:text-indigo-700 font-medium flex items-center gap-1">
                    <FolderIcon class="w-3 h-3 text-indigo-400 shrink-0" />
                    <span>{matchedCalName()}</span>
                  </span>
                  <Show when={preview().rruleHuman}>
                    <span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono-tabular flex items-center gap-1">
                      <RepeatIcon class="w-3 h-3 text-emerald-400 shrink-0" />
                      <span>{preview().rruleHuman}</span>
                    </span>
                  </Show>
                  <Show when={preview().conferenceProvider}>
                    <span class="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 uppercase font-semibold flex items-center gap-1">
                      <VideoIcon class="w-3 h-3 text-sky-400 shrink-0" />
                      <span>{preview().conferenceProvider}</span>
                    </span>
                  </Show>
                  <Show when={preview().location}>
                    <span class="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 flex items-center gap-1">
                      <MapPinIcon class="w-3 h-3 text-zinc-400 shrink-0" />
                      <span>{preview().location}</span>
                    </span>
                  </Show>
                </div>
              </div>
            )}
          </Show>

          {/* Search Matches */}
          <Show when={searchResults().length > 0}>
            <div class="p-2 max-h-60 overflow-y-auto border-b border-zinc-800/80 light:border-zinc-200">
              <div class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Matching Events
              </div>
              <For each={searchResults()}>
                {(ev) => (
                  <button
                    type="button"
                    onClick={() => {
                      if (viewMode() === "settings") {
                        closeSettings();
                      }
                      setAnchorDate(new Date(ev.startTs * 1000));
                      setSelectedEvent(ev);
                      setRightInspectorOpen(true);
                      setCommandPaletteOpen(false);
                    }}
                    class="w-full px-2.5 py-2 rounded-lg hover:bg-zinc-900 light:hover:bg-zinc-100 flex items-center justify-between text-left transition-colors"
                  >
                    <div class="flex items-center gap-2.5 min-w-0">
                      <span
                        class="w-2 h-2 rounded-full shrink-0"
                        style={{ "background-color": ev.colorHex }}
                      />
                      <span class="text-xs font-medium text-zinc-100 light:text-zinc-900 truncate">
                        {ev.title}
                      </span>
                      <span class="text-[10px] text-zinc-500 truncate">
                        {ev.calendarName}
                      </span>
                    </div>
                    <span class="text-[11px] font-mono-tabular text-zinc-400 shrink-0">
                      {formatDateInputValue(ev.startTs)} •{" "}
                      {formatTimeRange(
                        ev.startTs,
                        ev.endTs,
                        userPreferences().timeFormat
                      )}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>

          {/* Quick Actions */}
          <div class="p-2 space-y-1">
            <div class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Quick Actions
            </div>
            <div class="grid grid-cols-2 gap-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  joinActiveOrNextMeeting();
                  setCommandPaletteOpen(false);
                }}
                class="px-2.5 py-1.5 rounded-md hover:bg-zinc-900 light:hover:bg-zinc-100 flex items-center justify-between text-zinc-300 light:text-zinc-700"
              >
                <span class="flex items-center gap-2">
                  <VideoIcon class="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span>Join Active/Next Video Call</span>
                </span>
                <kbd class="font-mono-tabular text-[10px] text-zinc-500">
                  {formatModKey("J")}
                </kbd>
              </button>
              <button
                type="button"
                onClick={() => {
                  void triggerSyncNowAction();
                  setCommandPaletteOpen(false);
                }}
                class="px-2.5 py-1.5 rounded-md hover:bg-zinc-900 light:hover:bg-zinc-100 flex items-center justify-between text-zinc-300 light:text-zinc-700"
              >
                <span class="flex items-center gap-2">
                  <RefreshCwIcon class="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>Sync All Calendars Now</span>
                </span>
                <kbd class="font-mono-tabular text-[10px] text-zinc-500">
                  {formatModKey("R")}
                </kbd>
              </button>
              <button
                type="button"
                onClick={() => {
                  jumpToday();
                  setCommandPaletteOpen(false);
                }}
                class="px-2.5 py-1.5 rounded-md hover:bg-zinc-900 light:hover:bg-zinc-100 flex items-center justify-between text-zinc-300 light:text-zinc-700"
              >
                <span class="flex items-center gap-2">
                  <CalendarIcon class="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Go to Today</span>
                </span>
                <kbd class="font-mono-tabular text-[10px] text-zinc-500">T</kbd>
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode("agenda");
                  setCommandPaletteOpen(false);
                }}
                class="px-2.5 py-1.5 rounded-md hover:bg-zinc-900 light:hover:bg-zinc-100 flex items-center justify-between text-zinc-300 light:text-zinc-700"
              >
                <span class="flex items-center gap-2">
                  <ListIcon class="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  <span>View Upcoming Schedule</span>
                </span>
                <kbd class="font-mono-tabular text-[10px] text-zinc-500">A</kbd>
              </button>
              <button
                type="button"
                onClick={() => {
                  toggleTheme();
                  setCommandPaletteOpen(false);
                }}
                class="px-2.5 py-1.5 rounded-md hover:bg-zinc-900 light:hover:bg-zinc-100 flex items-center justify-between text-zinc-300 light:text-zinc-700"
              >
                <span class="flex items-center gap-2">
                  <SunMoonIcon class="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Switch Dark / Light Mode</span>
                </span>
                <kbd class="font-mono-tabular text-[10px] text-zinc-500">
                  Theme
                </kbd>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCommandPaletteOpen(false);
                  openSettings("general");
                }}
                class="px-2.5 py-1.5 rounded-md hover:bg-zinc-900 light:hover:bg-zinc-100 flex items-center justify-between text-zinc-300 light:text-zinc-700"
              >
                <span class="flex items-center gap-2">
                  <SettingsIcon class="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <span>Open Settings & Accounts</span>
                </span>
                <kbd class="font-mono-tabular text-[10px] text-zinc-500">
                  {formatModKey(",")}
                </kbd>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
