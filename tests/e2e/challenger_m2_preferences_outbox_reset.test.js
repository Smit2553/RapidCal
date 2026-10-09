import { assert, createHarness, TestSuite } from "./harness.js";

const suite = new TestSuite("Challenger M2-2: Preferences IO, Outbox Diagnostics & Dataset Reset");

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

suite.afterEach(async () => {
  // Ensure any lingering submodal is dismissed so subsequent tests start in a clean state
  await cdp.evaluate(`
    (() => {
      const submodal = document.querySelector('.fixed.inset-0.z-50');
      if (submodal) {
        const dismissBtn = Array.from(submodal.querySelectorAll('button')).find(b =>
          b.innerText.includes('Done') || b.innerText.includes('Cancel') || b.innerText.includes('Close')
        );
        dismissBtn?.click();
      }
    })()
  `);
  await new Promise((r) => setTimeout(r, 100));
});

// Helper to open Settings dialog and switch to "advanced" tab
async function openAdvancedSettingsTab() {
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.openSettings('advanced');
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));
}

// ============================================================================
// 1. PREFERENCES EXPORT ENVELOPE STRUCTURAL INTEGRITY
// ============================================================================

suite.test("Preferences Export: Valid schema envelope and comprehensive fields", async () => {
  const result = await cdp.evaluate(`
    (async () => {
      const { generatePreferencesExportJson } = await import('/src/lib/preferencesIo.ts');
      const store = await import('/src/store/calendarStore.ts');

      const rawJson = generatePreferencesExportJson();
      let parsed;
      try {
        parsed = JSON.parse(rawJson);
      } catch (err) {
        return { ok: false, error: 'JSON parse failure: ' + err.message };
      }

      // Check root envelope properties
      if (parsed.$schema !== "https://rapidcal.local/schemas/preferences.v1.json") {
        return { ok: false, error: 'Incorrect $schema: ' + parsed.$schema };
      }
      if (parsed.app !== "RapidCal") {
        return { ok: false, error: 'Incorrect app name: ' + parsed.app };
      }
      if (parsed.schemaVersion !== 1) {
        return { ok: false, error: 'schemaVersion must be 1, got ' + parsed.schemaVersion };
      }
      if (!parsed.exportedAt || isNaN(new Date(parsed.exportedAt).getTime())) {
        return { ok: false, error: 'exportedAt is not a valid ISO date string: ' + parsed.exportedAt };
      }
      if (parsed.theme !== "dark" && parsed.theme !== "light") {
        return { ok: false, error: 'Invalid theme: ' + parsed.theme };
      }

      // Check preferences block
      const prefs = parsed.preferences;
      if (!prefs || typeof prefs !== "object") {
        return { ok: false, error: 'Missing preferences object in envelope' };
      }

      const requiredPrefKeys = [
        "defaultView",
        "timeFormat",
        "weekStartsOn",
        "defaultEventDurationMins",
        "workingHoursStart",
        "workingHoursEnd",
        "showSecondaryTimezone",
        "highlightWeekends",
        "platformShortcutStyle",
        "gridDensity",
        "hourHeight",
      ];

      for (const key of requiredPrefKeys) {
        if (!(key in prefs)) {
          return { ok: false, error: 'Missing preference key in export: ' + key };
        }
      }

      // Check oauthConfig block
      const oauth = parsed.oauthConfig;
      if (!oauth || typeof oauth !== "object") {
        return { ok: false, error: 'Missing oauthConfig object in envelope' };
      }
      if (typeof oauth.googleClientId !== "string" || typeof oauth.msClientId !== "string") {
        return { ok: false, error: 'Missing oauth client IDs in export' };
      }

      return { ok: true, envelope: parsed };
    })()
  `);

  assert.strictEqual(result.ok, true, `Preferences export envelope verification failed: ${result.error}`);
  assert.strictEqual(result.envelope.$schema, "https://rapidcal.local/schemas/preferences.v1.json");
  assert.strictEqual(result.envelope.app, "RapidCal");
  assert.strictEqual(result.envelope.schemaVersion, 1);
});

