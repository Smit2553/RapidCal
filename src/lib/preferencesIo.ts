import { api } from "./tauri";
import {
  DEFAULT_PREFERENCES,
  oauthConfig,
  refreshMetadata,
  refreshViewport,
  setOAuthConfig,
  setTheme,
  showToast,
  theme,
  updateUserPreferences,
  userPreferences,
} from "../store/calendarStore";
import type {
  CalendarViewMode,
  GridDensity,
  OAuthConfig,
  PlatformShortcutStyle,
  UserPreferences,
} from "../types/calendar";

export interface PreferencesExportEnvelope {
  $schema: string;
  app: string;
  schemaVersion: number;
  exportedAt: string;
  theme: "dark" | "light";
  preferences: UserPreferences;
  oauthConfig: OAuthConfig;
}

export interface ValidationSuccess {
  ok: true;
  theme?: "dark" | "light";
  preferences: UserPreferences;
  oauthConfig?: OAuthConfig;
}

export interface ValidationFailure {
  ok: false;
  error: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

const VALID_VIEWS: CalendarViewMode[] = [
  "day",
  "3day",
  "workweek",
  "week",
  "month",
  "agenda",
];

/**
 * Serializes the current user preferences, theme, and oauth configuration.
 */
export function generatePreferencesExportJson(): string {
  const currentPrefs = userPreferences();
  const currentOauth = oauthConfig();
  const currentTheme = theme();

  const envelope: PreferencesExportEnvelope = {
    $schema: "https://rapidcal.local/schemas/preferences.v1.json",
    app: "RapidCal",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    theme: currentTheme,
    preferences: { ...currentPrefs },
    oauthConfig: { ...currentOauth },
  };

  return JSON.stringify(envelope, null, 2);
}

/**
 * Triggers a file download of the exported JSON preferences.
 */
export function downloadPreferencesJsonFile(): void {
  try {
    const jsonStr = generatePreferencesExportJson();
    const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateStr = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `rapidcal-preferences-${dateStr}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Preferences exported to rapidcal-preferences-${dateStr}.json`);
  } catch (err: any) {
    showToast(`Export failed: ${err?.message || "Unknown error"}`);
  }
}

/**
 * Copies the formatted JSON export to the system clipboard.
 */
export async function copyPreferencesJsonToClipboard(): Promise<void> {
  try {
    const jsonStr = generatePreferencesExportJson();
    await navigator.clipboard.writeText(jsonStr);
    showToast("Preferences JSON copied to clipboard");
  } catch (err: any) {
    showToast("Failed to copy JSON to clipboard");
  }
}

/**
 * Validates a raw JSON string against the RapidCal preferences schema.
 */
