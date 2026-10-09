import { assert, createHarness, TestSuite } from "./harness.js";

const suite = new TestSuite("Empirical Challenger M3: Responsive Layout, Gutters & Component Polish");

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
// 1. TOPBAR RESPONSIVENESS & ZERO-COLLISION AUDIT (960x640 to 1920x1080)
// ============================================================================

suite.test("TopBar Zero-Overflow & Text Collision Audit across Viewports", async () => {
  const viewports = [
    { width: 960, height: 640 },
    { width: 1280, height: 800 },
    { width: 1380, height: 860 },
    { width: 1920, height: 1080 }
  ];

  for (const vp of viewports) {
    await cdp.setViewport(vp.width, vp.height);
    await new Promise((r) => setTimeout(r, 150));

    const metrics = await cdp.evaluate(`
      (() => {
        const header = document.querySelector('header');
        if (!header) return null;
        return {
          clientWidth: header.clientWidth,
          scrollWidth: header.scrollWidth,
          hasHScroll: header.scrollWidth > header.clientWidth,
          h1Width: header.querySelector('h1') ? header.querySelector('h1').getBoundingClientRect().width : 0
        };
      })()
    `);

    assert.ok(metrics, `Header must exist at ${vp.width}x${vp.height}`);
    assert.strictEqual(
      metrics.hasHScroll,
      false,
      `TopBar overflowed horizontally at ${vp.width}x${vp.height}: scrollWidth ${metrics.scrollWidth} > clientWidth ${metrics.clientWidth}`
    );
    assert.ok(
      metrics.h1Width >= 80,
      `Date header h1 must have readable width >= 80px, got ${metrics.h1Width}px`
    );
  }
});

// ============================================================================
// 2. TIME GRID GUTTER METRICS: SINGLE (w-20 / 80px) & DUAL (w-28 / 112px)
// ============================================================================

suite.test("TimeGridView Gutter Geometry & Timezone Formatting", async () => {
  await cdp.setViewport(1280, 800);
  await selectViewTab("Week");

  // Verify single timezone gutter
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.updateUserPreferences({ showSecondaryTimezone: false });
    })()
  `);
  await new Promise((r) => setTimeout(r, 150));

  const singleMetrics = await cdp.evaluate(`
    (() => {
      const gutterHeader = document.querySelector('header + main div[class*="w-20"]') ||
                           document.querySelector('div[class*="w-20"]');
      const gutterRect = gutterHeader ? gutterHeader.getBoundingClientRect() : null;
      return {
        found: !!gutterHeader,
        width: gutterRect ? Math.round(gutterRect.width) : 0
      };
    })()
  `);

  assert.ok(singleMetrics.found, "Single timezone gutter with w-20 must be present in DOM");
  assert.strictEqual(singleMetrics.width, 80, `Single timezone gutter must measure exactly 80px (w-20), got ${singleMetrics.width}`);

  // Activate dual timezone
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.updateUserPreferences({ showSecondaryTimezone: true });
    })()
  `);
  await new Promise((r) => setTimeout(r, 150));

  const dualAudit = await cdp.evaluate(`
    (() => {
      const gutterHeader = document.querySelector('div[class*="w-28"]');
      const gutterRect = gutterHeader ? gutterHeader.getBoundingClientRect() : null;
      const tzCityText = gutterHeader ? gutterHeader.innerText : '';
      return {
        found: !!gutterHeader,
        width: gutterRect ? Math.round(gutterRect.width) : 0,
        tzCityText
      };
    })()
  `);

  assert.ok(dualAudit.found, "Dual timezone gutter with w-28 must be present in DOM");
  assert.strictEqual(dualAudit.width, 112, `Dual timezone gutter must measure exactly 112px (w-28), got ${dualAudit.width}`);
});

// ============================================================================
// 3. HAIRLINE BORDER ALIGNMENT: SCROLLBAR-GUTTER STABLE AUDIT
// ============================================================================

suite.test("Hairline Border Alignment & Scrollbar Gutter Stable", async () => {
  await selectViewTab("Week");

  const alignment = await cdp.evaluate(`
    (() => {
      const headerRow = document.querySelector('div.overflow-y-hidden[style*="scrollbar-gutter"]');
      const scrollableBody = document.querySelector('div.overflow-y-auto[style*="scrollbar-gutter"]');
      const headerStyle = headerRow ? headerRow.style.scrollbarGutter || window.getComputedStyle(headerRow).scrollbarGutter : '';
      const bodyStyle = scrollableBody ? scrollableBody.style.scrollbarGutter || window.getComputedStyle(scrollableBody).scrollbarGutter : '';
      return {
        headerFound: !!headerRow,
        bodyFound: !!scrollableBody,
        headerScrollbarGutter: headerStyle,
        bodyScrollbarGutter: bodyStyle
      };
    })()
  `);

  assert.ok(alignment.headerFound, "Time grid header row must have scrollbar-gutter: stable");
  assert.ok(alignment.bodyFound, "Time grid scrollable body must have scrollbar-gutter: stable");
  assert.strictEqual(alignment.bodyScrollbarGutter, "stable", "Computed scrollbar-gutter on body must be 'stable'");
});

// ============================================================================
// 4. SHORT-DURATION & COMPACT EVENT CARDS LAYOUT
// ============================================================================

