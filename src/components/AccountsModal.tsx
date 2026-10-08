import { Show } from "solid-js";
import { accountsModalOpen, setAccountsModalOpen } from "../store/calendarStore";
import { SettingsView } from "./SettingsView";

export function AccountsModal() {
  return (
    <Show when={accountsModalOpen()}>
      <div
        onClick={() => setAccountsModalOpen(false)}
        class="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 select-none"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          class="w-full max-w-4xl h-[85vh] rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-950 light:bg-white shadow-2xl flex flex-col overflow-hidden"
        >
          <SettingsView />
        </div>
      </div>
    </Show>
  );
}
