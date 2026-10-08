import { createEffect, createSignal, For, Show } from "solid-js";
import { formatDateInputValue, formatTimeRange } from "../lib/dateUtils";
import { api } from "../lib/tauri";
import {
  calendars,
  commandPaletteInitialMode,
  commandPaletteOpen,
  joinActiveOrNextMeeting,
  jumpToday,
  saveEventOptimistic,
  setAccountsModalOpen,
  setAnchorDate,
  setCommandPaletteOpen,
  setRightInspectorOpen,
  setSelectedEvent,
  setViewMode,
  toggleTheme,
  triggerSyncNowAction,
} from "../store/calendarStore";
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

  // Live Rust NLP parse or SQLite FTS5 search as the user types
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
      description: `Created via RapidCal Natural Language Quick-Add ("${preview.rawInput}")`,
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

    setAnchorDate(new Date(preview.startTs * 1000));
    setCommandPaletteOpen(false);
  };

  const matchedCalName = () => {
    const id = nlpPreview()?.matchedCalendarId;
    return calendars().find((c) => c.id === id)?.name || "Primary Calendar";
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
                class={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  mode() === "nlp"
                    ? "bg-indigo-600 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                ⚡ Natural Language Quick-Add (C)
              </button>
              <button
                type="button"
                onClick={() => setMode("search")}
                class={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  mode() === "search"
                    ? "bg-indigo-600 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                🔍 SQLite FTS5 Search (⌘F)
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
                  ? 'Try: "Sync with Sarah tomorrow 2pm-3:30pm every Wed at Meet @Acme"'
                  : "Search titles, locations, notes, or attendees (<2ms FTS5)…"
              }
              class="w-full bg-transparent text-sm text-zinc-100 light:text-zinc-900 placeholder:text-zinc-500 focus:outline-none"
            />
          </form>

          {/* Live Rust Natural Language Structured Token Preview */}
          <Show when={mode() === "nlp" && nlpPreview()}>
            {(preview) => (
              <div class="p-3.5 border-b border-zinc-800/80 light:border-zinc-200 bg-indigo-950/20 light:bg-indigo-50/60 space-y-2.5">
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
                    Rust NLP Live Parse Preview
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleConfirmNlpCreate()}
                    class="h-6 px-2.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                  >
                    Create Event ↵
                  </button>
                </div>

                <div class="flex flex-wrap items-center gap-1.5 text-xs">
                  <span class="px-2 py-0.5 rounded bg-zinc-900 light:bg-white border border-zinc-700 light:border-zinc-300 font-semibold text-zinc-100 light:text-zinc-900">
                    📌 {preview().title}
                  </span>
                  <span class="px-2 py-0.5 rounded bg-zinc-900 light:bg-white border border-zinc-800 font-mono-tabular text-zinc-300 light:text-zinc-700">
                    📅 {formatDateInputValue(preview().startTs)} •{" "}
                    {preview().isAllDay
                      ? "All Day"
                      : formatTimeRange(preview().startTs, preview().endTs)}
                  </span>
                  <span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 light:text-indigo-700 font-medium">
                    🗂 @{matchedCalName()}
                  </span>
                  <Show when={preview().rruleHuman}>
                    <span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono-tabular">
                      ↻ {preview().rruleHuman}
                    </span>
                  </Show>
                  <Show when={preview().conferenceProvider}>
                    <span class="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 uppercase font-semibold">
                      🎥 {preview().conferenceProvider}
                    </span>
                  </Show>
                  <Show when={preview().location}>
                    <span class="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                      📍 {preview().location}
                    </span>
                  </Show>
                </div>
              </div>
            )}
          </Show>

          {/* FTS5 Search Matches */}
          <Show when={searchResults().length > 0}>
            <div class="p-2 max-h-60 overflow-y-auto border-b border-zinc-800/80 light:border-zinc-200">
              <div class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Matching Events (SQLite FTS5)
              </div>
              <For each={searchResults()}>
                {(ev) => (
                  <button
                    type="button"
                    onClick={() => {
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
                      {formatTimeRange(ev.startTs, ev.endTs)}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>

          {/* Instant Keyboard Actions */}
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
                <span>🎥 Join Active/Next Video Meeting</span>
                <kbd class="font-mono-tabular text-[10px] text-zinc-500">
                  ⌘J
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
                <span>🔄 Sync All Accounts Now</span>
                <kbd class="font-mono-tabular text-[10px] text-zinc-500">
                  ⌘R
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
                <span>📍 Jump to Today</span>
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
                <span>📋 Switch to Agenda Dossier</span>
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
                <span>🌗 Toggle Dark / Light Precision Theme</span>
                <kbd class="font-mono-tabular text-[10px] text-zinc-500">
                  Theme
                </kbd>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCommandPaletteOpen(false);
                  setAccountsModalOpen(true);
                }}
                class="px-2.5 py-1.5 rounded-md hover:bg-zinc-900 light:hover:bg-zinc-100 flex items-center justify-between text-zinc-300 light:text-zinc-700"
              >
                <span>🔐 OAuth2 PKCE & Account Settings</span>
                <kbd class="font-mono-tabular text-[10px] text-zinc-500">
                  Vault
                </kbd>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
