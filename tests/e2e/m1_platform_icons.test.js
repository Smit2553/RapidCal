import { assert, createHarness, TestSuite } from "./harness.js";

const suite = new TestSuite("Milestone 1: Platform Abstraction & Iconography (R2)");

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

suite.test("Default Linux/Windows rendering has ZERO hardcoded ⌘ symbols", async () => {
  // Query all kbd and button text in the main header and sidebars
  const text = await cdp.getText("body");
  assert.ok(text, "Body text should exist");
  assert.strictEqual(
    text.includes("⌘"),
    false,
    "No hardcoded ⌘ symbols should appear in default Linux/Windows environment"
  );
});

suite.test("TopBar renders Ctrl+K shortcut and vector SVG icons", async () => {
  const topBarText = await cdp.getText("header");
  assert.ok(
    topBarText.includes("Ctrl+K"),
    `TopBar should render Ctrl+K on Linux/Windows, got: ${topBarText}`
  );

  // Check SVG icons in header
  const svgCount = await cdp.evaluate(`
    document.querySelectorAll('header svg').length
  `);
  assert.ok(svgCount >= 5, `TopBar should have at least 5 vector SVG icons, got ${svgCount}`);

  // Check previous/next period buttons use SVG instead of ‹ / ›
  const headerText = await cdp.getText("header");
  assert.strictEqual(headerText.includes("‹"), false, "TopBar must not contain ‹");
  assert.strictEqual(headerText.includes("›"), false, "TopBar must not contain ›");
  assert.strictEqual(headerText.includes("☀"), false, "TopBar must not contain ☀");
  assert.strictEqual(headerText.includes("☾"), false, "TopBar must not contain ☾");
});

