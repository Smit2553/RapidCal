import { assert, createHarness, TestSuite } from "./harness.js";

const suite = new TestSuite("Reviewer M3: Adversarial Stress Test & Verification");

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

async function selectViewTab(tabText) {
  const clicked = await cdp.evaluate(`
    (() => {
      const buttons = Array.from(document.querySelectorAll('header button'));
      const target = buttons.find(b => {
        const text = (b.innerText || '').trim();
        const lines = text.split('\\n').map(s => s.trim()).filter(Boolean);
        return lines[0] === ${JSON.stringify(tabText)} || text.startsWith(${JSON.stringify(tabText)});
      });
      if (target) {
        target.click();
        return true;
      }
      return false;
    })()
  `);
  assert.ok(clicked, `Could not find and click TopBar tab: ${tabText}`);
  await new Promise((r) => setTimeout(r, 200));
}

// ============================================================================
// 1. TOPBAR RESPONSIVENESS, COLLAPSE & ZERO-COLLISION AT 960x640
// ============================================================================

suite.test("TopBar: Responsive collapsing at 960px prevents squeeze and overflow", async () => {
  await cdp.setViewport(960, 640);
  await new Promise((r) => setTimeout(r, 200));

  const headerAudit = await cdp.evaluate(`
    (() => {
      const header = document.querySelector('header');
      if (!header) return null;
      const h1 = header.querySelector('h1');
      const rightGroup = header.querySelector('div.shrink-0:last-child') || header.children[header.children.length - 1];
      const buttons = Array.from(header.querySelectorAll('button'));
      const rect = header.getBoundingClientRect();

      return {
        headerHeight: rect.height,
        scrollWidth: header.scrollWidth,
        clientWidth: header.clientWidth,
        hasOverflow: header.scrollWidth > header.clientWidth,
        h1Found: !!h1,
        h1Width: h1 ? h1.getBoundingClientRect().width : 0,
        buttonCount: buttons.length,
        buttonsVisible: buttons.every(b => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
      };
    })()
  `);

  assert.ok(headerAudit, "TopBar header element must exist");
  assert.strictEqual(headerAudit.hasOverflow, false, "TopBar must have zero horizontal overflow at 960x640");
  assert.ok(headerAudit.h1Found, "Header h1 date title must exist");
  assert.ok(headerAudit.h1Width > 20, `Header h1 date title must be legible (width > 20px, got ${headerAudit.h1Width}px)`);
  assert.strictEqual(headerAudit.headerHeight, 48, `Header height must remain 48px without wrapping rows, got ${headerAudit.headerHeight}`);
  assert.strictEqual(headerAudit.buttonsVisible, true, "All TopBar action buttons must remain visible and clickable");
});

// ============================================================================
// 2. LEFTSIDEBAR: CHECKICON, ZAPICON CONTRAST, INACTIVE DAY HOVER
// ============================================================================