// ============================================================================
// 2. ADVERSARIAL SCHEMA VALIDATION FOR IMPORT
// ============================================================================

suite.test("Preferences Import: Rejects syntax errors, malformed payloads, and non-object roots", async () => {
  const result = await cdp.evaluate(`
    (async () => {
      const { validatePreferencesImport } = await import('/src/lib/preferencesIo.ts');

      const malformedCases = [
        { payload: "", desc: "Empty string" },
        { payload: "   ", desc: "Whitespace only" },
        { payload: "{", desc: "Unclosed brace" },
        { payload: "{ badJson: true }", desc: "Unquoted keys" },
        { payload: "['unclosed'", desc: "Unclosed bracket" },
        { payload: "null", desc: "Null primitive" },
        { payload: "12345", desc: "Number primitive" },
        { payload: "true", desc: "Boolean primitive" },
        { payload: '"hello"', desc: "String primitive" },
        { payload: "[]", desc: "Empty array" },
        { payload: "[1, 2, 3]", desc: "Array of numbers" },
      ];

      const failures = [];

      for (const tc of malformedCases) {
        const res = validatePreferencesImport(tc.payload);
        if (res.ok) {
          failures.push({ desc: tc.desc, payload: tc.payload, actual: res });
        }
      }

      return { pass: failures.length === 0, failures };
    })()
  `);

  assert.strictEqual(result.pass, true, `Validation accepted malformed/non-object payload: ${JSON.stringify(result.failures)}`);
});

