import { createMemo, For, Show } from "solid-js";
import {
  endOfDay,
  formatTimeShort,
  getMonthGridDays,
  isSameDay,
  startOfDay,
} from "../lib/dateUtils";
import {
  anchorDate,
  selectedEvent,
  setAnchorDate,
  setRightInspectorOpen,
  setSelectedEvent,
  startNewEventDraft,
  viewportEvents,
} from "../store/calendarStore";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthView() {
  const days = createMemo(() => getMonthGridDays(anchorDate()));
  const today = new Date();

  const eventsForDay = (day: Date) => {
    const dStart = Math.floor(startOfDay(day).getTime() / 1000);
    const dEnd = Math.floor(endOfDay(day).getTime() / 1000);
    return viewportEvents().filter(
      (ev) => ev.endTs > dStart && ev.startTs <= dEnd
    );
  };

  return (
    <div class="flex-1 flex flex-col min-w-0 min-h-0 bg-zinc-950 light:bg-white select-none">
      {/* Weekday Header Row */}
      <div class="grid grid-cols-7 border-b border-zinc-800/80 light:border-zinc-200 bg-zinc-950/90 light:bg-zinc-50">
        <For each={WEEKDAYS}>
          {(wd) => (
            <div class="py-2 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-400 light:text-zinc-600 border-r last:border-r-0 border-zinc-800/80 light:border-zinc-200">
              {wd}
            </div>
          )}
        </For>
      </div>

      {/* 6-Week Hairline Grid */}
      <div class="flex-1 grid grid-cols-7 grid-rows-6 min-h-0">
        <For each={days()}>
          {(day) => {
            const inMonth = () => day.getMonth() === anchorDate().getMonth();
            const isToday = () => isSameDay(day, today);
            const dayEvents = createMemo(() => eventsForDay(day));

            return (
              <div
                onClick={() => setAnchorDate(day)}
                onDblClick={() => {
                  const s =
                    Math.floor(startOfDay(day).getTime() / 1000) + 9 * 3600;
                  startNewEventDraft(s, s + 3600, false);
                }}
                class={`border-r border-b border-zinc-800/75 light:border-zinc-200 p-1.5 flex flex-col gap-1 overflow-hidden transition-colors ${
                  inMonth()
                    ? "bg-zinc-950 light:bg-white hover:bg-zinc-900/40 light:hover:bg-zinc-50"
                    : "bg-zinc-950/40 light:bg-zinc-100/60 text-zinc-600"
                }`}
              >
                <div class="flex items-center justify-between px-1">
                  <span
                    class={`text-xs font-mono-tabular ${
                      isToday()
                        ? "w-5 h-5 rounded-full bg-rose-500 text-white font-bold flex items-center justify-center"
                        : inMonth()
                          ? "text-zinc-300 light:text-zinc-700 font-medium"
                          : "text-zinc-600 light:text-zinc-400"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  <Show when={dayEvents().length > 4}>
                    <span class="text-[10px] font-mono-tabular text-zinc-500">
                      +{dayEvents().length - 4} more
                    </span>
                  </Show>
                </div>

                <div class="space-y-0.5 overflow-y-auto">
                  <For each={dayEvents().slice(0, 4)}>
                    {(ev) => {
                      const isSel = () =>
                        selectedEvent()?.instanceId === ev.instanceId;
                      const isTentative = () =>
                        ev.selfRsvp === "tentative" ||
                        Boolean(ev.busyMirrorOfEventId);

                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEvent(ev);
                            setRightInspectorOpen(true);
                          }}
                          class={`w-full text-left px-1.5 py-0.5 rounded text-[11px] truncate flex items-center justify-between gap-1 ${
                            isTentative() ? "bg-tentative-stripes" : ""
                          } ${
                            isSel()
                              ? "ring-1 ring-white light:ring-zinc-900"
                              : ""
                          }`}
                          style={{
                            "background-color": `${ev.colorHex}26`,
                            "border-left": `2.5px solid ${ev.colorHex}`,
                          }}
                        >
                          <span class="truncate font-medium text-zinc-100 light:text-zinc-900">
                            {ev.title}
                          </span>
                          <Show when={!ev.isAllDay}>
                            <span class="text-[9px] font-mono-tabular text-zinc-400 light:text-zinc-600 shrink-0">
                              {formatTimeShort(ev.startTs)}
                            </span>
                          </Show>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
