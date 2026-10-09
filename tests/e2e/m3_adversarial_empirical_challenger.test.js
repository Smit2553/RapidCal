import { assert, createHarness, TestSuite } from "./harness.js";

const suite = new TestSuite("M3 Empirical Challenger: Layout, Resizing, Dual-Sidebar & Theme Contrast Stress");

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

// Helper: Select TopBar view mode
async function switchViewMode(mode) {
  await cdp.evaluate(`
    (() => {
      if (window.__STORE__) {
        window.__STORE__.setViewMode(${JSON.stringify(mode)});
      }
      return true;
    })()
  `);
  await new Promise((r) => setTimeout(r, 100));
}

// Helper: Ensure dual sidebars are open
async function ensureDualSidebarsOpen() {
  await cdp.evaluate(`
    (() => {
      const s = window.__STORE__;
      if (s) {
        s.setLeftSidebarOpen(true);
        s.setRightInspectorOpen(true);
        if (!s.selectedEvent() && s.viewportEvents().length > 0) {
          s.setSelectedEvent(s.viewportEvents()[0]);
        }
      }
      return true;
    })()
  `);
  await new Promise((r) => setTimeout(r, 100));
}

// Helper: Set theme
async function setTheme(themeName) {
  await cdp.evaluate(`
    (() => {
      if (window.__STORE__) {
        window.__STORE__.setTheme(${JSON.stringify(themeName)});
      }
      return true;
    })()
  `);
  await new Promise((r) => setTimeout(r, 150));
}

// ============================================================================
// TEST 1: DUAL SIDEBARS COEXISTENCE & ZERO HORIZONTAL OVERFLOW (960px to 1920px)
// ============================================================================

suite.test("Dual Sidebars Coexistence & Zero Horizontal Overflow across 8 Viewports and All 6 Views", async () => {
  const viewports = [
    { width: 960, height: 640 },
    { width: 1024, height: 768 },
    { width: 1152, height: 864 },
    { width: 1280, height: 800 },
    { width: 1380, height: 860 },
    { width: 1440, height: 900 },
    { width: 1600, height: 900 },
    { width: 1920, height: 1080 }
  ];

  const modes = [
    { label: "Day", id: "day" },
    { label: "3-Day", id: "3day" },
    { label: "Work Week", id: "workweek" },
    { label: "Week", id: "week" },
    { label: "Month", id: "month" },
    { label: "Schedule", id: "agenda" }
  ];

  for (const vp of viewports) {
    await cdp.setViewport(vp.width, vp.height);
    await ensureDualSidebarsOpen();

    for (const view of modes) {
      await switchViewMode(view.id);

      const audit = await cdp.evaluate(`
        (() => {
          const docEl = document.documentElement;
          const body = document.body;
          const rootDiv = document.querySelector('div.h-screen.w-screen');
          const header = document.querySelector('header');
          const main = document.querySelector('main');
          const leftAside = document.querySelector('aside.w-64');
          const rightAside = document.querySelector('aside.w-80');

          let centerCanvas = null;
          if (main) {
            for (const child of main.children) {
              if (child !== leftAside && child !== rightAside) {
                centerCanvas = child;
                break;
              }
            }
          }

          const leftRect = leftAside ? leftAside.getBoundingClientRect() : null;
          const rightRect = rightAside ? rightAside.getBoundingClientRect() : null;
          const centerRect = centerCanvas ? centerCanvas.getBoundingClientRect() : null;

          return {
            windowOverflow: docEl.scrollWidth > docEl.clientWidth,
            bodyOverflow: body.scrollWidth > body.clientWidth,
            rootOverflow: rootDiv ? rootDiv.scrollWidth > rootDiv.clientWidth : false,
            headerOverflow: header ? header.scrollWidth > header.clientWidth : false,
            mainOverflow: main ? main.scrollWidth > main.clientWidth : false,
            centerCanvasOverflow: centerCanvas ? centerCanvas.scrollWidth > centerCanvas.clientWidth : false,
            leftWidth: leftRect ? Math.round(leftRect.width) : 0,
            rightWidth: rightRect ? Math.round(rightRect.width) : 0,
            centerWidth: centerRect ? Math.round(centerRect.width) : 0,
            leftRightOverlap: (leftRect && centerRect) ? leftRect.right > (centerRect.left + 1) : false,
            centerRightOverlap: (centerRect && rightRect) ? centerRect.right > (rightRect.left + 1) : false,
            clientWidth: docEl.clientWidth,
            clientHeight: docEl.clientHeight
          };
        })()
      `);

      assert.strictEqual(
        audit.windowOverflow,
        false,
        `Window overflowed horizontally at ${vp.width}x${vp.height} in view ${view.label}`
      );
      assert.strictEqual(
        audit.bodyOverflow,
        false,
        `Body overflowed horizontally at ${vp.width}x${vp.height} in view ${view.label}`
      );
      assert.strictEqual(
        audit.rootOverflow,
        false,
        `Root container overflowed horizontally at ${vp.width}x${vp.height} in view ${view.label}`
      );
      assert.strictEqual(
        audit.headerOverflow,
        false,
        `Header overflowed horizontally at ${vp.width}x${vp.height} in view ${view.label}`
      );
      assert.strictEqual(
        audit.mainOverflow,
        false,
        `Main overflowed horizontally at ${vp.width}x${vp.height} in view ${view.label}`
      );
      assert.strictEqual(
        audit.leftWidth,
        256,
        `LeftSidebar should measure 256px (w-64), got ${audit.leftWidth} at ${vp.width}x${vp.height}`
      );
      assert.strictEqual(
        audit.rightWidth,
        320,
        `EventInspector should measure 320px (w-80), got ${audit.rightWidth} at ${vp.width}x${vp.height}`
      );
      assert.ok(
        audit.centerWidth > 0,
        `Center canvas must have positive width, got ${audit.centerWidth} at ${vp.width}x${vp.height} in view ${view.label}`
      );
      assert.strictEqual(
        audit.leftRightOverlap,
        false,
        `LeftSidebar overlaps Center canvas at ${vp.width}x${vp.height} in view ${view.label}`
      );
      assert.strictEqual(
        audit.centerRightOverlap,
        false,
        `Center canvas overlaps EventInspector at ${vp.width}x${vp.height} in view ${view.label}`
      );
    }
  }
});

