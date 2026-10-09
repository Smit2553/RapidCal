import { assert, createHarness, TestSuite } from "./harness.js";

const suite = new TestSuite(
  "Empirical Challenger M3-2: TimeGridView Gutters, Short Cards, MonthView & AgendaView Precision Layouts"
);

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

// Helper to switch view by clicking TopBar tab
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

// Helper to ensure LeftSidebar and EventInspector states
async function setSidebars({ left, right }) {
  await cdp.evaluate(`
    (() => {
      const leftOpen = Boolean(document.querySelector('aside.w-64'));
      const rightOpen = Boolean(document.querySelector('aside.w-80'));
      const buttons = Array.from(document.querySelectorAll('header button'));

      if (${left} && !leftOpen) {
        const btn = buttons.find(b => b.getAttribute('title')?.includes('Sidebar ([)'));
        if (btn) btn.click();
      } else if (!${left} && leftOpen) {
        const btn = buttons.find(b => b.getAttribute('title')?.includes('Sidebar ([)'));
        if (btn) btn.click();
      }

      if (${right} && !rightOpen) {
        const btn = buttons.find(b => b.getAttribute('title')?.includes('Inspector (])'));
        if (btn) btn.click();
      } else if (!${right} && rightOpen) {
        const btn = buttons.find(b => b.getAttribute('title')?.includes('Inspector (])'));
        if (btn) btn.click();
      }
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));
}

// ============================================================================
// 1. TIMEGRIDVIEW GUTTERS IN 12H AND 24H MODES (SINGLE TIMEZONE)
// ============================================================================

suite.test(
  "TimeGridView Single Timezone Gutter: 12h & 24h modes, width >= 80px, zero collision/wrapping",
  async () => {
    await cdp.setViewport(1280, 800);
    await selectViewTab("Week");

    // 1. Test 12-hour mode without secondary timezone
    await cdp.evaluate(`
      (async () => {
        const store = await import('/src/store/calendarStore.ts');
        store.updateUserPreferences({
          showSecondaryTimezone: false,
          timeFormat: '12h'
        });
      })()
    `);
    await new Promise((r) => setTimeout(r, 200));

    const audit12h = await cdp.evaluate(`
      (() => {
        const headerGutter = document.querySelector('header + main div[class*="w-20"]') ||
                             document.querySelector('main div[class*="w-20"]');
        const bodyGutter = document.querySelector('main div.overflow-y-auto > div[class*="w-20"]');
        if (!headerGutter || !bodyGutter) {
          return { found: false, error: 'Gutters not found' };
        }

        const headerRect = headerGutter.getBoundingClientRect();
        const bodyRect = bodyGutter.getBoundingClientRect();

        // Check header label (primary timezone abbr e.g. "MST" or "PST")
        const headerLabel = headerGutter.querySelector('span');
        const headerWraps = headerLabel ? headerLabel.scrollHeight > headerLabel.clientHeight + 1 : false;

        // Check all 24 hour rows
        const hourRows = Array.from(bodyGutter.children);
        const rowsAudit = hourRows.map((row, idx) => {
          const span = row.querySelector('span');
          if (!span) return { idx, hasSpan: false };
          const rect = span.getBoundingClientRect();
          const text = (span.innerText || '').trim();
          const wraps = rect.height > 18; // Single line font is ~10px, line-height <= 18px
          const overflows = span.scrollWidth > span.clientWidth + 1;
          return {
            idx,
            hasSpan: true,
            text,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            wraps,
            overflows
          };
        });

        return {
          found: true,
          headerWidth: Math.round(headerRect.width),
          bodyWidth: Math.round(bodyRect.width),
          headerText: headerLabel ? headerLabel.innerText.trim() : '',
          headerWraps,
          rowsCount: hourRows.length,
          rowsAudit
        };
      })()
    `);

    assert.ok(audit12h.found, "Single timezone gutter elements must exist in DOM");
    assert.ok(audit12h.headerWidth >= 80, `Header gutter width must be >= 80px (got ${audit12h.headerWidth}px)`);
    assert.strictEqual(audit12h.headerWidth, 80, `Header gutter width must be exactly 80px (w-20), got ${audit12h.headerWidth}px`);
    assert.strictEqual(audit12h.bodyWidth, 80, `Body gutter width must be exactly 80px (w-20), got ${audit12h.bodyWidth}px`);
    assert.ok(audit12h.headerText.length > 0, "Timezone header must display primary timezone");
    assert.strictEqual(audit12h.headerWraps, false, "Primary timezone header must not wrap");
    assert.strictEqual(audit12h.rowsCount, 24, "Time grid must have 24 hour rows");

    // Verify 12h labels format and absence of wrapping/overflow
    for (const r of audit12h.rowsAudit) {
      assert.ok(r.hasSpan, `Hour row ${r.idx} must contain a label span`);
      assert.ok(
        r.text.endsWith("AM") || r.text.endsWith("PM"),
        `Hour row ${r.idx} must be formatted in 12h mode (e.g. '12:00 PM'), got '${r.text}'`
      );
      assert.strictEqual(r.wraps, false, `Hour row ${r.idx} label '${r.text}' must not wrap (height ${r.height}px > 18px)`);
      assert.strictEqual(r.overflows, false, `Hour row ${r.idx} label '${r.text}' must not overflow horizontally`);
    }

    // 2. Test 24-hour mode without secondary timezone
    await cdp.evaluate(`
      (async () => {
        const store = await import('/src/store/calendarStore.ts');
        store.updateUserPreferences({
          showSecondaryTimezone: false,
          timeFormat: '24h'
        });
      })()
    `);
    await new Promise((r) => setTimeout(r, 200));

    const audit24h = await cdp.evaluate(`
      (() => {
        const bodyGutter = document.querySelector('main div.overflow-y-auto > div[class*="w-20"]');
        const hourRows = Array.from(bodyGutter.children);
        return hourRows.map((row, idx) => {
          const span = row.querySelector('span');
          const rect = span ? span.getBoundingClientRect() : null;
          const text = span ? span.innerText.trim() : '';
          return {
            idx,
            text,
            wraps: rect ? rect.height > 18 : false,
            overflows: span ? span.scrollWidth > span.clientWidth + 1 : false
          };
        });
      })()
    `);

    assert.strictEqual(audit24h.length, 24, "Time grid must have 24 hour rows in 24h mode");
    for (const r of audit24h) {
      assert.ok(
        /^\d{2}:00$/.test(r.text),
        `Hour row ${r.idx} in 24h mode must be formatted as 'HH:00', got '${r.text}'`
      );
      assert.strictEqual(r.wraps, false, `Hour row ${r.idx} label '${r.text}' must not wrap`);
      assert.strictEqual(r.overflows, false, `Hour row ${r.idx} label '${r.text}' must not overflow`);
    }
  }
);

// ============================================================================
// 2. TIMEGRIDVIEW GUTTERS IN 12H AND 24H MODES (DUAL TIMEZONE)
// ============================================================================

suite.test(
  "TimeGridView Dual Timezone Gutter: 12h & 24h modes, width >= 112px, zero collision/wrapping across timezones",
  async () => {
    await cdp.setViewport(1280, 800);
    await selectViewTab("Week");

    const timezonesToTest = [
      { iana: "America/New_York", expectedTag: "NYC" },
      { iana: "Europe/London", expectedTag: "LON" },
      { iana: "Asia/Tokyo", expectedTag: "TYO" },
      { iana: "Australia/Sydney", expectedTag: "SYD" },
      { iana: "Asia/Kolkata", expectedTag: "DEL" },
      { iana: "UTC", expectedTag: "UTC" }
    ];

    for (const tz of timezonesToTest) {
      // Configure dual timezone with 12h
      await cdp.evaluate(`
        (async () => {
          const store = await import('/src/store/calendarStore.ts');
          store.setOAuthConfig({
            ...store.oauthConfig(),
            secondaryTimezone: ${JSON.stringify(tz.iana)}
          });
          store.updateUserPreferences({
            showSecondaryTimezone: true,
            timeFormat: '12h'
          });
        })()
      `);
      await new Promise((r) => setTimeout(r, 200));

      const dualAudit = await cdp.evaluate(`
        (() => {
          const headerGutter = document.querySelector('header + main div[class*="w-28"]') ||
                               document.querySelector('main div[class*="w-28"]');
          const bodyGutter = document.querySelector('main div.overflow-y-auto > div[class*="w-28"]');
          if (!headerGutter || !bodyGutter) {
            return { found: false, error: 'Dual timezone gutters not found' };
          }

          const headerRect = headerGutter.getBoundingClientRect();
          const bodyRect = bodyGutter.getBoundingClientRect();

          // Header sub-columns
          const headerSpans = Array.from(headerGutter.querySelectorAll('span'));
          const secHeaderSpan = headerSpans[0];
          const priHeaderSpan = headerSpans[1];
          const secHeaderRect = secHeaderSpan ? secHeaderSpan.getBoundingClientRect() : null;
          const priHeaderRect = priHeaderSpan ? priHeaderSpan.getBoundingClientRect() : null;

          // Check header collision & wrapping
          const headerCollides = secHeaderRect && priHeaderRect ? secHeaderRect.right > priHeaderRect.left + 1 : false;
          const secHeaderWraps = secHeaderRect ? secHeaderRect.height > 18 : false;
          const priHeaderWraps = priHeaderRect ? priHeaderRect.height > 18 : false;

          // Hour rows
          const rows = Array.from(bodyGutter.children);
          const rowsAudit = rows.map((row, idx) => {
            const spans = Array.from(row.querySelectorAll('span'));
            if (spans.length < 2) return { idx, hasTwoSpans: false };
            const s0 = spans[0];
            const s1 = spans[1];
            const r0 = s0.getBoundingClientRect();
            const r1 = s1.getBoundingClientRect();
            const collides = r0.right > r1.left + 1; // Tolerance 1px
            const wraps0 = r0.height > 18;
            const wraps1 = r1.height > 18;
            return {
              idx,
              hasTwoSpans: true,
              text0: s0.innerText.trim(),
              text1: s1.innerText.trim(),
              r0Right: r0.right,
              r1Left: r1.left,
              collides,
              wraps0,
              wraps1
            };
          });

          return {
            found: true,
            headerWidth: Math.round(headerRect.width),
            bodyWidth: Math.round(bodyRect.width),
            secHeaderText: secHeaderSpan ? secHeaderSpan.innerText.trim() : '',
            priHeaderText: priHeaderSpan ? priHeaderSpan.innerText.trim() : '',
            headerCollides,
            secHeaderWraps,
            priHeaderWraps,
            rowsAudit
          };
        })()
      `);

      assert.ok(dualAudit.found, `Dual timezone gutter must exist for timezone ${tz.iana}`);
      assert.ok(dualAudit.headerWidth >= 112, `Dual header gutter width must be >= 112px, got ${dualAudit.headerWidth}px`);
      assert.strictEqual(dualAudit.headerWidth, 112, `Dual header gutter width must be exactly 112px (w-28), got ${dualAudit.headerWidth}px`);
      assert.strictEqual(dualAudit.bodyWidth, 112, `Dual body gutter width must be exactly 112px (w-28), got ${dualAudit.bodyWidth}px`);
      assert.strictEqual(dualAudit.secHeaderText, tz.expectedTag, `Expected city abbreviation tag '${tz.expectedTag}' for '${tz.iana}', got '${dualAudit.secHeaderText}'`);
      assert.strictEqual(dualAudit.headerCollides, false, `Timezone header tags must not collide horizontally for ${tz.iana}`);
      assert.strictEqual(dualAudit.secHeaderWraps, false, `Secondary timezone header tag '${dualAudit.secHeaderText}' must not wrap`);
      assert.strictEqual(dualAudit.priHeaderWraps, false, `Primary timezone header tag '${dualAudit.priHeaderText}' must not wrap`);

      // Verify all 24 hour rows in dual timezone
      for (const r of dualAudit.rowsAudit) {
        assert.ok(r.hasTwoSpans, `Hour row ${r.idx} must have 2 spans for dual timezone`);
        assert.strictEqual(r.collides, false, `Hour row ${r.idx} labels '${r.text0}' and '${r.text1}' collided horizontally (${r.r0Right} > ${r.r1Left})`);
        assert.strictEqual(r.wraps0, false, `Secondary label '${r.text0}' wrapped in row ${r.idx}`);
        assert.strictEqual(r.wraps1, false, `Primary label '${r.text1}' wrapped in row ${r.idx}`);
      }
    }

    // Now test dual timezone in 24h mode
    await cdp.evaluate(`
      (async () => {
        const store = await import('/src/store/calendarStore.ts');
        store.updateUserPreferences({
          showSecondaryTimezone: true,
          timeFormat: '24h'
        });
      })()
    `);
    await new Promise((r) => setTimeout(r, 200));

    const dual24hAudit = await cdp.evaluate(`
      (() => {
        const bodyGutter = document.querySelector('main div.overflow-y-auto > div[class*="w-28"]');
        const rows = Array.from(bodyGutter.children);
        return rows.map((row, idx) => {
          const spans = Array.from(row.querySelectorAll('span'));
          const r0 = spans[0]?.getBoundingClientRect();
          const r1 = spans[1]?.getBoundingClientRect();
          return {
            idx,
            text0: spans[0]?.innerText.trim(),
            text1: spans[1]?.innerText.trim(),
            collides: r0 && r1 ? r0.right > r1.left + 1 : false,
            wraps: (r0 ? r0.height > 18 : false) || (r1 ? r1.height > 18 : false)
          };
        });
      })()
    `);

    for (const r of dual24hAudit) {
      assert.ok(/^\d{2}:00$/.test(r.text0), `Secondary hour '${r.text0}' must match HH:00 in row ${r.idx}`);
      assert.ok(/^\d{2}:00$/.test(r.text1), `Primary hour '${r.text1}' must match HH:00 in row ${r.idx}`);
      assert.strictEqual(r.collides, false, `Labels collided in row ${r.idx} 24h mode`);
      assert.strictEqual(r.wraps, false, `Label wrapped in row ${r.idx} 24h mode`);
    }
  }
);

// ============================================================================
// 3. SHORT-DURATION EVENT CARDS (15M & 30M) AND RESIZE HANDLE GEOMETRY
// ============================================================================

suite.test(
  "Short-Duration Event Cards (15m & 30m): min-height >= 20px, inline single-line layout, and h-1 resize handle",
  async () => {
    await cdp.setViewport(1280, 800);
    await selectViewTab("Week");

    // Inject 15m, 30m, and 60m test events on Monday of current week
    await cdp.evaluate(`
      (async () => {
        const store = await import('/src/store/calendarStore.ts');
        const dateUtils = await import('/src/lib/dateUtils.ts');
        const tauri = await import('/src/lib/tauri.ts');

        const monday = dateUtils.startOfWeekMonday(new Date());
        const baseTs = Math.floor(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 14, 0, 0).getTime() / 1000);

        // 15m event: 14:00 - 14:15
        await tauri.api.upsertEvent({
          id: 'test-evt-15m',
          calendarId: 'cal-acme-eng',
          title: 'Quick 15m Standup',
          startTs: baseTs,
          endTs: baseTs + 15 * 60,
          isAllDay: false
        });

        // 30m event: 14:30 - 15:00
        await tauri.api.upsertEvent({
          id: 'test-evt-30m',
          calendarId: 'cal-acme-eng',
          title: 'Sync 30m Meeting',
          startTs: baseTs + 30 * 60,
          endTs: baseTs + 60 * 60,
          isAllDay: false
        });

        // 60m tall event: 15:30 - 16:30
        await tauri.api.upsertEvent({
          id: 'test-evt-60m',
          calendarId: 'cal-acme-eng',
          title: 'Deep Work 60m Session',
          startTs: baseTs + 90 * 60,
          endTs: baseTs + 150 * 60,
          isAllDay: false
        });

        await store.refreshViewport();
      })()
    `);
    await new Promise((r) => setTimeout(r, 250));

    // Test across grid densities: compact (44px), standard (56px), spacious (72px)
    const densities = ["compact", "standard", "spacious"];

    for (const density of densities) {
      await cdp.evaluate(`
        (async () => {
          const store = await import('/src/store/calendarStore.ts');
          store.setGridDensity(${JSON.stringify(density)});
        })()
      `);
      await new Promise((r) => setTimeout(r, 200));

      const cardAudit = await cdp.evaluate(`
        (() => {
          const cards = Array.from(document.querySelectorAll('[data-event-card="true"]'));
          const target15m = cards.find(c => c.innerText.includes('Quick 15m Standup'));
          const target30m = cards.find(c => c.innerText.includes('Sync 30m Meeting'));
          const target60m = cards.find(c => c.innerText.includes('Deep Work 60m Session'));

          function inspectCard(card) {
            if (!card) return null;
            const rect = card.getBoundingClientRect();
            const resizeHandle = card.querySelector('div[class*="cursor-ns-resize"]');
            const handleClass = resizeHandle ? resizeHandle.className : '';
            const handleRect = resizeHandle ? resizeHandle.getBoundingClientRect() : null;

            // Check if inline flex row is active (single-line layout)
            const inlineContainer = card.querySelector('div.flex.items-center.justify-between');
            const isInline = Boolean(inlineContainer);

            // Text elements
            const titleEl = card.querySelector('span.font-semibold');
            const timeEl = card.querySelector('span.font-mono-tabular');
            const titleRect = titleEl ? titleEl.getBoundingClientRect() : null;
            const timeRect = timeEl ? timeEl.getBoundingClientRect() : null;

            return {
              height: Math.round(rect.height),
              width: Math.round(rect.width),
              isInline,
              handleClass,
              handleHeight: handleRect ? Math.round(handleRect.height) : 0,
              titleText: titleEl ? titleEl.innerText.trim() : '',
              timeText: timeEl ? timeEl.innerText.trim() : '',
              titleWidth: titleRect ? Math.round(titleRect.width) : 0,
              timeWidth: timeRect ? Math.round(timeRect.width) : 0
            };
          }

          return {
            card15m: inspectCard(target15m),
            card30m: inspectCard(target30m),
            card60m: inspectCard(target60m)
          };
        })()
      `);

      assert.ok(cardAudit.card15m, `15m card must be found at ${density} density`);
      assert.ok(cardAudit.card30m, `30m card must be found at ${density} density`);
      assert.ok(cardAudit.card60m, `60m card must be found at ${density} density`);

      // 1. Invariant for 15m card:
      // Height must be clamped to >= 20px (even when mathematical height is (15/60)*44-1 = 10px!)
      assert.ok(
        cardAudit.card15m.height >= 20,
        `15m card height must be >= 20px at ${density} density, got ${cardAudit.card15m.height}px`
      );
      assert.strictEqual(
        cardAudit.card15m.isInline,
        true,
        `15m card must use single-line inline layout at ${density} density`
      );
      assert.ok(
        cardAudit.card15m.handleClass.includes("h-1"),
        `15m card must have 'h-1' resize handle, got '${cardAudit.card15m.handleClass}'`
      );
      assert.ok(cardAudit.card15m.titleWidth > 0, "15m card title must be visible and have width > 0");
      assert.ok(cardAudit.card15m.timeWidth > 0, "15m card time must be visible and have width > 0");

      // 2. Invariant for 30m card:
      assert.ok(
        cardAudit.card30m.height >= 20,
        `30m card height must be >= 20px at ${density} density, got ${cardAudit.card30m.height}px`
      );
      assert.strictEqual(
        cardAudit.card30m.isInline,
        true,
        `30m card must use single-line inline layout at ${density} density`
      );
      assert.ok(
        cardAudit.card30m.handleClass.includes("h-1"),
        `30m card must have 'h-1' resize handle, got '${cardAudit.card30m.handleClass}'`
      );
      assert.ok(cardAudit.card30m.titleWidth > 0, "30m card title must be visible and have width > 0");
      assert.ok(cardAudit.card30m.timeWidth > 0, "30m card time must be visible and have width > 0");

      // 3. Invariant for 60m tall card:
      // Must use multiline layout (isInline is false) and h-2 handle
      assert.ok(
        cardAudit.card60m.height >= 40,
        `60m card height must be >= 40px at ${density} density, got ${cardAudit.card60m.height}px`
      );
      assert.strictEqual(
        cardAudit.card60m.isInline,
        false,
        `60m card must use multiline layout at ${density} density`
      );
      assert.ok(
        cardAudit.card60m.handleClass.includes("h-2"),
        `60m card must have 'h-2' resize handle, got '${cardAudit.card60m.handleClass}'`
      );
    }

    // Reset grid density to standard
    await cdp.evaluate(`
      (async () => {
        const store = await import('/src/store/calendarStore.ts');
        store.setGridDensity('standard');
      })()
    `);
  }
);

// ============================================================================
// 4. MONTHVIEW IN NARROW VIEWPORTS: TITLE PRESERVATION & +N BADGE NON-WRAPPING
// ============================================================================

suite.test(
  "MonthView Narrow Viewport: event titles preserved without timestamp crushing, +N badges do not wrap, zero internal scrollbars",
  async () => {
    // 1. Add multiple events to one day in Month view so overflow +N occurs
    await cdp.evaluate(`
      (async () => {
        const store = await import('/src/store/calendarStore.ts');
        const tauri = await import('/src/lib/tauri.ts');
        const now = store.anchorDate();
        const y = now.getFullYear();
        const m = now.getMonth();
        const targetDay = 15;

        for (let i = 1; i <= 5; i++) {
          const s = Math.floor(new Date(y, m, targetDay, 8 + i * 2, 0, 0).getTime() / 1000);
          await tauri.api.upsertEvent({
            id: 'month-overflow-evt-' + i,
            calendarId: 'cal-acme-eng',
            title: 'Project Milestone Review ' + i,
            startTs: s,
            endTs: s + 3600,
            isAllDay: false
          });
        }
        await store.refreshViewport();
      })()
    `);

    await selectViewTab("Month");
    await new Promise((r) => setTimeout(r, 200));

    // Test at narrow viewports: 960x640 with LeftSidebar open, and 960x640 with dual sidebars
    const viewConfigs = [
      { width: 960, height: 640, left: true, right: false, label: "960x640 LeftSidebar" },
      { width: 960, height: 640, left: true, right: true, label: "960x640 Dual Sidebars" },
      { width: 800, height: 600, left: false, right: false, label: "800x600 Clean" }
    ];

    for (const cfg of viewConfigs) {
      await cdp.setViewport(cfg.width, cfg.height);
      await setSidebars({ left: cfg.left, right: cfg.right });
      await new Promise((r) => setTimeout(r, 250));

      const monthAudit = await cdp.evaluate(`
        (() => {
          const monthGrid = document.querySelector('.grid-rows-6');
          if (!monthGrid) return { found: false };

          const cellContainers = Array.from(monthGrid.querySelectorAll(':scope > div'));
          let internalScrollbars = false;
          for (const c of cellContainers) {
            const eventBox = c.querySelector('div[class*="space-y-0.5"]');
            if (eventBox && eventBox.scrollHeight > eventBox.clientHeight + 2) {
              internalScrollbars = true;
              break;
            }
          }

          // Inspect event title buttons
          const eventButtons = Array.from(monthGrid.querySelectorAll('button[class*="text-[11px]"]'));
          const titlesAudit = eventButtons.map(btn => {
            const titleSpan = btn.querySelector('span.truncate.font-medium');
            const timeSpan = btn.querySelector('span.font-mono-tabular');
            const titleRect = titleSpan ? titleSpan.getBoundingClientRect() : null;
            const timeRect = timeSpan ? timeSpan.getBoundingClientRect() : null;
            return {
              titleText: titleSpan ? titleSpan.innerText.trim() : '',
              titleWidth: titleRect ? Math.round(titleRect.width) : 0,
              hasTimeSpan: Boolean(timeSpan && timeRect && timeRect.width > 0)
            };
          });

          // Inspect +N overflow badges
          const plusBadges = Array.from(monthGrid.querySelectorAll('span[title*="more events"]'));
          const badgesAudit = plusBadges.map(b => {
            const rect = b.getBoundingClientRect();
            const text = (b.innerText || '').trim();
            const wraps = rect.height > 18;
            return {
              text,
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              wraps
            };
          });

          // Check cell width
          const sampleCell = cellContainers[0];
          const cellWidth = sampleCell ? Math.round(sampleCell.getBoundingClientRect().width) : 0;

          return {
            found: true,
            cellWidth,
            internalScrollbars,
            titlesAudit,
            badgesAudit
          };
        })()
      `);

      assert.ok(monthAudit.found, `MonthGrid must exist for ${cfg.label}`);
      assert.strictEqual(
        monthAudit.internalScrollbars,
        false,
        `Day cell event containers must not produce internal vertical scrollbars under ${cfg.label}`
      );

      // Verify all rendered event titles are preserved and have readable width (> 15px)
      for (const t of monthAudit.titlesAudit) {
        assert.ok(
          t.titleWidth >= 15,
          `Event title '${t.titleText}' was extinguished to ${t.titleWidth}px under ${cfg.label}`
        );
      }

      // If cell width < 95px, verify timestamp badge is suppressed to prioritize title
      if (monthAudit.cellWidth < 95) {
        for (const t of monthAudit.titlesAudit) {
          assert.strictEqual(
            t.hasTimeSpan,
            false,
            `In narrow cell (${monthAudit.cellWidth}px), timestamp badge must be suppressed to avoid extinguishing title '${t.titleText}'`
          );
        }
      }

      // Verify +N badges exist and do NOT wrap
      assert.ok(monthAudit.badgesAudit.length > 0, `At least one +N badge must exist under ${cfg.label}`);
      for (const b of monthAudit.badgesAudit) {
        assert.ok(
          /^\+\d+/.test(b.text),
          `+N badge text must start with '+N', got '${b.text}' under ${cfg.label}`
        );
        assert.strictEqual(
          b.wraps,
          false,
          `+N badge '${b.text}' wrapped into multiple lines (height ${b.height}px > 18px) under ${cfg.label}`
        );
      }
    }
  }
);

// ============================================================================
// 5. AGENDAVIEW IN NARROW VIEWPORTS: ACTION WRAPPING & DETAILS PRESERVATION
// ============================================================================

suite.test(
  "AgendaView Narrow Screen (< 640px): actions wrap cleanly below details with zero horizontal overflow",
  async () => {
    await selectViewTab("Schedule");
    await new Promise((r) => setTimeout(r, 200));

    // Test mobile-equivalent viewport widths where Tailwind sm: is not triggered
    const mobileConfigs = [
      { width: 600, height: 750, label: "600x750 Compact Mobile Viewport" },
      { width: 500, height: 700, label: "500x700 Narrow Phone Viewport" }
    ];

    for (const cfg of mobileConfigs) {
      await cdp.setViewport(cfg.width, cfg.height);
      await setSidebars({ left: false, right: false });
      await new Promise((r) => setTimeout(r, 250));

      const agendaAudit = await cdp.evaluate(`
        (() => {
          const mainScroll = document.querySelector('div.flex-1.overflow-y-auto');
          if (!mainScroll) return { found: false, error: 'Main scroll not found' };

          const mainHasHScroll = mainScroll.scrollWidth > mainScroll.clientWidth;

          // Inspect each event card in AgendaView
          const cards = Array.from(mainScroll.querySelectorAll('div.rounded-lg.border.p-3'));
          const cardsAudit = cards.map((c, idx) => {
            const cardRect = c.getBoundingClientRect();
            const cardHasHScroll = c.scrollWidth > c.clientWidth + 1;

            // Details section (title, pills, time)
            const detailsSection = c.children[0];
            const detailsRect = detailsSection ? detailsSection.getBoundingClientRect() : null;
            const titleEl = c.querySelector('span.text-sm.font-semibold');
            const titleRect = titleEl ? titleEl.getBoundingClientRect() : null;

            // Actions section (RSVP + video button)
            const actionsSection = c.children[1];
            const actionsRect = actionsSection ? actionsSection.getBoundingClientRect() : null;

            // Check if actions wrapped vertically below details
            const isWrapped = detailsRect && actionsRect ? actionsRect.top >= detailsRect.bottom - 4 : false;

            return {
              idx,
              cardWidth: Math.round(cardRect.width),
              cardHasHScroll,
              detailsWidth: detailsRect ? Math.round(detailsRect.width) : 0,
              titleWidth: titleRect ? Math.round(titleRect.width) : 0,
              titleText: titleEl ? titleEl.innerText.trim() : '',
              isWrapped
            };
          });

          return {
            found: true,
            mainClientWidth: mainScroll.clientWidth,
            mainScrollWidth: mainScroll.scrollWidth,
            mainHasHScroll,
            cardsCount: cards.length,
            cardsAudit
          };
        })()
      `);

      assert.ok(agendaAudit.found, `AgendaView must be found under ${cfg.label}`);
      assert.strictEqual(
        agendaAudit.mainHasHScroll,
        false,
        `AgendaView main container must not have horizontal overflow under ${cfg.label}`
      );
      assert.ok(agendaAudit.cardsCount > 0, `AgendaView must display event cards under ${cfg.label}`);

      for (const card of agendaAudit.cardsAudit) {
        assert.strictEqual(
          card.cardHasHScroll,
          false,
          `Agenda card ${card.idx} '${card.titleText}' must not have horizontal overflow under ${cfg.label}`
        );
        // Under mobile viewport (< 640px), flex-col layout ensures actions wrap cleanly below details
        assert.strictEqual(
          card.isWrapped,
          true,
          `Agenda card ${card.idx} '${card.titleText}' actions must wrap vertically below details under ${cfg.label}`
        );
        assert.ok(
          card.titleWidth >= 100,
          `Agenda card ${card.idx} title '${card.titleText}' must retain >= 100px width under ${cfg.label}, got ${card.titleWidth}px`
        );
      }
    }
  }
);

suite.test(
  "AgendaView Dual Sidebars at 960x640: Adversarial Audit of Media Query vs Container Width",
  async () => {
    await cdp.setViewport(960, 640);
    await setSidebars({ left: true, right: true });
    await selectViewTab("Schedule");
    await new Promise((r) => setTimeout(r, 250));

    const audit = await cdp.evaluate(`
      (() => {
        const mainScroll = document.querySelector('div.flex-1.overflow-y-auto');
        if (!mainScroll) return { found: false };

        const card = mainScroll.querySelector('div.rounded-lg.border.p-3');
        if (!card) return { found: false };

        const details = card.children[0];
        const actions = card.children[1];
        const title = card.querySelector('span.text-sm.font-semibold');

        const mainHasHScroll = mainScroll.scrollWidth > mainScroll.clientWidth;
        const cardHasHScroll = card.scrollWidth > card.clientWidth + 1;
        const cardComputedStyle = window.getComputedStyle(card);

        return {
          found: true,
          mainWidth: mainScroll.clientWidth,
          cardWidth: card.clientWidth,
          flexDirection: cardComputedStyle.flexDirection,
          detailsWidth: details ? details.clientWidth : 0,
          actionsWidth: actions ? actions.clientWidth : 0,
          titleWidth: title ? title.clientWidth : 0,
          titleText: title ? title.innerText.trim() : '',
          mainHasHScroll,
          cardHasHScroll
        };
      })()
    `);

    assert.ok(audit.found, "AgendaView card must exist at 960x640 with dual sidebars");
    // Invariant: Zero horizontal scrolling is maintained
    assert.strictEqual(
      audit.mainHasHScroll,
      false,
      "AgendaView main scroll container must not have horizontal overflow"
    );
    assert.strictEqual(
      audit.cardHasHScroll,
      false,
      "Agenda card must not have horizontal overflow"
    );

    // Adversarial finding verification:
    // When dual sidebars are mounted at 960px window width, container width is ~384px.
    // Because Tailwind 'sm:flex-row' evaluates against window width (960px >= 640px),
    // flexDirection is 'row' rather than 'column'.
    assert.strictEqual(
      audit.flexDirection,
      "row",
      `Expected flexDirection to be 'row' due to sm: breakpoint query at 960px viewport`
    );
    // Document exact empirical title width under this constrained state
    assert.ok(
      audit.titleWidth > 0,
      `Title must remain non-zero and rendered in DOM (got ${audit.titleWidth}px)`
    );
  }
);

// ============================================================================
// 6. ADVERSARIAL STRESS TEST: HIGH-FREQUENCY PREFERENCE & THEME SWITCHING
// ============================================================================

suite.test(
  "Adversarial Stress Test: High-frequency preferences & theme toggling retains layout invariants",
  async () => {
    await cdp.setViewport(1280, 800);
    await selectViewTab("Week");

    // Rapidly toggle preferences 6 times
    for (let i = 0; i < 6; i++) {
      const isDual = i % 2 === 0;
      const is24h = i % 3 === 0;
      const theme = i % 2 === 0 ? "dark" : "light";
      const density = i % 2 === 0 ? "compact" : "spacious";

      await cdp.evaluate(`
        (async () => {
          const store = await import('/src/store/calendarStore.ts');
          store.updateUserPreferences({
            showSecondaryTimezone: ${isDual},
            timeFormat: ${is24h ? "'24h'" : "'12h'"}
          });
          store.setTheme(${JSON.stringify(theme)});
          store.setGridDensity(${JSON.stringify(density)});
        })()
      `);
    }
    await new Promise((r) => setTimeout(r, 200));

    // Verify system recovered cleanly
    const postStressMetrics = await cdp.evaluate(`
      (() => {
        const header = document.querySelector('header');
        const main = document.querySelector('main');
        const gutter = document.querySelector('div[class*="w-20"], div[class*="w-28"]');
        return {
          hasHeader: !!header,
          hasMain: !!main,
          headerHScroll: header ? header.scrollWidth > header.clientWidth : false,
          mainHScroll: main ? main.scrollWidth > main.clientWidth : false,
          gutterWidth: gutter ? Math.round(gutter.getBoundingClientRect().width) : 0
        };
      })()
    `);

    assert.ok(postStressMetrics.hasHeader, "Header must be intact after stress test");
    assert.ok(postStressMetrics.hasMain, "Main canvas must be intact after stress test");
    assert.strictEqual(postStressMetrics.headerHScroll, false, "Header must not have horizontal overflow");
    assert.strictEqual(postStressMetrics.mainHScroll, false, "Main canvas must not have horizontal overflow");
    assert.ok(postStressMetrics.gutterWidth >= 80, `Gutter width must be >= 80px (got ${postStressMetrics.gutterWidth}px)`);

    // Restore standard defaults
    await cdp.evaluate(`
      (async () => {
        const store = await import('/src/store/calendarStore.ts');
        store.updateUserPreferences({
          showSecondaryTimezone: false,
          timeFormat: '12h'
        });
        store.setTheme('dark');
        store.setGridDensity('standard');
      })()
    `);
    await setSidebars({ left: true, right: true });
  }
);

if (process.argv[1]?.endsWith("challenger_m3_2_precision.test.js")) {
  suite.run().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}

export { suite };
