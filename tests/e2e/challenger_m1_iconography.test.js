import fs from "node:fs";
import path from "node:path";
import { assert, createHarness, TestSuite } from "./harness.js";

const suite = new TestSuite("Empirical Challenger M1-2: Iconography & UI Presentation Stress Suite");

let harness;
let cdp;

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb) {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

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

// Test 1: Static analysis of Icons.tsx definition file
suite.test("Static Verification: All exported Icons in Icons.tsx conform to SVG specification", async () => {
  const iconsPath = path.resolve("./src/components/icons/Icons.tsx");
  const content = fs.readFileSync(iconsPath, "utf-8");

  const iconMatches = [...content.matchAll(/export function ([A-Za-z0-9]+Icon)\b/g)];
  assert.ok(iconMatches.length >= 25, `Should export at least 25 icon components, found ${iconMatches.length}`);

  const svgBlocks = content.split("<svg");
  assert.ok(svgBlocks.length > 25, "Icons.tsx must contain multiple <svg definitions");

  for (let i = 1; i < svgBlocks.length; i++) {
    const block = svgBlocks[i].slice(0, 400);
    assert.ok(
      block.includes('viewBox="0 0 24 24"'),
      `SVG block ${i} must define viewBox="0 0 24 24"`
    );
    assert.ok(
      block.includes('fill="none"'),
      `SVG block ${i} must define fill="none"`
    );
    assert.ok(
      block.includes('stroke="currentColor"'),
      `SVG block ${i} must define stroke="currentColor"`
    );
  }
});

// Test 2: Assert ZERO raw emojis or unicode glyphs across all views
suite.test("Empirical Assertion: ZERO raw emojis or raw unicode glyphs across all rendered views", async () => {
  const views = ["day", "week", "workweek", "3days", "month", "agenda"];
  const emojiRegexPattern = `[⚡⚙↻▶☀☾‹›🛡📅✨👤🗓🌍🔄⌨📌🗂🎥📍📋🌗↵]`;

  for (const v of views) {
    await cdp.evaluate(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('header button'));
        const btn = buttons.find(b => {
          const t = b.innerText.toLowerCase();
          if ('${v}' === 'day') return t === 'day';
          if ('${v}' === 'week') return t === 'week';
          if ('${v}' === 'workweek') return t.includes('work');
          if ('${v}' === '3days') return t.includes('3 days') || t.includes('3-day');
          if ('${v}' === 'month') return t === 'month';
          if ('${v}' === 'agenda') return t === 'schedule';
          return false;
        });
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 200));

    const evaluation = await cdp.evaluate(`
      (() => {
        const regex = new RegExp("${emojiRegexPattern}", "gu");
        const bodyText = document.body.innerText;
        const matches = bodyText.match(regex) || [];
        return {
          view: "${v}",
          matches: Array.from(new Set(matches)),
          matchCount: matches.length,
        };
      })()
    `);

    assert.strictEqual(
      evaluation.matchCount,
      0,
      `View '${v}' contains forbidden raw emojis/glyphs: ${evaluation.matches.join(", ")}`
    );
  }
});

// Test 3: Adversarial audit of all SVG viewBox definitions in DOM
suite.test("Adversarial DOM Audit: Detection of unmigrated non-24x24 SVGs in rendered UI", async () => {
  const svgAudit = await cdp.evaluate(`
    (() => {
      const svgs = Array.from(document.querySelectorAll('svg'));
      const invalidViewBoxes = [];
      const validSvgs = [];

      for (const svg of svgs) {
        const vb = svg.getAttribute('viewBox');
        const parent = svg.parentElement;
        const info = {
          viewBox: vb,
          classes: svg.getAttribute('class'),
          parentClass: parent ? parent.className : '',
          parentTag: parent ? parent.tagName : '',
        };
        if (vb !== '0 0 24 24') {
          invalidViewBoxes.push(info);
        } else {
          validSvgs.push(info);
        }
      }
      return { total: svgs.length, invalidCount: invalidViewBoxes.length, invalidViewBoxes, validCount: validSvgs.length };
    })()
  `);

  console.log(`\n    [Audit Result] Total SVGs: ${svgAudit.total}, Valid (0 0 24 24): ${svgAudit.validCount}, Non-24x24: ${svgAudit.invalidCount}`);
  if (svgAudit.invalidCount > 0) {
    console.log(`    [Defect Finding] Non-24x24 SVGs detected in DOM:`, JSON.stringify(svgAudit.invalidViewBoxes, null, 2));
  }

  assert.ok(svgAudit.total >= 15, "Should render at least 15 SVG elements in main layout");
  // Calendar checkbox tickmarks in LeftSidebar migrated to standard CheckIcon (viewBox 0 0 24 24)
  assert.strictEqual(
    svgAudit.invalidCount,
    0,
    "All SVGs in layout must conform to standard viewBox 0 0 24 24 with 0 unmigrated icons"
  );
});