suite.test("Preferences Import: Rejects out-of-range, invalid enum, and conflicting field values", async () => {
  const result = await cdp.evaluate(`
    (async () => {
      const { validatePreferencesImport } = await import('/src/lib/preferencesIo.ts');

      const invalidCases = [
        // 1. defaultView
        { payload: JSON.stringify({ defaultView: "year" }), expectedErr: "defaultView", desc: "Invalid view 'year'" },
        { payload: JSON.stringify({ defaultView: "decade" }), expectedErr: "defaultView", desc: "Invalid view 'decade'" },
        { payload: JSON.stringify({ defaultView: 123 }), expectedErr: "defaultView", desc: "Non-string defaultView" },

        // 2. timeFormat
        { payload: JSON.stringify({ timeFormat: "12-hour" }), expectedErr: "timeFormat", desc: "Invalid timeFormat '12-hour'" },
        { payload: JSON.stringify({ timeFormat: "military" }), expectedErr: "timeFormat", desc: "Invalid timeFormat 'military'" },
        { payload: JSON.stringify({ timeFormat: "" }), expectedErr: "timeFormat", desc: "Empty timeFormat" },

        // 3. weekStartsOn
        { payload: JSON.stringify({ weekStartsOn: "tuesday" }), expectedErr: "weekStartsOn", desc: "Invalid weekStartsOn 'tuesday'" },
        { payload: JSON.stringify({ weekStartsOn: "saturday" }), expectedErr: "weekStartsOn", desc: "Invalid weekStartsOn 'saturday'" },

        // 4. defaultEventDurationMins (< 5 or > 480 or NaN)
        { payload: JSON.stringify({ defaultEventDurationMins: 4 }), expectedErr: "defaultEventDurationMins", desc: "Duration < 5 min" },
        { payload: JSON.stringify({ defaultEventDurationMins: 0 }), expectedErr: "defaultEventDurationMins", desc: "Duration 0 min" },
        { payload: JSON.stringify({ defaultEventDurationMins: -15 }), expectedErr: "defaultEventDurationMins", desc: "Negative duration" },
        { payload: JSON.stringify({ defaultEventDurationMins: 481 }), expectedErr: "defaultEventDurationMins", desc: "Duration > 480 min (8h)" },
        { payload: JSON.stringify({ defaultEventDurationMins: 1440 }), expectedErr: "defaultEventDurationMins", desc: "Duration 24h" },
        { payload: JSON.stringify({ defaultEventDurationMins: "abc" }), expectedErr: "defaultEventDurationMins", desc: "NaN duration" },

        // 5. workingHoursStart (< 0 or > 23 or NaN)
        { payload: JSON.stringify({ workingHoursStart: -1 }), expectedErr: "workingHoursStart", desc: "Negative workingHoursStart" },
        { payload: JSON.stringify({ workingHoursStart: 24 }), expectedErr: "workingHoursStart", desc: "workingHoursStart 24" },
        { payload: JSON.stringify({ workingHoursStart: "morning" }), expectedErr: "workingHoursStart", desc: "NaN workingHoursStart" },

        // 6. workingHoursEnd (< 1 or > 24 or NaN)
        { payload: JSON.stringify({ workingHoursEnd: 0 }), expectedErr: "workingHoursEnd", desc: "workingHoursEnd 0" },
        { payload: JSON.stringify({ workingHoursEnd: 25 }), expectedErr: "workingHoursEnd", desc: "workingHoursEnd 25" },
        { payload: JSON.stringify({ workingHoursEnd: "evening" }), expectedErr: "workingHoursEnd", desc: "NaN workingHoursEnd" },

        // 7. workingHoursEnd <= workingHoursStart
        { payload: JSON.stringify({ workingHoursStart: 10, workingHoursEnd: 10 }), expectedErr: "greater than workingHoursStart", desc: "workingHoursEnd == workingHoursStart" },
        { payload: JSON.stringify({ workingHoursStart: 17, workingHoursEnd: 8 }), expectedErr: "greater than workingHoursStart", desc: "workingHoursEnd < workingHoursStart" },

        // 8. platformShortcutStyle
        { payload: JSON.stringify({ platformShortcutStyle: "unix" }), expectedErr: "platformShortcutStyle", desc: "Invalid shortcut style 'unix'" },
        { payload: JSON.stringify({ platformShortcutStyle: "macos" }), expectedErr: "platformShortcutStyle", desc: "Invalid shortcut style 'macos'" },

        // 9. gridDensity
        { payload: JSON.stringify({ gridDensity: "ultra-compact" }), expectedErr: "gridDensity", desc: "Invalid gridDensity 'ultra-compact'" },
        { payload: JSON.stringify({ gridDensity: "huge" }), expectedErr: "gridDensity", desc: "Invalid gridDensity 'huge'" },

        // 10. hourHeight (< 40 or > 96 or NaN)
        { payload: JSON.stringify({ hourHeight: 39 }), expectedErr: "hourHeight", desc: "hourHeight 39 (< 40)" },
        { payload: JSON.stringify({ hourHeight: 0 }), expectedErr: "hourHeight", desc: "hourHeight 0" },
        { payload: JSON.stringify({ hourHeight: -10 }), expectedErr: "hourHeight", desc: "Negative hourHeight" },
        { payload: JSON.stringify({ hourHeight: 97 }), expectedErr: "hourHeight", desc: "hourHeight 97 (> 96)" },
        { payload: JSON.stringify({ hourHeight: 120 }), expectedErr: "hourHeight", desc: "hourHeight 120" },
        { payload: JSON.stringify({ hourHeight: "tall" }), expectedErr: "hourHeight", desc: "NaN hourHeight" },
      ];

      const failures = [];

      for (const tc of invalidCases) {
        const res = validatePreferencesImport(tc.payload);
        if (res.ok) {
          failures.push({ desc: tc.desc, error: "Validation unexpectedly succeeded", payload: tc.payload });
        } else if (!res.error.toLowerCase().includes(tc.expectedErr.toLowerCase())) {
          failures.push({
            desc: tc.desc,
            error: "Error message did not mention expected phrase: " + tc.expectedErr,
            actualError: res.error,
          });
        }
      }

      return { pass: failures.length === 0, failures };
    })()
  `);

  assert.strictEqual(result.pass, true, `Adversarial field rejection failed: ${JSON.stringify(result.failures)}`);
});

