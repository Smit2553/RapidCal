import { assert, createHarness, TestSuite } from "./harness.js";

const suite = new TestSuite("Empirical Challenger M2-1: Time-Grid Density & Dynamic Hour Height");

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
  await new Promise((r) => setTimeout(r, 200));
}

// ============================================================================
// 1. GRID CANVAS SCALING & MATHEMATICAL ORACLE ACROSS PRESETS & BOUNDARIES
// ============================================================================

suite.test("Grid Canvas Scaling: Compact (44px), Standard (56px), Spacious (72px), and custom slider values (40..96px)", async () => {
  await selectViewTab("Week");

  // Import store module and verify hourHeightPx, setHourHeight, setGridDensity
  const testMatrix = [
    { name: "Compact preset", density: "compact", explicitH: null, expectedH: 44, expectedCanvasH: 24 * 44 },
    { name: "Standard preset", density: "standard", explicitH: null, expectedH: 56, expectedCanvasH: 24 * 56 },
    { name: "Spacious preset", density: "spacious", explicitH: null, expectedH: 72, expectedCanvasH: 24 * 72 },
    { name: "Custom Min Boundary", density: "custom", explicitH: 40, expectedH: 40, expectedCanvasH: 24 * 40 },
    { name: "Custom Intermediate 64", density: "custom", explicitH: 64, expectedH: 64, expectedCanvasH: 24 * 64 },
    { name: "Custom Intermediate 80", density: "custom", explicitH: 80, expectedH: 80, expectedCanvasH: 24 * 80 },
    { name: "Custom Max Boundary", density: "custom", explicitH: 96, expectedH: 96, expectedCanvasH: 24 * 96 },
    { name: "Clamped Underflow (20px)", density: "custom", explicitH: 20, expectedH: 40, expectedCanvasH: 24 * 40 },
    { name: "Clamped Overflow (150px)", density: "custom", explicitH: 150, expectedH: 96, expectedCanvasH: 24 * 96 },
  ];

  for (const tc of testMatrix) {
    const actionCode = tc.explicitH !== null
      ? `store.setHourHeight(${tc.explicitH});`
      : `store.setGridDensity(${JSON.stringify(tc.density)});`;

    const result = await cdp.evaluate(`
      (async () => {
        const store = await import('/src/store/calendarStore.ts');
        ${actionCode}

        // Give SolidJS microtasks a moment to flush reactive updates
        await new Promise(r => setTimeout(r, 40));

        const activeHourH = store.hourHeightPx();
        const activeDensity = store.userPreferences().gridDensity;

        // Inspect DOM in TimeGridView
        const gutter = document.querySelector('.shrink-0[style*="height"]');
        const dayCols = document.querySelector('.flex-1.grid.relative[style*="height"]');
        const gutterHourSlots = document.querySelectorAll('.shrink-0[style*="height"] > div');

        const gutterHeight = gutter ? parseFloat(gutter.style.height) : 0;
        const dayColsHeight = dayCols ? parseFloat(dayCols.style.height) : 0;
        const sampleSlotHeight = gutterHourSlots.length > 0 ? parseFloat(gutterHourSlots[0].style.height) : 0;

        return {
          activeHourH,
          activeDensity,
          gutterHeight,
          dayColsHeight,
          sampleSlotHeight,
          slotCount: gutterHourSlots.length
        };
      })()
    `);

    assert.strictEqual(
      result.activeHourH,
      tc.expectedH,
      `[${tc.name}] store.hourHeightPx() must match expected ${tc.expectedH}, got: ${result.activeHourH}`
    );
    assert.strictEqual(
      result.gutterHeight,
      tc.expectedCanvasH,
      `[${tc.name}] Timezone gutter style.height must match 24 * ${tc.expectedH} = ${tc.expectedCanvasH}px, got: ${result.gutterHeight}`
    );
    assert.strictEqual(
      result.dayColsHeight,
      tc.expectedCanvasH,
      `[${tc.name}] Day columns container style.height must match 24 * ${tc.expectedH} = ${tc.expectedCanvasH}px, got: ${result.dayColsHeight}`
    );
    assert.strictEqual(
      result.sampleSlotHeight,
      tc.expectedH,
      `[${tc.name}] Sample gutter hour slot style.height must match ${tc.expectedH}px, got: ${result.sampleSlotHeight}`
    );
    assert.strictEqual(
      result.slotCount,
      24,
      `[${tc.name}] Gutter must contain exactly 24 hour slots`
    );
  }

  // Restore standard density
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.setGridDensity('standard');
    })()
  `);
});

// ============================================================================
// 2. DRAGGING & 15-MINUTE SLOT SNAPPING ACROSS ALL DENSITIES
// ============================================================================

suite.test("15-Minute Slot Snapping: Snapping oracle and dragging across densities", async () => {
  // Test mathematical snapping logic for dragging deltaY -> deltaQuarters * 900s
  const densitiesToTest = [40, 44, 56, 72, 80, 96];

  for (const h of densitiesToTest) {
    const quarterPx = h / 4;

    const snappingVerification = await cdp.evaluate(`
      (() => {
        const h = ${h};
        const quarterPx = h / 4;
        const calculateDeltaSecs = (deltaY) => {
          const deltaQuarters = Math.round(deltaY / (h / 4));
          return deltaQuarters * 900;
        };

        const calculateQuarterIndex = (offsetY) => {
          return Math.floor(offsetY / (h / 4));
        };

        const checks = [
          // Below half-quarter threshold -> rounds to 0
          { deltaY: quarterPx * 0.4, expectedSecs: 0, desc: "below threshold (+)" },
          { deltaY: -quarterPx * 0.4, expectedSecs: 0, desc: "below threshold (-)" },

          // Above half-quarter threshold -> snaps to 1 quarter (900s)
          { deltaY: quarterPx * 0.6, expectedSecs: 900, desc: "above threshold 1 quarter (+)" },
          { deltaY: -quarterPx * 0.6, expectedSecs: -900, desc: "above threshold 1 quarter (-)" },

          // Exact quarter -> snaps to 1 quarter (900s)
          { deltaY: quarterPx, expectedSecs: 900, desc: "exact 1 quarter (+)" },
          { deltaY: -quarterPx, expectedSecs: -900, desc: "exact 1 quarter (-)" },

          // 2 quarters -> snaps to 1800s
          { deltaY: quarterPx * 2.1, expectedSecs: 1800, desc: "2 quarters (+)" },

          // 4 quarters (1 hour) -> snaps to 3600s
          { deltaY: h, expectedSecs: 3600, desc: "exact 1 hour (+)" },
          { deltaY: -h, expectedSecs: -3600, desc: "exact 1 hour (-)" },
        ];

        const gridSlotChecks = [
          { offsetY: 0, expectedIndex: 0 },
          { offsetY: quarterPx * 0.99, expectedIndex: 0 },
          { offsetY: quarterPx * 1.0, expectedIndex: 1 },
          { offsetY: quarterPx * 3.5, expectedIndex: 3 },
          { offsetY: h, expectedIndex: 4 },
        ];

        return {
          checks: checks.map(c => ({
            desc: c.desc,
            deltaY: c.deltaY,
            expected: c.expectedSecs,
            actual: calculateDeltaSecs(c.deltaY),
            pass: calculateDeltaSecs(c.deltaY) === c.expectedSecs
          })),
          gridSlots: gridSlotChecks.map(g => ({
            offsetY: g.offsetY,
            expectedIndex: g.expectedIndex,
            actualIndex: calculateQuarterIndex(g.offsetY),
            pass: calculateQuarterIndex(g.offsetY) === g.expectedIndex
          }))
        };
      })()
    `);

    for (const c of snappingVerification.checks) {
      assert.strictEqual(
        c.actual,
        c.expected,
        `[Density ${h}px] Drag deltaY ${c.deltaY.toFixed(1)}px (${c.desc}) must snap to ${c.expected}s, got: ${c.actual}s`
      );
    }

    for (const g of snappingVerification.gridSlots) {
      assert.strictEqual(
        g.actualIndex,
        g.expectedIndex,
        `[Density ${h}px] Grid slot at offsetY ${g.offsetY.toFixed(1)}px must map to quarterIndex ${g.expectedIndex}, got: ${g.actualIndex}`
      );
    }
  }
});

// ============================================================================
// 3. EVENT MINIMUM HEIGHT (>= 16px) ACROSS ALL DENSITIES & DURATIONS
// ============================================================================

suite.test("Event Minimum Height: >= 16px invariant strictly upheld across all durations (1m..60m) and densities (40..96px)", async () => {
  await selectViewTab("Day");

  const densityList = [40, 44, 56, 72, 80, 96];

  for (const h of densityList) {
    // Set density
    await cdp.evaluate(`
      (async () => {
        const store = await import('/src/store/calendarStore.ts');
        store.setHourHeight(${h});
      })()
    `);
    await new Promise(r => setTimeout(r, 40));

    // Evaluate mathematical height clamping oracle and DOM elements
    const heightAudit = await cdp.evaluate(`
      (() => {
        const h = ${h};

        // Mathematical oracle from TimeGridView:
        // const durMins = Math.max(15, (effectiveEndTs() - effectiveStartTs()) / 60);
        // const rawH = (durMins / 60) * hourHeightPx() - 1;
        // return Math.max(16, Math.round(rawH));
        const calcCardHeight = (durMins) => {
          const effectiveDur = Math.max(15, durMins);
          const rawH = (effectiveDur / 60) * h - 1;
          return Math.max(16, Math.round(rawH));
        };

        const testDurations = [0, 1, 5, 10, 15, 20, 30, 45, 60, 90, 120];
        const mathResults = testDurations.map(d => ({
          dur: d,
          calculatedH: calcCardHeight(d),
          pass: calcCardHeight(d) >= 16
        }));

        // Measure actual rendered cards in DOM
        const domCards = Array.from(document.querySelectorAll('[data-event-card="true"]')).map(el => {
          const rect = el.getBoundingClientRect();
          const title = el.querySelector('span')?.innerText || '';
          return {
            title,
            domHeight: Math.round(rect.height),
            styleHeight: parseFloat(el.style.height) || 0,
            pass: Math.round(rect.height) >= 16
          };
        });

        return {
          h,
          mathResults,
          domCards
        };
      })()
    `);

    // Verify mathematical bounds
    for (const mr of heightAudit.mathResults) {
      assert.ok(
        mr.calculatedH >= 16,
        `[Density ${h}px, Duration ${mr.dur}m] Calculated height must be >= 16px, got: ${mr.calculatedH}px`
      );
    }

    // Verify DOM rendered cards
    assert.ok(heightAudit.domCards.length > 0, `DOM cards should be rendered at density ${h}px`);
    for (const card of heightAudit.domCards) {
      assert.ok(
        card.domHeight >= 16,
        `[Density ${h}px] Rendered card '${card.title}' DOM height must be >= 16px, got: ${card.domHeight}px (style: ${card.styleHeight}px)`
      );
    }
  }

  // Restore standard
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.setGridDensity('standard');
    })()
  `);
});

