import { assert, createHarness, TestSuite } from "./harness.js";

const suite = new TestSuite("Challenger M3-2-1: TopBar Responsiveness, Date Title & Zero-Overflow Empirical Challenge");

let harness;
let cdp;

suite.beforeAll(async () => {
  harness = await createHarness();
  cdp = harness.cdp;
  await cdp.setViewport(1280, 800);
  await cdp.evaluate(`
    import('/src/store/calendarStore.ts').then(s => {
      window.__STORE__ = s;
    })
  `);
  await new Promise((r) => setTimeout(r, 300));
});

suite.afterAll(async () => {
  if (harness) {
    await harness.teardown();
  }
});

async function setDualSidebars(open = true) {
  await cdp.evaluate(`
    (() => {
      const s = window.__STORE__;
      if (s) {
        s.setLeftSidebarOpen(${open});
        s.setRightInspectorOpen(${open});
        if (${open} && !s.selectedEvent() && s.viewportEvents().length > 0) {
          s.setSelectedEvent(s.viewportEvents()[0]);
        }
      }
      return true;
    })()
  `);
  await new Promise((r) => setTimeout(r, 150));
}

async function setView(mode) {
  await cdp.evaluate(`
    (() => {
      if (window.__STORE__) {
        window.__STORE__.setViewMode(${JSON.stringify(mode)});
      }
      return true;
    })()
  `);
  await new Promise((r) => setTimeout(r, 150));
}

// ============================================================================
// TEST 1: MANDATORY DISPATCH VERIFICATION — h1 >= 80px & ZERO OVERFLOW ACROSS
// 960x640, 1024x768, 1280x800, 1920x1080 WITH DUAL SIDEBARS OPEN
// ============================================================================

suite.test("Empirically verify h1 date title width >= 80px & zero overflow with dual sidebars across target viewports", async () => {
  const targetViewports = [
    { width: 960, height: 640 },
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 }
  ];

  await setView("week");
  await setDualSidebars(true);

  const metricsTable = [];

  for (const vp of targetViewports) {
    await cdp.setViewport(vp.width, vp.height);
    await new Promise((r) => setTimeout(r, 200));

    const audit = await cdp.evaluate(`
      (() => {
        const docEl = document.documentElement;
        const body = document.body;
        const header = document.querySelector('header');
        const main = document.querySelector('main');
        const h1 = header ? header.querySelector('h1') : null;
        const leftSidebar = document.querySelector('aside.w-64');
        const rightInspector = document.querySelector('aside.w-80');

        const h1Rect = h1 ? h1.getBoundingClientRect() : null;
        const headerRect = header ? header.getBoundingClientRect() : null;

        const buttons = Array.from(header ? header.querySelectorAll('button') : []);
        const qaBtn = buttons.find(b => (b.getAttribute('title') || '').includes('Quick Add'));
        const qaRect = qaBtn ? qaBtn.getBoundingClientRect() : null;
        const settingsBtn = buttons.find(b => (b.getAttribute('title') || '').includes('Settings'));
        const settingsRect = settingsBtn ? settingsBtn.getBoundingClientRect() : null;

        return {
          viewport: '${vp.width}x${vp.height}',
          docElScrollWidth: docEl.scrollWidth,
          docElClientWidth: docEl.clientWidth,
          docElHasHOverflow: docEl.scrollWidth > docEl.clientWidth,
          bodyScrollWidth: body.scrollWidth,
          bodyClientWidth: body.clientWidth,
          bodyHasHOverflow: body.scrollWidth > body.clientWidth,
          headerScrollWidth: header ? header.scrollWidth : 0,
          headerClientWidth: header ? header.clientWidth : 0,
          headerHasHOverflow: header ? header.scrollWidth > header.clientWidth : false,
          headerHeight: headerRect ? Math.round(headerRect.height) : 0,
          h1Found: !!h1,
          h1Width: h1Rect ? parseFloat(h1Rect.width.toFixed(2)) : 0,
          h1Text: h1 ? (h1.innerText || '').trim() : '',
          leftSidebarFound: !!leftSidebar,
          rightInspectorFound: !!rightInspector,
          qaWidth: qaRect ? Math.round(qaRect.width) : 0,
          settingsWidth: settingsRect ? Math.round(settingsRect.width) : 0
        };
      })()
    `);

    assert.ok(audit, `Audit must succeed at ${vp.width}x${vp.height}`);
    assert.strictEqual(audit.leftSidebarFound, true, `Left sidebar must be mounted at ${vp.width}x${vp.height}`);
    assert.strictEqual(audit.rightInspectorFound, true, `Right inspector must be mounted at ${vp.width}x${vp.height}`);
    assert.strictEqual(audit.headerHeight, 48, `Header height must be exactly 48px at ${vp.width}x${vp.height}`);

    // Assert zero horizontal overflow
    assert.strictEqual(
      audit.docElHasHOverflow,
      false,
      `Document element horizontal overflow detected at ${vp.width}x${vp.height}: scrollWidth ${audit.docElScrollWidth} > clientWidth ${audit.docElClientWidth}`
    );
    assert.strictEqual(
      audit.bodyHasHOverflow,
      false,
      `Body horizontal overflow detected at ${vp.width}x${vp.height}: scrollWidth ${audit.bodyScrollWidth} > clientWidth ${audit.bodyClientWidth}`
    );
    assert.strictEqual(
      audit.headerHasHOverflow,
      false,
      `Header horizontal overflow detected at ${vp.width}x${vp.height}: scrollWidth ${audit.headerScrollWidth} > clientWidth ${audit.headerClientWidth}`
    );

    // Assert h1 width >= 80px
    assert.ok(
      audit.h1Width >= 80.0,
      `h1 date header width must be >= 80.0px across target viewports, got ${audit.h1Width}px at ${vp.width}x${vp.height}`
    );

    metricsTable.push(audit);
  }

  console.log("\n    [Mandatory Target Viewports Metrics Table (Dual Sidebars Open)]:");
  for (const m of metricsTable) {
    console.log(
      `      Viewport ${m.viewport}: h1 width = ${m.h1Width}px (>= 80px: PASS), QA width = ${m.qaWidth}px, Settings width = ${m.settingsWidth}px, H-Overflow: FALSE`
    );
  }
});