export function validatePreferencesImport(rawJson: string): ValidationResult {
  let parsed: any;
  try {
    parsed = JSON.parse(rawJson);
  } catch (e: any) {
    return { ok: false, error: `Invalid JSON syntax: ${e.message || "Parse error"}` };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Root JSON payload must be an object." };
  }

  // Handle both envelope { preferences: {...} } and direct flat object { defaultView: ... }
  const p = parsed.preferences && typeof parsed.preferences === "object"
    ? parsed.preferences
    : parsed;

  const current = userPreferences();
  const nextPrefs: UserPreferences = { ...DEFAULT_PREFERENCES, ...current };

  // 1. defaultView
  if ("defaultView" in p) {
    if (!VALID_VIEWS.includes(p.defaultView)) {
      return {
        ok: false,
        error: `Invalid defaultView "${p.defaultView}". Allowed values: ${VALID_VIEWS.join(", ")}`,
      };
    }
    nextPrefs.defaultView = p.defaultView;
  }

  // 2. timeFormat
  if ("timeFormat" in p) {
    if (p.timeFormat !== "12h" && p.timeFormat !== "24h") {
      return { ok: false, error: `Invalid timeFormat "${p.timeFormat}". Allowed: "12h" | "24h"` };
    }
    nextPrefs.timeFormat = p.timeFormat;
  }

  // 3. weekStartsOn
  if ("weekStartsOn" in p) {
    if (p.weekStartsOn !== "monday" && p.weekStartsOn !== "sunday") {
      return { ok: false, error: `Invalid weekStartsOn "${p.weekStartsOn}". Allowed: "monday" | "sunday"` };
    }
    nextPrefs.weekStartsOn = p.weekStartsOn;
  }

  // 4. defaultEventDurationMins
  if ("defaultEventDurationMins" in p) {
    const dur = Number(p.defaultEventDurationMins);
    if (isNaN(dur) || dur < 5 || dur > 480) {
      return { ok: false, error: "defaultEventDurationMins must be a number between 5 and 480" };
    }
    nextPrefs.defaultEventDurationMins = dur as any;
  }

  // 5. workingHoursStart & workingHoursEnd
  if ("workingHoursStart" in p) {
    const start = Number(p.workingHoursStart);
    if (isNaN(start) || start < 0 || start > 23) {
      return { ok: false, error: "workingHoursStart must be an integer between 0 and 23" };
    }
    nextPrefs.workingHoursStart = start;
  }
  if ("workingHoursEnd" in p) {
    const end = Number(p.workingHoursEnd);
    if (isNaN(end) || end < 1 || end > 24) {
      return { ok: false, error: "workingHoursEnd must be an integer between 1 and 24" };
    }
    if (end <= nextPrefs.workingHoursStart) {
      return { ok: false, error: "workingHoursEnd must be greater than workingHoursStart" };
    }
    nextPrefs.workingHoursEnd = end;
  }

  // 6. showSecondaryTimezone & highlightWeekends
  if ("showSecondaryTimezone" in p) {
    nextPrefs.showSecondaryTimezone = Boolean(p.showSecondaryTimezone);
  }
  if ("highlightWeekends" in p) {
    nextPrefs.highlightWeekends = Boolean(p.highlightWeekends);
  }

  // 7. platformShortcutStyle
  if ("platformShortcutStyle" in p) {
    const validStyles: PlatformShortcutStyle[] = ["auto", "mac", "windows_linux"];
    if (!validStyles.includes(p.platformShortcutStyle)) {
      return { ok: false, error: `platformShortcutStyle must be "auto" | "mac" | "windows_linux"` };
    }
    nextPrefs.platformShortcutStyle = p.platformShortcutStyle;
  }

  // 8. gridDensity & hourHeight
  if ("gridDensity" in p) {
    const validDensities: GridDensity[] = ["compact", "standard", "spacious", "custom"];
    if (validDensities.includes(p.gridDensity)) {
      nextPrefs.gridDensity = p.gridDensity;
    } else {
      return { ok: false, error: `Invalid gridDensity "${p.gridDensity}". Allowed: ${validDensities.join(", ")}` };
    }
  }
  if ("hourHeight" in p) {
    const hh = Number(p.hourHeight);
    if (isNaN(hh) || hh < 40 || hh > 96) {
      return { ok: false, error: "hourHeight must be a number between 40 and 96" };
    }
    nextPrefs.hourHeight = hh;
  }

  // Theme check
  let nextTheme: ("dark" | "light") | undefined;
  if (parsed.theme === "dark" || parsed.theme === "light") {
    nextTheme = parsed.theme;
  }

  // OAuth config check
  let nextOauth: OAuthConfig | undefined;
  if (parsed.oauthConfig && typeof parsed.oauthConfig === "object") {
    const o = parsed.oauthConfig;
    const curO = oauthConfig();
    nextOauth = {
      googleClientId: typeof o.googleClientId === "string" ? o.googleClientId : curO.googleClientId,
      googleClientSecret: typeof o.googleClientSecret === "string" ? o.googleClientSecret : curO.googleClientSecret,
      msClientId: typeof o.msClientId === "string" ? o.msClientId : curO.msClientId,
      msTenantId: typeof o.msTenantId === "string" && o.msTenantId ? o.msTenantId : curO.msTenantId,
      hibernationEnabled: typeof o.hibernationEnabled === "boolean" ? o.hibernationEnabled : curO.hibernationEnabled,
      secondaryTimezone: typeof o.secondaryTimezone === "string" ? o.secondaryTimezone : curO.secondaryTimezone,
      syncIntervalSecs: typeof o.syncIntervalSecs === "number" && o.syncIntervalSecs >= 15 ? o.syncIntervalSecs : curO.syncIntervalSecs,
    };
  }

  return {
    ok: true,
    preferences: nextPrefs,
    theme: nextTheme,
    oauthConfig: nextOauth,
  };
}

/**
 * Applies a validated preferences payload to store, backend, and localStorage.
 */
export async function applyImportedPreferences(validated: ValidationSuccess): Promise<void> {
  updateUserPreferences(validated.preferences);

  if (validated.theme) {
    setTheme(validated.theme);
  }

  if (validated.oauthConfig) {
    await api.saveOAuthConfig(validated.oauthConfig);
    setOAuthConfig(validated.oauthConfig);
  }

  await Promise.all([refreshMetadata(), refreshViewport()]);
  showToast("Preferences imported successfully");
}

/**
 * Resets the SQLite demo seed and optionally resets preferences to factory defaults.
 */
export async function resetToSampleDataset(options?: { resetPreferences?: boolean }): Promise<void> {
  await api.resetDemoData();

  if (options?.resetPreferences) {
    updateUserPreferences(DEFAULT_PREFERENCES);
    setTheme("dark");
  }

  await Promise.all([refreshMetadata(), refreshViewport()]);
  showToast("Sample dataset and default preferences restored");
}