suite.test("LeftSidebar renders SVG icons and Ctrl+, in footer", async () => {
  // Ensure left sidebar is visible
  const hasLeftSidebar = await cdp.evaluate(`Boolean(document.querySelector('aside.w-64'))`);
  if (!hasLeftSidebar) {
    await cdp.evaluate(`
      (() => {
        const btn = document.querySelector('header button[title*="Sidebar"]');
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 200));
  }

  const sidebarText = await cdp.getText("aside.w-64");
  assert.ok(
    sidebarText.includes("Ctrl+,"),
    `LeftSidebar footer should render Ctrl+,, got: ${sidebarText}`
  );
  assert.strictEqual(sidebarText.includes("⚡"), false, "LeftSidebar must not contain ⚡");
  assert.strictEqual(sidebarText.includes("⚙"), false, "LeftSidebar must not contain ⚙");
  assert.strictEqual(sidebarText.includes("‹"), false, "LeftSidebar mini-month must not contain ‹");
  assert.strictEqual(sidebarText.includes("›"), false, "LeftSidebar mini-month must not contain ›");
});

suite.test("CommandPalette renders dynamic shortcuts and SVG icons", async () => {
  // Open command palette with Kbd or button
  await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b => b.innerText.includes('Quick Add / Search'));
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  const paletteText = await cdp.evaluate(`
    (() => {
      const modal = document.querySelector('.fixed.inset-0');
      return modal ? modal.innerText : '';
    })()
  `);

  assert.ok(paletteText.includes("Search Events (Ctrl+F)"), `Search tab should render Ctrl+F, got: ${paletteText}`);
  assert.ok(paletteText.includes("Ctrl+J"), `Join Video Call should render Ctrl+J, got: ${paletteText}`);
  assert.ok(paletteText.includes("Ctrl+R"), `Sync Calendars should render Ctrl+R, got: ${paletteText}`);
  assert.ok(paletteText.includes("Ctrl+,"), `Settings should render Ctrl+,, got: ${paletteText}`);
  assert.strictEqual(paletteText.includes("⌘"), false, "CommandPalette must not contain ⌘");
  assert.strictEqual(paletteText.includes("⚡"), false, "CommandPalette must not contain ⚡");
  assert.strictEqual(paletteText.includes("🔍"), false, "CommandPalette must not contain 🔍");
  assert.strictEqual(paletteText.includes("🔄"), false, "CommandPalette must not contain 🔄");
  assert.strictEqual(paletteText.includes("🎥"), false, "CommandPalette must not contain 🎥");

  // Close command palette with Escape
  await cdp.evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  `);
  await new Promise((r) => setTimeout(r, 200));
});

suite.test("SettingsView shortcuts tab dynamically renders platform shortcuts", async () => {
  // Open settings
  await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b => b.innerText.includes('Settings'));
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  // Navigate to shortcuts tab
  await cdp.evaluate(`
    (() => {
      const navButtons = Array.from(document.querySelectorAll('nav button'));
      const shortcutsBtn = navButtons.find(b => b.innerText.includes('Keyboard Shortcuts'));
      if (shortcutsBtn) shortcutsBtn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));

  const shortcutsText = await cdp.getText('div.flex-1.overflow-y-auto');
  assert.ok(shortcutsText.includes("C or Ctrl+K"), `Shortcuts tab should render C or Ctrl+K, got: ${shortcutsText}`);
  assert.ok(shortcutsText.includes("Ctrl+F"), `Shortcuts tab should render Ctrl+F, got: ${shortcutsText}`);
  assert.ok(shortcutsText.includes("Ctrl+J"), `Shortcuts tab should render Ctrl+J, got: ${shortcutsText}`);
  assert.ok(shortcutsText.includes("Ctrl+R"), `Shortcuts tab should render Ctrl+R, got: ${shortcutsText}`);
  assert.ok(shortcutsText.includes("Ctrl+,"), `Shortcuts tab should render Ctrl+,, got: ${shortcutsText}`);
  assert.ok(shortcutsText.includes("Del"), `Shortcuts tab should render Del, got: ${shortcutsText}`);
  assert.strictEqual(shortcutsText.includes("⌘"), false, "Shortcuts tab must not contain ⌘");

  // Verify settings nav buttons use SVG icons, not raw emojis
  const navText = await cdp.getText('nav');
  assert.strictEqual(navText.includes("✨"), false, "Settings nav must not contain ✨");
  assert.strictEqual(navText.includes("👤"), false, "Settings nav must not contain 👤");
  assert.strictEqual(navText.includes("🗓"), false, "Settings nav must not contain 🗓");
  assert.strictEqual(navText.includes("🌍"), false, "Settings nav must not contain 🌍");
  assert.strictEqual(navText.includes("🔄"), false, "Settings nav must not contain 🔄");
  assert.strictEqual(navText.includes("⌨"), false, "Settings nav must not contain ⌨");

  // Return to calendar
  await cdp.evaluate(`
    (() => {
      const backBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Back to Calendar') || b.innerText.includes('Return to Calendar'));
      if (backBtn) backBtn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));
});

suite.test("Live preference override: Switching platformShortcutStyle to 'mac' reacts immediately", async () => {
  // Update preference in localStorage and trigger store reload or function
  await cdp.evaluate(`
    (() => {
      const raw = localStorage.getItem('rapidcal.preferences.v1') || '{}';
      const prefs = JSON.parse(raw);
      prefs.platformShortcutStyle = 'mac';
      localStorage.setItem('rapidcal.preferences.v1', JSON.stringify(prefs));
      window.location.reload();
    })()
  `);
  await new Promise((r) => setTimeout(r, 800));

  const topBarText = await cdp.getText("header");
  assert.ok(
    topBarText.includes("⌘K"),
    `After mac override, TopBar should render ⌘K, got: ${topBarText}`
  );

  // Restore back to auto
  await cdp.evaluate(`
    (() => {
      const raw = localStorage.getItem('rapidcal.preferences.v1') || '{}';
      const prefs = JSON.parse(raw);
      prefs.platformShortcutStyle = 'auto';
      localStorage.setItem('rapidcal.preferences.v1', JSON.stringify(prefs));
      window.location.reload();
    })()
  `);
  await new Promise((r) => setTimeout(r, 800));

  const restoredText = await cdp.getText("header");
  assert.ok(
    restoredText.includes("Ctrl+K"),
    `After restoring to auto on Linux, TopBar should render Ctrl+K, got: ${restoredText}`
  );
});

// Run directly if invoked as entry point
if (process.argv[1]?.endsWith("m1_platform_icons.test.js")) {
  suite.run().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}

export { suite };