suite.test("Preferences Import: Accepts both full envelope and direct flat object payloads", async () => {
  const result = await cdp.evaluate(`
    (async () => {
      const { validatePreferencesImport } = await import('/src/lib/preferencesIo.ts');

      // Envelope format
      const envelopePayload = JSON.stringify({
        $schema: "https://rapidcal.local/schemas/preferences.v1.json",
        app: "RapidCal",
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        theme: "light",
        preferences: {
          defaultView: "day",
          timeFormat: "24h",
          weekStartsOn: "sunday",
          defaultEventDurationMins: 45,
          workingHoursStart: 9,
          workingHoursEnd: 18,
          gridDensity: "spacious",
          hourHeight: 72,
          platformShortcutStyle: "mac",
        },
        oauthConfig: {
          googleClientId: "test-google-id",
          msClientId: "test-ms-id",
          syncIntervalSecs: 120,
        },
      });

      const resEnvelope = validatePreferencesImport(envelopePayload);
      if (!resEnvelope.ok) {
        return { ok: false, error: 'Envelope validation failed: ' + resEnvelope.error };
      }
      if (resEnvelope.theme !== "light") {
        return { ok: false, error: 'Expected theme light, got: ' + resEnvelope.theme };
      }
      if (resEnvelope.preferences.defaultView !== "day" || resEnvelope.preferences.hourHeight !== 72) {
        return { ok: false, error: 'Envelope preferences mismatch' };
      }
      if (resEnvelope.oauthConfig?.syncIntervalSecs !== 120) {
        return { ok: false, error: 'Envelope oauthConfig syncIntervalSecs mismatch' };
      }

      // Direct flat object format
      const flatPayload = JSON.stringify({
        defaultView: "month",
        timeFormat: "12h",
        gridDensity: "compact",
        hourHeight: 44,
      });

      const resFlat = validatePreferencesImport(flatPayload);
      if (!resFlat.ok) {
        return { ok: false, error: 'Flat payload validation failed: ' + resFlat.error };
      }
      if (resFlat.preferences.defaultView !== "month" || resFlat.preferences.hourHeight !== 44) {
        return { ok: false, error: 'Flat preferences mismatch' };
      }

      return { ok: true };
    })()
  `);

  assert.strictEqual(result.ok, true, `Valid payloads failed validation: ${result.error}`);
});

// ============================================================================
// 3. PREFERENCES APPLICATION & UI REACTIVITY
// ============================================================================

suite.test("Preferences Application: Reactive store and DOM updates upon import", async () => {
  const result = await cdp.evaluate(`
    (async () => {
      const { validatePreferencesImport, applyImportedPreferences } = await import('/src/lib/preferencesIo.ts');
      const store = await import('/src/store/calendarStore.ts');

      const customPayload = JSON.stringify({
        theme: "light",
        preferences: {
          defaultView: "agenda",
          timeFormat: "24h",
          weekStartsOn: "monday",
          gridDensity: "spacious",
          hourHeight: 72,
          platformShortcutStyle: "windows_linux",
        },
      });

      const validated = validatePreferencesImport(customPayload);
      if (!validated.ok) {
        return { ok: false, error: 'Validation failed' };
      }

      await applyImportedPreferences(validated);

      // Verify reactive signals
      const p = store.userPreferences();
      const currentTheme = store.theme();
      const currentHh = store.hourHeightPx();

      return {
        ok: true,
        theme: currentTheme,
        defaultView: p.defaultView,
        timeFormat: p.timeFormat,
        hourHeight: p.hourHeight,
        hourHeightPx: currentHh,
        platformShortcutStyle: p.platformShortcutStyle,
        gridDensity: p.gridDensity,
      };
    })()
  `);

  assert.strictEqual(result.ok, true, `Application failed: ${result.error}`);
  assert.strictEqual(result.theme, "light");
  assert.strictEqual(result.defaultView, "agenda");
  assert.strictEqual(result.timeFormat, "24h");
  assert.strictEqual(result.hourHeight, 72);
  assert.strictEqual(result.hourHeightPx, 72);
  assert.strictEqual(result.gridDensity, "spacious");
  assert.strictEqual(result.platformShortcutStyle, "windows_linux");
});

