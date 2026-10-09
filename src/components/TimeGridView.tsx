import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import {
  endOfDay,
  formatHourLabel,
  formatSecondaryTzHour,
  formatTimeRange,
  formatTimeShort,
  formatTzCityAbbreviation,
  getPrimaryTimezoneAbbr,
  getVisibleDaysForView,
  isSameDay,
  startOfDay,
} from "../lib/dateUtils";
import { api } from "../lib/tauri";
import { RepeatIcon, VideoIcon } from "./icons/Icons";
import {
  anchorDate,
  hourHeightPx,
  inspectorEditScope,
  moveOrResizeEventOptimistic,
  oauthConfig,
  selectedEvent,
  setRightInspectorOpen,
  setSelectedEvent,
  startNewEventDraft,
  userPreferences,
  viewMode,
  viewportEvents,
} from "../store/calendarStore";
import type { ViewportEvent } from "../types/calendar";

const DAY_HOURS = Array.from({ length: 24 }, (_, i) => i);

export function TimeGridView() {
  let scrollContainerRef: HTMLDivElement | undefined;

  const visibleDays = createMemo(() =>
    getVisibleDaysForView(
      anchorDate(),
      viewMode(),
      userPreferences().weekStartsOn
    )
  );

  const [nowDate, setNowDate] = createSignal(new Date());
  const timer = setInterval(() => setNowDate(new Date()), 30_000);
  onCleanup(() => clearInterval(timer));

  // Interactive drag state for move / resize / create-on-grid
  const [dragState, setDragState] = createSignal<{
    mode: "move" | "resize" | "create";
    event?: ViewportEvent;
    initialDayStartTs: number;
    dayStartTs: number;
    initialStartTs: number;
    initialEndTs: number;
    currentStartTs: number;
    currentEndTs: number;
    startClientY: number;
  } | null>(null);

  onMount(() => {
    // Scroll to the user's configured start of working hours initially
    if (scrollContainerRef) {
      const startHour = userPreferences().workingHoursStart ?? 9;
      scrollContainerRef.scrollTop = Math.max(0, startHour * hourHeightPx() - 24);
    }

    let prevHourHeight = hourHeightPx();
    createEffect(() => {
      const currentH = hourHeightPx();
      if (scrollContainerRef && prevHourHeight !== currentH && prevHourHeight > 0) {
        const ratio = currentH / prevHourHeight;
        scrollContainerRef.scrollTop = Math.round(scrollContainerRef.scrollTop * ratio);
        prevHourHeight = currentH;
      }
    });

    const onWindowMouseMove = (e: MouseEvent) => {
      const st = dragState();
      if (!st) return;
      const deltaY = e.clientY - st.startClientY;
      // Snap to 15-minute (900s) increments
      const deltaQuarters = Math.round(deltaY / (hourHeightPx() / 4));
      const deltaSecs = deltaQuarters * 900;

      if (st.mode === "move") {
        let targetDayStartTs = st.dayStartTs;
        const hoveredCol = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest("[data-day-start-ts]") as HTMLElement | null;
        if (hoveredCol?.dataset.dayStartTs) {
          const parsed = Number(hoveredCol.dataset.dayStartTs);
          if (Number.isFinite(parsed)) {
            targetDayStartTs = parsed;
          }
        }
        const dayShiftSecs = targetDayStartTs - st.initialDayStartTs;
        const duration = st.initialEndTs - st.initialStartTs;
        const nextStart = Math.max(
          targetDayStartTs,
          Math.min(
            targetDayStartTs + 86400 - duration,
            st.initialStartTs + dayShiftSecs + deltaSecs
          )
        );
        setDragState({
          ...st,
          dayStartTs: targetDayStartTs,
          currentStartTs: nextStart,
          currentEndTs: nextStart + duration,
        });
      } else if (st.mode === "resize") {
        const nextEnd = Math.max(
          st.initialStartTs + 900,
          Math.min(st.dayStartTs + 86400, st.initialEndTs + deltaSecs)
        );
        setDragState({
          ...st,
          currentEndTs: nextEnd,
        });
      } else if (st.mode === "create") {
        const rawTarget = st.initialStartTs + deltaSecs;
        const s = Math.max(st.dayStartTs, Math.min(st.initialStartTs, rawTarget));
        const end = Math.min(
          st.dayStartTs + 86400,
          Math.max(st.initialStartTs + 900, rawTarget + 900)
        );
        setDragState({
          ...st,
          currentStartTs: s,
          currentEndTs: end,
        });
      }
    };

    const onWindowMouseUp = () => {
      const st = dragState();
      if (!st) return;
      setDragState(null);

      if (
        (st.mode === "move" || st.mode === "resize") &&
        st.event &&
        (st.currentStartTs !== st.initialStartTs ||
          st.currentEndTs !== st.initialEndTs)
      ) {
        void moveOrResizeEventOptimistic(
          st.event,
          st.currentStartTs,
          st.currentEndTs,
          st.event.isRecurring ? inspectorEditScope() : "all"
        );
      } else if (st.mode === "create") {
        startNewEventDraft(st.currentStartTs, st.currentEndTs, false);
      }
    };

    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mouseup", onWindowMouseUp);
    onCleanup(() => {
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("mouseup", onWindowMouseUp);
    });
  });

  const allDayEventsForDay = (day: Date) => {
    const dStart = Math.floor(startOfDay(day).getTime() / 1000);
    const dEnd = Math.floor(endOfDay(day).getTime() / 1000);
    return viewportEvents().filter(
      (ev) => ev.isAllDay && ev.endTs > dStart && ev.startTs <= dEnd
    );
  };

  const timedEventsForDay = (day: Date) => {
    const dStart = Math.floor(startOfDay(day).getTime() / 1000);
    const dEnd = Math.floor(endOfDay(day).getTime() / 1000);
    const st = dragState();
    return viewportEvents().filter((ev) => {
      if (ev.isAllDay) return false;
      const effectiveStart =
        st?.mode === "move" && st.event?.instanceId === ev.instanceId
          ? st.currentStartTs
          : ev.startTs;
      return effectiveStart >= dStart && effectiveStart <= dEnd;
    });
  };

  const currentTimeMinutes = createMemo(() => {
    const n = nowDate();
    return n.getHours() * 60 + n.getMinutes();
  });

  const primaryTz = getPrimaryTimezoneAbbr();
  const secondaryTz = createMemo(() => oauthConfig().secondaryTimezone || "UTC");

  // Keep selected event highlighted
  createEffect(() => {
    selectedEvent();
  });

  return (
    <div class="flex-1 flex flex-col min-w-0 min-h-0 bg-zinc-950 light:bg-white select-none">
      {/* Sticky Column Header Row: Timezone Labels + Day Headers */}
      <div
        class="flex border-b border-zinc-800/80 light:border-zinc-200 bg-zinc-950/90 light:bg-zinc-50 shrink-0 overflow-y-hidden"
        style={{ "scrollbar-gutter": "stable" }}
      >
        {/* Timezone Gutter Header */}
        <div
          class={`${
            userPreferences().showSecondaryTimezone ? "w-28" : "w-20"
          } shrink-0 border-r border-zinc-800/80 light:border-zinc-200 px-1.5 py-2 flex items-end text-[10px] font-mono-tabular text-zinc-500 select-none`}
        >
          <Show
            when={userPreferences().showSecondaryTimezone}
            fallback={
              <span class="text-zinc-400 light:text-zinc-600 font-semibold ml-auto text-right pr-0.5">
                {primaryTz}
              </span>
            }
          >
            <div class="grid grid-cols-2 gap-1 w-full items-end">
              <span
                class="text-zinc-500 light:text-zinc-400 font-semibold text-left truncate"
                title={secondaryTz()}
              >
                {formatTzCityAbbreviation(secondaryTz())}
              </span>
              <span class="text-zinc-400 light:text-zinc-600 font-semibold text-right pr-0.5 truncate">
                {primaryTz}
              </span>
            </div>
          </Show>
        </div>

        {/* Day Column Headers */}
        <div
          class="flex-1 grid"
          style={{
            "grid-template-columns": `repeat(${visibleDays().length}, minmax(0, 1fr))`,
          }}
        >
          <For each={visibleDays()}>
            {(day) => {
              const isToday = () => isSameDay(day, nowDate());
              const dayName = new Intl.DateTimeFormat("en-US", {
                weekday: "short",
              }).format(day);

              return (
                <div class="border-r last:border-r-0 border-zinc-800/80 light:border-zinc-200 px-2.5 py-2 flex flex-col gap-1">
                  <div class="flex items-center justify-between">
                    <span
                      class={`text-xs font-medium uppercase tracking-wider ${
                        isToday()
                          ? "text-indigo-400 font-semibold"
                          : "text-zinc-400 light:text-zinc-600"
                      }`}
                    >
                      {dayName}
                    </span>
                    <span
                      class={`w-6 h-6 rounded-full text-xs font-mono-tabular flex items-center justify-center ${
                        isToday()
                          ? "bg-rose-500 text-white font-bold shadow-[0_0_10px_rgba(244,63,94,0.6)]"
                          : "text-zinc-200 light:text-zinc-800 font-semibold"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                  </div>

                  {/* All-Day Event Banner Pills */}
                  <div class="space-y-1 min-h-[18px] max-h-24 overflow-y-auto">
                    <For each={allDayEventsForDay(day)}>
                      {(ev) => (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedEvent(ev);
                            setRightInspectorOpen(true);
                          }}
                          class="w-full text-left px-1.5 py-0.5 rounded text-[11px] font-medium truncate text-zinc-100 light:text-zinc-900 transition-opacity hover:opacity-90"
                          style={{
                            "background-color": `${ev.colorHex}26`,
                            "border-left": `3px solid ${ev.colorHex}`,
                          }}
                        >
                          {ev.title}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </div>

      {/* Scrollable 24-Hour Precision Time Grid */}
      <div
        ref={scrollContainerRef}
        class="flex-1 overflow-y-auto relative flex"
        style={{ "scrollbar-gutter": "stable" }}
      >
        {/* Timezone Gutter */}
        <div
          class={`${
            userPreferences().showSecondaryTimezone ? "w-28" : "w-20"
          } shrink-0 border-r border-zinc-800/80 light:border-zinc-200 bg-zinc-950 light:bg-zinc-50 select-none`}
          style={{ height: `${24 * hourHeightPx()}px` }}
        >
          <For each={DAY_HOURS}>
            {(hour) => (
              <div
                class="relative px-1.5 flex items-start text-[10px] font-mono-tabular"
                style={{ height: `${hourHeightPx()}px` }}
              >
                <Show
                  when={userPreferences().showSecondaryTimezone}
                  fallback={
                    <span class="-mt-1.5 text-zinc-400 light:text-zinc-600 ml-auto text-right pr-0.5 truncate">
                      {formatHourLabel(hour, userPreferences().timeFormat)}
                    </span>
                  }
                >
                  <div class="grid grid-cols-2 gap-1 w-full items-start">
                    <span class="-mt-1.5 text-zinc-600 light:text-zinc-400 text-left truncate">
                      {formatSecondaryTzHour(
                        hour,
                        secondaryTz(),
                        userPreferences().timeFormat
                      )}
                    </span>
                    <span class="-mt-1.5 text-zinc-400 light:text-zinc-600 text-right pr-0.5 truncate">
                      {formatHourLabel(hour, userPreferences().timeFormat)}
                    </span>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>

        {/* Day Columns Canvas */}
        <div
          class="flex-1 grid relative"
          style={{
            "grid-template-columns": `repeat(${visibleDays().length}, minmax(0, 1fr))`,
            height: `${24 * hourHeightPx()}px`,
          }}
        >
          <For each={visibleDays()}>
            {(day) => {
              const dayStartTs = () =>
                Math.floor(startOfDay(day).getTime() / 1000);
              const isToday = () => isSameDay(day, nowDate());
              const dayEvents = createMemo(() => timedEventsForDay(day));

              const handleGridMouseDown = (e: MouseEvent) => {
                if (e.button !== 0) return;
                if ((e.target as HTMLElement).closest("[data-event-card]")) {
                  return;
                }
                const rect = (
                  e.currentTarget as HTMLDivElement
                ).getBoundingClientRect();
                const offsetY = Math.max(0, e.clientY - rect.top);
                const quarterIndex = Math.floor(offsetY / (hourHeightPx() / 4));
                const startTs = dayStartTs() + quarterIndex * 900;
                const defaultDurSecs =
                  (userPreferences().defaultEventDurationMins || 30) * 60;
                setDragState({
                  mode: "create",
                  initialDayStartTs: dayStartTs(),
                  dayStartTs: dayStartTs(),
                  initialStartTs: startTs,
                  initialEndTs: startTs + defaultDurSecs,
                  currentStartTs: startTs,
                  currentEndTs: startTs + defaultDurSecs,
                  startClientY: e.clientY,
                });
              };

              return (
                <div
                  data-day-start-ts={dayStartTs()}
                  onMouseDown={handleGridMouseDown}
                  class={`relative border-r last:border-r-0 border-zinc-800/80 light:border-zinc-200 ${
                    isToday()
                      ? "bg-indigo-950/[0.07] light:bg-indigo-50/30"
                      : ""
                  }`}
                >
                  {/* 1px Hour & Half-Hour Hairline Grid */}
                  <For each={DAY_HOURS}>
                    {() => (
                      <div
                        class="border-b border-zinc-800/70 light:border-zinc-200/80 relative"
                        style={{ height: `${hourHeightPx()}px` }}
                      >
                        <div class="absolute inset-x-0 top-1/2 border-b border-dashed border-zinc-900/80 light:border-zinc-100 pointer-events-none" />
                      </div>
                    )}
                  </For>

                  {/* Glowing Red Current-Time "Now" Needle */}
                  <Show when={isToday()}>
                    <div
                      class="absolute inset-x-0 z-20 pointer-events-none flex items-center"
                      style={{
                        top: `${(currentTimeMinutes() / 60) * hourHeightPx()}px`,
                      }}
                    >
                      <div class="w-2 h-2 -ml-1 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]" />
                      <div class="flex-1 h-[1.5px] bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
                    </div>
                  </Show>

                  {/* Drag-to-Create Preview Block */}
                  <Show
                    when={
                      dragState()?.mode === "create" &&
                      dragState()?.dayStartTs === dayStartTs()
                        ? dragState()
                        : null
                    }
                  >
                    {(st) => {
                      const startMins = () =>
                        (st().currentStartTs - dayStartTs()) / 60;
                      const durMins = () =>
                        Math.max(
                          15,
                          (st().currentEndTs - st().currentStartTs) / 60
                        );
                      return (
                        <div
                          class="absolute inset-x-1 rounded-md border border-indigo-400 bg-indigo-500/25 z-30 p-1.5 pointer-events-none"
                          style={{
                            top: `${(startMins() / 60) * hourHeightPx()}px`,
                            height: `${(durMins() / 60) * hourHeightPx()}px`,
                          }}
                        >
                          <div class="text-[11px] font-semibold text-indigo-200">
                            New Event
                          </div>
                          <div class="text-[10px] font-mono-tabular text-indigo-300">
                            {formatTimeRange(
                              st().currentStartTs,
                              st().currentEndTs,
                              userPreferences().timeFormat
                            )}
                          </div>
                        </div>
                      );
                    }}
                  </Show>

                  {/* Packed Timed Events */}
                  <For each={dayEvents()}>
                    {(ev) => {
                      const activeDrag = () =>
                        dragState()?.event?.instanceId === ev.instanceId
                          ? dragState()
                          : null;

                      const effectiveStartTs = () =>
                        activeDrag()?.currentStartTs ?? ev.startTs;
                      const effectiveEndTs = () =>
                        activeDrag()?.currentEndTs ?? ev.endTs;

                      const topPx = () => {
                        const mins = Math.max(
                          0,
                          (effectiveStartTs() - dayStartTs()) / 60
                        );
                        return (mins / 60) * hourHeightPx();
                      };

                      const heightPx = () => {
                        const durMins = Math.max(
                          15,
                          (effectiveEndTs() - effectiveStartTs()) / 60
                        );
                        const rawH = (durMins / 60) * hourHeightPx() - 1;
                        return Math.max(20, Math.round(rawH));
                      };

                      const isShortCard = () => {
                        const durMins = (effectiveEndTs() - effectiveStartTs()) / 60;
                        return heightPx() < 40 || durMins <= 30;
                      };

                      const approxDayColWidth = () => {
                        const containerW = scrollContainerRef?.clientWidth || 800;
                        const gutterW = userPreferences().showSecondaryTimezone ? 112 : 80;
                        return Math.max(30, (containerW - gutterW) / Math.max(1, visibleDays().length));
                      };
                      const approxCardWidth = () => approxDayColWidth() / Math.max(1, ev.totalCols);
                      const isNarrowCard = () => ev.totalCols > 1 || approxCardWidth() < 60;

                      const widthPct = () => 100 / Math.max(1, ev.totalCols);
                      const leftPct = () => ev.colIndex * widthPct();

                      const isPast = () =>
                        effectiveEndTs() < Math.floor(nowDate().getTime() / 1000);
                      const isTentativeOrBusy = () =>
                        ev.selfRsvp === "tentative" ||
                        ev.status === "tentative" ||
                        Boolean(ev.busyMirrorOfEventId);
                      const isSelected = () =>
                        selectedEvent()?.instanceId === ev.instanceId;

                      const cardPaddingClass = () => {
                        if (isShortCard() || isNarrowCard()) {
                          return "px-1.5 py-0.5";
                        }
                        return "px-2 py-1";
                      };

                      return (
                        <div
                          data-event-card="true"
                          onMouseDown={(e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            setSelectedEvent(ev);
                            setRightInspectorOpen(true);
                            setDragState({
                              mode: "move",
                              event: ev,
                              initialDayStartTs: dayStartTs(),
                              dayStartTs: dayStartTs(),
                              initialStartTs: ev.startTs,
                              initialEndTs: ev.endTs,
                              currentStartTs: ev.startTs,
                              currentEndTs: ev.endTs,
                              startClientY: e.clientY,
                            });
                          }}
                          class={`group absolute rounded-md ${cardPaddingClass()} overflow-hidden cursor-grab active:cursor-grabbing transition-shadow ${
                            isTentativeOrBusy() ? "bg-tentative-stripes" : ""
                          } ${isPast() ? "opacity-60" : "opacity-100"} ${
                            isSelected()
                              ? "ring-2 ring-white/90 light:ring-zinc-900 z-20 shadow-lg"
                              : "hover:z-10"
                          }`}
                          style={{
                            top: `${topPx()}px`,
                            height: `${heightPx()}px`,
                            left: ev.totalCols > 1 ? `calc(${leftPct()}% + 1px)` : `calc(${leftPct()}% + 2px)`,
                            width: ev.totalCols > 1 ? `calc(${widthPct()}% - 2px)` : `calc(${widthPct()}% - 4px)`,
                            "background-color": `${ev.colorHex}29`,
                            "border-left": `3px solid ${ev.colorHex}`,
                            border: isSelected()
                              ? undefined
                              : `1px solid ${ev.colorHex}55`,
                            "border-left-width": "3px",
                          }}
                        >
                          <Show
                            when={!isShortCard()}
                            fallback={
                              /* Compact Single-Line Inline Layout for <=30m or height < 40px */
                              <div class="flex items-center justify-between gap-1 w-full min-w-0 leading-none h-full">
                                <div class="flex items-center gap-1 min-w-0 truncate">
                                  <span class="text-[10px] font-semibold leading-none text-zinc-100 light:text-zinc-900 truncate">
                                    {ev.title}
                                  </span>
                                  <Show when={ev.isDirty}>
                                    <span
                                      class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                                      title="Waiting to sync"
                                    />
                                  </Show>
                                  <Show when={ev.isRecurring && approxCardWidth() >= 50}>
                                    <span
                                      class="text-[9px] text-zinc-400 inline-flex items-center shrink-0"
                                      title={ev.rruleHuman || "Recurring"}
                                    >
                                      <RepeatIcon class="w-2.5 h-2.5 shrink-0" />
                                    </span>
                                  </Show>
                                </div>
                                <Show when={approxCardWidth() >= 45}>
                                  <span class="text-[9px] font-mono-tabular text-zinc-300 light:text-zinc-700 shrink-0 leading-none opacity-85">
                                    {formatTimeShort(
                                      effectiveStartTs(),
                                      userPreferences().timeFormat
                                    )}
                                  </span>
                                </Show>
                              </div>
                            }
                          >
                            {/* Standard Multiline Layout for tall cards (height >= 40px) */}
                            <div class="flex items-start justify-between gap-1">
                              <span class="text-[11px] font-semibold leading-tight text-zinc-100 light:text-zinc-900 truncate">
                                {ev.title}
                              </span>
                              <div class="flex items-center gap-1 shrink-0">
                                <Show when={ev.isDirty}>
                                  <span
                                    class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                                    title="Waiting to sync"
                                  />
                                </Show>
                                <Show when={ev.isRecurring && (ev.totalCols === 1 || approxCardWidth() >= 50)}>
                                  <span
                                    class="text-[9px] text-zinc-400 inline-flex items-center shrink-0"
                                    title={ev.rruleHuman || "Recurring"}
                                  >
                                    <RepeatIcon class="w-2.5 h-2.5 shrink-0" />
                                  </span>
                                </Show>
                              </div>
                            </div>

                            <div class="text-[10px] font-mono-tabular text-zinc-300 light:text-zinc-700 truncate leading-tight mt-0.5">
                              {formatTimeRange(
                                effectiveStartTs(),
                                effectiveEndTs(),
                                userPreferences().timeFormat
                              )}
                            </div>

                            <Show when={heightPx() >= 48 && ev.conferenceUrl && approxCardWidth() >= 75}>
                              <button
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (ev.conferenceUrl) {
                                    void api.openExternalUrl(ev.conferenceUrl);
                                  }
                                }}
                                class="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-zinc-950/70 light:bg-white/80 text-indigo-300 light:text-indigo-700 hover:bg-indigo-600 hover:text-white transition-colors"
                              >
                                <VideoIcon class="w-2.5 h-2.5 shrink-0" />
                                <span class="truncate">
                                  Join{" "}
                                  {(ev.conferenceProvider || "Video").toUpperCase()}
                                </span>
                              </button>
                            </Show>
                          </Show>

                          {/* Bottom Resize Handle (15-min snap): h-1 on short cards, h-2 on tall cards */}
                          <div
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              setSelectedEvent(ev);
                              setDragState({
                                mode: "resize",
                                event: ev,
                                initialDayStartTs: dayStartTs(),
                                dayStartTs: dayStartTs(),
                                initialStartTs: ev.startTs,
                                initialEndTs: ev.endTs,
                                currentStartTs: ev.startTs,
                                currentEndTs: ev.endTs,
                                startClientY: e.clientY,
                              });
                            }}
                            class={`absolute inset-x-0 bottom-0 ${
                              isShortCard() ? "h-1" : "h-2"
                            } cursor-ns-resize opacity-0 group-hover:opacity-100 bg-white/15`}
                          />
                        </div>
                      );
                    }}
                  </For>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}