// ============================================================================
// TEST 2: TOPBAR DATE TITLE <h1> MEASUREMENT & CONTROL NON-COLLISION AUDIT
// ============================================================================

suite.test("TopBar Date Title <h1> Metrics and Controls Non-Collision Across Viewports", async () => {
  const viewports = [960, 1000, 1024, 1100, 1200, 1280, 1380, 1920];
  const results = [];

  for (const w of viewports) {
    await cdp.setViewport(w, 700);
    await switchViewMode("week");

    const headerAudit = await cdp.evaluate(`
      (() => {
        const header = document.querySelector('header');
        if (!header) return null;

        const h1 = header.querySelector('h1');
        const h1Rect = h1 ? h1.getBoundingClientRect() : null;
        const h1Text = h1 ? (h1.innerText || '').trim() : '';

        const groups = Array.from(header.children);
        const leftGroup = groups[0];
        const centerGroup = groups[1];
        const rightGroup = groups[2];

        const leftRect = leftGroup ? leftGroup.getBoundingClientRect() : null;
        const centerRect = centerGroup ? centerGroup.getBoundingClientRect() : null;
        const rightRect = rightGroup ? rightGroup.getBoundingClientRect() : null;

        const buttons = Array.from(header.querySelectorAll('button'));
        const qaBtn = buttons.find(b => (b.getAttribute('title') || '').includes('Quick Add'));
        const qaRect = qaBtn ? qaBtn.getBoundingClientRect() : null;

        return {
          viewportWidth: ${w},
          h1Width: h1Rect ? Math.round(h1Rect.width) : 0,
          h1Text,
          qaWidth: qaRect ? Math.round(qaRect.width) : 0,
          hasHScroll: header.scrollWidth > header.clientWidth,
          scrollWidth: header.scrollWidth,
          clientWidth: header.clientWidth,
          leftCollidesCenter: (leftRect && centerRect) ? leftRect.right > (centerRect.left + 1) : false,
          centerCollidesRight: (centerRect && rightRect) ? centerRect.right > (rightRect.left + 1) : false
        };
      })()
    `);

    assert.ok(headerAudit, `TopBar header must exist at ${w}px`);
    assert.strictEqual(
      headerAudit.hasHScroll,
      false,
      `TopBar overflowed horizontally at ${w}px: scrollWidth ${headerAudit.scrollWidth} > clientWidth ${headerAudit.clientWidth}`
    );
    assert.strictEqual(
      headerAudit.leftCollidesCenter,
      false,
      `TopBar Left group collides with Center group at ${w}px`
    );
    assert.strictEqual(
      headerAudit.centerCollidesRight,
      false,
      `TopBar Center group collides with Right group at ${w}px`
    );

    // Verify h1 width is strictly non-zero
    assert.ok(
      headerAudit.h1Width > 0,
      `Date title <h1> must have non-zero width at ${w}px (got ${headerAudit.h1Width}px)`
    );

    results.push({
      width: w,
      h1Width: headerAudit.h1Width,
      qaWidth: headerAudit.qaWidth,
      text: headerAudit.h1Text
    });
  }

  // Print empirical telemetry
  console.log("\n    [Empirical TopBar <h1> Metrics]:");
  for (const r of results) {
    console.log(`      Viewport ${r.width}px: h1 width = ${r.h1Width}px (Quick Add width = ${r.qaWidth}px, title = "${r.text}")`);
  }
});

