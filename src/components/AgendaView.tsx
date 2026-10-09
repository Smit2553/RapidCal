import { createMemo, For, Show } from "solid-js";
import { formatTimeRange } from "../lib/dateUtils";
import { api } from "../lib/tauri";
import { formatModKey } from "../lib/platform";
import { MapPinIcon, PlusIcon, RepeatIcon, VideoIcon } from "./icons/Icons";
import {
  selectedEvent,
  setRightInspectorOpen,
  setSelectedEvent,
  startNewEventDraft,
  updateRsvpOptimistic,
  userPreferences,
  viewportEvents,
} from "../store/calendarStore";
import type { ViewportEvent } from "../types/calendar";

export function AgendaView() {
  const groupedByDay = createMemo(() => {
    const map = new Map<string, { dateLabel: string; items: ViewportEvent[] }>();
    const sorted = [...viewportEvents()].sort((a, b) => a.startTs - b.startTs);

    for (const ev of sorted) {
      const dt = new Date(ev.startTs * 1000);
      const key = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
      if (!map.has(key)) {
        const dateLabel = new Intl.DateTimeFormat("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
          year: "numeric",
        }).format(dt);
        map.set(key, { dateLabel, items: [] });
      }
      map.get(key)!.items.push(ev);
    }
    return Array.from(map.values());
  });

  return (
    <div class="flex-1 overflow-y-auto bg-zinc-950 light:bg-white p-3.5 sm:p-6">
      <div class="max-w-4xl mx-auto space-y-6">
        <div class="flex items-center justify-between border-b border-zinc-800 light:border-zinc-200 pb-3">
          <div>
            <h2 class="text-base font-semibold text-zinc-100 light:text-zinc-900">
              Upcoming Schedule
            </h2>
            <p class="text-xs text-zinc-400 light:text-zinc-600">
              Your upcoming meetings and events across all connected calendars
            </p>
          </div>
          <button
            type="button"
            onClick={() => startNewEventDraft()}
            class="h-8 px-3 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0"
          >
            <PlusIcon class="w-3.5 h-3.5 shrink-0" />
            <span class="hidden sm:inline">Schedule Event</span>
            <span class="sm:hidden">New</span>
          </button>
        </div>

        <Show
          when={groupedByDay().length > 0}
          fallback={
            <div class="rounded-xl border border-zinc-800 light:border-zinc-200 p-12 text-center text-zinc-500">
              No events scheduled in the next 30 days. Press{" "}
              <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 light:bg-zinc-200 text-zinc-300 light:text-zinc-700 font-mono-tabular text-xs">
                {formatModKey("K")}
              </kbd>{" "}
              to quickly add an event.
            </div>
          }
        >
          <For each={groupedByDay()}>
            {(group) => (
              <section class="space-y-2">
                <h3 class="text-xs font-semibold uppercase tracking-wider text-indigo-400 font-mono-tabular sticky top-0 bg-zinc-950/90 light:bg-white/90 py-1 backdrop-blur">
                  {group.dateLabel}
                </h3>

                <div class="space-y-2">
                  <For each={group.items}>
                    {(ev) => {
                      const isSel = () =>
                        selectedEvent()?.instanceId === ev.instanceId;

                      return (
                        <div
                          onClick={() => {
                            setSelectedEvent(ev);
                            setRightInspectorOpen(true);
                          }}
                          class={`rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 cursor-pointer transition-all ${
                            ev.selfRsvp === "tentative" ||
                            ev.busyMirrorOfEventId
                              ? "bg-tentative-stripes"
                              : ""
                          } ${
                            isSel()
                              ? "border-indigo-500 bg-zinc-900/90 light:bg-indigo-50/40"
                              : "border-zinc-800/80 light:border-zinc-200 bg-zinc-900/40 light:bg-zinc-50 hover:border-zinc-700"
                          }`}
                        >
                          <div class="flex items-start gap-3 min-w-0 w-full sm:w-auto">
                            <div
                              class="w-1.5 self-stretch rounded-full shrink-0"
                              style={{ "background-color": ev.colorHex }}
                            />
                            <div class="space-y-1 min-w-0 flex-1">
                              <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-sm font-semibold text-zinc-100 light:text-zinc-900 truncate">
                                  {ev.title}
                                </span>
                                <span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-800 light:bg-zinc-200 text-zinc-300 light:text-zinc-700">
                                  {ev.calendarName}
                                </span>
                                <Show when={ev.rruleHuman}>
                                  <span class="px-1.5 py-0.5 rounded text-[10px] font-mono-tabular bg-indigo-500/15 text-indigo-300 light:text-indigo-700 flex items-center gap-1">
                                    <RepeatIcon class="w-2.5 h-2.5 shrink-0" />
                                    <span>{ev.rruleHuman}</span>
                                  </span>
                                </Show>
                                <Show when={ev.busyMirrorOfEventId}>
                                  <span class="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-300">
                                    Blocked Time
                                  </span>
                                </Show>
                              </div>

                              <div class="flex items-center gap-3 text-xs text-zinc-400 light:text-zinc-600 font-mono-tabular flex-wrap">
                                <span>
                                  {ev.isAllDay
                                    ? "All Day"
                                    : formatTimeRange(
                                        ev.startTs,
                                        ev.endTs,
                                        userPreferences().timeFormat
                                      )}
                                </span>
                                <Show when={ev.location}>
                                  <span class="flex items-center gap-1">
                                    <MapPinIcon class="w-3 h-3 text-zinc-400 shrink-0" />
                                    <span class="truncate">{ev.location}</span>
                                  </span>
                                </Show>
                              </div>
                            </div>
                          </div>

                          {/* Right Actions: Inline Response + Video Join */}
                          <div
                            class="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap pt-2 sm:pt-0 border-t border-zinc-800/40 light:border-zinc-200/60 sm:border-t-0 justify-between sm:justify-end w-full sm:w-auto"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div class="flex items-center rounded-md border border-zinc-800 light:border-zinc-200 overflow-hidden text-[11px]">
                              {(
                                [
                                  ["accepted", "Yes"],
                                  ["tentative", "Maybe"],
                                  ["declined", "No"],
                                ] as const
                              ).map(([status, label]) => (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void updateRsvpOptimistic(ev, status)
                                  }
                                  class={`px-2 py-1 font-medium transition-colors ${
                                    ev.selfRsvp === status
                                      ? "bg-indigo-600 text-white"
                                      : "bg-zinc-900 light:bg-white text-zinc-400 light:text-zinc-600 hover:text-zinc-200 light:hover:text-zinc-900"
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>

                            <Show when={ev.conferenceUrl}>
                              <button
                                type="button"
                                onClick={() => {
                                  if (ev.conferenceUrl) {
                                    void api.openExternalUrl(ev.conferenceUrl);
                                  }
                                }}
                                class="h-7 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                              >
                                <VideoIcon class="w-3 h-3 shrink-0" />
                                <span>
                                  Join{" "}
                                  {(ev.conferenceProvider || "Call").toUpperCase()}
                                </span>
                              </button>
                            </Show>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </section>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