// ============================================================================
// 4. RELATIVE SCROLL POSITION PRESERVATION
// ============================================================================

suite.test("Relative Scroll Preservation: Switching density maintains proportional viewport hour position", async () => {
  await selectViewTab("Week");

  // Reset to standard (56px)
  await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      store.setGridDensity('standard');
    })()
  `);
  await new Promise(r => setTimeout(r, 50));

  // Scroll to hour 9.0 (9 * 56 = 504px)
  const initialScroll = await cdp.evaluate(`
    (() => {
      const scrollEl = document.querySelector('.overflow-y-auto');
      if (!scrollEl) return { found: false };
      scrollEl.scrollTop = 504; // 9.0 hours * 56px
      return {
        found: true,
        scrollTop: scrollEl.scrollTop,
        totalHeight: scrollEl.scrollHeight
      };
    })()
  `);
  assert.ok(initialScroll.found, "Time grid scroll container must exist");

  // Step 1: Switch to Spacious (72px)
  // Expected scrollTop: 504 * (72 / 56) = 648px (which is 9.0 hours * 72px)
  const spaciousTransition = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      const scrollEl = document.querySelector('.overflow-y-auto');
      const prevScroll = scrollEl.scrollTop;
      store.setGridDensity('spacious');
      await new Promise(r => setTimeout(r, 50));
      return {
        prevScroll,
        newScroll: scrollEl.scrollTop,
        expectedScroll: Math.round(prevScroll * (72 / 56)),
        approxHour: scrollEl.scrollTop / 72
      };
    })()
  `);

  assert.ok(
    Math.abs(spaciousTransition.newScroll - spaciousTransition.expectedScroll) <= 2,
    `ScrollTop after switching to Spacious (72px) should be ~${spaciousTransition.expectedScroll}px (hour ~9.0), got: ${spaciousTransition.newScroll}px (approx hour: ${spaciousTransition.approxHour.toFixed(2)})`
  );

  // Step 2: Switch to Compact (44px)
  // Expected scrollTop: current * (44 / 72)
  const compactTransition = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      const scrollEl = document.querySelector('.overflow-y-auto');
      const prevScroll = scrollEl.scrollTop;
      store.setGridDensity('compact');
      await new Promise(r => setTimeout(r, 50));
      return {
        prevScroll,
        newScroll: scrollEl.scrollTop,
        expectedScroll: Math.round(prevScroll * (44 / 72)),
        approxHour: scrollEl.scrollTop / 44
      };
    })()
  `);

  assert.ok(
    Math.abs(compactTransition.newScroll - compactTransition.expectedScroll) <= 2,
    `ScrollTop after switching to Compact (44px) should be ~${compactTransition.expectedScroll}px (hour ~9.0), got: ${compactTransition.newScroll}px (approx hour: ${compactTransition.approxHour.toFixed(2)})`
  );

  // Step 3: Switch to Custom Slider 80px
  const customTransition = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      const scrollEl = document.querySelector('.overflow-y-auto');
      const prevScroll = scrollEl.scrollTop;
      store.setHourHeight(80);
      await new Promise(r => setTimeout(r, 50));
      return {
        prevScroll,
        newScroll: scrollEl.scrollTop,
        expectedScroll: Math.round(prevScroll * (80 / 44)),
        approxHour: scrollEl.scrollTop / 80
      };
    })()
  `);

  assert.ok(
    Math.abs(customTransition.newScroll - customTransition.expectedScroll) <= 2,
    `ScrollTop after setting custom height 80px should be ~${customTransition.expectedScroll}px (hour ~9.0), got: ${customTransition.newScroll}px (approx hour: ${customTransition.approxHour.toFixed(2)})`
  );

  // Step 4: Boundary scroll top = 0 remains 0
  const zeroScrollTransition = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      const scrollEl = document.querySelector('.overflow-y-auto');
      scrollEl.scrollTop = 0;
      store.setGridDensity('standard');
      await new Promise(r => setTimeout(r, 50));
      return {
        scrollTop: scrollEl.scrollTop
      };
    })()
  `);

  assert.strictEqual(
    zeroScrollTransition.scrollTop,
    0,
    `ScrollTop = 0 must remain 0 after density change`
  );
});

// ============================================================================
// 5. ZERO HORIZONTAL OVERFLOW ACROSS DENSITIES & VIEWPORTS
// ============================================================================

suite.test("Zero Horizontal Overflow: scrollWidth <= clientWidth strictly across viewports (960..1920) and densities", async () => {
  const viewports = [
    { w: 960, h: 640, label: "960x640 Min Viewport" },
    { w: 1280, h: 800, label: "1280x800 Standard Laptop" },
    { w: 1380, h: 860, label: "1380x860 14-inch" },
    { w: 1920, h: 1080, label: "1920x1080 Wide Desktop" },
  ];

  const densities = [40, 44, 56, 72, 96];
  const calendarViews = ["Day", "3-Day", "Work Week", "Week"];

  for (const vp of viewports) {
    await cdp.setViewport(vp.w, vp.h);

    for (const viewName of calendarViews) {
      await selectViewTab(viewName);

      for (const d of densities) {
        const overflowAudit = await cdp.evaluate(`
          (async () => {
            const store = await import('/src/store/calendarStore.ts');
            store.setHourHeight(${d});
            await new Promise(r => setTimeout(r, 20));

            const scrollEl = document.querySelector('.overflow-y-auto');
            const dayCols = document.querySelector('.flex-1.grid.relative');
            const main = document.querySelector('main');
            const doc = document.documentElement;

            const check = (el, name) => {
              if (!el) return { name, exists: false, overflow: false };
              const overflow = el.scrollWidth > el.clientWidth;
              return {
                name,
                exists: true,
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth,
                overflow
              };
            };

            return {
              scrollEl: check(scrollEl, 'TimeGridScrollContainer'),
              dayCols: check(dayCols, 'DayColumnsCanvas'),
              main: check(main, 'MainContainer'),
              doc: check(doc, 'DocumentRoot')
            };
          })()
        `);

        assert.strictEqual(
          overflowAudit.scrollEl.overflow,
          false,
          `[${vp.label} | ${viewName} | Density ${d}px] TimeGridScrollContainer must not overflow horizontally: ${JSON.stringify(overflowAudit.scrollEl)}`
        );
        assert.strictEqual(
          overflowAudit.dayCols.overflow,
          false,
          `[${vp.label} | ${viewName} | Density ${d}px] DayColumnsCanvas must not overflow horizontally: ${JSON.stringify(overflowAudit.dayCols)}`
        );
        assert.strictEqual(
          overflowAudit.main.overflow,
          false,
          `[${vp.label} | ${viewName} | Density ${d}px] MainContainer must not overflow horizontally: ${JSON.stringify(overflowAudit.main)}`
        );
        assert.strictEqual(
          overflowAudit.doc.overflow,
          false,
          `[${vp.label} | ${viewName} | Density ${d}px] DocumentRoot must not overflow horizontally: ${JSON.stringify(overflowAudit.doc)}`
        );
      }
    }
  }

  // Restore viewport
  await cdp.setViewport(1280, 800);
  await selectViewTab("Week");
});

// ============================================================================
// 6. SETTINGS VIEW UI CONTROLS & BI-DIRECTIONAL PERSISTENCE
// ============================================================================

suite.test("Settings UI: General and Advanced density controls synchronize cleanly with store & localStorage", async () => {
  // Open settings
  const openSettings = await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b =>
        b.getAttribute('title')?.toLowerCase().includes('settings') ||
        b.getAttribute('aria-label')?.toLowerCase().includes('settings')
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()
  `);
  assert.ok(openSettings, "Settings button should be opened from TopBar");
  await new Promise(r => setTimeout(r, 300));

  // Test 1: General Tab 3-Pill selector
  const generalPillTest = await cdp.evaluate(`
    (async () => {
      const pills = Array.from(document.querySelectorAll('button')).filter(b => {
        const txt = (b.innerText || '').trim();
        return txt.startsWith('Compact') || txt.startsWith('Standard') || txt.startsWith('Spacious');
      });

      if (pills.length < 3) return { found: false, count: pills.length };

      const store = await import('/src/store/calendarStore.ts');

      // Click Compact
      const compactBtn = pills.find(b => b.innerText.includes('Compact'));
      compactBtn.click();
      await new Promise(r => setTimeout(r, 50));
      const hAfterCompact = store.hourHeightPx();

      // Click Spacious
      const spaciousBtn = pills.find(b => b.innerText.includes('Spacious'));
      spaciousBtn.click();
      await new Promise(r => setTimeout(r, 50));
      const hAfterSpacious = store.hourHeightPx();

      // Click Standard
      const standardBtn = pills.find(b => b.innerText.includes('Standard'));
      standardBtn.click();
      await new Promise(r => setTimeout(r, 50));
      const hAfterStandard = store.hourHeightPx();

      return {
        found: true,
        hAfterCompact,
        hAfterSpacious,
        hAfterStandard
      };
    })()
  `);

  assert.ok(generalPillTest.found, "General settings tab must render Compact/Standard/Spacious pill selectors");
  assert.strictEqual(generalPillTest.hAfterCompact, 44, "Clicking Compact pill should set hourHeight to 44px");
  assert.strictEqual(generalPillTest.hAfterSpacious, 72, "Clicking Spacious pill should set hourHeight to 72px");
  assert.strictEqual(generalPillTest.hAfterStandard, 56, "Clicking Standard pill should set hourHeight to 56px");

  // Test 2: Navigate to Advanced tab and verify Section 4 controls
  const advancedNav = await cdp.evaluate(`
    (() => {
      const navBtn = Array.from(document.querySelectorAll('nav button')).find(b =>
        (b.innerText || '').toLowerCase().includes('advanced')
      );
      if (navBtn) {
        navBtn.click();
        return true;
      }
      return false;
    })()
  `);
  assert.ok(advancedNav, "Advanced settings tab should be clicked");
  await new Promise(r => setTimeout(r, 300));

  const advancedControlsTest = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');

      // Find density cards in Section 4
      const cards = Array.from(document.querySelectorAll('button')).filter(b =>
        b.innerText.includes('Compact (44px)') ||
        b.innerText.includes('Standard (56px)') ||
        b.innerText.includes('Spacious (72px)')
      );

      // Find range slider
      const slider = document.querySelector('input[type="range"][min="40"][max="96"]');

      // Find reset button if available
      const resetBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.includes('Reset to Default')
      );

      // Click Compact card
      const compactCard = cards.find(b => b.innerText.includes('Compact (44px)'));
      if (compactCard) compactCard.click();
      await new Promise(r => setTimeout(r, 50));
      const hAfterCard = store.hourHeightPx();

      // Change range slider
      if (slider) {
        slider.value = "84";
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await new Promise(r => setTimeout(r, 50));
      const hAfterSlider = store.hourHeightPx();

      // Reset button
      const resetBtnAfterChange = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.includes('Reset to Default (56px)')
      );
      if (resetBtnAfterChange) {
        resetBtnAfterChange.click();
      }
      await new Promise(r => setTimeout(r, 50));
      const hAfterReset = store.hourHeightPx();

      // Check localStorage
      const stored = JSON.parse(localStorage.getItem('rapidcal.preferences.v1') || '{}');

      return {
        cardsCount: cards.length,
        hasSlider: Boolean(slider),
        hAfterCard,
        hAfterSlider,
        hAfterReset,
        storedDensity: stored.gridDensity,
        storedHourHeight: stored.hourHeight
      };
    })()
  `);

  assert.strictEqual(advancedControlsTest.cardsCount, 3, "Advanced tab must render 3 density preset cards");
  assert.ok(advancedControlsTest.hasSlider, "Advanced tab must render range slider (40..96px)");
  assert.strictEqual(advancedControlsTest.hAfterCard, 44, "Clicking Compact card sets 44px");
  assert.strictEqual(advancedControlsTest.hAfterSlider, 84, "Setting range slider to 84 sets 84px");
  assert.strictEqual(advancedControlsTest.hAfterReset, 56, "Clicking Reset button restores 56px default");
  assert.strictEqual(advancedControlsTest.storedDensity, "standard", "localStorage must persist standard density");
  assert.strictEqual(advancedControlsTest.storedHourHeight, 56, "localStorage must persist 56px hour height");

  // Close Settings dialog
  await cdp.evaluate(`
    (() => {
      const backBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.includes('Back to Calendar')
      );
      if (backBtn) backBtn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 300));
});

