import { assert, createHarness, TestSuite } from "./harness.js";

const suite = new TestSuite("Challenger M1-1: Adversarial Challenge & Empirical Verification");

let harness;
let cdp;

suite.beforeAll(async () => {
  harness = await createHarness();
  cdp = harness.cdp;
  await cdp.setViewport(1280, 800);
});

suite.afterAll(async () => {
  if (harness) {
    await harness.teardown();
  }
});

// ============================================================================
// 1. EMPIRICAL PLATFORM DETECTION & SIMULATION HARNESS
// ============================================================================

suite.test("Platform Detection: Correctly classifies Linux, Windows, macOS, and edge cases", async () => {
  const result = await cdp.evaluate(`
    (async () => {
      const platformMod = await import('/src/lib/platform.ts');
      const { detectSystemPlatform } = platformMod;

      const testCases = [
        // Linux variants
        [{ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }, "linux", "Linux x86_64 desktop"],
        [{ platform: "Linux aarch64", userAgent: "Mozilla/5.0 (X11; Ubuntu; Linux aarch64)" }, "linux", "Linux ARM64"],
        [{ platform: "Linux i686", userAgent: "Mozilla/5.0 (X11; Linux i686)" }, "linux", "Linux 32-bit"],
        [{ userAgentData: { platform: "Linux" } }, "linux", "Chromium userAgentData Linux"],

        // Windows variants
        [{ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, "windows", "Windows 10/11 Win32"],
        [{ platform: "Win64", userAgent: "Mozilla/5.0 (Windows NT 10.0; WOW64)" }, "windows", "Windows WOW64 Win64"],
        [{ platform: "Windows", userAgent: "Mozilla/5.0 (Windows NT 6.1)" }, "windows", "Windows legacy"],
        [{ userAgentData: { platform: "Windows" } }, "windows", "Chromium userAgentData Windows"],

        // macOS variants
        [{ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }, "mac", "macOS Intel/Apple Silicon"],
        [{ platform: "MacPPC", userAgent: "Mozilla/5.0 (Macintosh; PPC Mac OS X)" }, "mac", "macOS PowerPC legacy"],
        [{ userAgentData: { platform: "macOS" } }, "mac", "Chromium userAgentData macOS"],
        [{ platform: "MacIntel", userAgentData: { platform: "macOS" } }, "mac", "macOS combined"],

        // Edge cases and fallbacks
        [{ platform: "", userAgent: "" }, "linux", "Empty navigator strings fallback"],
        [{ platform: "FreeBSD", userAgent: "Mozilla/5.0 (FreeBSD; Vbox)" }, "linux", "FreeBSD fallback to linux"],
        [{ platform: "SunOS", userAgent: "Mozilla/5.0 (SunOS sun4u)" }, "linux", "SunOS fallback to linux"],
      ];

      const originalPlatform = navigator.platform;
      const originalUserAgent = navigator.userAgent;
      const originalUserAgentData = navigator.userAgentData;

      const failures = [];

      for (const [mockNav, expected, desc] of testCases) {
        Object.defineProperty(navigator, 'platform', {
          value: mockNav.platform !== undefined ? mockNav.platform : originalPlatform,
          configurable: true,
        });
        Object.defineProperty(navigator, 'userAgent', {
          value: mockNav.userAgent !== undefined ? mockNav.userAgent : originalUserAgent,
          configurable: true,
        });
        Object.defineProperty(navigator, 'userAgentData', {
          value: mockNav.userAgentData !== undefined ? mockNav.userAgentData : undefined,
          configurable: true,
        });

        const detected = detectSystemPlatform();
        if (detected !== expected) {
          failures.push({ desc, expected, actual: detected });
        }
      }

      // Restore
      Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true });
      Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true });
      Object.defineProperty(navigator, 'userAgentData', { value: originalUserAgentData, configurable: true });

      return { pass: failures.length === 0, failures };
    })()
  `);

  assert.strictEqual(result.pass, true, `Platform detection failed cases: ${JSON.stringify(result.failures)}`);
});

// ============================================================================
// 2. SHORTCUT FORMATTING ORACLE & BOUNDARY HARNESS
// ============================================================================