// ============================================================================
// TEST 2: ALL 6 VIEW MODES UNDER 960x640 WITH DUAL SIDEBARS OPEN
// ============================================================================

suite.test("Empirically verify all 6 view modes at minimum 960x640 with dual sidebars maintain h1 >= 80px & zero overflow", async () => {
  const modes = [
    { id: "day", label: "Day" },
    { id: "3day", label: "3-Day" },
    { id: "workweek", label: "Work Week" },
    { id: "week", label: "Week" },
    { id: "month", label: "Month" },
    { id: "agenda", label: "Schedule" }
  ];

  await cdp.setViewport(960, 640);
  await setDualSidebars(true);

  for (const m of modes) {
    await setView(m.id);

    const audit = await cdp.evaluate(`
      (() => {
        const header = document.querySelector('header');
        const h1 = header ? header.querySelector('h1') : null;
        const h1Rect = h1 ? h1.getBoundingClientRect() : null;
        const docEl = document.documentElement;
        const body = document.body;
        const main = document.querySelector('main');
        const s = window.__STORE__;

        return {
          mode: '${m.label}',
          headerFound: !!header,
          h1Found: !!h1,
          h1Width: h1Rect ? parseFloat(h1Rect.width.toFixed(2)) : 0,
          h1Text: h1 ? (h1.innerText || '').trim() : '',
          headerHasOverflow: header ? header.scrollWidth > header.clientWidth : false,
          docElHasOverflow: docEl.scrollWidth > docEl.clientWidth,
          bodyHasOverflow: body.scrollWidth > body.clientWidth,
          mainHasOverflow: main ? main.scrollWidth > main.clientWidth : false,
          storeAnchor: s ? String(s.anchorDate()) : 'no-store'
        };
      })()
    `);
    console.log("    [TEST 2 MODE]:", JSON.stringify(audit));

    assert.ok(
      audit.h1Width >= 80.0,
      `View mode '${m.label}' at 960x640 failed h1 width >= 80px: got ${audit.h1Width}px (text: "${audit.h1Text}")`
    );
    assert.strictEqual(
      audit.headerHasOverflow,
      false,
      `Header overflowed in mode '${m.label}' at 960x640`
    );
    assert.strictEqual(
      audit.docElHasOverflow,
      false,
      `Document element overflowed in mode '${m.label}' at 960x640`
    );
    assert.strictEqual(
      audit.bodyHasOverflow,
      false,
      `Body overflowed in mode '${m.label}' at 960x640`
    );
    assert.strictEqual(
      audit.mainHasOverflow,
      false,
      `Main element overflowed in mode '${m.label}' at 960x640`
    );
  }
});