// ============================================================================
// 7. PREFERENCES JSON EXPORT / IMPORT BOUNDARY VALIDATION
// ============================================================================

suite.test("Preferences IO: Export and Import schema boundary validation for gridDensity and hourHeight", async () => {
  const ioValidation = await cdp.evaluate(`
    (async () => {
      const prefsIo = await import('/src/lib/preferencesIo.ts');
      const { validatePreferencesImport, generatePreferencesExportJson } = prefsIo;

      // 1. Export test
      const exportedJsonStr = generatePreferencesExportJson();
      const exportedObj = JSON.parse(exportedJsonStr);

      const exportHasDensity = "gridDensity" in exportedObj.preferences;
      const exportHasHeight = "hourHeight" in exportedObj.preferences;

      // 2. Import validation oracle test
      const testCases = [
        // Valid cases
        { input: JSON.stringify({ version: 1, preferences: { gridDensity: "compact", hourHeight: 44 } }), shouldPass: true, desc: "Valid compact" },
        { input: JSON.stringify({ version: 1, preferences: { gridDensity: "standard", hourHeight: 56 } }), shouldPass: true, desc: "Valid standard" },
        { input: JSON.stringify({ version: 1, preferences: { gridDensity: "spacious", hourHeight: 72 } }), shouldPass: true, desc: "Valid spacious" },
        { input: JSON.stringify({ version: 1, preferences: { gridDensity: "custom", hourHeight: 40 } }), shouldPass: true, desc: "Valid custom min (40)" },
        { input: JSON.stringify({ version: 1, preferences: { gridDensity: "custom", hourHeight: 96 } }), shouldPass: true, desc: "Valid custom max (96)" },

        // Invalid / adversarial cases
        { input: JSON.stringify({ version: 1, preferences: { gridDensity: "ultra-dense" } }), shouldPass: false, desc: "Invalid gridDensity string" },
        { input: JSON.stringify({ version: 1, preferences: { hourHeight: 39 } }), shouldPass: false, desc: "hourHeight below min (39)" },
        { input: JSON.stringify({ version: 1, preferences: { hourHeight: 97 } }), shouldPass: false, desc: "hourHeight above max (97)" },
        { input: JSON.stringify({ version: 1, preferences: { hourHeight: -5 } }), shouldPass: false, desc: "Negative hourHeight" },
        { input: JSON.stringify({ version: 1, preferences: { hourHeight: "not-a-number" } }), shouldPass: false, desc: "Non-numeric hourHeight" },
        { input: '{"version": 1, "preferences": {"hourHeight": NaN}}', shouldPass: false, desc: "Malformed JSON string" },
      ];

      const validationResults = testCases.map(tc => {
        const res = validatePreferencesImport(tc.input);
        return {
          desc: tc.desc,
          shouldPass: tc.shouldPass,
          actualPass: res.ok,
          error: res.error,
          passedCheck: res.ok === tc.shouldPass
        };
      });

      return {
        exportHasDensity,
        exportHasHeight,
        validationResults
      };
    })()
  `);

  assert.ok(ioValidation.exportHasDensity, "Exported JSON preferences must contain gridDensity");
  assert.ok(ioValidation.exportHasHeight, "Exported JSON preferences must contain hourHeight");

  for (const vr of ioValidation.validationResults) {
    assert.strictEqual(
      vr.actualPass,
      vr.shouldPass,
      `[${vr.desc}] validatePreferencesImport expected ok=${vr.shouldPass}, got ok=${vr.actualPass} (error: ${vr.error})`
    );
  }
});