// ============================================================================
// TEST 3: UP NEXT PILL TRUNCATION & BOUNDED DIMENSIONS
// ============================================================================

suite.test("Up Next Countdown Pill Truncation and Responsive Behavior", async () => {
  // Test across responsive viewports
  const viewports = [
    { width: 960, height: 640, expectVisible: false },
    { width: 1280, height: 800, expectVisible: true, maxAllowedWidth: 160 },
    { width: 1380, height: 860, expectVisible: true, maxAllowedWidth: 160 },
    { width: 1920, height: 1080, expectVisible: true, maxAllowedWidth: 260 }
  ];

  for (const vp of viewports) {
    await cdp.setViewport(vp.width, vp.height);
    await new Promise((r) => setTimeout(r, 100));

    const pillAudit = await cdp.evaluate(`
      (() => {
        const header = document.querySelector('header');
        if (!header) return null;

        const pill = header.querySelector('div[class*="rounded-full"][class*="border-indigo-500/30"]');
        const pillTextSpan = pill ? pill.querySelector('span.truncate') : null;

        const pillRect = pill ? pill.getBoundingClientRect() : null;
        const textRect = pillTextSpan ? pillTextSpan.getBoundingClientRect() : null;

        const computedPill = pill ? window.getComputedStyle(pill) : null;
        const computedText = pillTextSpan ? window.getComputedStyle(pillTextSpan) : null;

        return {
          hasHeaderOverflow: header.scrollWidth > header.clientWidth,
          headerScrollWidth: header.scrollWidth,
          headerClientWidth: header.clientWidth,
          pillFound: !!pill,
          isPillDisplayed: computedPill ? computedPill.display !== 'none' : false,
          pillWidth: pillRect ? Math.round(pillRect.width) : 0,
          textWidth: textRect ? Math.round(textRect.width) : 0,
          textOverflowEllipsis: computedText ? computedText.textOverflow === 'ellipsis' : false,
          h1Width: header.querySelector('h1') ? Math.round(header.querySelector('h1').getBoundingClientRect().width) : 0
        };
      })()
    `);

    assert.ok(pillAudit, `Header must exist at ${vp.width}x${vp.height}`);
    assert.strictEqual(
      pillAudit.hasHeaderOverflow,
      false,
      `Header overflowed at ${vp.width}x${vp.height}`
    );

    if (!vp.expectVisible) {
      assert.strictEqual(
        pillAudit.isPillDisplayed,
        false,
        `Up Next pill should be hidden at ${vp.width}x${vp.height} to preserve header space`
      );
    } else if (pillAudit.pillFound && pillAudit.isPillDisplayed) {
      assert.ok(
        pillAudit.textOverflowEllipsis,
        `Up Next text span must have text-overflow: ellipsis`
      );
      assert.ok(
        pillAudit.textWidth <= vp.maxAllowedWidth,
        `Up Next text span width (${pillAudit.textWidth}px) exceeds max allowed (${vp.maxAllowedWidth}px) at ${vp.width}x${vp.height}`
      );
    }
  }
});

// ============================================================================
// TEST 4: THEME SWITCHING & CONTRAST ORACLE (DARK AND LIGHT THEMES)
// ============================================================================