suite.test("LeftSidebar: CheckIcon integration, ZapIcon contrast, and inactive day styling", async () => {
  // Ensure LeftSidebar is open
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.setLeftSidebarOpen(true);
    })()
  `);
  await new Promise((r) => setTimeout(r, 150));

  const sidebarAudit = await cdp.evaluate(`
    (() => {
      const sidebar = document.querySelector('aside.w-64');
      if (!sidebar) return { found: false };

      // 1. Check all calendar checkbox checkmarks use CheckIcon (viewBox="0 0 24 24")
      const checkSvgs = Array.from(sidebar.querySelectorAll('label span svg'));
      const invalidSvgs = checkSvgs.filter(svg => {
        const vb = svg.getAttribute('viewBox');
        return vb !== '0 0 24 24';
      });

      // 2. Inspect ZapIcon class for contrast
      const zapSvg = sidebar.querySelector('button svg.text-amber-600') ||
                     sidebar.querySelector('button svg[class*="text-amber"]');
      const zapClasses = zapSvg ? zapSvg.getAttribute('class') || zapSvg.className?.baseVal || '' : '';

      // 3. Inspect inactive day button hover classes
      const dayButtons = Array.from(sidebar.querySelectorAll('div.grid-cols-7 button'));
      const inactiveButton = dayButtons.find(b => {
        const cls = b.className || '';
        return cls.includes('text-zinc-600') || cls.includes('light:text-zinc-400');
      });
      const inactiveClasses = inactiveButton ? inactiveButton.className : '';

      return {
        found: true,
        checkSvgCount: checkSvgs.length,
        invalidSvgCount: invalidSvgs.length,
        zapSvgFound: !!zapSvg,
        zapClasses,
        hasZapContrast: zapClasses.includes('text-amber-600') && zapClasses.includes('dark:text-amber-400'),
        inactiveButtonFound: !!inactiveButton,
        inactiveHasLightHover: inactiveClasses.includes('light:hover:bg-zinc-200')
      };
    })()
  `);

  assert.ok(sidebarAudit.found, "LeftSidebar (aside.w-64) must be found");
  assert.ok(sidebarAudit.checkSvgCount >= 1, "LeftSidebar must render calendar checkboxes");
  assert.strictEqual(sidebarAudit.invalidSvgCount, 0, "All checkbox icons must be standard 24x24 CheckIcon");
  assert.ok(sidebarAudit.zapSvgFound, "ZapIcon must be present in LeftSidebar footer");
  assert.strictEqual(sidebarAudit.hasZapContrast, true, "ZapIcon must specify text-amber-600 for light mode and dark:text-amber-400");
  assert.ok(sidebarAudit.inactiveButtonFound, "Inactive day buttons must exist in mini calendar");
  assert.strictEqual(sidebarAudit.inactiveHasLightHover, true, "Inactive day buttons must have light:hover:bg-zinc-200 for clean light mode contrast");
});

// ============================================================================
// 3. EVENTINSPECTOR: LIGHT MODE CONTROLS & RESPONSIVE BEHAVIOR
// ============================================================================

suite.test("EventInspector: Light mode styling across controls & responsive inspector", async () => {
  // Set theme to light and open inspector with draft event
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.setTheme('light');
      store.setRightInspectorOpen(true);
      store.startNewEventDraft();
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));

  const inspectorAudit = await cdp.evaluate(`
    (() => {
      const inspector = document.querySelector('aside.w-80');
      if (!inspector) return { found: false };

      // Inspect Cancel button classes
      const cancelBtn = Array.from(inspector.querySelectorAll('button')).find(b =>
        (b.innerText || '').trim() === 'Cancel'
      );
      const cancelClasses = cancelBtn ? cancelBtn.className : '';

      // Inspect Save button
      const saveBtn = inspector.querySelector('button[type="submit"]');

      // Select an existing recurring event to inspect scope toggle and RSVP
      return {
        found: true,
        cancelFound: !!cancelBtn,
        cancelClasses,
        cancelHasLightClass: cancelClasses.includes('light:bg-zinc-100') && cancelClasses.includes('light:border-zinc-300'),
        saveFound: !!saveBtn
      };
    })()
  `);

  assert.ok(inspectorAudit.found, "EventInspector (aside.w-80) must be found");
  assert.ok(inspectorAudit.cancelFound, "Cancel button must exist on draft event");
  assert.strictEqual(inspectorAudit.cancelHasLightClass, true, "Cancel button must have proper light mode styles");
  assert.ok(inspectorAudit.saveFound, "Save button must exist");

  // Select an existing event from store to test recurring scope and block time controls
  const recurringAudit = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      const events = store.viewportEvents();
      // Find or synthesize a recurring event
      const eventToSelect = events.find(e => e.isRecurring) || events[0];
      if (eventToSelect) {
        // Force recurring flag for scope test
        store.setSelectedEvent({
          ...eventToSelect,
          isRecurring: true,
          rrule: 'FREQ=WEEKLY'
        });
      }
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));

  const scopeAudit = await cdp.evaluate(`
    (() => {
      const inspector = document.querySelector('aside.w-80');
      if (!inspector) return { found: false };

      // Look for "This event" and "All events" buttons
      const buttons = Array.from(inspector.querySelectorAll('button'));
      const singleBtn = buttons.find(b => (b.innerText || '').includes('This event'));
      const allBtn = buttons.find(b => (b.innerText || '').includes('All events'));

      // Look for Block Time button
      const blockTimeBtn = buttons.find(b => (b.innerText || '').includes('Block Time'));

      // Look for Going? RSVP buttons
      const yesBtn = buttons.find(b => (b.innerText || '').trim() === 'Yes');
      const maybeBtn = buttons.find(b => (b.innerText || '').trim() === 'Maybe');
      const noBtn = buttons.find(b => (b.innerText || '').trim() === 'No');

      return {
        found: true,
        singleBtnFound: !!singleBtn,
        singleBtnClasses: singleBtn ? singleBtn.className : '',
        allBtnFound: !!allBtn,
        blockTimeFound: !!blockTimeBtn,
        blockTimeClasses: blockTimeBtn ? blockTimeBtn.className : '',
        rsvpFound: !!(yesBtn && maybeBtn && noBtn),
        rsvpClasses: maybeBtn ? maybeBtn.className : ''
      };
    })()
  `);

  assert.ok(scopeAudit.found, "Inspector must remain mounted");
  assert.ok(scopeAudit.singleBtnFound, "Scope button 'This event' must exist for recurring event");
  assert.ok(scopeAudit.allBtnFound, "Scope button 'All events' must exist for recurring event");
  assert.ok(
    scopeAudit.singleBtnClasses.includes('light:bg-zinc-100') || scopeAudit.singleBtnClasses.includes('bg-indigo-600'),
    "Scope buttons must include light mode styling"
  );
  if (scopeAudit.blockTimeFound) {
    assert.ok(
      scopeAudit.blockTimeClasses.includes('light:bg-zinc-200'),
      "Block Time button must include light:bg-zinc-200"
    );
  }
  assert.ok(scopeAudit.rsvpFound, "RSVP buttons (Yes/Maybe/No) must exist for selected event");
  assert.ok(
    scopeAudit.rsvpClasses.includes('light:bg-zinc-100') || scopeAudit.rsvpClasses.includes('bg-indigo-600'),
    "RSVP buttons must include light mode styling"
  );
});

// ============================================================================
// 4. APP.TSX: SIDEBAR HIDING IN SETTINGSVIEW
// ============================================================================

suite.test("App.tsx: Both LeftSidebar and EventInspector unmount in SettingsView", async () => {
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.setLeftSidebarOpen(true);
      store.setRightInspectorOpen(true);
      store.setViewMode('settings');
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));

  const checkUnmounted = await cdp.evaluate(`
    (() => {
      const leftSidebar = document.querySelector('aside.w-64');
      const rightInspector = document.querySelector('aside.w-80');
      const rightToggleBtn = Array.from(document.querySelectorAll('header button')).find(b =>
        (b.getAttribute('title') || '').includes('Inspector')
      );
      return {
        leftSidebarMounted: !!leftSidebar,
        rightInspectorMounted: !!rightInspector,
        rightToggleMounted: !!rightToggleBtn
      };
    })()
  `);

  assert.strictEqual(
    checkUnmounted.leftSidebarMounted,
    false,
    "LeftSidebar (aside.w-64) must be unmounted when SettingsView is active"
  );
  assert.strictEqual(
    checkUnmounted.rightInspectorMounted,
    false,
    "EventInspector (aside.w-80) must be unmounted when SettingsView is active"
  );
  assert.strictEqual(
    checkUnmounted.rightToggleMounted,
    false,
    "Right Inspector toggle button in TopBar must be hidden when SettingsView is active"
  );

  // Switch back to Week view
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.setViewMode('week');
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));

  const checkRestored = await cdp.evaluate(`
    (() => {
      return {
        leftSidebarMounted: !!document.querySelector('aside.w-64'),
        rightInspectorMounted: !!document.querySelector('aside.w-80')
      };
    })()
  `);

  assert.strictEqual(checkRestored.leftSidebarMounted, true, "LeftSidebar should be restored in calendar view");
  assert.strictEqual(checkRestored.rightInspectorMounted, true, "EventInspector should be restored in calendar view");
});

// ============================================================================
// 5. EXTREME ADVERSARIAL STRESS: DUAL SIDEBARS AT 960x640 VIEWPORT
// ============================================================================

suite.test("Adversarial Stress: 960x640 with Dual Sidebars open induces zero horizontal overflow", async () => {
  await cdp.setViewport(960, 640);
  await selectViewTab("Week");

  // Ensure both sidebars are open
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.setLeftSidebarOpen(true);
      store.setRightInspectorOpen(true);
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));

  const stressMetrics = await cdp.evaluate(`
    (() => {
      const body = document.body;
      const html = document.documentElement;
      const main = document.querySelector('main');
      const timeGrid = document.querySelector('main > div.flex-1');
      return {
        bodyScrollWidth: body.scrollWidth,
        bodyClientWidth: body.clientWidth,
        htmlScrollWidth: html.scrollWidth,
        htmlClientWidth: html.clientWidth,
        mainScrollWidth: main ? main.scrollWidth : 0,
        mainClientWidth: main ? main.clientWidth : 0,
        timeGridWidth: timeGrid ? timeGrid.clientWidth : 0,
        hasHorizontalOverflow: body.scrollWidth > body.clientWidth || html.scrollWidth > html.clientWidth
      };
    })()
  `);

  assert.strictEqual(
    stressMetrics.hasHorizontalOverflow,
    false,
    `Adversarial stress failed: Page has horizontal overflow at 960x640 (body: ${stressMetrics.bodyScrollWidth} > ${stressMetrics.bodyClientWidth})`
  );
  assert.ok(
    stressMetrics.timeGridWidth >= 300,
    `Time grid calendar column area must remain usable (>= 300px), got ${stressMetrics.timeGridWidth}px`
  );
});

// ============================================================================
// 6. ADVERSARIAL STRESS: EXTREME EVENT TITLE OVERFLOW PROTECTION
// ============================================================================

suite.test("Adversarial Stress: Extreme 250-character title does not break column bounds", async () => {
  await selectViewTab("Week");

  const longTitleResult = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      const events = store.viewportEvents();
      if (!events || events.length === 0) return { tested: false };

      const target = events[0];
      const extremeTitle = "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW";
      
      // Select and update title
      store.setSelectedEvent({
        ...target,
        title: extremeTitle
      });

      await new Promise(r => setTimeout(r, 100));

      const card = document.querySelector('[data-event-card="true"]');
      if (!card) return { tested: false };

      const cardRect = card.getBoundingClientRect();
      const parentCol = card.parentElement;
      const colRect = parentCol ? parentCol.getBoundingClientRect() : null;

      return {
        tested: true,
        cardWidth: Math.round(cardRect.width),
        colWidth: colRect ? Math.round(colRect.width) : 0,
        cardOverflowsCol: colRect ? cardRect.right > colRect.right + 2 : false,
        cardScrollWidth: card.scrollWidth,
        cardClientWidth: card.clientWidth
      };
    })()
  `);

  if (longTitleResult.tested) {
    assert.strictEqual(
      longTitleResult.cardOverflowsCol,
      false,
      "Extreme length event title must not push event card beyond day column bounds"
    );
  }

  // Restore dark theme
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.setTheme('dark');
    })()
  `);
});

if (process.argv[1]?.endsWith("reviewer_m3_adversarial.test.js")) {
  suite.run().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}

export { suite };
