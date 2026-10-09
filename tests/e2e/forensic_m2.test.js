import assert from "node:assert";
import { createHarness, TestSuite } from "./harness.js";

const suite = new TestSuite("Forensic Auditor M2: Integrity & Stress Verification");

let harness;
let cdp;

suite.beforeAll(async () => {
  harness = await createHarness();
  cdp = harness.cdp;
});

suite.afterAll(async () => {
  if (harness) {
    await harness.teardown();
  }
});

// Helper to switch view by clicking TopBar tab
async function selectViewTab(tabText) {
  const clicked = await cdp.evaluate(`
    (() => {
      const buttons = Array.from(document.querySelectorAll('header button'));
      const target = buttons.find(b => {
        const text = (b.innerText || '').trim();
        const lines = text.split('\\n').map(s => s.trim()).filter(Boolean);
        return lines[0] === ${JSON.stringify(tabText)} || text === ${JSON.stringify(tabText)};
      });
      if (target) {
        target.click();
        return true;
      }
      return false;
    })()
  `);
  assert.ok(clicked, `Could not find and click TopBar tab: ${tabText}`);
  await new Promise((r) => setTimeout(r, 250));
}

// ----------------------------------------------------------------------------
// Test 1: Preferences JSON Schema Validation Engine Rigor
// ----------------------------------------------------------------------------
suite.test("Preferences JSON Schema Validation & Export Integrity", async () => {
  const validationResults = await cdp.evaluate(`
    (async () => {
      const mod = await import('/src/lib/preferencesIo.ts');
      
      const results = {};

      // 1. Export envelope roundtrip
      const exportedJson = mod.generatePreferencesExportJson();
      results.exportIsValidJson = false;
      try {
        const parsed = JSON.parse(exportedJson);
        results.exportIsValidJson = Boolean(parsed && parsed.$schema && parsed.schemaVersion === 1 && parsed.preferences);
      } catch {}

      const roundtrip = mod.validatePreferencesImport(exportedJson);
      results.roundtripOk = roundtrip.ok;

      // 2. Reject malformed JSON syntax
      const malformed = mod.validatePreferencesImport('{ invalid json');
      results.malformedRejected = (!malformed.ok && malformed.error.includes('Invalid JSON syntax'));

      // 3. Reject non-object JSON
      const arrayJson = mod.validatePreferencesImport('["not", "an", "object"]');
      results.arrayRejected = (!arrayJson.ok && arrayJson.error.includes('Root JSON payload must be an object'));

      // 4. Boundary check: defaultEventDurationMins
      const durLow = mod.validatePreferencesImport(JSON.stringify({ defaultEventDurationMins: 4 }));
      const durHigh = mod.validatePreferencesImport(JSON.stringify({ defaultEventDurationMins: 481 }));
      const durValid = mod.validatePreferencesImport(JSON.stringify({ defaultEventDurationMins: 45 }));
      results.durationBoundaries = (!durLow.ok && !durHigh.ok && durValid.ok);

      // 5. Boundary check: workingHours
      const hoursInverted = mod.validatePreferencesImport(JSON.stringify({ workingHoursStart: 18, workingHoursEnd: 9 }));
      const hoursValid = mod.validatePreferencesImport(JSON.stringify({ workingHoursStart: 8, workingHoursEnd: 17 }));
      results.workingHoursBoundaries = (!hoursInverted.ok && hoursValid.ok);

      // 6. Boundary check: hourHeight
      const hhLow = mod.validatePreferencesImport(JSON.stringify({ hourHeight: 39 }));
      const hhHigh = mod.validatePreferencesImport(JSON.stringify({ hourHeight: 97 }));
      const hhValid = mod.validatePreferencesImport(JSON.stringify({ hourHeight: 64 }));
      results.hourHeightBoundaries = (!hhLow.ok && !hhHigh.ok && hhValid.ok);

      // 7. Enum checks: defaultView, gridDensity, platformShortcutStyle
      const viewInvalid = mod.validatePreferencesImport(JSON.stringify({ defaultView: 'nonexistent' }));
      const densityInvalid = mod.validatePreferencesImport(JSON.stringify({ gridDensity: 'superdense' }));
      const styleInvalid = mod.validatePreferencesImport(JSON.stringify({ platformShortcutStyle: 'amiga' }));
      results.enumsValidated = (!viewInvalid.ok && !densityInvalid.ok && !styleInvalid.ok);

      return results;
    })()
  `);

  assert.strictEqual(validationResults.exportIsValidJson, true, "generatePreferencesExportJson must produce a valid v1 envelope");
  assert.strictEqual(validationResults.roundtripOk, true, "Exported JSON must pass schema validation on roundtrip");
  assert.strictEqual(validationResults.malformedRejected, true, "Malformed JSON syntax must be rejected");
  assert.strictEqual(validationResults.arrayRejected, true, "Non-object JSON root must be rejected");
  assert.strictEqual(validationResults.durationBoundaries, true, "Duration < 5 or > 480 must be rejected");
  assert.strictEqual(validationResults.workingHoursBoundaries, true, "Inverted working hours must be rejected");
  assert.strictEqual(validationResults.hourHeightBoundaries, true, "Hour height < 40 or > 96 must be rejected");
  assert.strictEqual(validationResults.enumsValidated, true, "Invalid enum values must be rejected");
});