// ============================================================================
// 4. OUTBOX DIAGNOSTICS & PAYLOAD MODAL EMPIRICAL TESTS
// ============================================================================

suite.test("Outbox Diagnostics: Clean queue empty state rendering", async () => {
  await openAdvancedSettingsTab();

  const emptyState = await cdp.evaluate(`
    (() => {
      const badges = Array.from(document.querySelectorAll('span'));
      const cleanBadge = badges.find(b => b.innerText.includes('Queue Clean'));

      const emptyCards = Array.from(document.querySelectorAll('div'));
      const emptyText = emptyCards.find(d => d.innerText.includes('Outbox Queue Clean'));

      return {
        hasCleanBadge: Boolean(cleanBadge),
        hasEmptyCard: Boolean(emptyText),
      };
    })()
  `);

  assert.strictEqual(emptyState.hasCleanBadge, true, "Should render 'Queue Clean' badge when outbox is empty");
  assert.strictEqual(emptyState.hasEmptyCard, true, "Should render 'Outbox Queue Clean' card when outbox is empty");
});

suite.test("Outbox Diagnostics: Table rendering and operation badges with queued mutations", async () => {
  // Inject mock mutations into outbox via api.listOutboxMutations and refreshMetadata
  await cdp.evaluate(`
    (async () => {
      const { api } = await import('/src/lib/tauri.ts');
      const store = await import('/src/store/calendarStore.ts');

      window.__origListOutbox = api.listOutboxMutations;
      api.listOutboxMutations = async () => [
        {
          id: 101,
          operation: "create",
          accountId: "acc-google-work",
          calendarId: "cal-acme-eng",
          payloadJson: JSON.stringify({ title: "Q4 Strategic Roadmap", startTs: 1728550000, endTs: 1728553600 }),
          createdAt: new Date(Date.now() - 45000).toISOString(),
          retryCount: 0,
          lastError: null,
        },
        {
          id: 102,
          operation: "update",
          accountId: "acc-ms-outlook",
          calendarId: "cal-contoso-ent",
          payloadJson: JSON.stringify({ id: "evt-contoso-1", title: "Rescheduled Executive Briefing" }),
          createdAt: new Date(Date.now() - 300000).toISOString(),
          retryCount: 2,
          lastError: "HTTP 503 Service Unavailable: Remote API rate limit reached",
        },
        {
          id: 103,
          operation: "delete",
          accountId: "acc-google-personal",
          calendarId: "cal-personal",
          payloadJson: JSON.stringify({ id: "evt-cancelled-99" }),
          createdAt: new Date(Date.now() - 7200000).toISOString(),
          retryCount: 0,
          lastError: null,
        },
      ];

      await store.refreshMetadata();
    })()
  `);

  await new Promise((r) => setTimeout(r, 400));

  const tableInspection = await cdp.evaluate(`
    (() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      if (rows.length !== 3) {
        return { ok: false, rowCount: rows.length, error: 'Expected 3 table rows' };
      }

      const rowData = rows.map(r => {
        const text = r.innerText;
        const badges = Array.from(r.querySelectorAll('span')).map(s => s.innerText);
        const buttons = Array.from(r.querySelectorAll('button')).map(b => b.innerText);
        return { text, badges, buttons };
      });

      const pendingBadge = Array.from(document.querySelectorAll('span')).find(s => s.innerText.includes('3 Pending'));

      return {
        ok: true,
        hasPendingBadge: Boolean(pendingBadge),
        rowCount: rows.length,
        rowData,
      };
    })()
  `);

  assert.strictEqual(tableInspection.ok, true, `Table inspection failed: ${tableInspection.error}`);
  assert.strictEqual(tableInspection.rowCount, 3, "Table must render exactly 3 rows");
  assert.strictEqual(tableInspection.hasPendingBadge, true, "Badge must display '3 Pending'");

  // Check operation badges in rows
  const row1 = tableInspection.rowData[0];
  const row2 = tableInspection.rowData[1];
  const row3 = tableInspection.rowData[2];

  assert.ok(row1.badges.some((b) => b.includes("CREATE")), "Row 1 must show CREATE badge");
  assert.ok(row2.badges.some((b) => b.includes("UPDATE")), "Row 2 must show UPDATE badge");
  assert.ok(row3.badges.some((b) => b.includes("DELETE")), "Row 3 must show DELETE badge");

  assert.ok(row2.text.includes("HTTP 503"), "Row 2 must render error message");
});