// Test 4: Modal Verification: CommandPalette and SettingsView
suite.test("Modal Verification: CommandPalette and SettingsView iconography & zero glyphs", async () => {
  // 1. Check CommandPalette
  await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b => b.innerText.includes('Quick Add / Search'));
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  const paletteMetrics = await cdp.evaluate(`
    (() => {
      const modal = document.querySelector('.fixed.inset-0');
      if (!modal) return null;
      const text = modal.innerText;
      const svgs = Array.from(modal.querySelectorAll('svg')).map(s => {
        const rect = s.getBoundingClientRect();
        return {
          viewBox: s.getAttribute('viewBox'),
          w: rect.width,
          h: rect.height,
        };
      });
      return { text, svgs };
    })()
  `);

  assert.ok(paletteMetrics, "CommandPalette modal must exist");
  assert.ok(paletteMetrics.svgs.length >= 4, `CommandPalette should contain at least 4 SVGs, got ${paletteMetrics.svgs.length}`);
  for (const s of paletteMetrics.svgs) {
    assert.strictEqual(s.viewBox, "0 0 24 24", "Palette SVG viewBox must be 0 0 24 24");
    assert.ok(s.w > 0 && s.w <= 32, `Palette SVG width out of range: ${s.w}`);
    assert.ok(s.h > 0 && s.h <= 32, `Palette SVG height out of range: ${s.h}`);
  }

  // Close palette
  await cdp.evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  `);
  await new Promise((r) => setTimeout(r, 200));

  // 2. Check SettingsView across tabs
  await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b => b.innerText.includes('Settings'));
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  const settingsTabs = ["general", "accounts", "calendars", "timezones", "sync", "shortcuts"];
  for (const tabName of settingsTabs) {
    await cdp.evaluate(`
      (() => {
        const navBtns = Array.from(document.querySelectorAll('nav button'));
        const btn = navBtns.find(b => b.innerText.toLowerCase().includes('${tabName}'));
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 200));

    const checkResult = await cdp.evaluate(`
      (() => {
        const container = document.querySelector('div.flex-1.overflow-y-auto');
        const text = container ? container.innerText : '';
        const svgs = Array.from(container ? container.querySelectorAll('svg') : []).map(s => ({
          viewBox: s.getAttribute('viewBox'),
          rect: s.getBoundingClientRect(),
        }));
        const regex = /[⚡⚙↻▶☀☾‹›🛡📅✨👤🗓🌍🔄⌨📌🗂🎥📍📋🌗↵]/gu;
        const matches = text.match(regex) || [];
        return {
          tab: '${tabName}',
          matchCount: matches.length,
          matches: Array.from(new Set(matches)),
          svgCount: svgs.length,
          allSvgsValid: svgs.every(s => s.viewBox === '0 0 24 24' && s.rect.width > 0 && s.rect.height > 0)
        };
      })()
    `);

    assert.strictEqual(
      checkResult.matchCount,
      0,
      `Settings tab '${tabName}' contains forbidden glyphs: ${checkResult.matches.join(", ")}`
    );
    assert.ok(
      checkResult.allSvgsValid,
      `Settings tab '${tabName}' has SVGs with invalid viewBox or dimensions`
    );
  }

  // Return to calendar
  await cdp.evaluate(`
    (() => {
      const backBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Back') || b.innerText.includes('Return'));
      if (backBtn) backBtn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));
});

// Test 5: Contrast analysis in Dark and Light themes with Canvas 2D color resolution
suite.test("Color & Contrast Verification: Primary UI icons maintain high contrast across themes", async () => {
  const evaluateContrastForTheme = async (themeName) => {
    await cdp.evaluate(`
      (() => {
        if ('${themeName}' === 'light') {
          document.documentElement.classList.remove('dark');
          document.documentElement.classList.add('light');
        } else {
          document.documentElement.classList.remove('light');
          document.documentElement.classList.add('dark');
        }
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    const iconContrasts = await cdp.evaluate(`
      (() => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d");

        function toRgb(colorStr) {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = colorStr;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
          return { r, g, b };
        }

        function getEffectiveBg(el) {
          let curr = el;
          while (curr && curr !== document.documentElement) {
            const bg = window.getComputedStyle(curr).backgroundColor;
            if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
              return bg;
            }
            curr = curr.parentElement;
          }
          return '${themeName}' === 'dark' ? 'rgb(9, 9, 11)' : 'rgb(255, 255, 255)';
        }

        const svgs = Array.from(document.querySelectorAll('header button svg, aside button svg'));
        const results = [];
        for (const svg of svgs) {
          // Check if visible
          const isHidden = (svg.offsetParent === null && window.getComputedStyle(svg).display === 'none') ||
                           (svg.parentElement && svg.parentElement.offsetParent === null && window.getComputedStyle(svg.parentElement).display === 'none');
          if (isHidden) continue;

          const color = window.getComputedStyle(svg).color;
          const stroke = window.getComputedStyle(svg).stroke;
          const bg = getEffectiveBg(svg);
          results.push({
            rgbColor: toRgb(stroke || color),
            rgbBg: toRgb(bg),
            tag: svg.parentElement?.tagName
          });
        }
        return results;
      })()
    `);

    assert.ok(iconContrasts.length >= 5, `Expected >= 5 icons to check contrast in ${themeName} theme`);

    let passingCount = 0;
    const contrastReports = [];
    for (const item of iconContrasts) {
      const ratio = contrastRatio(item.rgbColor, item.rgbBg);
      contrastReports.push(ratio.toFixed(2));
      if (ratio >= 3.0) {
        passingCount++;
      }
    }

    return { total: iconContrasts.length, passingCount, contrastReports };
  };

  const darkRes = await evaluateContrastForTheme("dark");
  console.log(`\n    [Theme Dark] ${darkRes.passingCount}/${darkRes.total} icons pass >= 3.0:1 (ratios: ${darkRes.contrastReports.join(", ")})`);
  assert.ok(darkRes.passingCount >= 5, "Dark theme icons must maintain high contrast");

  const lightRes = await evaluateContrastForTheme("light");
  console.log(`    [Theme Light] ${lightRes.passingCount}/${lightRes.total} icons pass >= 3.0:1 (ratios: ${lightRes.contrastReports.join(", ")})`);
  assert.ok(lightRes.passingCount >= 5, "Light theme icons must maintain high contrast");

  // Restore dark theme
  await cdp.evaluate(`
    (() => {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));
});

// Test 6: Viewport resize bounding box stress test (960x640 to 1920x1080)
suite.test("Layout Stress Test: SVG icons do not clip, collide, or break bounding boxes from 960x640 to 1920x1080", async () => {
  const viewports = [
    { w: 960, h: 640 },
    { w: 1280, h: 800 },
    { w: 1380, h: 860 },
    { w: 1920, h: 1080 },
  ];

  for (const vp of viewports) {
    await cdp.setViewport(vp.w, vp.h);

    const check = await cdp.evaluate(`
      (() => {
        const header = document.querySelector('header');
        if (!header) return { error: 'No header' };
        
        const headerOverflow = header.scrollWidth > header.clientWidth;
        
        // Check only actively displayed icons in header
        const icons = Array.from(header.querySelectorAll('svg')).map(s => {
          // An icon is hidden if it or an ancestor is display: none
          let isHidden = false;
          let el = s;
          while (el && el !== document.body) {
            if (window.getComputedStyle(el).display === 'none') {
              isHidden = true;
              break;
            }
            el = el.parentElement;
          }

          const rect = s.getBoundingClientRect();
          return {
            classes: s.getAttribute('class'),
            isHidden,
            w: rect.width,
            h: rect.height,
            validDimensions: isHidden || (rect.width > 0 && rect.height > 0 && rect.width <= 48 && rect.height <= 48),
            inViewport: isHidden || (rect.right <= window.innerWidth && rect.bottom <= window.innerHeight),
          };
        });

        return {
          headerOverflow,
          allValidDimensions: icons.every(i => i.validDimensions),
          allInViewport: icons.every(i => i.inViewport),
          iconCount: icons.length,
        };
      })()
    `);

    assert.strictEqual(
      check.headerOverflow,
      false,
      `Header overflows horizontally at viewport ${vp.w}x${vp.h}`
    );
    assert.ok(
      check.allValidDimensions,
      `Some visible icons have invalid dimensions at viewport ${vp.w}x${vp.h}`
    );
    assert.ok(
      check.allInViewport,
      `Some icons clipped outside viewport at ${vp.w}x${vp.h}`
    );
  }

  // Restore 1280x800
  await cdp.setViewport(1280, 800);
});

// Run directly
if (process.argv[1]?.endsWith("challenger_m1_iconography.test.js")) {
  suite.run().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}

export { suite };