suite.test("Shortcut Formatting: Modifiers and symbol oracle for macOS vs Windows/Linux", async () => {
  const result = await cdp.evaluate(`
    (async () => {
      const p = await import('/src/lib/platform.ts');
      const checks = [];

      // Mod symbols
      checks.push(p.getModSymbol("mac") === "⌘");
      checks.push(p.getModSymbol("windows_linux") === "Ctrl");
      checks.push(p.getAltSymbol("mac") === "⌥");
      checks.push(p.getAltSymbol("windows_linux") === "Alt");
      checks.push(p.getShiftSymbol("mac") === "⇧");
      checks.push(p.getShiftSymbol("windows_linux") === "Shift");
      checks.push(p.getEnterSymbol("mac") === "↩");
      checks.push(p.getEnterSymbol("windows_linux") === "Enter");
      checks.push(p.getDeleteSymbol("mac") === "⌫");
      checks.push(p.getDeleteSymbol("windows_linux") === "Del");
      checks.push(p.getBackspaceSymbol("mac") === "⌫");
      checks.push(p.getBackspaceSymbol("windows_linux") === "Backspace");

      // formatModKey
      checks.push(p.formatModKey("K", "mac") === "⌘K");
      checks.push(p.formatModKey("K", "windows_linux") === "Ctrl+K");
      checks.push(p.formatModKey(",", "mac") === "⌘,");
      checks.push(p.formatModKey(",", "windows_linux") === "Ctrl+,");
      checks.push(p.formatModKey("J", "mac") === "⌘J");
      checks.push(p.formatModKey("J", "windows_linux") === "Ctrl+J");
      checks.push(p.formatModKey("F", "mac") === "⌘F");
      checks.push(p.formatModKey("F", "windows_linux") === "Ctrl+F");
      checks.push(p.formatModKey("R", "mac") === "⌘R");
      checks.push(p.formatModKey("R", "windows_linux") === "Ctrl+R");

      // formatKeyCombo
      checks.push(p.formatKeyCombo({ mod: true, shift: true, key: "P" }, "mac") === "⇧⌘P");
      checks.push(p.formatKeyCombo({ mod: true, shift: true, key: "P" }, "windows_linux") === "Ctrl+Shift+P");
      checks.push(p.formatKeyCombo({ mod: true, alt: true, shift: true, key: "N" }, "mac") === "⌥⇧⌘N");
      checks.push(p.formatKeyCombo({ mod: true, alt: true, shift: true, key: "N" }, "windows_linux") === "Ctrl+Alt+Shift+N");
      checks.push(p.formatKeyCombo({ mod: true, key: "Backspace" }, "mac") === "⌘⌫");
      checks.push(p.formatKeyCombo({ mod: true, key: "Backspace" }, "windows_linux") === "Ctrl+Backspace");
      checks.push(p.formatKeyCombo({ key: "Enter" }, "mac") === "↩");
      checks.push(p.formatKeyCombo({ key: "Enter" }, "windows_linux") === "Enter");
      checks.push(p.formatKeyCombo({ key: "Escape" }, "mac") === "Esc");
      checks.push(p.formatKeyCombo({ key: "Escape" }, "windows_linux") === "Esc");

      return { allPass: checks.every(Boolean), checks };
    })()
  `);

  assert.strictEqual(result.allPass, true, `Some shortcut formatting checks failed: ${JSON.stringify(result)}`);
});

suite.test("Shortcut Text Replacement: formatShortcutText behavior and character boundaries", async () => {
  const result = await cdp.evaluate(`
    (async () => {
      const p = await import('/src/lib/platform.ts');
      return {
        macModK: p.formatShortcutText("Mod+K", "mac"),
        winModK: p.formatShortcutText("Mod+K", "windows_linux"),
        winModComma: p.formatShortcutText("Mod+,", "windows_linux"),
        winMacCombo: p.formatShortcutText("⌘K or ⌘,", "windows_linux"),
        winBracket: p.formatShortcutText("⌘[", "windows_linux"),
        winSlash: p.formatShortcutText("⌘/", "windows_linux"),
      };
    })()
  `);

  assert.strictEqual(result.macModK, "⌘K");
  assert.strictEqual(result.winModK, "Ctrl+K");
  assert.strictEqual(result.winModComma, "Ctrl+,");
  assert.strictEqual(result.winMacCombo, "Ctrl+K or Ctrl+,");
  // Adversarial note on boundaries:
  // Regex /⌘([A-Za-z0-9,])/g only matches alphanumeric + comma.
  // "⌘[" does not match [A-Za-z0-9,] so it stays "⌘["
  assert.strictEqual(result.winBracket, "⌘[", "formatShortcutText leaves ⌘[ untouched due to character class [A-Za-z0-9,]");
});

// ============================================================================
// 3. DYNAMIC DOM REACTIVITY WITHOUT RELOAD IN LIVE CHROMIUM
// ============================================================================