// ----------------------------------------------------------------------------
// Test 2: Advanced Settings Navigation & Power-User Controls Layout
// ----------------------------------------------------------------------------
suite.test("Advanced Settings Tab Navigation & Power-User Sections", async () => {
  // 1. Open Settings
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.openSettings('advanced');
    })()
  `);
  await new Promise((r) => setTimeout(r, 400));

  // 2. Verify all power-user section headings are mounted in DOM
  const headings = await cdp.evaluate(`
    Array.from(document.querySelectorAll('h3')).map(h => h.innerText.trim().toUpperCase())
  `);

  assert.ok(headings.some(h => h.includes('DEVELOPER OAUTH CREDENTIALS')), "Advanced tab must include Developer OAuth section");
  assert.ok(headings.some(h => h.includes('SYNC POLLING FREQUENCY & TIMING')), "Advanced tab must include Sync Polling Tuning section");
  assert.ok(headings.some(h => h.includes('PLATFORM SHORTCUT STYLE OVERRIDE')), "Advanced tab must include Platform Shortcut Style section");
  assert.ok(headings.some(h => h.includes('TIME-GRID DENSITY & SCALING')), "Advanced tab must include Time-Grid Density section");
  assert.ok(headings.some(h => h.includes('SYNC QUEUE & OUTBOX DIAGNOSTICS')), "Advanced tab must include Outbox Diagnostics section");
  assert.ok(headings.some(h => h.includes('PREFERENCES BACKUP & PORTABILITY')), "Advanced tab must include Preferences Backup & Portability section");
  assert.ok(headings.some(h => h.includes('RESET SAMPLE DATASET & LOCAL STORAGE')), "Advanced tab must include Danger Zone / Sample Reset section");

  // 3. Verify Accounts tab does NOT have raw client secret / technical developer inputs
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.setActiveSettingsTab('accounts');
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  const accountsInputsCheck = await cdp.evaluate(`
    (() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      return {
        hasSecretInput: inputs.some(i => i.placeholder?.includes('client_secret') || i.name?.includes('Secret')),
        hasClientIdInput: inputs.some(i => i.placeholder?.includes('client_id') || i.name?.includes('ClientId')),
      };
    })()
  `);
  assert.strictEqual(accountsInputsCheck.hasSecretInput, false, "Accounts tab must be approachable and free of raw OAuth Secret inputs");
  assert.strictEqual(accountsInputsCheck.hasClientIdInput, false, "Accounts tab must be approachable and free of raw OAuth Client ID inputs");

  // Close settings
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.closeSettings();
    })()
  `);
  await new Promise((r) => setTimeout(r, 400));
});

// ----------------------------------------------------------------------------
// Test 3: Outbox Diagnostics Table & Backend Connection
// ----------------------------------------------------------------------------
suite.test("Outbox Diagnostics Table Rendering & Mutation Inspection", async () => {
  // Open Settings -> Advanced
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.openSettings('advanced');
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  // Check metrics and refresh button
  const tableCheck = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      
      const initialCount = store.outboxMutations().length;

      const refreshBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.toLowerCase().includes('refresh sync cache')
      );
      const refreshBtnExists = Boolean(refreshBtn);

      const upperText = document.body.innerText.toUpperCase();
      const hasDatabaseMetrics = Boolean(
        upperText.includes('SQLITE WAL') && 
        upperText.includes('OUTBOX MUTATIONS')
      );

      return {
        initialCount,
        refreshBtnExists,
        hasDatabaseMetrics,
      };
    })()
  `);

  assert.ok(tableCheck.refreshBtnExists, "Diagnostics refresh button must exist");
  assert.ok(tableCheck.hasDatabaseMetrics, "Database metrics overview cards must exist");

  // Close settings
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.closeSettings();
    })()
  `);
  await new Promise((r) => setTimeout(r, 400));
});

