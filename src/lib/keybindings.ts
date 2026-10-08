import {
  accountsModalOpen,
  closeSettings,
  commandPaletteOpen,
  deleteEventOptimistic,
  joinActiveOrNextMeeting,
  jumpToday,
  leftSidebarOpen,
  openCommandPalette,
  openSettings,
  rightInspectorOpen,
  selectedEvent,
  setAccountsModalOpen,
  setCommandPaletteOpen,
  setLeftSidebarOpen,
  setRightInspectorOpen,
  setViewMode,
  stepDate,
  triggerSyncNowAction,
  viewMode,
} from "../store/calendarStore";

export function registerGlobalKeybindings(): () => void {
  const handler = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const isInput =
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable);

    const mod = e.metaKey || e.ctrlKey;

    // Cmd/Ctrl + , -> Open or close Settings
    if (mod && e.key === ",") {
      e.preventDefault();
      if (viewMode() === "settings") {
        closeSettings();
      } else {
        openSettings("general");
      }
      return;
    }

    // Cmd/Ctrl + K -> Command Bar & Quick Add
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (commandPaletteOpen()) {
        setCommandPaletteOpen(false);
      } else {
        openCommandPalette("nlp");
      }
      return;
    }

    // Cmd/Ctrl + F -> Search Events
    if (mod && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openCommandPalette("search");
      return;
    }

    // Cmd/Ctrl + J -> Join Active or Upcoming Meeting
    if (mod && e.key.toLowerCase() === "j") {
      e.preventDefault();
      joinActiveOrNextMeeting();
      return;
    }

    // Cmd/Ctrl + R -> Sync Calendars
    if (mod && e.key.toLowerCase() === "r") {
      e.preventDefault();
      void triggerSyncNowAction();
      return;
    }

    // Escape closes modals or returns from Settings
    if (e.key === "Escape") {
      if (commandPaletteOpen()) {
        setCommandPaletteOpen(false);
        return;
      }
      if (accountsModalOpen()) {
        setAccountsModalOpen(false);
        return;
      }
      if (viewMode() === "settings" && !isInput) {
        closeSettings();
        return;
      }
    }

    // Ignore single-key hotkeys when typing in inputs or when modal is open
    if (isInput || mod || e.altKey || commandPaletteOpen() || accountsModalOpen()) {
      return;
    }

    switch (e.key.toLowerCase()) {
      case "d":
        e.preventDefault();
        setViewMode("day");
        break;
      case "3":
        e.preventDefault();
        setViewMode("3day");
        break;
      case "5":
        e.preventDefault();
        setViewMode("workweek");
        break;
      case "w":
        e.preventDefault();
        setViewMode("week");
        break;
      case "m":
        e.preventDefault();
        setViewMode("month");
        break;
      case "a":
        e.preventDefault();
        setViewMode("agenda");
        break;
      case "t":
        e.preventDefault();
        jumpToday();
        break;
      case "c":
        e.preventDefault();
        openCommandPalette("nlp");
        break;
      case "[":
        e.preventDefault();
        setLeftSidebarOpen(!leftSidebarOpen());
        break;
      case "]":
        e.preventDefault();
        setRightInspectorOpen(!rightInspectorOpen());
        break;
      case "arrowleft":
      case "h":
        e.preventDefault();
        stepDate(-1);
        break;
      case "arrowright":
      case "l":
        e.preventDefault();
        stepDate(1);
        break;
      case "backspace":
      case "delete": {
        const sel = selectedEvent();
        if (sel) {
          e.preventDefault();
          void deleteEventOptimistic(sel, sel.isRecurring ? "single" : "all");
        }
        break;
      }
      default:
        break;
    }
  };

  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