// ============================================================================
// TEST 3: ADVERSARIAL DATE ANCHOR STRESS (LONGEST MONTH & DAY STRINGS)
// ============================================================================

suite.test("Adversarial Date Anchor: September 2026 and long Day format maintain h1 >= 80px & zero overflow at 960x640", async () => {
  await cdp.setViewport(960, 640);
  await setDualSidebars(true);

  // Set anchor date to September 30, 2026 (Wednesday) - longest month name "September 2026"
  await cdp.evaluate(`
    (() => {
      const s = window.__STORE__;
      if (s) {
        s.setAnchorDate(new Date(2026, 8, 30, 10, 0, 0)); // Month index 8 = September
      }
      return true;
    })()
  `);
  await new Promise((r) => setTimeout(r, 150));

  // Test in Week mode ("September 2026")
  await setView("week");
  const septWeekAudit = await cdp.evaluate(`
    (() => {
      const header = document.querySelector('header');
      const h1 = header ? header.querySelector('h1') : null;
      return {
        h1Text: h1 ? (h1.innerText || '').trim() : '',
        h1Width: h1 ? parseFloat(h1.getBoundingClientRect().width.toFixed(2)) : 0,
        hasOverflow: header ? header.scrollWidth > header.clientWidth : false
      };
    })()
  `);

  assert.strictEqual(septWeekAudit.h1Text, "September 2026");
  assert.ok(
    septWeekAudit.h1Width >= 80.0,
    `September 2026 header width must be >= 80px, got ${septWeekAudit.h1Width}px`
  );
  assert.strictEqual(septWeekAudit.hasOverflow, false, "September 2026 header must not overflow");

  // Test in Day mode ("Wed, Sep 30, 2026")
  await setView("day");
  const septDayAudit = await cdp.evaluate(`
    (() => {
      const header = document.querySelector('header');
      const h1 = header ? header.querySelector('h1') : null;
      const s = window.__STORE__;
      return {
        h1Text: h1 ? (h1.innerText || '').trim() : '',
        h1Width: h1 ? parseFloat(h1.getBoundingClientRect().width.toFixed(2)) : 0,
        hasOverflow: header ? header.scrollWidth > header.clientWidth : false,
        storeViewMode: s ? s.viewMode() : null,
        storeAnchorDate: s ? s.anchorDate().toISOString() : null
      };
    })()
  `);
  console.log("    [DIAGNOSTIC TEST 3]:", JSON.stringify(septDayAudit));

  assert.strictEqual(septDayAudit.h1Text, "Wed, Sep 30, 2026");
  assert.ok(
    septDayAudit.h1Width >= 80.0,
    `Wed, Sep 30, 2026 header width must be >= 80px, got ${septDayAudit.h1Width}px`
  );
  assert.strictEqual(septDayAudit.hasOverflow, false, "Day view header must not overflow");

  // Reset anchor date to default October 2026
  await cdp.evaluate(`
    (() => {
      const s = window.__STORE__;
      if (s) {
        s.setAnchorDate(new Date(2026, 9, 8, 10, 0, 0));
      }
      return true;
    })()
  `);
});