suite.test("Outbox Diagnostics: JSON payload viewer modal opens, formats JSON, and dismisses", async () => {
  // Click the payload preview button on the first row
  const modalOpened = await cdp.evaluate(`
    (() => {
      const payloadBtn = document.querySelector('tbody tr:first-child button[title="Click to view full JSON"]');
      if (payloadBtn) {
        payloadBtn.click();
        return true;
      }
      return false;
    })()
  `);
  assert.strictEqual(modalOpened, true, "Must find and click payload preview button");

  await new Promise((r) => setTimeout(r, 200));

  // Verify modal DOM
  const modalContent = await cdp.evaluate(`
    (() => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      if (!modal) return null;

      const title = modal.querySelector('h4')?.innerText || '';
      const textContent = modal.querySelector('h4')?.textContent || '';
      const pre = modal.querySelector('pre')?.innerText || '';
      const buttons = Array.from(modal.querySelectorAll('button')).map(b => b.innerText);

      return { title, textContent, pre, buttons };
    })()
  `);

  assert.ok(modalContent, "Modal must be rendered");
  assert.ok(
    modalContent.title.toUpperCase().includes("OUTBOX MUTATION PAYLOAD JSON") ||
    modalContent.textContent.includes("Outbox Mutation Payload JSON"),
    `Modal heading must match, got: ${modalContent.title}`
  );
  assert.ok(modalContent.pre.includes("Q4 Strategic Roadmap"), "Modal pre must contain formatted title");
  assert.ok(modalContent.buttons.includes("Copy JSON"), "Modal must contain 'Copy JSON' button");
  assert.ok(modalContent.buttons.includes("Done"), "Modal must contain 'Done' button");

  // Dismiss modal via "Done" button
  await cdp.evaluate(`
    (() => {
      const doneBtn = Array.from(document.querySelectorAll('.fixed.inset-0.z-50 button')).find(b => b.innerText === 'Done');
      doneBtn?.click();
    })()
  `);

  await new Promise((r) => setTimeout(r, 200));

  const modalClosed = await cdp.evaluate(`
    Boolean(!document.querySelector('.fixed.inset-0.z-50'))
  `);
  assert.strictEqual(modalClosed, true, "Modal must be dismissed after clicking Done");
});

suite.test("Outbox Diagnostics: Manual sync cache refresh button triggers without error", async () => {
  const refreshed = await cdp.evaluate(`
    (async () => {
      const refreshBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.includes('Refresh Sync Cache')
      );
      if (!refreshBtn) return { ok: false, error: 'Button not found' };

      refreshBtn.click();
      return { ok: true };
    })()
  `);

  assert.strictEqual(refreshed.ok, true, `Sync refresh button click failed: ${refreshed.error}`);
  await new Promise((r) => setTimeout(r, 400));
});

// ============================================================================
// 5. SAMPLE DATASET RESET CONFIRMATION MODAL & CANCEL VS CONFIRM
// ============================================================================