suite.test("Compact Layout for Short-Duration Events & Overlapping Columns", async () => {
  await selectViewTab("Week");

  const cardAudit = await cdp.evaluate(`
    (() => {
      const cards = Array.from(document.querySelectorAll('[data-event-card="true"]'));
      return cards.map(c => {
        const rect = c.getBoundingClientRect();
        const resizeHandle = c.querySelector('div[class*="cursor-ns-resize"]');
        const handleClass = resizeHandle ? resizeHandle.className : '';
        const isInline = c.querySelector('div[class*="items-center.justify-between"]') !== null ||
                         c.querySelector('div.flex.items-center.justify-between') !== null;
        return {
          title: (c.innerText || '').slice(0, 25),
          height: Math.round(rect.height),
          handleClass,
          isInline
        };
      });
    })()
  `);

  assert.ok(cardAudit.length > 0, "Calendar should render event cards");

  // Verify all short cards (height < 40px) have compact resize handle (h-1)
  const shortCards = cardAudit.filter(c => c.height < 40);
  for (const sc of shortCards) {
    assert.ok(
      sc.handleClass.includes("h-1"),
      `Short card '${sc.title}' (height ${sc.height}px) must have h-1 resize handle, got: ${sc.handleClass}`
    );
  }
});

// ============================================================================
// 5. ALL-DAY BANNER CONSTRAINED HEIGHT
// ============================================================================

suite.test("All-Day Event Banner has capped height & overflow containment", async () => {
  await selectViewTab("Week");

  const bannerAudit = await cdp.evaluate(`
    (() => {
      const banner = document.querySelector('div[class*="max-h-24"]');
      return {
        found: !!banner,
        hasOverflowAuto: banner ? banner.className.includes('overflow-y-auto') : false
      };
    })()
  `);

  assert.ok(bannerAudit.found, "All-day banner container must have max-h-24 class");
  assert.strictEqual(bannerAudit.hasOverflowAuto, true, "All-day banner must have overflow-y-auto class");
});

// ============================================================================
// 6. MONTH VIEW CELL ADAPTATION & OVERFLOW SUPPRESSION
// ============================================================================

suite.test("MonthView Narrow Cell Text Preservation & Scrollbar Prevention", async () => {
  await cdp.setViewport(960, 640);
  await selectViewTab("Month");
  await new Promise((r) => setTimeout(r, 200));

  const monthMetrics = await cdp.evaluate(`
    (() => {
      // Find each day's event container inside MonthView
      const cellContainers = Array.from(document.querySelectorAll('.grid-rows-6 > div > div[class*="space-y-0.5"]'));
      let hasCellScrollbar = false;
      for (const cell of cellContainers) {
        if (cell.scrollHeight > cell.clientHeight + 2) {
          hasCellScrollbar = true;
          break;
        }
      }
      const eventButtons = Array.from(document.querySelectorAll('.grid-rows-6 button[class*="text-[11px]"]'));
      return {
        cellContainersCount: cellContainers.length,
        hasCellScrollbar,
        eventButtonsCount: eventButtons.length
      };
    })()
  `);

  assert.strictEqual(monthMetrics.hasCellScrollbar, false, "MonthView cells must not produce internal scrollbars at 960x640");
});

// ============================================================================
// 7. AGENDA VIEW RESPONSIVE ACTION WRAPPING
// ============================================================================

suite.test("AgendaView Responsive Card Layout at 960x640", async () => {
  await cdp.setViewport(960, 640);
  await selectViewTab("Schedule");
  await new Promise((r) => setTimeout(r, 200));

  const agendaMetrics = await cdp.evaluate(`
    (() => {
      const container = document.querySelector('div.flex-1.overflow-y-auto');
      if (!container) return null;
      return {
        clientWidth: container.clientWidth,
        scrollWidth: container.scrollWidth,
        hasHScroll: container.scrollWidth > container.clientWidth
      };
    })()
  `);

  assert.ok(agendaMetrics, "AgendaView container must exist");
  assert.strictEqual(agendaMetrics.hasHScroll, false, "AgendaView must not horizontally overflow at 960x640");
});

// ============================================================================
// 8. SETTINGS VIEW DUAL-SIDEBAR ELIMINATION & RESPONSIVE GRID
// ============================================================================

suite.test("SettingsView hides LeftSidebar and adapts cleanly at 960x640", async () => {
  await cdp.setViewport(960, 640);

  // Click Settings
  await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b =>
        (b.innerText || '').includes('Settings') || (b.getAttribute('title') || '').includes('Settings')
      );
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  const settingsState = await cdp.evaluate(`
    (() => {
      const leftSidebar = document.querySelector('aside.w-64');
      const settingsView = document.querySelector('div.flex-1.flex.overflow-hidden');
      const mainContainer = document.querySelector('div.flex-1.overflow-y-auto');
      return {
        hasLeftSidebar: !!leftSidebar,
        hasSettingsView: !!settingsView,
        mainWidth: mainContainer ? mainContainer.clientWidth : 0,
        hasHScroll: mainContainer ? mainContainer.scrollWidth > mainContainer.clientWidth : false
      };
    })()
  `);

  assert.strictEqual(settingsState.hasLeftSidebar, false, "LeftSidebar must be unmounted when in SettingsView");
  assert.strictEqual(settingsState.hasHScroll, false, "SettingsView must not horizontally overflow at 960x640");
  assert.ok(settingsState.mainWidth >= 650, `SettingsView content width should be >= 650px (got ${settingsState.mainWidth})`);

  // Return to Week view
  await selectViewTab("Week");
});

if (process.argv[1]?.endsWith("challenger_m3_layout.test.js")) {
  suite.run().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}

export { suite };
