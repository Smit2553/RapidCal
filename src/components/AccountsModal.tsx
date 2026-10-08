import { createEffect, createSignal, For, Show } from "solid-js";
import { api } from "../lib/tauri";
import {
  accounts,
  accountsModalOpen,
  oauthConfig,
  outboxMutations,
  refreshMetadata,
  refreshViewport,
  setAccountsModalOpen,
  setOAuthConfig,
  showToast,
  triggerSyncNowAction,
} from "../store/calendarStore";

const SECONDARY_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Kolkata",
];

export function AccountsModal() {
  const [googleClientId, setGoogleClientId] = createSignal("");
  const [googleClientSecret, setGoogleClientSecret] = createSignal("");
  const [msClientId, setMsClientId] = createSignal("");
  const [msTenantId, setMsTenantId] = createSignal("common");
  const [hibernationEnabled, setHibernationEnabled] = createSignal(true);
  const [secondaryTimezone, setSecondaryTimezone] = createSignal("UTC");
  const [syncIntervalSecs, setSyncIntervalSecs] = createSignal(60);
  const [authStatusMsg, setAuthStatusMsg] = createSignal<string | null>(null);

  createEffect(() => {
    if (accountsModalOpen()) {
      const cfg = oauthConfig();
      setGoogleClientId(cfg.googleClientId);
      setGoogleClientSecret(cfg.googleClientSecret || "");
      setMsClientId(cfg.msClientId);
      setMsTenantId(cfg.msTenantId || "common");
      setHibernationEnabled(cfg.hibernationEnabled);
      setSecondaryTimezone(cfg.secondaryTimezone || "UTC");
      setSyncIntervalSecs(cfg.syncIntervalSecs || 60);
      setAuthStatusMsg(null);
    }
  });

  const handleSaveSettings = async (e: Event) => {
    e.preventDefault();
    const updated = await api.saveOAuthConfig({
      googleClientId: googleClientId(),
      googleClientSecret: googleClientSecret() || null,
      msClientId: msClientId(),
      msTenantId: msTenantId() || "common",
      hibernationEnabled: hibernationEnabled(),
      secondaryTimezone: secondaryTimezone(),
      syncIntervalSecs: syncIntervalSecs(),
    });
    setOAuthConfig(updated);
    showToast("Saved OAuth2 PKCE & Desktop Daemon preferences");
  };

  const handleConnectProvider = async (provider: "google" | "microsoft") => {
    setAuthStatusMsg(
      `Starting localhost OAuth2 + PKCE loopback server for ${provider}…`
    );
    try {
      await handleSaveSettings(new Event("submit"));
      const acc = await api.connectOAuthAccount(provider);
      await Promise.all([refreshMetadata(), refreshViewport()]);
      setAuthStatusMsg(`Connected ${acc.email} (${acc.provider})!`);
      showToast(`Connected ${acc.email}`);
    } catch (err) {
      setAuthStatusMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Show when={accountsModalOpen()}>
      <div
        onClick={() => setAccountsModalOpen(false)}
        class="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 select-none"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          class="w-full max-w-3xl max-h-[88vh] rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-950 light:bg-white shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Modal Header */}
          <div class="px-5 py-3.5 border-b border-zinc-800 light:border-zinc-200 flex items-center justify-between">
            <div>
              <h2 class="text-sm font-semibold text-zinc-100 light:text-zinc-900">
                Multi-Account Sync, OAuth2 + PKCE Vault & Desktop Daemon
              </h2>
              <p class="text-xs text-zinc-400 light:text-zinc-600">
                Direct localhost PKCE authentication • OS Keychain + AES-256-GCM
                SQLite Vault • Zero Cloud Relay
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAccountsModalOpen(false)}
              class="h-7 px-2.5 rounded-md border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Close (ESC)
            </button>
          </div>

          <div class="p-5 overflow-y-auto space-y-6">
            {/* Connected / Demo Accounts List */}
            <section class="space-y-2.5">
              <div class="flex items-center justify-between">
                <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Connected & Demo Accounts ({accounts().length})
                </h3>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleConnectProvider("google")}
                    class="h-7 px-3 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                  >
                    + Connect Google Calendar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConnectProvider("microsoft")}
                    class="h-7 px-3 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                  >
                    + Connect Microsoft Outlook
                  </button>
                </div>
              </div>

              <Show when={authStatusMsg()}>
                <div class="p-2.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-xs text-indigo-200 light:text-indigo-800">
                  {authStatusMsg()}
                </div>
              </Show>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                <For each={accounts()}>
                  {(acc) => (
                    <div class="rounded-lg border border-zinc-800 light:border-zinc-200 bg-zinc-900/50 light:bg-zinc-50 p-3 flex flex-col justify-between gap-2">
                      <div class="space-y-1">
                        <div class="flex items-center justify-between">
                          <span
                            class={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                              acc.provider === "microsoft"
                                ? "bg-sky-500/20 text-sky-400"
                                : "bg-indigo-500/20 text-indigo-400"
                            }`}
                          >
                            {acc.provider}
                          </span>
                          <span class="text-[10px] font-mono-tabular text-emerald-400">
                            ● {acc.status}
                          </span>
                        </div>
                        <div class="text-xs font-semibold text-zinc-100 light:text-zinc-900 truncate">
                          {acc.displayName}
                        </div>
                        <div class="text-[11px] font-mono-tabular text-zinc-400 truncate">
                          {acc.email}
                        </div>
                      </div>

                      <div class="flex items-center justify-between pt-2 border-t border-zinc-800/60 light:border-zinc-200">
                        <span class="text-[10px] text-zinc-500">
                          Incremental Delta Ready
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            await api.removeAccount(acc.id);
                            await Promise.all([
                              refreshMetadata(),
                              refreshViewport(),
                            ]);
                            showToast(`Removed ${acc.email}`);
                          }}
                          class="text-[11px] text-rose-400 hover:text-rose-300"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </section>

            {/* OAuth2 + PKCE Client ID Configuration & Desktop Daemon Settings */}
            <form
              onSubmit={(e) => void handleSaveSettings(e)}
              class="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/30 light:bg-zinc-50 p-4 space-y-4"
            >
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 light:text-zinc-700">
                    OAuth2 Client Credentials & Timezone / Hibernation Config
                  </h3>
                  <p class="text-[11px] text-zinc-500">
                    Can also be supplied via{" "}
                    <code class="font-mono-tabular text-zinc-400">
                      RAPIDCAL_GOOGLE_CLIENT_ID
                    </code>{" "}
                    and{" "}
                    <code class="font-mono-tabular text-zinc-400">
                      RAPIDCAL_MS_CLIENT_ID
                    </code>{" "}
                    environment variables.
                  </p>
                </div>
                <button
                  type="submit"
                  class="h-7 px-3 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                >
                  Save Settings
                </button>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="space-y-1">
                  <label class="text-[11px] font-medium text-zinc-400">
                    Google OAuth Desktop Client ID
                  </label>
                  <input
                    type="text"
                    value={googleClientId()}
                    onInput={(e) => setGoogleClientId(e.currentTarget.value)}
                    placeholder="xxxx.apps.googleusercontent.com"
                    class="w-full h-8 px-2.5 rounded border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs font-mono-tabular text-zinc-200 light:text-zinc-800"
                  />
                </div>
                <div class="space-y-1">
                  <label class="text-[11px] font-medium text-zinc-400">
                    Google Client Secret (Optional for Installed App PKCE)
                  </label>
                  <input
                    type="password"
                    value={googleClientSecret()}
                    onInput={(e) =>
                      setGoogleClientSecret(e.currentTarget.value)
                    }
                    placeholder="GOCSPX-••••••••"
                    class="w-full h-8 px-2.5 rounded border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs font-mono-tabular text-zinc-200 light:text-zinc-800"
                  />
                </div>
                <div class="space-y-1">
                  <label class="text-[11px] font-medium text-zinc-400">
                    Microsoft Entra / Azure Application (Client) ID
                  </label>
                  <input
                    type="text"
                    value={msClientId()}
                    onInput={(e) => setMsClientId(e.currentTarget.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    class="w-full h-8 px-2.5 rounded border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs font-mono-tabular text-zinc-200 light:text-zinc-800"
                  />
                </div>
                <div class="space-y-1">
                  <label class="text-[11px] font-medium text-zinc-400">
                    Microsoft Tenant ID
                  </label>
                  <input
                    type="text"
                    value={msTenantId()}
                    onInput={(e) => setMsTenantId(e.currentTarget.value)}
                    placeholder="common"
                    class="w-full h-8 px-2.5 rounded border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs font-mono-tabular text-zinc-200 light:text-zinc-800"
                  />
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-zinc-800/70 light:border-zinc-200">
                <div class="space-y-1">
                  <label class="text-[11px] font-medium text-zinc-400">
                    Secondary Timezone Gutter
                  </label>
                  <select
                    value={secondaryTimezone()}
                    onChange={(e) =>
                      setSecondaryTimezone(e.currentTarget.value)
                    }
                    class="w-full h-8 px-2 rounded border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs font-mono-tabular text-zinc-200 light:text-zinc-800"
                  >
                    <For each={SECONDARY_TIMEZONES}>
                      {(tz) => <option value={tz}>{tz}</option>}
                    </For>
                  </select>
                </div>

                <div class="space-y-1">
                  <label class="text-[11px] font-medium text-zinc-400">
                    Active Sync Poll Interval (s)
                  </label>
                  <input
                    type="number"
                    min={15}
                    max={600}
                    value={syncIntervalSecs()}
                    onInput={(e) =>
                      setSyncIntervalSecs(
                        parseInt(e.currentTarget.value, 10) || 60
                      )
                    }
                    class="w-full h-8 px-2.5 rounded border border-zinc-800 light:border-zinc-300 bg-zinc-950 light:bg-white text-xs font-mono-tabular text-zinc-200 light:text-zinc-800"
                  />
                </div>

                <div class="flex items-center pt-4">
                  <label class="flex items-center gap-2 text-xs text-zinc-300 light:text-zinc-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hibernationEnabled()}
                      onChange={(e) =>
                        setHibernationEnabled(e.currentTarget.checked)
                      }
                    />
                    <span>
                      WebView Hibernation to Tray ({"<10MB"} background RAM)
                    </span>
                  </label>
                </div>
              </div>
            </form>

            {/* Persistent SQLite Outbox Queue & Demo Reset */}
            <section class="flex items-center justify-between rounded-lg border border-zinc-800 light:border-zinc-200 p-3.5 bg-zinc-900/30 light:bg-zinc-50">
              <div class="space-y-0.5">
                <div class="text-xs font-semibold text-zinc-200 light:text-zinc-800">
                  Persistent Offline Outbox Queue ({outboxMutations().length}{" "}
                  pending)
                </div>
                <p class="text-[11px] text-zinc-500">
                  Local edits commit in {"<1ms"} to SQLite WAL and flush
                  asynchronously to Google Calendar & Microsoft Graph.
                </p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void triggerSyncNowAction()}
                  class="h-7 px-3 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
                >
                  Flush Outbox & Sync Now
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await api.resetDemoData();
                    await Promise.all([refreshMetadata(), refreshViewport()]);
                    showToast("Reset multi-account demo dataset");
                  }}
                  class="h-7 px-3 rounded-md border border-zinc-700 hover:bg-zinc-800 text-xs text-zinc-300"
                >
                  Reset Demo Seed
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </Show>
  );
}