// ============================================================================
// TEST 4: ADVERSARIAL UP NEXT PILL COEXISTENCE AT 1280px & 1380px LAPTOP VIEWPORTS
// ============================================================================

suite.test("Adversarial Up Next Pill Coexistence: Active long meeting title does not compress h1 < 80px at 1280px or 1380px", async () => {
  // Inject an active meeting with a very long title
  await cdp.evaluate(`
    (async () => {
      const tauri = await import('/src/lib/tauri.ts');
      const store = await import('/src/store/calendarStore.ts');
      const now = Math.floor(Date.now() / 1000);
      await tauri.api.upsertEvent({
        id: 'adv-up-next-test',
        calendarId: 'cal-acme-eng',
        title: 'RapidCal Executive Architecture & Roadmap Sync 2026 Q4 Extra Long Title',
        startTs: now + 300,
        endTs: now + 3600,
        isAllDay: false,
        conferenceUrl: 'https://meet.google.com/abc-defg-hij'
      });
      await store.refreshMetadata();
    })()
  `);
  await setView("week");
  await setDualSidebars(true);

  const laptopViewports = [
    { width: 1280, height: 800 },
    { width: 1380, height: 860 }
  ];

  for (const vp of laptopViewports) {
    await cdp.setViewport(vp.width, vp.height);
    await new Promise((r) => setTimeout(r, 150));

    const audit = await cdp.evaluate(`
      (() => {
        const header = document.querySelector('header');
        const h1 = header ? header.querySelector('h1') : null;
        const pill = header ? header.querySelector('div[class*="rounded-full"][class*="border-indigo-500/30"]') : null;

        return {
          h1Width: h1 ? parseFloat(h1.getBoundingClientRect().width.toFixed(2)) : 0,
          h1Text: h1 ? (h1.innerText || '').trim() : '',
          pillFound: !!pill,
          pillWidth: pill ? Math.round(pill.getBoundingClientRect().width) : 0,
          headerHasOverflow: header ? header.scrollWidth > header.clientWidth : false
        };
      })()
    `);

    assert.ok(
      audit.h1Width >= 80.0,
      `h1 date title must maintain width >= 80px under long Up Next pill at ${vp.width}x${vp.height}, got ${audit.h1Width}px`
    );
    assert.strictEqual(
      audit.headerHasOverflow,
      false,
      `Header must have zero overflow with long Up Next pill at ${vp.width}x${vp.height}`
    );
  }
});

// ============================================================================
// TEST 5: GRANULAR STEP RESIZE SWEEP (960px to 1280px in 40px increments)
// ============================================================================

suite.test("Granular Step Resize Sweep: h1 width >= 80px & zero overflow from 960px to 1280px in 40px steps", async () => {
  await setView("week");
  await setDualSidebars(true);

  for (let w = 960; w <= 1280; w += 40) {
    await cdp.setViewport(w, 700);
    await new Promise((r) => setTimeout(r, 80));

    const audit = await cdp.evaluate(`
      (() => {
        const header = document.querySelector('header');
        const h1 = header ? header.querySelector('h1') : null;
        const docEl = document.documentElement;

        return {
          width: ${w},
          h1Width: h1 ? parseFloat(h1.getBoundingClientRect().width.toFixed(2)) : 0,
          headerOverflow: header ? header.scrollWidth > header.clientWidth : false,
          docOverflow: docEl.scrollWidth > docEl.clientWidth
        };
      })()
    `);

    assert.ok(
      audit.h1Width >= 80.0,
      `At stepped viewport ${w}px, h1 width dropped below 80px: got ${audit.h1Width}px`
    );
    assert.strictEqual(
      audit.headerOverflow,
      false,
      `Header overflowed at stepped viewport ${w}px`
    );
    assert.strictEqual(
      audit.docOverflow,
      false,
      `Document element overflowed at stepped viewport ${w}px`
    );
  }
});

if (process.argv[1]?.endsWith("challenger_m3_2_1_adversarial.test.js")) {
  suite.run().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}

export { suite };