suite.test("Theme Contrast Stress Test: High Contrast and Proper Styling Across LeftSidebar, EventInspector, TopBar", async () => {
  await cdp.setViewport(1280, 800);
  await switchViewMode("week");
  await ensureDualSidebarsOpen();

  const themes = ["dark", "light"];

  for (const th of themes) {
    await setTheme(th);

    const contrastAudit = await cdp.evaluate(`
      (() => {
        // Universal color extractor supporting oklab, oklch, rgb, rgba
        function extractLightness(colorStr) {
          if (!colorStr) return null;
          // oklch(L C H ...) or oklab(L A B ...) -> L is in [0, 1]
          const oklMatch = colorStr.match(/ok(?:lch|lab)\\(([0-9.]+)/);
          if (oklMatch) {
            return parseFloat(oklMatch[1]);
          }
          // rgb(r, g, b) or rgba(r, g, b, a)
          const rgbMatch = colorStr.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
          if (rgbMatch) {
            const r = parseInt(rgbMatch[1], 10) / 255;
            const g = parseInt(rgbMatch[2], 10) / 255;
            const b = parseInt(rgbMatch[3], 10) / 255;
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          }
          return null;
        }

        function computeContrast(fgStr, bgStr) {
          const l1 = extractLightness(fgStr);
          const l2 = extractLightness(bgStr);
          if (l1 === null || l2 === null) return null;
          // In OKLab/OKLCH, lightness L maps to luminance Y ~ L^3
          const y1 = Math.pow(l1, 3);
          const y2 = Math.pow(l2, 3);
          const max = Math.max(y1, y2);
          const min = Math.min(y1, y2);
          return (max + 0.05) / (min + 0.05);
        }

        const header = document.querySelector('header');
        const h1 = header ? header.querySelector('h1') : null;
        const left = document.querySelector('aside.w-64');
        const right = document.querySelector('aside.w-80');
        const titleInput = right ? right.querySelector('input[type="text"]') : null;
        const calSelect = right ? right.querySelector('select') : null;
        const saveBtn = right ? right.querySelector('button[type="submit"]') : null;

        const headerBg = header ? window.getComputedStyle(header).backgroundColor : null;
        const h1Color = h1 ? window.getComputedStyle(h1).color : null;
        const leftBg = left ? window.getComputedStyle(left).backgroundColor : null;
        const rightBg = right ? window.getComputedStyle(right).backgroundColor : null;
        const titleInputBg = titleInput ? window.getComputedStyle(titleInput).backgroundColor : null;
        const titleInputColor = titleInput ? window.getComputedStyle(titleInput).color : null;
        const saveBtnBg = saveBtn ? window.getComputedStyle(saveBtn).backgroundColor : null;
        const saveBtnColor = saveBtn ? window.getComputedStyle(saveBtn).color : null;

        return {
          theme: document.documentElement.classList.contains('light') ? 'light' : 'dark',
          h1Contrast: computeContrast(h1Color, headerBg),
          titleInputContrast: computeContrast(titleInputColor, titleInputBg),
          saveBtnContrast: computeContrast(saveBtnColor, saveBtnBg),
          headerBg,
          h1Color,
          leftBg,
          rightBg,
          titleInputBg,
          titleInputColor,
          saveBtnBg,
          saveBtnColor
        };
      })()
    `);

    assert.ok(contrastAudit, `Contrast audit failed for theme ${th}`);

    console.log(`\n    [Theme ${th.toUpperCase()} Contrast Audit]:`);
    console.log(`      Header <h1> contrast: ${contrastAudit.h1Contrast?.toFixed(1)}:1`);
    console.log(`      Title input contrast: ${contrastAudit.titleInputContrast?.toFixed(1)}:1`);
    console.log(`      Save button contrast: ${contrastAudit.saveBtnContrast?.toFixed(1)}:1`);

    assert.ok(
      contrastAudit.h1Contrast >= 4.5,
      `Header <h1> contrast under ${th} theme is too low: ${contrastAudit.h1Contrast}:1`
    );
    assert.ok(
      contrastAudit.titleInputContrast >= 4.5,
      `Title input contrast under ${th} theme is too low: ${contrastAudit.titleInputContrast}:1`
    );
    assert.ok(
      contrastAudit.saveBtnContrast >= 3.0,
      `Save button contrast under ${th} theme is too low: ${contrastAudit.saveBtnContrast}:1`
    );
  }

  // Restore dark theme
  await setTheme("dark");
});

// ============================================================================
// TEST 5: TIME GRID GUTTER EXPANSION & 12H/24H MODES AT 960PX DUAL SIDEBARS
// ============================================================================

