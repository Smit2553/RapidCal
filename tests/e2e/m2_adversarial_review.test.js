import { assert, createHarness, TestSuite } from "./harness.js";

const suite = new TestSuite("Reviewer M2-2: Adversarial Stress Test & Schema Validation");

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
// 1. SCHEMA VALIDATION & PREFERENCES IMPORT/EXPORT ORACLE
// ============================================================================

suite.test("Schema Validation: Rejects malformed JSON and out-of-boundary values", async () => {
  const result = await cdp.evaluate(`
    (async () => {
      const io = await import('/src/lib/preferencesIo.ts');
      const { validatePreferencesImport } = io;

      const results = [];

      // Malformed JSON syntax
      const r1 = validatePreferencesImport("{ invalid json ");
      results.push({ test: "syntax error", pass: !r1.ok && r1.error.includes("Invalid JSON") });

      // Non-object root
      const r2 = validatePreferencesImport("null");
      results.push({ test: "null root", pass: !r2.ok });
      const r3 = validatePreferencesImport("[1, 2, 3]");
      results.push({ test: "array root", pass: !r3.ok });

      // Invalid defaultView
      const r4 = validatePreferencesImport(JSON.stringify({ defaultView: "invalid_view" }));
      results.push({ test: "invalid defaultView", pass: !r4.ok && r4.error.includes("defaultView") });

      // Invalid timeFormat
      const r5 = validatePreferencesImport(JSON.stringify({ timeFormat: "48h" }));
      results.push({ test: "invalid timeFormat", pass: !r5.ok && r5.error.includes("timeFormat") });

      // Invalid weekStartsOn
      const r6 = validatePreferencesImport(JSON.stringify({ weekStartsOn: "tuesday" }));
      results.push({ test: "invalid weekStartsOn", pass: !r6.ok && r6.error.includes("weekStartsOn") });

      // Out-of-bounds defaultEventDurationMins (< 5 or > 480)
      const r7 = validatePreferencesImport(JSON.stringify({ defaultEventDurationMins: 2 }));
      results.push({ test: "duration too small", pass: !r7.ok && r7.error.includes("defaultEventDurationMins") });
      const r8 = validatePreferencesImport(JSON.stringify({ defaultEventDurationMins: 600 }));
      results.push({ test: "duration too large", pass: !r8.ok && r8.error.includes("defaultEventDurationMins") });

      // Out-of-bounds working hours
      const r9 = validatePreferencesImport(JSON.stringify({ workingHoursStart: -1 }));
      results.push({ test: "negative workingHoursStart", pass: !r9.ok });
      const r10 = validatePreferencesImport(JSON.stringify({ workingHoursStart: 18, workingHoursEnd: 9 }));
      results.push({ test: "workingHoursEnd <= workingHoursStart", pass: !r10.ok && r10.error.includes("greater than") });

      // Out-of-bounds hourHeight (< 40 or > 96)
      const r11 = validatePreferencesImport(JSON.stringify({ hourHeight: 30 }));
      results.push({ test: "hourHeight below 40", pass: !r11.ok && r11.error.includes("hourHeight") });
      const r12 = validatePreferencesImport(JSON.stringify({ hourHeight: 120 }));
      results.push({ test: "hourHeight above 96", pass: !r12.ok && r12.error.includes("hourHeight") });

      // Invalid gridDensity
      const r13 = validatePreferencesImport(JSON.stringify({ gridDensity: "ultra-dense" }));
      results.push({ test: "invalid gridDensity", pass: !r13.ok && r13.error.includes("gridDensity") });

      // Invalid platformShortcutStyle
      const r14 = validatePreferencesImport(JSON.stringify({ platformShortcutStyle: "android" }));
      results.push({ test: "invalid platformShortcutStyle", pass: !r14.ok && r14.error.includes("platformShortcutStyle") });

      return { allPassed: results.every(r => r.pass), results };
    })()
  `);

  assert.strictEqual(
    result.allPassed,
    true,
    `Adversarial schema validation failed cases: ${JSON.stringify(result.results.filter(r => !r.pass))}`
  );
});