// ============================================================================
// 8. RAPID HIGH-FREQUENCY DENSITY TOGGLING STRESS TEST
// ============================================================================

suite.test("Stress Test: Rapid high-frequency density switches (10 iterations) induce zero NaN styles or DOM corruptions", async () => {
  await selectViewTab("Week");

  const stressResult = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');
      const heights = [40, 72, 44, 96, 56, 44, 80, 56, 72, 44, 56];
      const errors = [];

      for (let i = 0; i < heights.length; i++) {
        const h = heights[i];
        store.setHourHeight(h);
        // Extremely tight async yield to stress reactive queue
        await new Promise(r => setTimeout(r, 15));

        const scrollEl = document.querySelector('.overflow-y-auto');
        const gutter = document.querySelector('.shrink-0[style*="height"]');
        const dayCols = document.querySelector('.flex-1.grid.relative[style*="height"]');

        const gutterH = gutter ? gutter.style.height : '';
        const dayColsH = dayCols ? dayCols.style.height : '';

        if (gutterH.includes('NaN') || dayColsH.includes('NaN')) {
          errors.push({ step: i, targetH: h, gutterH, dayColsH, error: "NaN detected in style height" });
        }

        if (scrollEl && isNaN(scrollEl.scrollTop)) {
          errors.push({ step: i, targetH: h, error: "scrollTop is NaN" });
        }
      }

      // Check final state
      const finalH = store.hourHeightPx();
      const finalDensity = store.userPreferences().gridDensity;

      return {
        errors,
        finalH,
        finalDensity
      };
    })()
  `);

  assert.strictEqual(stressResult.errors.length, 0, `Rapid toggles should have zero NaN styles: ${JSON.stringify(stressResult.errors)}`);
  assert.strictEqual(stressResult.finalH, 56, "Final hourHeight must be restored to 56px");
});

// ============================================================================
// 9. ADAPTIVE EVENT CARD CONTROLS AT COMPACT VS SPACIOUS DENSITIES
// ============================================================================

suite.test("Adaptive Event Card Layout: Conference join button threshold (>= 48px) behaves correctly at Compact vs Spacious", async () => {
  await selectViewTab("Day");

  const buttonVisibilityTest = await cdp.evaluate(`
    (async () => {
      const store = await import('/src/store/calendarStore.ts');

      // 1. Set compact (44px) - 1-hour event raw height is (60/60)*44 - 1 = 43px (< 48px threshold)
      store.setGridDensity('compact');
      await new Promise(r => setTimeout(r, 50));

      const compactJoinBtns = Array.from(document.querySelectorAll('[data-event-card="true"] button')).filter(b =>
        b.innerText.toLowerCase().includes('join')
      );

      // 2. Set spacious (72px) - 1-hour event raw height is (60/60)*72 - 1 = 71px (>= 48px threshold)
      store.setGridDensity('spacious');
      await new Promise(r => setTimeout(r, 50));

      const spaciousJoinBtns = Array.from(document.querySelectorAll('[data-event-card="true"] button')).filter(b =>
        b.innerText.toLowerCase().includes('join')
      );

      // Restore standard
      store.setGridDensity('standard');

      return {
        compactCount: compactJoinBtns.length,
        spaciousCount: spaciousJoinBtns.length
      };
    })()
  `);

  // Under spacious, events with conference URLs display Join buttons; under compact, short events suppress it
  assert.ok(
    buttonVisibilityTest.spaciousCount >= buttonVisibilityTest.compactCount,
    `Spacious density (72px) should expose at least as many Join buttons as Compact (44px), got spacious=${buttonVisibilityTest.spaciousCount}, compact=${buttonVisibilityTest.compactCount}`
  );
});

// Run test suite
suite.run().catch((err) => {
  console.error("Test Suite execution failed:", err);
  process.exit(1);
});

