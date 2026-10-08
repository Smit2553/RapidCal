import { Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { AccountsModal } from "./components/AccountsModal";
import { AgendaView } from "./components/AgendaView";
import { CommandPalette } from "./components/CommandPalette";
import { EventInspector } from "./components/EventInspector";
import { LeftSidebar } from "./components/LeftSidebar";
import { MonthView } from "./components/MonthView";
import { TimeGridView } from "./components/TimeGridView";
import { TopBar } from "./components/TopBar";
import { registerGlobalKeybindings } from "./lib/keybindings";
import {
  initializeCalendarStore,
  toastMessage,
  triggerSyncNowAction,
  viewMode,
} from "./store/calendarStore";

export default function App() {
  onMount(() => {
    void initializeCalendarStore();
    const unregister = registerGlobalKeybindings();

    const handleOnline = () => {
      void triggerSyncNowAction();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void triggerSyncNowAction();
      }
    };
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    onCleanup(() => {
      unregister();
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    });
  });

  return (
    <div class="h-screen w-screen flex flex-col bg-zinc-950 light:bg-white text-zinc-100 light:text-zinc-900 overflow-hidden">
      <TopBar />

      {/* 3-Pane Cron / Linear Precision Workspace */}
      <main class="flex-1 flex min-h-0 min-w-0 overflow-hidden">
        <LeftSidebar />

        <Switch fallback={<TimeGridView />}>
          <Match when={viewMode() === "month"}>
            <MonthView />
          </Match>
          <Match when={viewMode() === "agenda"}>
            <AgendaView />
          </Match>
        </Switch>

        <EventInspector />
      </main>

      {/* Modals & Command Bar */}
      <CommandPalette />
      <AccountsModal />

      {/* Sub-millisecond Action Toast */}
      <Show when={toastMessage()}>
        {(msg) => (
          <div class="fixed bottom-4 right-4 z-50 px-3.5 py-2 rounded-lg border border-indigo-500/40 bg-zinc-900/95 light:bg-zinc-900 text-xs font-medium text-zinc-100 shadow-xl flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-indigo-400" />
            <span>{msg()}</span>
          </div>
        )}
      </Show>
    </div>
  );
}
