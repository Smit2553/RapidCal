import { assert, createHarness, TestSuite } from "./harness.js";

const suite = new TestSuite("Tier 2: Boundary & Corner Cases");

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

suite.test(
  "Minimum Viewport 960x640 with Dual Sidebars Open",
  async () => {
    // 1. Set viewport to minimum size 960x640
    await cdp.setViewport(960, 640);
    await selectViewTab("Week");

    // 2. Ensure both sidebars are open
    await cdp.evaluate(`
      (() => {
        const leftOpen = Boolean(document.querySelector('aside.w-64'));
        const rightOpen = Boolean(document.querySelector('aside.w-80'));
        const buttons = Array.from(document.querySelectorAll('header button'));

        // Toggle left sidebar if closed
        if (!leftOpen) {
          const leftBtn = buttons.find(b => b.getAttribute('title')?.includes('Sidebar ([)'));
          if (leftBtn) leftBtn.click();
        }

        // Toggle right inspector if closed
        if (!rightOpen) {
          const rightBtn = buttons.find(b => b.getAttribute('title')?.includes('Inspector (])'));
          if (rightBtn) rightBtn.click();
        }
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    // Verify both sidebars are mounted
    const sidebarsMounted = await cdp.evaluate(`
      Boolean(document.querySelector('aside.w-64') && document.querySelector('aside.w-80'))
    `);
    assert.ok(
      sidebarsMounted,
      "Both LeftSidebar (w-64) and EventInspector (w-80) must be mounted simultaneously"
    );

    // 3. Verify main content container does not have horizontal scrollbar overflow
    const mainOverflow = await cdp.evaluate(`
      (() => {
        const main = document.querySelector('main');
        if (!main) return null;
        return {
          scrollWidth: main.scrollWidth,
          clientWidth: main.clientWidth,
          overflow: main.scrollWidth > main.clientWidth
        };
      })()
    `);
    assert.ok(mainOverflow, "Main element must exist");
    assert.strictEqual(
      mainOverflow.overflow,
      false,
      `Main container should not have horizontal overflow at 960x640 with dual sidebars: ${JSON.stringify(mainOverflow)}`
    );

    // 4. Verify day columns canvas in TimeGridView is visible and positive width
    const canvasBox = await cdp.getBoundingBox('.grid-cols-7, [data-day-start-ts]');
    assert.ok(canvasBox, "Calendar day columns should be rendered");
    assert.ok(canvasBox.width > 200, `Available calendar canvas width should be > 200px, got: ${canvasBox.width}`);

    await harness.saveScreenshot("tier2_01_dual_sidebars_960x640");
  }
);

suite.test("Time-Grid Gutter Widths & 12-Hour Mode Formatting", async () => {
  await cdp.setViewport(1280, 800);
  await selectViewTab("Day");

  // Set 12h time format via preferences in localStorage
  await cdp.evaluate(`
    (() => {
      const key = "rapidcal.preferences.v1";
      const current = JSON.parse(localStorage.getItem(key) || '{}');
      current.timeFormat = "12h";
      localStorage.setItem(key, JSON.stringify(current));
    })()
  `);
  // Navigate/reload to apply preference cleanly
  await cdp.navigate(harness.url);
  await selectViewTab("Day");

  // Inspect gutter element and its hour labels
  const gutterMetrics = await cdp.evaluate(`
    (() => {
      // Find the time gutter container (has hour text like '9 AM' or '12 PM')
      const hourLabels = Array.from(document.querySelectorAll('span')).filter(s =>
        /\\b(1[0-2]|[1-9])(:00)?\\s*(AM|PM)\\b/i.test(s.innerText.trim())
      );
      if (hourLabels.length === 0) return { found: false };

      const sample = hourLabels[0];
      const gutter = sample.closest('.shrink-0');

      return {
        found: true,
        count: hourLabels.length,
        gutterWidth: gutter ? gutter.clientWidth : 0,
        sampleText: sample.innerText.trim(),
        labelScrollWidth: sample.scrollWidth,
        labelClientWidth: sample.clientWidth,
        isClipped: sample.scrollWidth > sample.clientWidth + 1
      };
    })()
  `);

  assert.ok(gutterMetrics.found, "12h hour labels (e.g., 9:00 AM) must be rendered in the gutter");
  assert.ok(
    gutterMetrics.gutterWidth >= 64,
    `Gutter width in 12h mode should be >= 64px, got: ${gutterMetrics.gutterWidth}`
  );
  assert.strictEqual(
    gutterMetrics.isClipped,
    false,
    `12h hour label must fit cleanly without text clipping: ${JSON.stringify(gutterMetrics)}`
  );

  await harness.saveScreenshot("tier2_02_gutter_12h");
});

suite.test("Time-Grid Gutter Widths & 24-Hour Mode Formatting", async () => {
  await selectViewTab("Day");

  // Set 24h format
  await cdp.evaluate(`
    (() => {
      const key = "rapidcal.preferences.v1";
      const current = JSON.parse(localStorage.getItem(key) || '{}');
      current.timeFormat = "24h";
      localStorage.setItem(key, JSON.stringify(current));
    })()
  `);
  await cdp.navigate(harness.url);
  await selectViewTab("Day");

  const gutter24hMetrics = await cdp.evaluate(`
    (() => {
      const hourLabels = Array.from(document.querySelectorAll('span')).filter(s =>
        /^(0?\\d|1\\d|2[0-3]):00$/.test(s.innerText.trim())
      );
      if (hourLabels.length === 0) return { found: false };

      const sample = hourLabels[0];
      const gutter = sample.closest('.shrink-0');

      return {
        found: true,
        count: hourLabels.length,
        gutterWidth: gutter ? gutter.clientWidth : 0,
        sampleText: sample.innerText.trim(),
        labelScrollWidth: sample.scrollWidth,
        labelClientWidth: sample.clientWidth,
        isClipped: sample.scrollWidth > sample.clientWidth + 1
      };
    })()
  `);

  assert.ok(gutter24hMetrics.found, "24h hour labels (e.g., 09:00, 13:00) must be rendered in gutter");
  assert.strictEqual(
    gutter24hMetrics.isClipped,
    false,
    `24h hour label must fit cleanly without text clipping: ${JSON.stringify(gutter24hMetrics)}`
  );

  await harness.saveScreenshot("tier2_03_gutter_24h");
});

suite.test("Dual Timezone Gutter Width & Formatting", async () => {
  // Set dual timezone active
  await cdp.evaluate(`
    (() => {
      const key = "rapidcal.preferences.v1";
      const current = JSON.parse(localStorage.getItem(key) || '{}');
      current.showSecondaryTimezone = true;
      localStorage.setItem(key, JSON.stringify(current));
    })()
  `);
  await cdp.navigate(harness.url);
  await selectViewTab("Day");

  const dualTzGutter = await cdp.evaluate(`
    (() => {
      // Find gutter that contains two spans per hour row
      const rows = Array.from(document.querySelectorAll('.font-mono-tabular.flex'));
      if (rows.length === 0) return { found: false };

      const sampleRow = rows.find(r => r.querySelectorAll('span').length >= 2);
      if (!sampleRow) return { found: false, count: rows.length };

      const spans = Array.from(sampleRow.querySelectorAll('span'));
      const gutter = sampleRow.closest('.shrink-0');

      return {
        found: true,
        gutterWidth: gutter ? gutter.clientWidth : 0,
        spanCount: spans.length,
        secLabel: spans[0]?.innerText.trim(),
        primLabel: spans[1]?.innerText.trim(),
        isOverflowing: gutter ? gutter.scrollWidth > gutter.clientWidth : false
      };
    })()
  `);

  assert.ok(dualTzGutter.found, "Dual timezone hour rows should display two timezone columns");
  assert.ok(
    dualTzGutter.gutterWidth >= 96,
    `Dual timezone gutter width must be expanded (>= 96px), got: ${dualTzGutter.gutterWidth}`
  );
  assert.strictEqual(
    dualTzGutter.isOverflowing,
    false,
    `Dual timezone gutter should not horizontally overflow: ${JSON.stringify(dualTzGutter)}`
  );

  await harness.saveScreenshot("tier2_04_gutter_dual_tz");
});

suite.test("Short-Duration (15m/30m) Event Cards Layout & Bounds", async () => {
  await selectViewTab("Week");

  // Query all rendered event cards
  const cardMetrics = await cdp.evaluate(`
    (() => {
      const cards = Array.from(document.querySelectorAll('[data-event-card="true"]'));
      return cards.map(c => {
        const rect = c.getBoundingClientRect();
        const titleEl = c.querySelector('span, .truncate');
        return {
          title: (titleEl?.innerText || c.innerText || '').slice(0, 30),
          height: rect.height,
          width: rect.width,
          hasTitle: Boolean(titleEl),
          titleScrollWidth: titleEl ? titleEl.scrollWidth : 0,
          titleClientWidth: titleEl ? titleEl.clientWidth : 0
        };
      });
    })()
  `);

  assert.ok(cardMetrics.length > 0, "Demo events should be rendered on the calendar grid");

  for (const card of cardMetrics) {
    assert.ok(card.height >= 14, `Event card '${card.title}' height should be >= 14px, got: ${card.height}`);
    assert.ok(card.width >= 30, `Event card '${card.title}' width should be >= 30px, got: ${card.width}`);
    assert.ok(card.hasTitle, `Event card '${card.title}' should have title element`);
  }

  await harness.saveScreenshot("tier2_05_short_events");
});

suite.test("Overlapping Concurrent Event Cards Packing", async () => {
  await selectViewTab("Week");

  // Evaluate column packing geometry for overlapping events
  const packingStats = await cdp.evaluate(`
    (() => {
      // Find cards in the same day column
      const dayCols = Array.from(document.querySelectorAll('[data-day-start-ts]'));
      const overlappingClusters = [];

      for (const col of dayCols) {
        const cards = Array.from(col.querySelectorAll('[data-event-card="true"]'));
        if (cards.length > 1) {
          // Check card bounding boxes for vertical overlap
          for (let i = 0; i < cards.length; i++) {
            for (let j = i + 1; j < cards.length; j++) {
              const r1 = cards[i].getBoundingClientRect();
              const r2 = cards[j].getBoundingClientRect();
              const vOverlap = Math.max(0, Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top));
              if (vOverlap > 5) {
                // Concurrent overlapping pair
                overlappingClusters.push({
                  card1: { top: r1.top, left: r1.left, width: r1.width },
                  card2: { top: r2.top, left: r2.left, width: r2.width },
                  differentLeft: Math.abs(r1.left - r2.left) > 5,
                  nonZeroWidth: r1.width > 20 && r2.width > 20
                });
              }
            }
          }
        }
      }

      return {
        hasOverlapCluster: overlappingClusters.length > 0,
        clusterCount: overlappingClusters.length,
        clusters: overlappingClusters.slice(0, 5)
      };
    })()
  `);

  if (packingStats.hasOverlapCluster) {
    for (const cluster of packingStats.clusters) {
      assert.strictEqual(
        cluster.differentLeft,
        true,
        `Overlapping events must be packed side-by-side with distinct left offsets: ${JSON.stringify(cluster)}`
      );
      assert.strictEqual(
        cluster.nonZeroWidth,
        true,
        `Overlapping event cards must maintain non-zero legible width: ${JSON.stringify(cluster)}`
      );
    }
  }

  await harness.saveScreenshot("tier2_06_overlapping_events");
});

suite.test("Horizontal Overflow Audit Across Responsive Viewports", async () => {
  const viewportsToTest = [
    { width: 960, height: 640 },
    { width: 1280, height: 800 },
    { width: 1380, height: 860 },
    { width: 1920, height: 1080 },
  ];

  for (const vp of viewportsToTest) {
    await cdp.setViewport(vp.width, vp.height);
    await new Promise((r) => setTimeout(r, 200));

    // Audit main app container and topbar
    const overflowReport = await cdp.evaluate(`
      (() => {
        const defects = [];
        const targets = [
          { name: 'TopBar', el: document.querySelector('header') },
          { name: 'Main', el: document.querySelector('main') },
          { name: 'LeftSidebar', el: document.querySelector('aside.w-64') },
          { name: 'EventInspector', el: document.querySelector('aside.w-80') }
        ];

        for (const t of targets) {
          if (!t.el) continue;
          if (t.el.scrollWidth > t.el.clientWidth + 2) {
            defects.push({
              name: t.name,
              scrollWidth: t.el.scrollWidth,
              clientWidth: t.el.clientWidth,
              diff: t.el.scrollWidth - t.el.clientWidth
            });
          }
        }
        return defects;
      })()
    `);

    assert.strictEqual(
      overflowReport.length,
      0,
      `Unintentional horizontal overflow detected at viewport ${vp.width}x${vp.height}: ${JSON.stringify(overflowReport)}`
    );
  }

  await harness.saveScreenshot("tier2_07_overflow_audit_passed");
});

if (process.argv[1]?.endsWith("tier2_boundaries.test.js")) {
  suite.run().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}

export { suite };
