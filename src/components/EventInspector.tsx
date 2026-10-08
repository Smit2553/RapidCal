import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  combineDateAndTimeInputs,
  formatDateInputValue,
  formatTimeInputValue,
} from "../lib/dateUtils";
import { api, describeFallbackRrule } from "../lib/tauri";
import {
  calendars,
  createCrossAccountBusyMirror,
  deleteEventOptimistic,
  draftSlot,
  inspectorEditScope,
  rightInspectorOpen,
  saveEventOptimistic,
  selectedEvent,
  setDraftSlot,
  setInspectorEditScope,
  startNewEventDraft,
  updateRsvpOptimistic,
} from "../store/calendarStore";

const RRULE_PRESETS = [
  { label: "Does not repeat", value: "" },
  { label: "Every day", value: "FREQ=DAILY" },
  {
    label: "Every weekday (Mon–Fri)",
    value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  },
  { label: "Every week", value: "FREQ=WEEKLY" },
  { label: "Every 2 weeks", value: "FREQ=WEEKLY;INTERVAL=2" },
  { label: "Every month", value: "FREQ=MONTHLY" },
  { label: "Every year", value: "FREQ=YEARLY" },
];

export function EventInspector() {
  const [title, setTitle] = createSignal("");
  const [calendarId, setCalendarId] = createSignal("");
  const [dateStr, setDateStr] = createSignal("");
  const [startTimeStr, setStartTimeStr] = createSignal("09:00");
  const [endTimeStr, setEndTimeStr] = createSignal("10:00");
  const [isAllDay, setIsAllDay] = createSignal(false);
  const [rrule, setRrule] = createSignal("");
  const [location, setLocation] = createSignal("");
  const [conferenceUrl, setConferenceUrl] = createSignal("");
  const [description, setDescription] = createSignal("");
  const editScope = inspectorEditScope;
  const setEditScope = setInspectorEditScope;

  const rruleOptions = createMemo(() => {
    const cur = rrule().trim();
    if (!cur || RRULE_PRESETS.some((p) => p.value === cur)) {
      return RRULE_PRESETS;
    }
    const label =
      describeFallbackRrule(cur) ||
      selectedEvent()?.rruleHuman ||
      `Custom (${cur})`;
    return [...RRULE_PRESETS, { label, value: cur }];
  });

  // Cross-account busy-mirror target
  const [mirrorCalendarId, setMirrorCalendarId] = createSignal("");
  const [redactMirrorTitle, setRedactMirrorTitle] = createSignal(false);

  // Sync form state whenever selectedEvent or draftSlot changes
  createEffect(() => {
    const sel = selectedEvent();
    const draft = draftSlot();
    const defaultCalId =
      calendars().find((c) => c.isPrimary)?.id || calendars()[0]?.id || "";

    if (sel) {
      setTitle(sel.title);
      setCalendarId(sel.calendarId);
      setDateStr(formatDateInputValue(sel.startTs));
      setStartTimeStr(formatTimeInputValue(sel.startTs));
      setEndTimeStr(formatTimeInputValue(sel.endTs));
      setIsAllDay(sel.isAllDay);
      setRrule(sel.rrule || "");
      setLocation(sel.location || "");
      setConferenceUrl(sel.conferenceUrl || "");
      setDescription(sel.description || "");
      setEditScope(sel.isRecurring ? "single" : "all");

      const otherCal = calendars().find((c) => c.id !== sel.calendarId);
      if (otherCal) setMirrorCalendarId(otherCal.id);
    } else if (draft) {
      setTitle("");
      setCalendarId(defaultCalId);
      setDateStr(formatDateInputValue(draft.startTs));
      setStartTimeStr(formatTimeInputValue(draft.startTs));
      setEndTimeStr(formatTimeInputValue(draft.endTs));
      setIsAllDay(draft.isAllDay);
      setRrule("");
      setLocation("");
      setConferenceUrl("");
      setDescription("");
      setEditScope("all");
    }
  });

  const otherCalendars = createMemo(() => {
    const sel = selectedEvent();
    if (!sel) return [];
    return calendars().filter((c) => c.id !== sel.calendarId);
  });

  const handleSave = (e: Event) => {
    e.preventDefault();
    const sel = selectedEvent();
    const startTs = combineDateAndTimeInputs(
      dateStr(),
      isAllDay() ? "00:00" : startTimeStr()
    );
    const endTs = isAllDay()
      ? startTs + 86400
      : Math.max(
          startTs + 900,
          combineDateAndTimeInputs(dateStr(), endTimeStr())
        );

    void saveEventOptimistic({
      id: sel?.eventId || null,
      calendarId: calendarId() || calendars()[0]?.id || "",
      title: title().trim() || "Untitled Event",
      description: description(),
      location: location(),
      startTs,
      endTs,
      isAllDay: isAllDay(),
      timezone: sel?.timezone || "UTC",
      rrule: rrule().trim() || null,
      conferenceUrl: conferenceUrl().trim() || null,
      editScope: sel?.isRecurring ? editScope() : "all",
      instanceStartTs: sel?.startTs ?? null,
    });
  };

  return (
    <Show when={rightInspectorOpen()}>
      <aside class="w-80 shrink-0 border-l border-zinc-800/80 light:border-zinc-200 bg-zinc-950 light:bg-zinc-50 flex flex-col overflow-y-auto select-none">
        <Show
          when={selectedEvent() || draftSlot()}
          fallback={
            <div class="p-6 flex-1 flex flex-col items-center justify-center text-center space-y-3 text-zinc-500">
              <div class="w-10 h-10 rounded-full border border-zinc-800 light:border-zinc-200 flex items-center justify-center text-lg">
                📅
              </div>
              <div class="space-y-1">
                <p class="text-xs font-medium text-zinc-300 light:text-zinc-700">
                  No Event Selected
                </p>
                <p class="text-[11px] text-zinc-500">
                  Click any event on the grid, drag across time slots, or press{" "}
                  <kbd class="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono-tabular">
                    C
                  </kbd>{" "}
                  to create.
                </p>
              </div>
              <button
                type="button"
                onClick={() => startNewEventDraft()}
                class="h-7 px-3 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
              >
                + New Event
              </button>
            </div>
          }
        >
          <form onSubmit={handleSave} class="p-3.5 space-y-4 flex-1 flex flex-col">
            {/* Header Status */}
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                {selectedEvent() ? "Event Details" : "New Event"}
              </span>
              <Show when={selectedEvent()?.isDirty}>
                <span class="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  Sync pending
                </span>
              </Show>
            </div>

            {/* Event Title */}
            <div>
              <input
                type="text"
                value={title()}
                onInput={(e) => setTitle(e.currentTarget.value)}
                placeholder="Event title…"
                class="w-full px-2.5 py-1.5 rounded-md border border-zinc-800 light:border-zinc-300 bg-zinc-900 light:bg-white text-sm font-semibold text-zinc-100 light:text-zinc-900 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Video Call Join Button */}
            <Show when={selectedEvent()?.conferenceUrl || conferenceUrl()}>
              <div class="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-2.5 flex items-center justify-between gap-2">
                <div class="min-w-0">
                  <div class="text-xs font-semibold text-indigo-300 light:text-indigo-700">
                    {(
                      selectedEvent()?.conferenceProvider || "Video"
                    ).toUpperCase()}{" "}
                    Call
                  </div>
                  <div class="text-[10px] font-mono-tabular text-indigo-400/80 truncate">
                    {selectedEvent()?.conferenceUrl || conferenceUrl()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const url =
                      selectedEvent()?.conferenceUrl || conferenceUrl();
                    if (url) void api.openExternalUrl(url);
                  }}
                  class="shrink-0 h-7 px-2.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                >
                  Join ⌘J
                </button>
              </div>
            </Show>

            {/* Target Calendar Selector */}
            <div class="space-y-1">
              <label class="text-[11px] font-medium text-zinc-400 light:text-zinc-600">
                Calendar
              </label>
              <select
                value={calendarId()}
                onChange={(e) => setCalendarId(e.currentTarget.value)}
                class="w-full h-8 px-2 rounded-md border border-zinc-800 light:border-zinc-300 bg-zinc-900 light:bg-white text-xs text-zinc-200 light:text-zinc-800"
              >
                <For each={calendars()}>
                  {(cal) => <option value={cal.id}>{cal.name}</option>}
                </For>
              </select>
            </div>

            {/* Date & Time Range */}
            <div class="space-y-2 rounded-lg border border-zinc-800/80 light:border-zinc-200 bg-zinc-900/40 light:bg-white p-2.5">
              <div class="flex items-center justify-between">
                <label class="text-[11px] font-medium text-zinc-400 light:text-zinc-600">
                  Date & Time
                </label>
                <label class="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAllDay()}
                    onChange={(e) => setIsAllDay(e.currentTarget.checked)}
                    class="rounded border-zinc-700"
                  />
                  <span>All-day</span>
                </label>
              </div>

              <input
                type="date"
                value={dateStr()}
                onInput={(e) => setDateStr(e.currentTarget.value)}
                class="w-full h-7 px-2 rounded border border-zinc-800 light:border-zinc-300 bg-zinc-900 light:bg-zinc-50 text-xs font-mono-tabular text-zinc-200 light:text-zinc-800"
              />

              <Show when={!isAllDay()}>
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <span class="text-[10px] text-zinc-500 block mb-0.5">
                      Start
                    </span>
                    <input
                      type="time"
                      value={startTimeStr()}
                      onInput={(e) => setStartTimeStr(e.currentTarget.value)}
                      class="w-full h-7 px-2 rounded border border-zinc-800 light:border-zinc-300 bg-zinc-900 light:bg-zinc-50 text-xs font-mono-tabular text-zinc-200 light:text-zinc-800"
                    />
                  </div>
                  <div>
                    <span class="text-[10px] text-zinc-500 block mb-0.5">
                      End
                    </span>
                    <input
                      type="time"
                      value={endTimeStr()}
                      onInput={(e) => setEndTimeStr(e.currentTarget.value)}
                      class="w-full h-7 px-2 rounded border border-zinc-800 light:border-zinc-300 bg-zinc-900 light:bg-zinc-50 text-xs font-mono-tabular text-zinc-200 light:text-zinc-800"
                    />
                  </div>
                </div>
              </Show>
            </div>

            {/* Repeat Options */}
            <div class="space-y-1.5">
              <label class="text-[11px] font-medium text-zinc-400 light:text-zinc-600">
                Repeat
              </label>
              <select
                value={rrule()}
                onChange={(e) => setRrule(e.currentTarget.value)}
                class="w-full h-8 px-2 rounded-md border border-zinc-800 light:border-zinc-300 bg-zinc-900 light:bg-white text-xs text-zinc-200 light:text-zinc-800"
              >
                <For each={rruleOptions()}>
                  {(preset) => (
                    <option value={preset.value}>{preset.label}</option>
                  )}
                </For>
              </select>

              <Show when={selectedEvent()?.isRecurring}>
                <div class="pt-1 flex items-center justify-between text-[11px] text-zinc-400">
                  <span>Apply changes to:</span>
                  <div class="flex rounded border border-zinc-800 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setEditScope("single")}
                      class={`px-2 py-0.5 ${
                        editScope() === "single"
                          ? "bg-indigo-600 text-white"
                          : "bg-zinc-900 text-zinc-400"
                      }`}
                    >
                      This event
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditScope("all")}
                      class={`px-2 py-0.5 ${
                        editScope() === "all"
                          ? "bg-indigo-600 text-white"
                          : "bg-zinc-900 text-zinc-400"
                      }`}
                    >
                      All events
                    </button>
                  </div>
                </div>
              </Show>
            </div>

            {/* Location & Video Link */}
            <div class="space-y-2">
              <input
                type="text"
                value={location()}
                onInput={(e) => setLocation(e.currentTarget.value)}
                placeholder="Location or room…"
                class="w-full h-7 px-2.5 rounded-md border border-zinc-800 light:border-zinc-300 bg-zinc-900 light:bg-white text-xs text-zinc-200 light:text-zinc-800"
              />
              <input
                type="text"
                value={conferenceUrl()}
                onInput={(e) => setConferenceUrl(e.currentTarget.value)}
                placeholder="Video call link (Google Meet, Teams, Zoom)…"
                class="w-full h-7 px-2.5 rounded-md border border-zinc-800 light:border-zinc-300 bg-zinc-900 light:bg-white text-xs font-mono-tabular text-zinc-200 light:text-zinc-800"
              />
            </div>

            {/* Notes / Description */}
            <div class="space-y-1">
              <label class="text-[11px] font-medium text-zinc-400 light:text-zinc-600">
                Notes
              </label>
              <textarea
                rows={3}
                value={description()}
                onInput={(e) => setDescription(e.currentTarget.value)}
                placeholder="Meeting agenda, links, or notes…"
                class="w-full p-2 rounded-md border border-zinc-800 light:border-zinc-300 bg-zinc-900 light:bg-white text-xs text-zinc-200 light:text-zinc-800 resize-none"
              />
            </div>

            {/* Guests & Your Response */}
            <Show when={selectedEvent()}>
              {(sel) => (
                <div class="space-y-2 rounded-lg border border-zinc-800/80 light:border-zinc-200 bg-zinc-900/30 light:bg-white p-2.5">
                  <div class="flex items-center justify-between">
                    <span class="text-[11px] font-medium text-zinc-400 light:text-zinc-600">
                      Going?
                    </span>
                    <div class="flex rounded-md border border-zinc-800 light:border-zinc-200 overflow-hidden text-[11px]">
                      {(
                        [
                          ["accepted", "Yes"],
                          ["tentative", "Maybe"],
                          ["declined", "No"],
                        ] as const
                      ).map(([st, lbl]) => (
                        <button
                          type="button"
                          onClick={() => void updateRsvpOptimistic(sel(), st)}
                          class={`px-2.5 py-0.5 font-medium ${
                            sel().selfRsvp === st
                              ? "bg-indigo-600 text-white"
                              : "bg-zinc-900 light:bg-zinc-100 text-zinc-400"
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>

                  <Show when={sel().attendees.length > 0}>
                    <div class="space-y-1 pt-1 border-t border-zinc-800/60 light:border-zinc-200">
                      <For each={sel().attendees}>
                        {(att) => (
                          <div class="flex items-center justify-between text-[11px]">
                            <span class="text-zinc-300 light:text-zinc-700 truncate">
                              {att.displayName || att.email}
                            </span>
                            <span
                              class={`px-1.5 py-0.2 rounded text-[10px] ${
                                att.responseStatus === "accepted"
                                  ? "text-emerald-400"
                                  : att.responseStatus === "tentative"
                                    ? "text-amber-400"
                                    : att.responseStatus === "declined"
                                      ? "text-rose-400"
                                      : "text-zinc-500"
                              }`}
                            >
                              {att.responseStatus === "accepted"
                                ? "Going"
                                : att.responseStatus === "tentative"
                                  ? "Maybe"
                                  : att.responseStatus === "declined"
                                    ? "Declined"
                                    : "Invited"}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </Show>

            {/* Block Time on Another Calendar */}
            <Show
              when={
                selectedEvent() &&
                !selectedEvent()?.busyMirrorOfEventId &&
                otherCalendars().length > 0
              }
            >
              <div class="rounded-lg border border-zinc-800/80 light:border-zinc-200 bg-zinc-900/40 light:bg-white p-2.5 space-y-2">
                <div class="text-[11px] font-semibold text-zinc-300 light:text-zinc-700">
                  🛡 Block Time on Another Calendar
                </div>
                <p class="text-[10px] text-zinc-500 leading-relaxed">
                  Copy this time slot onto another calendar so people see
                  you&apos;re unavailable.
                </p>
                <select
                  value={mirrorCalendarId()}
                  onChange={(e) => setMirrorCalendarId(e.currentTarget.value)}
                  class="w-full h-7 px-2 rounded border border-zinc-800 light:border-zinc-300 bg-zinc-900 light:bg-zinc-50 text-xs text-zinc-200 light:text-zinc-800"
                >
                  <For each={otherCalendars()}>
                    {(cal) => <option value={cal.id}>{cal.name}</option>}
                  </For>
                </select>
                <div class="flex items-center justify-between pt-0.5">
                  <label class="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={redactMirrorTitle()}
                      onChange={(e) =>
                        setRedactMirrorTitle(e.currentTarget.checked)
                      }
                    />
                    <span>Hide event title (show as Busy)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const sel = selectedEvent();
                      if (sel && mirrorCalendarId()) {
                        void createCrossAccountBusyMirror(
                          sel,
                          mirrorCalendarId(),
                          redactMirrorTitle()
                        );
                      }
                    }}
                    class="h-6 px-2.5 rounded bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white text-[11px] font-medium transition-colors"
                  >
                    Block Time
                  </button>
                </div>
              </div>
            </Show>

            {/* Save / Delete Footer */}
            <div class="pt-2 mt-auto flex items-center justify-between gap-2 border-t border-zinc-800/80 light:border-zinc-200">
              <Show
                when={selectedEvent()}
                fallback={
                  <button
                    type="button"
                    onClick={() => setDraftSlot(null)}
                    class="h-8 px-3 rounded-md border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                }
              >
                {(sel) => (
                  <button
                    type="button"
                    onClick={() =>
                      void deleteEventOptimistic(
                        sel(),
                        sel().isRecurring ? editScope() : "all"
                      )
                    }
                    class="h-8 px-3 rounded-md border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium transition-colors"
                  >
                    Delete
                  </button>
                )}
              </Show>

              <button
                type="submit"
                class="flex-1 h-8 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
              >
                {selectedEvent() ? "Save Changes" : "Create Event"}
              </button>
            </div>
          </form>
        </Show>
      </aside>
    </Show>
  );
}