suite.test("Dynamic DOM Reactivity: preference update to 'mac' reflects immediately WITHOUT reload", async () => {
  // Call updateUserPreferences directly in browser runtime context without page reload
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.updateUserPreferences({ platformShortcutStyle: 'mac' });
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));

  // 1. Verify TopBar Quick Add search kbd has reactively updated to ⌘K
  const topBarKbd = await cdp.evaluate(`
    (() => {
      const kbds = Array.from(document.querySelectorAll('header kbd'));
      const k = kbds.find(el => el.textContent?.includes('K'));
      return k ? k.textContent?.trim() : null;
    })()
  `);
  assert.strictEqual(
    topBarKbd,
    "⌘K",
    `TopBar kbd should reactively become ⌘K without page reload, got: ${topBarKbd}`
  );

  // 2. Verify TopBar Settings button title attribute
  const settingsTitle = await cdp.evaluate(`
    document.querySelector('header button[title*="Settings"]')?.getAttribute('title')
  `);
  assert.ok(
    settingsTitle?.includes("⌘,"),
    `TopBar settings title should reactively contain ⌘,, got: ${settingsTitle}`
  );

  // 3. Verify LeftSidebar footer kbd
  const leftSidebarKbd = await cdp.evaluate(`
    (() => {
      const kbds = Array.from(document.querySelectorAll('aside.w-64 kbd'));
      const k = kbds.find(el => el.textContent?.includes(',') || el.textContent?.includes('⌘') || el.textContent?.includes('Ctrl'));
      return k ? k.textContent?.trim() : null;
    })()
  `);
  assert.strictEqual(
    leftSidebarKbd,
    "⌘,",
    `LeftSidebar kbd should reactively become ⌘, without page reload, got: ${leftSidebarKbd}`
  );
});

suite.test("Dynamic DOM Reactivity: preference update to 'windows_linux' reflects immediately WITHOUT reload", async () => {
  // Switch to 'windows_linux' live without reload
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.updateUserPreferences({ platformShortcutStyle: 'windows_linux' });
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));

  // 1. TopBar kbd
  const topBarKbd = await cdp.evaluate(`
    (() => {
      const kbds = Array.from(document.querySelectorAll('header kbd'));
      const k = kbds.find(el => el.textContent?.includes('K'));
      return k ? k.textContent?.trim() : null;
    })()
  `);
  assert.strictEqual(
    topBarKbd,
    "Ctrl+K",
    `TopBar kbd should reactively become Ctrl+K without page reload, got: ${topBarKbd}`
  );

  // 2. LeftSidebar footer kbd
  const leftSidebarKbd = await cdp.evaluate(`
    (() => {
      const kbds = Array.from(document.querySelectorAll('aside.w-64 kbd'));
      const k = kbds.find(el => el.textContent?.includes(',') || el.textContent?.includes('⌘') || el.textContent?.includes('Ctrl'));
      return k ? k.textContent?.trim() : null;
    })()
  `);
  assert.strictEqual(
    leftSidebarKbd,
    "Ctrl+,",
    `LeftSidebar kbd should reactively become Ctrl+, without page reload, got: ${leftSidebarKbd}`
  );
});

suite.test("Dynamic DOM Reactivity: CommandPalette and SettingsView reflect live style changes", async () => {
  // Set to 'mac' style
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.updateUserPreferences({ platformShortcutStyle: 'mac' });
      store.openCommandPalette('nlp');
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  const paletteText = await cdp.evaluate(`
    document.querySelector('.fixed.inset-0')?.innerText || ''
  `);
  assert.ok(paletteText.includes("⌘F"), `CommandPalette should render ⌘F when style is mac, got: ${paletteText}`);
  assert.ok(paletteText.includes("⌘J"), `CommandPalette should render ⌘J when style is mac, got: ${paletteText}`);
  assert.ok(paletteText.includes("⌘R"), `CommandPalette should render ⌘R when style is mac, got: ${paletteText}`);
  assert.ok(paletteText.includes("⌘,"), `CommandPalette should render ⌘, when style is mac, got: ${paletteText}`);

  // Close CommandPalette
  await cdp.evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  `);
  await new Promise((r) => setTimeout(r, 200));

  // Switch back to 'windows_linux'
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.updateUserPreferences({ platformShortcutStyle: 'windows_linux' });
    })()
  `);
  await new Promise((r) => setTimeout(r, 100));

  // Re-open CommandPalette
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.openCommandPalette('nlp');
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  const paletteTextWin = await cdp.evaluate(`
    document.querySelector('.fixed.inset-0')?.innerText || ''
  `);
  assert.ok(paletteTextWin.includes("Ctrl+F"), `CommandPalette should render Ctrl+F when style is windows_linux`);
  assert.ok(paletteTextWin.includes("Ctrl+J"), `CommandPalette should render Ctrl+J when style is windows_linux`);
  assert.ok(paletteTextWin.includes("Ctrl+R"), `CommandPalette should render Ctrl+R when style is windows_linux`);

  // Close CommandPalette
  await cdp.evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  `);
  await new Promise((r) => setTimeout(r, 200));

  // Reset to 'auto'
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.updateUserPreferences({ platformShortcutStyle: 'auto' });
    })()
  `);
  await new Promise((r) => setTimeout(r, 100));
});

