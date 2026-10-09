import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
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
  userPreferences,
  viewportEvents,
} from "../store/calendarStore";

const WEEKDAYS_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthView() {
  let rootRef: HTMLDivElement | undefined;
  const [containerWidth, setContainerWidth] = createSignal(
    typeof window !== "undefined" ? window.innerWidth : 1000
  );
  const [containerHeight, setContainerHeight] = createSignal(
    typeof window !== "undefined" ? window.innerHeight : 800
  );

  onMount(() => {
    if (typeof window === "undefined") return;

    const updateSize = () => {
      if (rootRef) {
        const rect = rootRef.getBoundingClientRect();
        setContainerWidth(rect.width);
        setContainerHeight(rect.height);
      } else {
        setContainerWidth(window.innerWidth);
        setContainerHeight(window.innerHeight);
      }
    };

    updateSize();

    if (typeof ResizeObserver !== "undefined" && rootRef) {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContainerWidth(entry.contentRect.width);
          setContainerHeight(entry.contentRect.height);
        }
      });
      ro.observe(rootRef);
      onCleanup(() => ro.disconnect());
    } else {
      window.addEventListener("resize", updateSize);
      onCleanup(() => window.removeEventListener("resize", updateSize));
    }
  });

  const cellWidth = createMemo(() => containerWidth() / 7);
  // Narrow cell threshold: < 95px triggers compact mode (prevents title extinction and date badge collision)
  const isNarrowCell = createMemo(() => cellWidth() < 95);

  // Adapt max displayed events based on available container/viewport height
  // When viewport height < 660px (container height < 550px), limit to 2 events to prevent cell overflow
  const maxEvents = createMemo(() => {
    const ch = containerHeight();
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    if (ch < 550 || vh < 660) return 2;
    if (ch < 700 || vh < 780) return 3;
    return 4;
  });

  const weekdays = createMemo(() =>
    userPreferences().weekStartsOn === "sunday" ? WEEKDAYS_SUN : WEEKDAYS_MON
  );
  const days = createMemo(() =>
    getMonthGridDays(anchorDate(), userPreferences().weekStartsOn)
  );
  const today = new Date();

  const eventsForDay = (day: Date) => {
    const dStart = Math.floor(startOfDay(day).getTime() / 1000);
    const dEnd = Math.floor(endOfDay(day).getTime() / 1000);
    return viewportEvents().filter(
      (ev) => ev.endTs > dStart && ev.startTs <= dEnd
    );
  };

  return (
    <div
      ref={rootRef}
      class="flex-1 flex flex-col min-w-0 min-h-0 bg-zinc-950 light:bg-white select-none"
    >
      {/* Weekday Header Row */}
      <div class="grid grid-cols-7 border-b border-zinc-800/80 light:border-zinc-200 bg-zinc-950/90 light:bg-zinc-50">
        <For each={weekdays()}>
          {(wd) => (
            <div class="py-1.5 sm:py-2 px-1 sm:px-2 md:px-3 text-center sm:text-left text-xs font-semibold uppercase tracking-wider text-zinc-400 light:text-zinc-600 border-r last:border-r-0 border-zinc-800/80 light:border-zinc-200 truncate">
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
            const overflowCount = createMemo(
              () => dayEvents().length - maxEvents()
            );

            return (
              <div
                onClick={() => setAnchorDate(day)}
                onDblClick={() => {
                  const startHour = userPreferences().workingHoursStart ?? 9;
                  const durSecs =
                    (userPreferences().defaultEventDurationMins || 30) * 60;
                  const s =
                    Math.floor(startOfDay(day).getTime() / 1000) +
                    startHour * 3600;
                  startNewEventDraft(s, s + durSecs, false);
                }}
                class={`border-r border-b border-zinc-800/75 light:border-zinc-200 p-1 sm:p-1.5 flex flex-col gap-0.5 sm:gap-1 overflow-hidden transition-colors ${
                  inMonth()
                    ? "bg-zinc-950 light:bg-white hover:bg-zinc-900/40 light:hover:bg-zinc-50"
                    : "bg-zinc-950/40 light:bg-zinc-100/60 text-zinc-600"
                }`}
              >
                <div class="flex items-center justify-between px-0.5 sm:px-1 min-w-0">
                  <span
                    class={`text-xs font-mono-tabular shrink-0 ${
                      isToday()
                        ? "w-5 h-5 rounded-full bg-rose-500 text-white font-bold flex items-center justify-center text-[11px]"
                        : inMonth()
                          ? "text-zinc-300 light:text-zinc-700 font-medium"
                          : "text-zinc-600 light:text-zinc-400"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  <Show when={overflowCount() > 0}>
                    <span
                      class="text-[10px] font-mono-tabular text-zinc-500 shrink-0"
                      title={`+${overflowCount()} more events`}
                    >
                      +{overflowCount()}
                      <Show when={!isNarrowCell()}>
                        <span class="hidden sm:inline"> more</span>
                      </Show>
                    </span>
                  </Show>
                </div>

                <div class="space-y-0.5 overflow-hidden min-h-0">
                  <For each={dayEvents().slice(0, maxEvents())}>
                    {(ev) => {
                      const isSel = () =>
                        selectedEvent()?.instanceId === ev.instanceId;
                      const isTentative = () =>
                        ev.selfRsvp === "tentative" ||
                        Boolean(ev.busyMirrorOfEventId);
                      const formattedTime = createMemo(() =>
                        formatTimeShort(ev.startTs, userPreferences().timeFormat)
                      );

                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEvent(ev);
                            setRightInspectorOpen(true);
                          }}
                          title={`${ev.title}${
                            ev.isAllDay ? " (All Day)" : ` · ${formattedTime()}`
                          }`}
                          class={`w-full text-left px-1 sm:px-1.5 py-0.5 rounded text-[11px] truncate flex items-center justify-between gap-1 min-w-0 transition-opacity ${
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
                          <span class="truncate font-medium text-zinc-100 light:text-zinc-900 min-w-0 flex-1">
                            {ev.title}
                          </span>
                          <Show when={!ev.isAllDay && !isNarrowCell()}>
                            <span class="text-[9px] font-mono-tabular text-zinc-400 light:text-zinc-600 shrink-0 hidden sm:inline">
                              {formattedTime()}
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