// ----------------------------------------------------------------------------
// Test 4: Dynamic Time-Grid Hour Height Scaling & Proportional Scroll
// ----------------------------------------------------------------------------
suite.test("Dynamic Time-Grid Hour Height Scaling & Proportional Scroll", async () => {
  await selectViewTab("Day");

  const scalingCheck = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      
      // 1. Set to compact (44px)
      store.setGridDensity('compact');
      await new Promise(r => setTimeout(r, 150));
      const compactHeight = store.hourHeightPx();

      // Read rendered gutter slot height
      const gutterEl = document.querySelector('.shrink-0 div[style*="height"]');
      const compactDomH = gutterEl ? gutterEl.getBoundingClientRect().height : 0;

      // 2. Set to spacious (72px)
      store.setGridDensity('spacious');
      await new Promise(r => setTimeout(r, 150));
      const spaciousHeight = store.hourHeightPx();
      const spaciousDomH = gutterEl ? gutterEl.getBoundingClientRect().height : 0;

      // 3. Set custom slider (60px)
      store.setHourHeight(60);
      await new Promise(r => setTimeout(r, 150));
      const customHeight = store.hourHeightPx();
      const customDomH = gutterEl ? gutterEl.getBoundingClientRect().height : 0;

      // Reset to standard (56px)
      store.setGridDensity('standard');

      return {
        compactHeight,
        spaciousHeight,
        customHeight,
        compactDomH,
        spaciousDomH,
        customDomH,
      };
    })()
  `);

  assert.strictEqual(scalingCheck.compactHeight, 44, "Compact density must set hourHeightPx to 44");
  assert.strictEqual(scalingCheck.spaciousHeight, 72, "Spacious density must set hourHeightPx to 72");
  assert.strictEqual(scalingCheck.customHeight, 60, "setHourHeight(60) must set hourHeightPx to 60");
  assert.strictEqual(Math.round(scalingCheck.compactDomH), 44, "DOM gutter slot height must dynamically scale to 44px");
  assert.strictEqual(Math.round(scalingCheck.spaciousDomH), 72, "DOM gutter slot height must dynamically scale to 72px");
  assert.strictEqual(Math.round(scalingCheck.customDomH), 60, "DOM gutter slot height must dynamically scale to 60px");
});

// ----------------------------------------------------------------------------
// Test 5: Reset Dataset Danger Modal Zero-Emoji & Functionality
// ----------------------------------------------------------------------------
suite.test("Reset Dataset Danger Modal Iconography & Nonce Confirmation", async () => {
  // 1. Open Settings -> Advanced
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.openSettings('advanced');
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  // 2. Click "Reset Sample Dataset…"
  await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.toLowerCase().includes('reset sample dataset')
      );
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  // 3. Inspect the confirmation modal
  const modalInspection = await cdp.evaluate(`
    (() => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      if (!modal) return { mounted: false };

      const svgs = Array.from(modal.querySelectorAll('svg'));
      const emojiRegex = /(\\p{Extended_Pictographic}|[\\u2600-\\u27BF])/u;
      const rawEmojiPresent = emojiRegex.test(modal.innerText);

      const hasAlertIcon = svgs.some(s => s.getAttribute('viewBox') === '0 0 24 24');

      return {
        mounted: true,
        rawEmojiPresent,
        hasAlertIcon,
        hasCancelBtn: Boolean(Array.from(modal.querySelectorAll('button')).find(b => b.innerText.includes('Cancel'))),
        hasConfirmBtn: Boolean(Array.from(modal.querySelectorAll('button')).find(b => b.innerText.includes('Confirm Reset'))),
      };
    })()
  `);

  assert.strictEqual(modalInspection.mounted, true, "Danger reset confirmation modal must mount");
  assert.strictEqual(modalInspection.rawEmojiPresent, false, "Danger modal must have ZERO raw emojis");
  assert.strictEqual(modalInspection.hasAlertIcon, true, "Danger modal must use 24x24 AlertTriangleIcon");
  assert.strictEqual(modalInspection.hasCancelBtn, true, "Danger modal must offer Cancel button");
  assert.strictEqual(modalInspection.hasConfirmBtn, true, "Danger modal must offer Confirm Reset button");

  // Click Cancel to safely close modal
  await cdp.evaluate(`
    (() => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      const cancel = Array.from(modal?.querySelectorAll('button') || []).find(b => b.innerText.includes('Cancel'));
      if (cancel) cancel.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  // Close Settings
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.closeSettings();
    })()
  `);
  await new Promise((r) => setTimeout(r, 400));
});

// Run directly if invoked from command line
if (process.argv[1]?.endsWith("forensic_m2.test.js")) {
  suite.run().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  }).catch((err) => {
    console.error("Forensic test suite failure:", err);
    process.exit(1);
  });
}

export { suite };
