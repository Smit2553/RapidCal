import { createMemo, For, Show } from "solid-js";
import {
  addMonths,
  getMonthGridDays,
  isSameDay,
} from "../lib/dateUtils";
import {
  accounts,
  anchorDate,
  calendars,
  leftSidebarOpen,
  openCommandPalette,
  setAccountsModalOpen,
  setAnchorDate,
  toggleCalendar,
  viewportEvents,
} from "../store/calendarStore";

const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

export function LeftSidebar() {
  const miniDays = createMemo(() => getMonthGridDays(anchorDate()));
  const today = new Date();

  const daysWithEvents = createMemo(() => {
    const set = new Set<string>();
    for (const ev of viewportEvents()) {
      const d = new Date(ev.startTs * 1000);
      set.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }
    return set;
  });

  const miniMonthLabel = createMemo(() =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "numeric",
    }).format(anchorDate())
  );

  return (
    <Show when={leftSidebarOpen()}>
      <aside class="w-64 shrink-0 border-r border-zinc-800/80 light:border-zinc-200 bg-zinc-950 light:bg-zinc-50 flex flex-col justify-between overflow-y-auto select-none">
        <div class="p-3 space-y-5">
          {/* Mini-Month Navigator */}
          <div>
            <div class="flex items-center justify-between mb-2 px-1">
              <span class="text-xs font-semibold tracking-tight text-zinc-200 light:text-zinc-800">
                {miniMonthLabel()}
              </span>
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setAnchorDate(addMonths(anchorDate(), -1))}
                  class="w-5 h-5 rounded hover:bg-zinc-800 light:hover:bg-zinc-200 text-zinc-400 flex items-center justify-center text-xs"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setAnchorDate(addMonths(anchorDate(), 1))}
                  class="w-5 h-5 rounded hover:bg-zinc-800 light:hover:bg-zinc-200 text-zinc-400 flex items-center justify-center text-xs"
                >
                  ›
                </button>
              </div>
            </div>

            <div class="grid grid-cols-7 text-center text-[10px] font-mono-tabular text-zinc-500 mb-1">
              <For each={WEEKDAY_INITIALS}>
                {(d) => <div class="py-0.5">{d}</div>}
              </For>
            </div>

            <div class="grid grid-cols-7 gap-0.5 text-center">
              <For each={miniDays()}>
                {(day) => {
                  const inCurrentMonth = () =>
                    day.getMonth() === anchorDate().getMonth();
                  const isSelected = () => isSameDay(day, anchorDate());
                  const isToday = () => isSameDay(day, today);
                  const hasEvent = () =>
                    daysWithEvents().has(
                      `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
                    );

                  return (
                    <button
                      type="button"
                      onClick={() => setAnchorDate(day)}
                      class={`h-7 rounded-md text-[11px] font-mono-tabular relative flex flex-col items-center justify-center transition-colors ${
                        isSelected()
                          ? "bg-indigo-600 text-white font-semibold"
                          : isToday()
                            ? "border border-rose-500/70 text-rose-400 font-semibold"
                            : inCurrentMonth()
                              ? "text-zinc-300 light:text-zinc-700 hover:bg-zinc-800/70 light:hover:bg-zinc-200"
                              : "text-zinc-600 light:text-zinc-400 hover:bg-zinc-900"
                      }`}
                    >
                      <span>{day.getDate()}</span>
                      <Show when={hasEvent() && !isSelected()}>
                        <span class="w-1 h-1 rounded-full bg-indigo-400 absolute bottom-0.5" />
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>

          {/* Connected Multi-Account Tree (Google + Microsoft Outlook) */}
          <div class="space-y-3">
            <div class="flex items-center justify-between px-1">
              <span class="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Accounts & Calendars
              </span>
              <button
                type="button"
                onClick={() => setAccountsModalOpen(true)}
                class="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium"
              >
                + Connect
              </button>
            </div>

            <For each={accounts()}>
              {(account) => {
                const accountCalendars = createMemo(() =>
                  calendars().filter((c) => c.accountId === account.id)
                );

                return (
                  <div class="rounded-lg border border-zinc-800/70 light:border-zinc-200 bg-zinc-900/40 light:bg-white p-2.5 space-y-2">
                    <div class="flex items-center justify-between gap-1.5">
                      <div class="flex items-center gap-1.5 min-w-0">
                        <span
                          class={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                            account.provider === "microsoft"
                              ? "bg-sky-500/15 text-sky-400 border border-sky-500/30"
                              : "bg-indigo-500/15 text-indigo-400 border border-indigo-500/30"
                          }`}
                        >
                          {account.provider === "microsoft"
                            ? "Outlook"
                            : "Google"}
                        </span>
                        <span
                          class="text-xs font-medium text-zinc-200 light:text-zinc-800 truncate"
                          title={account.email}
                        >
                          {account.email}
                        </span>
                      </div>
                      <span
                        class={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          account.status === "connected"
                            ? "bg-emerald-400"
                            : "bg-indigo-400"
                        }`}
                        title={`Status: ${account.status}`}
                      />
                    </div>

                    <div class="space-y-1 pl-0.5">
                      <For each={accountCalendars()}>
                        {(cal) => (
                          <label class="flex items-center justify-between gap-2 py-1 px-1.5 rounded hover:bg-zinc-800/60 light:hover:bg-zinc-100 cursor-pointer group">
                            <div class="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={cal.isVisible}
                                onChange={(e) =>
                                  void toggleCalendar(
                                    cal.id,
                                    e.currentTarget.checked
                                  )
                                }
                                class="sr-only"
                              />
                              <span
                                class="w-3 h-3 rounded-xs flex items-center justify-center transition-all shrink-0"
                                style={{
                                  "background-color": cal.isVisible
                                    ? cal.colorHex
                                    : "transparent",
                                  border: `1.5px solid ${cal.colorHex}`,
                                }}
                              >
                                <Show when={cal.isVisible}>
                                  <svg
                                    class="w-2 h-2 text-white"
                                    viewBox="0 0 12 12"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                  >
                                    <polyline points="2 6 5 9 10 3" />
                                  </svg>
                                </Show>
                              </span>
                              <span class="text-xs text-zinc-300 light:text-zinc-700 truncate">
                                {cal.name}
                              </span>
                            </div>
                            <Show when={cal.isPrimary}>
                              <span class="text-[9px] font-mono-tabular text-zinc-500">
                                pri
                              </span>
                            </Show>
                          </label>
                        )}
                      </For>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>

        {/* Footer: Keyboard Shortcut Cheat Sheet & NLP Quick-Add Trigger */}
        <div class="p-3 border-t border-zinc-800/80 light:border-zinc-200 space-y-2 text-[11px] text-zinc-500">
          <button
            type="button"
            onClick={() => openCommandPalette("nlp")}
            class="w-full py-1.5 px-2.5 rounded-md border border-zinc-800 light:border-zinc-200 bg-zinc-900/60 light:bg-white hover:border-indigo-500/40 text-left flex items-center justify-between text-zinc-300 light:text-zinc-700 transition-colors"
          >
            <span>⚡ Natural Language Add</span>
            <kbd class="font-mono-tabular text-[10px] px-1 rounded bg-zinc-800 light:bg-zinc-200">
              C
            </kbd>
          </button>
          <div class="grid grid-cols-2 gap-1 text-[10px] font-mono-tabular text-zinc-500 px-1">
            <div>D/3/5/W: Grid</div>
            <div>M/A: Month/List</div>
            <div>⌘K: Command</div>
            <div>⌘J: Join Video</div>
          </div>
        </div>
      </aside>
    </Show>
  );
}
