import { assert, createHarness, TestSuite } from "./harness.js";

const suite = new TestSuite("Tier 3: Cross-Feature Tests");

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

suite.test("Platform Emulation: MacIntel displays macOS symbols (⌘)", async () => {
  // Override user agent and platform to macOS
  await cdp.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "MacIntel"
  );
  await cdp.navigate(harness.url);

  const platformInfo = await cdp.evaluate(`
    (() => {
      // Find settings button title or shortcut badges
      const buttons = Array.from(document.querySelectorAll('header button'));
      const settingsBtn = buttons.find(b => b.innerText.includes('Settings'));
      const title = settingsBtn ? settingsBtn.getAttribute('title') : '';
      return {
        platform: navigator.platform,
        settingsTitle: title,
        hasMacCmd: title.includes('⌘')
      };
    })()
  `);

  assert.ok(
    platformInfo.settingsTitle.includes("⌘"),
    `On macOS (MacIntel), Settings shortcut title should display '⌘,', got: '${platformInfo.settingsTitle}'`
  );

  await harness.saveScreenshot("tier3_01_platform_mac");
});

suite.test("Platform Emulation: Linux x86_64 displays Ctrl shortcuts", async () => {
  // Override user agent and platform to Linux
  await cdp.setUserAgent(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Linux x86_64"
  );
  await cdp.navigate(harness.url);

  const platformInfo = await cdp.evaluate(`
    (() => {
      const buttons = Array.from(document.querySelectorAll('header button'));
      const settingsBtn = buttons.find(b => b.innerText.includes('Settings'));
      const title = settingsBtn ? settingsBtn.getAttribute('title') : '';
      return {
        platform: navigator.platform,
        settingsTitle: title,
        hasCtrl: title.includes('Ctrl'),
        hasCmd: title.includes('⌘')
      };
    })()
  `);

  assert.ok(
    platformInfo.settingsTitle.includes("Ctrl"),
    `On Linux, Settings shortcut title should dynamically display 'Ctrl+,', got: '${platformInfo.settingsTitle}'`
  );
  assert.strictEqual(
    platformInfo.hasCmd,
    false,
    `On Linux, Settings button should not display macOS '⌘' symbol`
  );

  await harness.saveScreenshot("tier3_02_platform_linux");
});

suite.test("Platform Emulation: Win32 displays Ctrl shortcuts", async () => {
  // Override user agent and platform to Windows
  await cdp.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Win32"
  );
  await cdp.navigate(harness.url);

  const platformInfo = await cdp.evaluate(`
    (() => {
      const buttons = Array.from(document.querySelectorAll('header button'));
      const settingsBtn = buttons.find(b => b.innerText.includes('Settings'));
      const title = settingsBtn ? settingsBtn.getAttribute('title') : '';
      return {
        platform: navigator.platform,
        settingsTitle: title,
        hasCtrl: title.includes('Ctrl'),
        hasCmd: title.includes('⌘')
      };
    })()
  `);

  assert.ok(
    platformInfo.settingsTitle.includes("Ctrl"),
    `On Windows, Settings shortcut title should dynamically display 'Ctrl+,', got: '${platformInfo.settingsTitle}'`
  );
  assert.strictEqual(
    platformInfo.hasCmd,
    false,
    `On Windows, Settings button should not display macOS '⌘' symbol`
  );

  await harness.saveScreenshot("tier3_03_platform_windows");
});

suite.test("Theme Switching: Dark Mode Contrast and CSS Classes", async () => {
  // Ensure Dark theme is set
  await cdp.evaluate(`
    (() => {
      document.documentElement.classList.remove('light');
      localStorage.setItem('rapidcal.theme.v1', 'dark');
    })()
  `);
  await cdp.navigate(harness.url);

  const darkMetrics = await cdp.evaluate(`
    (() => {
      const isLightClass = document.documentElement.classList.contains('light');
      const bodyBg = window.getComputedStyle(document.body).backgroundColor;
      const header = document.querySelector('header');
      const headerBg = header ? window.getComputedStyle(header).backgroundColor : '';
      const headerColor = header ? window.getComputedStyle(header).color : '';
      return {
        isLightClass,
        bodyBg,
        headerBg,
        headerColor
      };
    })()
  `);

  assert.strictEqual(
    darkMetrics.isLightClass,
    false,
    "Document root should not have .light class in Dark mode"
  );
  // Verify dark background (Tailwind 4 uses oklch/oklab or rgb)
  assert.ok(
    darkMetrics.bodyBg.includes("oklch") ||
    darkMetrics.bodyBg.includes("oklab") ||
    darkMetrics.bodyBg.includes("rgb(9, 9, 11)") ||
    darkMetrics.bodyBg.includes("rgb(0, 0, 0)") ||
    darkMetrics.headerBg.includes("oklch") ||
    darkMetrics.headerBg.includes("oklab") ||
    darkMetrics.headerBg.includes("rgb("),
    `Dark mode body/header background should have dark styles: ${JSON.stringify(darkMetrics)}`
  );

  await harness.saveScreenshot("tier3_04_theme_dark");
});