// ============================================================================
// 4. VERIFY WORKER CLAIMS: SettingsView UI DROPDOWN PRESENCE AUDIT
// ============================================================================

suite.test("Worker Claim Audit: Is 'Platform Shortcut Style' dropdown present in Settings UI?", async () => {
  // Open settings
  await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b => b.innerText.includes('Settings'));
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  // Check if any select or label in settings controls platformShortcutStyle
  const audit = await cdp.evaluate(`
    (() => {
      const labels = Array.from(document.querySelectorAll('label, h3, div')).map(el => el.textContent?.trim());
      const hasLabel = labels.some(t => t?.includes('Platform Shortcut Style') || t?.includes('Shortcut Style'));
      const selects = Array.from(document.querySelectorAll('select')).map(s => Array.from(s.options).map(o => o.text).join(' '));
      const hasOptions = selects.some(s => s.includes('Auto-detect') || s.includes('macOS (⌘)'));
      return { hasLabel, hasOptions };
    })()
  `);

  // Close settings
  await cdp.evaluate(`
    (() => {
      const backBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Back to Calendar') || b.innerText.includes('Return to Calendar'));
      if (backBtn) backBtn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));

  // Document that the UI dropdown claimed in Worker M1 handoff is NOT in SettingsView.tsx
  assert.strictEqual(
    audit.hasLabel || audit.hasOptions,
    false,
    "Audit confirms: SettingsView currently does NOT contain the 'Platform Shortcut Style' UI dropdown claimed in Worker M1 handoff (deferred to Milestone 2 Feature 9)"
  );
});

// ============================================================================
// 5. KEYBINDING & SHORTCUT LABEL CROSS-ALIGNMENT VERIFICATION
// ============================================================================

suite.test("Keybinding Cross-Alignment: Dispatched events match UI advertised shortcuts", async () => {
  // 1. Test Ctrl+K opens CommandPalette
  await cdp.evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  `);
  await new Promise((r) => setTimeout(r, 200));
  let isPaletteOpen = await cdp.evaluate(`Boolean(document.querySelector('.fixed.inset-0'))`);
  assert.strictEqual(isPaletteOpen, true, "Ctrl+K must open CommandPalette");

  // 2. Test Escape closes CommandPalette
  await cdp.evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  `);
  await new Promise((r) => setTimeout(r, 200));
  isPaletteOpen = await cdp.evaluate(`Boolean(document.querySelector('.fixed.inset-0'))`);
  assert.strictEqual(isPaletteOpen, false, "Escape must close CommandPalette");

  // 3. Test Meta+K (Cmd+K) also opens CommandPalette (cross-platform handling)
  await cdp.evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
  `);
  await new Promise((r) => setTimeout(r, 200));
  isPaletteOpen = await cdp.evaluate(`Boolean(document.querySelector('.fixed.inset-0'))`);
  assert.strictEqual(isPaletteOpen, true, "Meta+K (Cmd+K) must open CommandPalette");

  // Close
  await cdp.evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  `);
  await new Promise((r) => setTimeout(r, 200));

  // 4. Test single key hotkeys: D (Day view), W (Week view), M (Month view)
  await cdp.evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
  `);
  await new Promise((r) => setTimeout(r, 200));
  let activeView = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      return store.viewMode();
    })()
  `);
  assert.strictEqual(activeView, "day", "Key 'd' should switch viewMode to 'day'");

  await cdp.evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
  `);
  await new Promise((r) => setTimeout(r, 200));
  activeView = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      return store.viewMode();
    })()
  `);
  assert.strictEqual(activeView, "month", "Key 'm' should switch viewMode to 'month'");

  // Reset to week
  await cdp.evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
  `);
  await new Promise((r) => setTimeout(r, 200));
});

if (process.argv[1]?.endsWith("m1_empirical_challenge.test.js")) {
  suite.run().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}

export { suite };
