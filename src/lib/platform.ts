import { userPreferences } from "../store/calendarStore";
import type {
  EffectivePlatformStyle,
  KeyCombo,
  PlatformShortcutStyle,
  TargetPlatform,
} from "../types/calendar";

/**
 * Detect the host platform from navigator attributes.
 * Inspects navigator.userAgentData.platform, navigator.platform, and navigator.userAgent.
 * Defaults to "linux" if running in an SSR or non-standard environment.
 */
export function detectSystemPlatform(): TargetPlatform {
  if (typeof navigator === "undefined") {
    return "linux";
  }

  // Type assertion for modern Chromium User-Agent Client Hints
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };

  const uaPlatform = (nav.userAgentData?.platform || "").toLowerCase();
  const navPlatform = (navigator.platform || "").toLowerCase();
  const userAgent = (navigator.userAgent || "").toLowerCase();

  // Detect macOS
  if (
    uaPlatform.includes("mac") ||
    navPlatform.includes("mac") ||
    userAgent.includes("macintosh") ||
    userAgent.includes("mac os x")
  ) {
    return "mac";
  }

  // Detect Windows
  if (
    uaPlatform.includes("win") ||
    navPlatform.includes("win") ||
    userAgent.includes("windows")
  ) {
    return "windows";
  }

  // Default / Linux
  return "linux";
}

/**
 * Returns human-readable label for the detected or provided platform.
 */
export function getSystemPlatformLabel(platform?: TargetPlatform): string {
  const p = platform ?? detectSystemPlatform();
  switch (p) {
    case "mac":
      return "macOS";
    case "windows":
      return "Windows";
    case "linux":
      return "Linux";
  }
}

/**
 * Resolves the effective keyboard shortcut style ("mac" | "windows_linux")
 * taking into account the user preference override and system detection.
 *
 * Calling this inside a SolidJS reactive context (JSX, createMemo, createEffect)
 * will automatically track changes to userPreferences().
 */
export function getEffectivePlatformStyle(
  override?: PlatformShortcutStyle
): EffectivePlatformStyle {
  const pref = override ?? userPreferences()?.platformShortcutStyle ?? "auto";

  if (pref === "mac") {
    return "mac";
  }
  if (pref === "windows_linux") {
    return "windows_linux";
  }

  // When "auto", resolve to system platform
  const sys = detectSystemPlatform();
  return sys === "mac" ? "mac" : "windows_linux";
}

/**
 * Helper to determine whether the effective platform style is macOS.
 */
export function isMac(style?: EffectivePlatformStyle): boolean {
  return (style ?? getEffectivePlatformStyle()) === "mac";
}

/**
 * Primary modifier key symbol or label:
 * - macOS: "⌘"
 * - Windows / Linux: "Ctrl"
 */
export function getModSymbol(style?: EffectivePlatformStyle): string {
  return isMac(style) ? "⌘" : "Ctrl";
}

/**
 * Alternate / Option key symbol or label:
 * - macOS: "⌥"
 * - Windows / Linux: "Alt"
 */
export function getAltSymbol(style?: EffectivePlatformStyle): string {
  return isMac(style) ? "⌥" : "Alt";
}

/**
 * Shift key symbol or label:
 * - macOS: "⇧"
 * - Windows / Linux: "Shift"
 */
export function getShiftSymbol(style?: EffectivePlatformStyle): string {
  return isMac(style) ? "⇧" : "Shift";
}

/**
 * Enter / Return key symbol or label:
 * - macOS: "↩"
 * - Windows / Linux: "Enter"
 */
export function getEnterSymbol(style?: EffectivePlatformStyle): string {
  return isMac(style) ? "↩" : "Enter";
}

/**
 * Delete key symbol or label:
 * - macOS: "⌫"
 * - Windows / Linux: "Del"
 */
export function getDeleteSymbol(style?: EffectivePlatformStyle): string {
  return isMac(style) ? "⌫" : "Del";
}

/**
 * Backspace key symbol or label:
 * - macOS: "⌫"
 * - Windows / Linux: "Backspace"
 */
export function getBackspaceSymbol(style?: EffectivePlatformStyle): string {
  return isMac(style) ? "⌫" : "Backspace";
}

/**
 * Convenience aliases for quick labels in UI components
 */
export function modifierKeyLabel(style?: EffectivePlatformStyle): string {
  return getModSymbol(style);
}

export function enterKeyLabel(style?: EffectivePlatformStyle): string {
  return getEnterSymbol(style);
}

export function deleteKeyLabel(style?: EffectivePlatformStyle): string {
  return getDeleteSymbol(style);
}

/**
 * Formats a primary modifier + single key shortcut string.
 *
 * Examples:
 *   formatModKey("K") -> "⌘K" on macOS, "Ctrl+K" on Windows/Linux
 *   formatModKey(",") -> "⌘," on macOS, "Ctrl+," on Windows/Linux
 *   formatModKey("J") -> "⌘J" on macOS, "Ctrl+J" on Windows/Linux
 *   formatModKey("F") -> "⌘F" on macOS, "Ctrl+F" on Windows/Linux
 *   formatModKey("R") -> "⌘R" on macOS, "Ctrl+R" on Windows/Linux
 */
export function formatModKey(
  key: string,
  style?: EffectivePlatformStyle
): string {
  const effective = style ?? getEffectivePlatformStyle();
  if (effective === "mac") {
    return `⌘${key}`;
  }
  return `Ctrl+${key}`;
}

/**
 * Formats an arbitrary structured key combination.
 *
 * Example:
 *   formatKeyCombo({ mod: true, shift: true, key: "P" })
 *   -> "⇧⌘P" on macOS, "Ctrl+Shift+P" on Windows/Linux
 */
export function formatKeyCombo(
  combo: KeyCombo,
  style?: EffectivePlatformStyle
): string {
  const effective = style ?? getEffectivePlatformStyle();
  const mac = effective === "mac";

  // Normalize special key names
  let keyLabel = combo.key;
  const lowerKey = combo.key.toLowerCase();
  if (lowerKey === "enter" || lowerKey === "return") {
    keyLabel = mac ? "↩" : "Enter";
  } else if (lowerKey === "delete") {
    keyLabel = mac ? "⌫" : "Del";
  } else if (lowerKey === "backspace") {
    keyLabel = mac ? "⌫" : "Backspace";
  } else if (lowerKey === "escape" || lowerKey === "esc") {
    keyLabel = "Esc";
  }

  if (mac) {
    const parts: string[] = [];
    if (combo.alt) parts.push("⌥");
    if (combo.shift) parts.push("⇧");
    if (combo.mod || combo.meta || combo.ctrl) parts.push("⌘");
    parts.push(keyLabel);
    return parts.join("");
  } else {
    const parts: string[] = [];
    if (combo.mod || combo.ctrl || combo.meta) parts.push("Ctrl");
    if (combo.alt) parts.push("Alt");
    if (combo.shift) parts.push("Shift");
    parts.push(keyLabel);
    return parts.join("+");
  }
}

/**
 * Helper to dynamically format shortcut description strings containing
 * "⌘" or "Mod" tokens for tables and tooltip references.
 */
export function formatShortcutText(
  text: string,
  style?: EffectivePlatformStyle
): string {
  const effective = style ?? getEffectivePlatformStyle();
  if (effective === "mac") {
    return text.replace(/Mod\+/gi, "⌘");
  }
  return text
    .replace(/⌘([A-Za-z0-9,])/g, "Ctrl+$1")
    .replace(/Mod\+/gi, "Ctrl+");
}