suite.test("Export & Import Roundtrip: Valid envelope imports cleanly and applies updates", async () => {
  const result = await cdp.evaluate(`
    (async () => {
      const io = await import('/src/lib/preferencesIo.ts');
      const store = await import('/src/store/calendarStore.ts');

      // 1. Generate export
      const exportedJson = io.generatePreferencesExportJson();
      const envelope = JSON.parse(exportedJson);

      if (envelope.app !== "RapidCal" || envelope.schemaVersion !== 1 || !envelope.preferences) {
        return { pass: false, reason: "Envelope format invalid" };
      }

      // 2. Validate export payload
      const validation = io.validatePreferencesImport(exportedJson);
      if (!validation.ok) {
        return { pass: false, reason: "Self-validation of exported JSON failed: " + validation.error };
      }

      // 3. Import modified preferences
      const testImportPayload = JSON.stringify({
        schemaVersion: 1,
        preferences: {
          defaultView: "3day",
          timeFormat: "24h",
          gridDensity: "spacious",
          hourHeight: 72,
          workingHoursStart: 7,
          workingHoursEnd: 19
        }
      });
      const validTest = io.validatePreferencesImport(testImportPayload);
      if (!validTest.ok) {
        return { pass: false, reason: "Valid test payload failed: " + validTest.error };
      }

      await io.applyImportedPreferences(validTest);

      const updatedPrefs = store.userPreferences();
      const pass =
        updatedPrefs.defaultView === "3day" &&
        updatedPrefs.timeFormat === "24h" &&
        updatedPrefs.gridDensity === "spacious" &&
        updatedPrefs.hourHeight === 72 &&
        updatedPrefs.workingHoursStart === 7 &&
        updatedPrefs.workingHoursEnd === 19;

      // Restore defaults
      store.updateUserPreferences({
        defaultView: "week",
        timeFormat: "12h",
        gridDensity: "standard",
        hourHeight: 56,
        workingHoursStart: 8,
        workingHoursEnd: 17
      });

      return { pass, updatedPrefs };
    })()
  `);

  assert.strictEqual(result.pass, true, `Roundtrip import failed: ${JSON.stringify(result)}`);
});

// ============================================================================
// 2. TIME-GRID DYNAMIC RESIZING & PROPORTIONAL SCROLL
// ============================================================================

