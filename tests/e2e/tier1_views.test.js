import { assert, createHarness, TestSuite } from "./harness.js";

const suite = new TestSuite("Tier 1: Feature Coverage Across Views");

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
  await new Promise((r) => setTimeout(r, 300));
}

suite.test("TopBar renders brand title and navigation controls", async () => {
  const topBarText = await cdp.getText("header");
  assert.ok(topBarText, "TopBar header should exist");
  assert.ok(
    topBarText.includes("RapidCal"),
    "TopBar must include RapidCal title"
  );
  assert.ok(
    topBarText.includes("Today"),
    "TopBar must include Today button"
  );
  await harness.saveScreenshot("tier1_01_topbar");
});

suite.test("Switches to Day view and renders 1 day column", async () => {
  await selectViewTab("Day");
  const colCount = await cdp.evaluate(`
    document.querySelectorAll('[data-day-start-ts]').length
  `);
  assert.strictEqual(
    colCount,
    1,
    `Day view should render exactly 1 day column, got: ${colCount}`
  );
  await harness.saveScreenshot("tier1_02_day_view");
});

suite.test("Switches to 3-Day view and renders 3 day columns", async () => {
  await selectViewTab("3-Day");
  const colCount = await cdp.evaluate(`
    document.querySelectorAll('[data-day-start-ts]').length
  `);
  assert.strictEqual(
    colCount,
    3,
    `3-Day view should render exactly 3 day columns, got: ${colCount}`
  );
  await harness.saveScreenshot("tier1_03_3day_view");
});

suite.test("Switches to Work Week view and renders 5 day columns", async () => {
  await selectViewTab("Work Week");
  const colCount = await cdp.evaluate(`
    document.querySelectorAll('[data-day-start-ts]').length
  `);
  assert.strictEqual(
    colCount,
    5,
    `Work Week view should render exactly 5 day columns, got: ${colCount}`
  );
  await harness.saveScreenshot("tier1_04_workweek_view");
});

suite.test("Switches to Week view and renders 7 day columns", async () => {
  await selectViewTab("Week");
  const colCount = await cdp.evaluate(`
    document.querySelectorAll('[data-day-start-ts]').length
  `);
  assert.strictEqual(
    colCount,
    7,
    `Week view should render exactly 7 day columns, got: ${colCount}`
  );
  await harness.saveScreenshot("tier1_05_week_view");
});

suite.test("Switches to Month view and renders month grid cells", async () => {
  await selectViewTab("Month");
  const cellCount = await cdp.evaluate(`
    document.querySelectorAll('.grid-cols-7.grid-rows-6 > div').length
  `);
  assert.strictEqual(
    cellCount,
    42,
    `Month view should render a 6x7 grid (42 cells), got: ${cellCount}`
  );
  await harness.saveScreenshot("tier1_06_month_view");
});

suite.test("Switches to Schedule / Agenda view and renders list", async () => {
  await selectViewTab("Schedule");
  const isAgendaRendered = await cdp.evaluate(`
    Boolean(document.querySelector('h2') && document.querySelector('h2').innerText.includes('Upcoming Schedule'))
  `);
  assert.ok(isAgendaRendered, "AgendaView should render 'Upcoming Schedule' header");
  await harness.saveScreenshot("tier1_07_agenda_view");
});

suite.test("Opens Settings dialog and navigates across all tabs", async () => {
  // Click Settings button in TopBar (gear icon / title 'Settings')
  const settingsOpened = await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b =>
        b.getAttribute('title')?.toLowerCase().includes('setting') ||
        b.innerText.toLowerCase().includes('setting')
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()
  `);
  assert.ok(settingsOpened, "Settings button should be found and clicked");
  await new Promise((r) => setTimeout(r, 400));

  const hasSettingsHeading = await cdp.evaluate(`
    Boolean(document.querySelector('h2') && document.querySelector('h2').innerText.includes('Settings'))
  `);
  assert.ok(hasSettingsHeading, "Settings heading should be visible");

  // Tab keywords to test
  const expectedTabs = ["General", "Accounts", "Calendars", "Time", "Sync", "Shortcuts"];

  for (const tabKeyword of expectedTabs) {
    const clickedTab = await cdp.evaluate(`
      (() => {
        const navButtons = Array.from(document.querySelectorAll('nav button'));
        const target = navButtons.find(b =>
          (b.innerText || '').toLowerCase().includes(${JSON.stringify(tabKeyword.toLowerCase())})
        );
        if (target) {
          target.click();
          return true;
        }
        return false;
      })()
    `);
    assert.ok(clickedTab, `Should click settings tab matching: ${tabKeyword}`);
    await new Promise((r) => setTimeout(r, 200));
  }

  // Check if M2 advanced tab exists, if present test it too
  const hasAdvancedTab = await cdp.evaluate(`
    Boolean(Array.from(document.querySelectorAll('nav button')).find(b => b.innerText.toLowerCase().includes('advanced')))
  `);
  if (hasAdvancedTab) {
    await cdp.evaluate(`
      Array.from(document.querySelectorAll('nav button')).find(b => b.innerText.toLowerCase().includes('advanced'))?.click();
    `);
    await new Promise((r) => setTimeout(r, 200));
  }

  await harness.saveScreenshot("tier1_08_settings_tabs");
});

suite.test("Closes Settings and returns to calendar view", async () => {
  const backClicked = await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.includes('Back to Calendar')
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()
  `);
  assert.ok(backClicked, "Back to Calendar button should be clicked");
  await new Promise((r) => setTimeout(r, 400));

  const isSettingsClosed = await cdp.evaluate(`
    !document.querySelector('aside h2') || !document.querySelector('aside h2').innerText.includes('Settings')
  `);
  assert.ok(isSettingsClosed, "Settings view should be closed");
});

suite.test("Opens Command Palette modal, verifies modes, and dismisses", async () => {
  // Click Quick Add / Search in TopBar
  const openCmd = await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b =>
        b.innerText.includes('Quick Add') || b.innerText.includes('Search')
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()
  `);
  assert.ok(openCmd, "Quick Add button should be clicked");
  await new Promise((r) => setTimeout(r, 400));

  // Modal input should be rendered
  const hasInput = await cdp.evaluate(`
    Boolean(document.querySelector('.fixed.inset-0 input'))
  `);
  assert.ok(hasInput, "Command Palette input field should be visible");

  // Mode switcher bar
  const hasModeButtons = await cdp.evaluate(`
    (() => {
      const btns = Array.from(document.querySelectorAll('.fixed.inset-0 button'));
      return btns.some(b => b.innerText.includes('Quick Add Event')) &&
             btns.some(b => b.innerText.includes('Search Events'));
    })()
  `);
  assert.ok(hasModeButtons, "Mode buttons (Quick Add and Search) should be present");

  await harness.saveScreenshot("tier1_09_command_palette");

  // Press ESC to dismiss
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await new Promise((r) => setTimeout(r, 300));

  const isDismissed = await cdp.evaluate(`
    !document.querySelector('.fixed.inset-0 input')
  `);
  assert.ok(isDismissed, "Command Palette should be dismissed via Escape");
});

// Run directly if invoked as entry point
if (process.argv[1]?.endsWith("tier1_views.test.js")) {
  suite.run().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}

export { suite };