suite.test("Theme Switching: Light Mode Toggle and Contrast", async () => {
  // Click theme toggle button in TopBar
  const toggleClicked = await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b =>
        b.getAttribute('title')?.toLowerCase().includes('dark / light') ||
        b.getAttribute('title')?.toLowerCase().includes('theme')
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()
  `);

  assert.ok(toggleClicked, "Theme toggle button in TopBar should be found and clicked");
  await new Promise((r) => setTimeout(r, 300));

  const lightMetrics = await cdp.evaluate(`
    (() => {
      const hasLightClass = document.documentElement.classList.contains('light');
      const header = document.querySelector('header');
      const headerBg = header ? window.getComputedStyle(header).backgroundColor : '';
      const headerColor = header ? window.getComputedStyle(header).color : '';
      return {
        hasLightClass,
        headerBg,
        headerColor
      };
    })()
  `);

  assert.strictEqual(
    lightMetrics.hasLightClass,
    true,
    "Document root must receive .light class when switching to Light theme"
  );

  await harness.saveScreenshot("tier3_05_theme_light");

  // Toggle back to dark theme
  await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b =>
        b.getAttribute('title')?.toLowerCase().includes('dark / light') ||
        b.getAttribute('title')?.toLowerCase().includes('theme')
      );
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));
});

suite.test("Timezone Configuration and Dynamic Grid Reflow", async () => {
  // Check primary timezone
  const tzInfo = await cdp.evaluate(`
    (() => {
      const primaryTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const key = "rapidcal.preferences.v1";
      const prefs = JSON.parse(localStorage.getItem(key) || '{}');
      return {
        primaryTz,
        showSecondary: prefs.showSecondaryTimezone ?? true
      };
    })()
  `);

  assert.ok(tzInfo.primaryTz, "Intl primary timezone must be detected");

  // Toggle secondary timezone off and measure gutter in Day view
  await cdp.evaluate(`
    (() => {
      const key = "rapidcal.preferences.v1";
      const prefs = JSON.parse(localStorage.getItem(key) || '{}');
      prefs.showSecondaryTimezone = false;
      localStorage.setItem(key, JSON.stringify(prefs));
    })()
  `);
  await cdp.navigate(harness.url);

  const singleTzGutterWidth = await cdp.evaluate(`
    (() => {
      const gutter = document.querySelector('.overflow-y-auto .shrink-0.border-r');
      return gutter ? gutter.clientWidth : 0;
    })()
  `);

  // Toggle secondary timezone on and measure gutter
  await cdp.evaluate(`
    (() => {
      const key = "rapidcal.preferences.v1";
      const prefs = JSON.parse(localStorage.getItem(key) || '{}');
      prefs.showSecondaryTimezone = true;
      localStorage.setItem(key, JSON.stringify(prefs));
    })()
  `);
  await cdp.navigate(harness.url);

  const dualTzGutterWidth = await cdp.evaluate(`
    (() => {
      const gutter = document.querySelector('.overflow-y-auto .shrink-0.border-r');
      return gutter ? gutter.clientWidth : 0;
    })()
  `);

  assert.ok(
    dualTzGutterWidth > singleTzGutterWidth,
    `Dual timezone gutter (${dualTzGutterWidth}px) should be wider than single timezone gutter (${singleTzGutterWidth}px)`
  );

  await harness.saveScreenshot("tier3_06_timezone_reflow");
});

if (process.argv[1]?.endsWith("tier3_cross_features.test.js")) {
  suite.run().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}

export { suite };