suite.test("Time-Grid Density: hourHeightPx updates dynamically across presets and slider", async () => {
  // Ensure we are in week view
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.setViewMode('week');
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));

  // 1. Test Compact preset (44px)
  const compactCheck = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.setGridDensity('compact');
      await new Promise(r => setTimeout(r, 100));

      // The time grid container has both .flex-1 and .overflow-y-auto
      const gridContainer = document.querySelector('div.flex-1.overflow-y-auto');
      const gutter = gridContainer?.querySelector('div.shrink-0');
      const hourRows = Array.from(gutter?.children || []);
      const firstRowH = hourRows[0]?.getBoundingClientRect().height;
      const totalGutterH = gutter?.getBoundingClientRect().height;

      return {
        storeHeight: store.hourHeightPx(),
        firstRowH: Math.round(firstRowH || 0),
        totalGutterH: Math.round(totalGutterH || 0),
      };
    })()
  `);
  assert.strictEqual(compactCheck.storeHeight, 44, "store.hourHeightPx() should be 44 in compact mode");
  assert.strictEqual(compactCheck.firstRowH, 44, "First hour row in gutter should be 44px");
  assert.strictEqual(compactCheck.totalGutterH, 24 * 44, "Total gutter height should be 24 * 44 = 1056px");

  // 2. Test Spacious preset (72px)
  const spaciousCheck = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.setGridDensity('spacious');
      await new Promise(r => setTimeout(r, 100));

      const gridContainer = document.querySelector('div.flex-1.overflow-y-auto');
      const gutter = gridContainer?.querySelector('div.shrink-0');
      const hourRows = Array.from(gutter?.children || []);
      const firstRowH = hourRows[0]?.getBoundingClientRect().height;
      const totalGutterH = gutter?.getBoundingClientRect().height;

      return {
        storeHeight: store.hourHeightPx(),
        firstRowH: Math.round(firstRowH || 0),
        totalGutterH: Math.round(totalGutterH || 0),
      };
    })()
  `);
  assert.strictEqual(spaciousCheck.storeHeight, 72, "store.hourHeightPx() should be 72 in spacious mode");
  assert.strictEqual(spaciousCheck.firstRowH, 72, "First hour row in gutter should be 72px");
  assert.strictEqual(spaciousCheck.totalGutterH, 24 * 72, "Total gutter height should be 24 * 72 = 1728px");

  // 3. Test Proportional Scroll Preservation
  const scrollCheck = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      const container = document.querySelector('div.flex-1.overflow-y-auto');
      if (!container) return { pass: false, reason: "scroll container missing" };

      // Set to standard (56px) and scroll to 560px (hour 10)
      store.setHourHeight(56);
      await new Promise(r => setTimeout(r, 50));
      container.scrollTop = 560;

      // Scale up to 72px (ratio = 72 / 56 = 1.2857)
      store.setHourHeight(72);
      await new Promise(r => setTimeout(r, 100));
      const scaledScrollTop = container.scrollTop;
      const expectedScrollTop = Math.round(560 * (72 / 56)); // 720px

      // Reset to standard
      store.setHourHeight(56);

      return {
        pass: Math.abs(scaledScrollTop - expectedScrollTop) <= 2,
        scaledScrollTop,
        expectedScrollTop
      };
    })()
  `);
  assert.strictEqual(
    scrollCheck.pass,
    true,
    `Scroll position should scale proportionally: got ${scrollCheck.scaledScrollTop}, expected ${scrollCheck.expectedScrollTop}`
  );
});

// ============================================================================
// 3. SETTINGSVIEW ADVANCED TAB POWER CONTROLS
// ============================================================================

suite.test("SettingsView Advanced Tab: All power-user sections render with interactive controls", async () => {
  const sectionsCheck = await cdp.evaluate(`
    (async () => {
      // Click Settings in TopBar
      const settingsBtn = Array.from(document.querySelectorAll("header button")).find(b =>
        b.innerText.toLowerCase().includes("setting") || b.getAttribute("title")?.toLowerCase().includes("setting")
      );
      if (!settingsBtn) return { error: "Settings button not found" };
      settingsBtn.click();
      await new Promise(r => setTimeout(r, 400));

      // Click Advanced in Settings nav
      const navButtons = Array.from(document.querySelectorAll("nav button"));
      const advTab = navButtons.find(b => b.innerText.toLowerCase().includes("advanced"));
      if (!advTab) return { error: "Advanced tab button not found in nav" };
      advTab.click();
      await new Promise(r => setTimeout(r, 400));

      const upper = document.body.innerText.toUpperCase();
      return {
        oauthSection: upper.includes("DEVELOPER OAUTH CREDENTIALS"),
        syncSection: upper.includes("SYNC POLLING FREQUENCY & TIMING"),
        shortcutSection: upper.includes("PLATFORM SHORTCUT STYLE OVERRIDE"),
        densitySection: upper.includes("TIME-GRID DENSITY & SCALING"),
        diagnosticsSection: upper.includes("SYNC QUEUE & OUTBOX DIAGNOSTICS"),
        backupSection: upper.includes("PREFERENCES BACKUP & PORTABILITY"),
        dangerSection: upper.includes("RESET SAMPLE DATASET & LOCAL STORAGE")
      };
    })()
  `);

  assert.strictEqual(sectionsCheck.oauthSection, true, "OAuth section must be present in Advanced tab");
  assert.strictEqual(sectionsCheck.syncSection, true, "Sync polling section must be present in Advanced tab");
  assert.strictEqual(sectionsCheck.shortcutSection, true, "Platform shortcut override section must be present in Advanced tab");
  assert.strictEqual(sectionsCheck.densitySection, true, "Grid density section must be present in Advanced tab");
  assert.strictEqual(sectionsCheck.diagnosticsSection, true, "Outbox diagnostics section must be present in Advanced tab");
  assert.strictEqual(sectionsCheck.backupSection, true, "Preferences backup section must be present in Advanced tab");
  assert.strictEqual(sectionsCheck.dangerSection, true, "Reset sample dataset danger zone must be present in Advanced tab");

  // Close Settings
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.closeSettings();
    })()
  `);
  // Close Settings
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.closeSettings();
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));
});

if (process.argv[1]?.endsWith("m2_adversarial_review.test.js")) {
  suite.run().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}

export { suite };