suite.test("Dataset Reset: Confirmation modal renders warning, SVG icon, and cancel closes without change", async () => {
  // Open Reset modal
  const opened = await cdp.evaluate(`
    (() => {
      const resetBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.includes('Reset Sample Dataset')
      );
      if (resetBtn) {
        resetBtn.click();
        return true;
      }
      return false;
    })()
  `);
  assert.strictEqual(opened, true, "Must click 'Reset Sample Dataset…' button");

  await new Promise((r) => setTimeout(r, 200));

  // Inspect modal content
  const modalInspection = await cdp.evaluate(`
    (() => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      if (!modal) return null;

      const title = modal.querySelector('h4')?.innerText || '';
      const textContent = modal.querySelector('h4')?.textContent || '';
      const svgIcon = modal.querySelector('svg');
      const viewBox = svgIcon?.getAttribute('viewBox');
      const rawText = modal.innerText;

      // Check for raw emoji ⚠️ (forbidden by R2 zero-emoji rule)
      const hasRawEmoji = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(rawText);

      const checkbox = modal.querySelector('input[type="checkbox"]');
      const isChecked = checkbox ? checkbox.checked : null;

      return {
        title,
        textContent,
        hasSvg: Boolean(svgIcon),
        viewBox,
        hasRawEmoji,
        hasCheckbox: Boolean(checkbox),
        isChecked,
      };
    })()
  `);

  assert.ok(modalInspection, "Reset confirmation modal must be open");
  assert.ok(
    modalInspection.title.includes("Reset to Sample Dataset?") ||
    modalInspection.textContent.includes("Reset to Sample Dataset?"),
    `Modal title must match, got: ${modalInspection.title}`
  );
  assert.strictEqual(modalInspection.hasSvg, true, "Modal must use vector SVG icon");
  assert.strictEqual(modalInspection.viewBox, "0 0 24 24", "SVG icon must have 24x24 viewBox");
  assert.strictEqual(modalInspection.hasRawEmoji, false, "Modal must NOT contain any raw Unicode emoji glyphs");
  assert.strictEqual(modalInspection.hasCheckbox, true, "Modal must contain preference reset checkbox");
  assert.strictEqual(modalInspection.isChecked, true, "Checkbox must default to checked");

  // Test Cancel
  await cdp.evaluate(`
    (() => {
      const cancelBtn = Array.from(document.querySelectorAll('.fixed.inset-0.z-50 button')).find(b =>
        b.innerText.includes('Cancel')
      );
      cancelBtn?.click();
    })()
  `);

  await new Promise((r) => setTimeout(r, 200));

  const stillHasMutations = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      return {
        modalClosed: !document.querySelector('.fixed.inset-0.z-50'),
        mutationCount: store.outboxMutations().length,
      };
    })()
  `);

  assert.strictEqual(stillHasMutations.modalClosed, true, "Cancel must close confirmation modal");
  assert.strictEqual(stillHasMutations.mutationCount, 3, "Cancel must NOT purge outbox mutations");
});

suite.test("Dataset Reset: Confirm execution purges outbox, reseeds data, and restores defaults", async () => {
  // Restore real listOutboxMutations before confirm reset
  await cdp.evaluate(`
    (async () => {
      const { api } = await import('/src/lib/tauri.ts');
      if (window.__origListOutbox) {
        api.listOutboxMutations = window.__origListOutbox;
      }
    })()
  `);

  // Re-open reset modal
  await cdp.evaluate(`
    (() => {
      const resetBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.includes('Reset Sample Dataset')
      );
      resetBtn?.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));

  // Click "Confirm Reset" button
  await cdp.evaluate(`
    (() => {
      const confirmBtn = Array.from(document.querySelectorAll('.fixed.inset-0.z-50 button')).find(b =>
        b.innerText.includes('Confirm Reset')
      );
      confirmBtn?.click();
    })()
  `);

  await new Promise((r) => setTimeout(r, 700));

  // Check state after reset
  const postResetState = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      const prefs = store.userPreferences();
      const mutations = store.outboxMutations();
      const accounts = store.accounts();
      const calendars = store.calendars();

      return {
        modalClosed: !document.querySelector('.fixed.inset-0.z-50'),
        mutationCount: mutations.length,
        accountCount: accounts.length,
        calendarCount: calendars.length,
        defaultView: prefs.defaultView,
        theme: store.theme(),
        hourHeight: prefs.hourHeight,
      };
    })()
  `);

  assert.strictEqual(postResetState.modalClosed, true, "Modal must be closed after confirm reset");
  assert.strictEqual(postResetState.mutationCount, 0, "Outbox mutations must be purged to 0");
  assert.ok(postResetState.accountCount >= 3, `Demo accounts must be restored (got ${postResetState.accountCount})`);
  assert.ok(postResetState.calendarCount >= 5, `Demo calendars must be restored (got ${postResetState.calendarCount})`);
  assert.strictEqual(postResetState.defaultView, "week", "Default view must reset to 'week'");
  assert.strictEqual(postResetState.hourHeight, 56, "Hour height must reset to 56px default");
  assert.strictEqual(postResetState.theme, "dark", "Theme must reset to 'dark' default");
});

// ============================================================================
// 6. PREFERENCES PASTE MODAL ADVERSARIAL VALIDATION
// ============================================================================

suite.test("Preferences Paste Modal: Rejects invalid JSON with inline error, accepts valid payload", async () => {
  // Open Paste Modal
  const opened = await cdp.evaluate(`
    (() => {
      const pasteBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.includes('Paste JSON')
      );
      if (pasteBtn) {
        pasteBtn.click();
        return true;
      }
      return false;
    })()
  `);
  assert.strictEqual(opened, true, "Must click 'Paste JSON…' button");
  await new Promise((r) => setTimeout(r, 200));

  // Input invalid JSON
  await cdp.evaluate(`
    (() => {
      const textarea = document.querySelector('textarea');
      if (textarea) {
        textarea.value = '{ "timeFormat": "invalid-format" }';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const validateBtn = Array.from(document.querySelectorAll('.fixed.inset-0.z-50 button')).find(b =>
        b.innerText.includes('Validate & Import')
      );
      validateBtn?.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));

  // Check that inline error message is shown and modal stays open
  const errorCheck = await cdp.evaluate(`
    (() => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      if (!modal) return { open: false };
      const errBox = modal.querySelector('.text-rose-400');
      return {
        open: true,
        hasError: Boolean(errBox),
        errorText: errBox?.innerText,
      };
    })()
  `);

  assert.strictEqual(errorCheck.open, true, "Modal must remain open when validation fails");
  assert.strictEqual(errorCheck.hasError, true, "Inline error box must be displayed");
  assert.ok(errorCheck.errorText.includes("timeFormat"), "Error text must mention invalid timeFormat");

  // Input valid JSON
  await cdp.evaluate(`
    (() => {
      const textarea = document.querySelector('textarea');
      if (textarea) {
        textarea.value = JSON.stringify({ defaultView: "day", timeFormat: "24h" });
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const validateBtn = Array.from(document.querySelectorAll('.fixed.inset-0.z-50 button')).find(b =>
        b.innerText.includes('Validate & Import')
      );
      validateBtn?.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  const validCheck = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      return {
        modalClosed: !document.querySelector('.fixed.inset-0.z-50'),
        defaultView: store.userPreferences().defaultView,
        timeFormat: store.userPreferences().timeFormat,
      };
    })()
  `);

  assert.strictEqual(validCheck.modalClosed, true, "Modal must close on valid import");
  assert.strictEqual(validCheck.defaultView, "day", "defaultView should be imported as 'day'");
  assert.strictEqual(validCheck.timeFormat, "24h", "timeFormat should be imported as '24h'");

  // Reset back to week default for clean test teardown
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.updateUserPreferences({ defaultView: "week", timeFormat: "12h" });
      store.closeSettings();
    })()
  `);
});

if (process.argv[1]?.endsWith("challenger_m2_preferences_outbox_reset.test.js")) {
  suite.run().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}

export { suite };