suite.test("Time-Grid Gutter Expansion (w-20 single, w-28 dual) and 12h/24h Modes Under Dual Sidebars at 960x640", async () => {
  await cdp.setViewport(960, 640);
  await switchViewMode("week");
  await ensureDualSidebarsOpen();

  // Test single timezone in 12h mode
  await cdp.evaluate(`
    (() => {
      if (window.__STORE__) {
        window.__STORE__.updateUserPreferences({
          showSecondaryTimezone: false,
          timeFormat: '12h'
        });
      }
      return true;
    })()
  `);
  await new Promise((r) => setTimeout(r, 100));

  const single12hMetrics = await cdp.evaluate(`
    (() => {
      const gutterHeader = document.querySelector('div[class*="w-20"]');
      const gutterRect = gutterHeader ? gutterHeader.getBoundingClientRect() : null;
      const hourLabels = Array.from(document.querySelectorAll('div[class*="w-20"] span[class*="font-mono-tabular"]'));
      const textWrapped = hourLabels.some(l => l.clientHeight > 22);

      return {
        gutterFound: !!gutterHeader,
        gutterWidth: gutterRect ? Math.round(gutterRect.width) : 0,
        hourLabelCount: hourLabels.length,
        textWrapped
      };
    })()
  `);

  assert.ok(single12hMetrics.gutterFound, "Single timezone gutter (w-20) must be present in DOM");
  assert.strictEqual(single12hMetrics.gutterWidth, 80, `Single timezone gutter width must be 80px (w-20), got ${single12hMetrics.gutterWidth}`);
  assert.strictEqual(single12hMetrics.textWrapped, false, "12h hour labels must not wrap vertically in 80px gutter");

  // Test dual timezone in 12h mode
  await cdp.evaluate(`
    (() => {
      if (window.__STORE__) {
        window.__STORE__.updateUserPreferences({
          showSecondaryTimezone: true,
          timeFormat: '12h'
        });
      }
      return true;
    })()
  `);
  await new Promise((r) => setTimeout(r, 100));

  const dual12hMetrics = await cdp.evaluate(`
    (() => {
      const gutterHeader = document.querySelector('div[class*="w-28"]');
      const gutterRect = gutterHeader ? gutterHeader.getBoundingClientRect() : null;
      const subCols = Array.from(gutterHeader ? gutterHeader.querySelectorAll('div.grid-cols-2 span') : []);
      const subColWidths = subCols.map(c => Math.round(c.getBoundingClientRect().width));

      return {
        gutterFound: !!gutterHeader,
        gutterWidth: gutterRect ? Math.round(gutterRect.width) : 0,
        subColCount: subCols.length,
        subColWidths
      };
    })()
  `);

  assert.ok(dual12hMetrics.gutterFound, "Dual timezone gutter (w-28) must be present in DOM");
  assert.strictEqual(dual12hMetrics.gutterWidth, 112, `Dual timezone gutter width must be 112px (w-28), got ${dual12hMetrics.gutterWidth}`);

  // Test dual timezone in 24h mode
  await cdp.evaluate(`
    (() => {
      if (window.__STORE__) {
        window.__STORE__.updateUserPreferences({
          showSecondaryTimezone: true,
          timeFormat: '24h'
        });
      }
      return true;
    })()
  `);
  await new Promise((r) => setTimeout(r, 100));

  const dual24hMetrics = await cdp.evaluate(`
    (() => {
      const gutterHeader = document.querySelector('div[class*="w-28"]');
      const gutterRect = gutterHeader ? gutterHeader.getBoundingClientRect() : null;
      return {
        gutterFound: !!gutterHeader,
        gutterWidth: gutterRect ? Math.round(gutterRect.width) : 0
      };
    })()
  `);

  assert.strictEqual(dual24hMetrics.gutterWidth, 112, `Dual timezone gutter in 24h mode must be 112px, got ${dual24hMetrics.gutterWidth}`);

  // Restore defaults
  await cdp.evaluate(`
    (() => {
      if (window.__STORE__) {
        window.__STORE__.updateUserPreferences({
          showSecondaryTimezone: false,
          timeFormat: '12h'
        });
      }
      return true;
    })()
  `);
});

if (process.argv[1]?.endsWith("m3_adversarial_empirical_challenger.test.js")) {
  suite.run().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}

export { suite };
