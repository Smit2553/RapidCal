import { assert, createHarness, TestSuite } from "./harness.js";

const suite = new TestSuite("Tier 4: Real-World User Flows");

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

suite.test("User Flow 1: Create a new event via EventInspector", async () => {
  await selectViewTab("Week");

  // Ensure EventInspector is open
  await cdp.evaluate(`
    (() => {
      const inspector = document.querySelector('aside.w-80');
      if (!inspector) {
        const btn = Array.from(document.querySelectorAll('header button')).find(b =>
          b.getAttribute('title')?.includes('Inspector (])')
        );
        if (btn) btn.click();
      }
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  // If in "No Event Selected" state, click "+ New Event"
  await cdp.evaluate(`
    (() => {
      const newBtn = Array.from(document.querySelectorAll('aside.w-80 button')).find(b =>
        b.innerText.includes('New Event')
      );
      if (newBtn) newBtn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  // Type title into event title input
  const eventTitle = `Alpha Launch Sprint Sync ${Date.now().toString().slice(-4)}`;
  await cdp.type('aside.w-80 input[placeholder*="Event title"]', eventTitle);

  // Submit form (Save Event)
  const saved = await cdp.evaluate(`
    (() => {
      const saveBtn = Array.from(document.querySelectorAll('aside.w-80 button')).find(b =>
        b.innerText.includes('Save Event') || b.type === 'submit'
      );
      if (saveBtn) {
        saveBtn.click();
        return true;
      }
      return false;
    })()
  `);
  assert.ok(saved, "Save Event button should be clicked");
  await new Promise((r) => setTimeout(r, 500));

  // Verify toast or event card exists in the viewport
  const eventRendered = await cdp.evaluate(`
    (() => {
      const cards = Array.from(document.querySelectorAll('[data-event-card="true"]'));
      return cards.some(c => c.innerText.includes(${JSON.stringify(eventTitle)}));
    })()
  `);
  assert.ok(
    eventRendered,
    `Newly created event '${eventTitle}' should appear on calendar grid`
  );

  await harness.saveScreenshot("tier4_01_event_created");
});

suite.test("User Flow 2: Natural Language Quick Add via Command Palette", async () => {
  // Open Command Palette
  const opened = await cdp.evaluate(`
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
  assert.ok(opened, "Quick Add button should be clicked");
  await new Promise((r) => setTimeout(r, 300));

  // Type query in NLP mode
  const nlpQuery = "Coffee with Sarah tomorrow at 2pm";
  await cdp.type(".fixed.inset-0 input", nlpQuery);
  await new Promise((r) => setTimeout(r, 600));

  // Verify preview card appears
  const previewFound = await cdp.evaluate(`
    Boolean(document.querySelector('.fixed.inset-0 .border-indigo-500, .fixed.inset-0 .text-indigo-400'))
  `);
  assert.ok(previewFound, "NLP preview card should be generated");

  // Click Create Event button
  const createClicked = await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('.fixed.inset-0 button')).find(b =>
        b.innerText.includes('Create Event')
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()
  `);
  assert.ok(createClicked, "Create Event button should be clicked in Command Palette");
  await new Promise((r) => setTimeout(r, 500));

  // Modal should be closed
  const modalClosed = await cdp.evaluate(`
    !document.querySelector('.fixed.inset-0 input')
  `);
  assert.ok(modalClosed, "Command Palette should close after creating event");

  await harness.saveScreenshot("tier4_02_nlp_quick_add");
});

suite.test("User Flow 3: Search Events in Command Palette", async () => {
  // Open Command Palette
  await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b =>
        b.innerText.includes('Quick Add') || b.innerText.includes('Search')
      );
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  // Switch to Search Events mode
  const searchModeBtn = await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('.fixed.inset-0 button')).find(b =>
        b.innerText.includes('Search Events')
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()
  `);
  assert.ok(searchModeBtn, "Search Events mode button should be clicked");
  await new Promise((r) => setTimeout(r, 200));

  // Type search query for guaranteed seed events ("Product")
  await cdp.type(".fixed.inset-0 input", "Product");
  await new Promise((r) => setTimeout(r, 600));

  // Verify search results exist
  const resultCount = await cdp.evaluate(`
    (() => {
      const matchHeader = Array.from(document.querySelectorAll('.fixed.inset-0 div')).find(d =>
        (d.innerText || '').toLowerCase().includes('matching events')
      );
      if (!matchHeader) return 0;
      const container = matchHeader.parentElement;
      return container ? container.querySelectorAll('button').length : 0;
    })()
  `);
  assert.ok(
    resultCount > 0,
    `Search results should be displayed for query 'Product', got: ${resultCount}`
  );

  // Click the first search result
  const clicked = await cdp.evaluate(`
    (() => {
      const btn = document.querySelector('.fixed.inset-0 .max-h-60 button');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()
  `);
  assert.ok(clicked, "Search result button should be found and clicked");
  await new Promise((r) => setTimeout(r, 400));

  // Verify modal is dismissed
  const modalClosed = await cdp.evaluate(`
    !document.querySelector('.fixed.inset-0 input')
  `);
  assert.ok(modalClosed, "Command Palette should close when search result is selected");

  await harness.saveScreenshot("tier4_03_search_events");
});

suite.test("User Flow 4: Navigate Calendar Dates and Jump to Today", async () => {
  await selectViewTab("Week");

  // Read initial date header text in TopBar (e.g. 'October 2026')
  const initialTitle = await cdp.getText("header h1");
  assert.ok(initialTitle, "Date navigation header title should exist");

  // Click Next (›)
  const nextClicked = await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b =>
        b.innerText.trim() === '›' || b.getAttribute('title')?.includes('Next')
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()
  `);
  assert.ok(nextClicked, "Next date step button should be clicked");
  await new Promise((r) => setTimeout(r, 250));

  // Click Previous (‹) twice
  for (let i = 0; i < 2; i++) {
    await cdp.evaluate(`
      (() => {
        const btn = Array.from(document.querySelectorAll('header button')).find(b =>
          b.innerText.trim() === '‹' || b.getAttribute('title')?.includes('Previous')
        );
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 250));
  }

  // Click "Today" button
  const todayClicked = await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b =>
        b.innerText.trim() === 'Today' || b.getAttribute('title')?.includes('Today')
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()
  `);
  assert.ok(todayClicked, "Today button should be clicked");
  await new Promise((r) => setTimeout(r, 300));

  const finalTitle = await cdp.getText("header h1");
  assert.ok(finalTitle, "Date navigation header should display current title");
  assert.strictEqual(
    finalTitle,
    initialTitle,
    `Jumping back to Today should restore the initial anchor month title ('${initialTitle}'), got: '${finalTitle}'`
  );

  await harness.saveScreenshot("tier4_04_date_navigation");
});

suite.test("User Flow 5: Configure User Preferences in Settings", async () => {
  // 1. Open Settings
  await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b =>
        b.innerText.includes('Settings')
      );
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 400));

  // 2. Change Start Week On to "Sunday"
  const changedToSun = await cdp.evaluate(`
    (() => {
      const selects = Array.from(document.querySelectorAll('select'));
      const weekSelect = selects.find(s =>
        Array.from(s.options).some(o => o.value === 'sunday')
      );
      if (weekSelect) {
        weekSelect.value = 'sunday';
        weekSelect.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    })()
  `);
  assert.ok(changedToSun, "Start Week On select should be changed to 'sunday'");
  await new Promise((r) => setTimeout(r, 300));

  // 3. Return to Calendar
  await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.includes('Back to Calendar')
      );
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 400));

  // 4. In Month view, verify first column header is 'SUN' (case-insensitive)
  await selectViewTab("Month");
  const firstWeekday = await cdp.evaluate(`
    document.querySelector('main > div .grid-cols-7 > div')?.innerText?.trim()
  `);
  assert.strictEqual(
    firstWeekday?.toUpperCase(),
    "SUN",
    `When weekStartsOn is 'sunday', first Month view header must be 'SUN', got: '${firstWeekday}'`
  );

  // 5. Restore back to "Monday" in Settings
  await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b =>
        b.innerText.includes('Settings')
      );
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 400));

  await cdp.evaluate(`
    (() => {
      const selects = Array.from(document.querySelectorAll('select'));
      const weekSelect = selects.find(s =>
        Array.from(s.options).some(o => o.value === 'monday')
      );
      if (weekSelect) {
        weekSelect.value = 'monday';
        weekSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const backBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.includes('Back to Calendar')
      );
      if (backBtn) backBtn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 400));

  await harness.saveScreenshot("tier4_05_settings_flow");
});

suite.test("User Flow 6: Toggle Sidebars and Verify Responsive Reflow", async () => {
  await selectViewTab("Week");

  // Get initial canvas width with sidebars open
  const initialCanvasWidth = await cdp.evaluate(`
    document.querySelector('.flex-1.grid.relative')?.clientWidth || 0
  `);

  // Toggle LeftSidebar off
  await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b =>
        b.getAttribute('title')?.includes('Sidebar ([)')
      );
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  const leftHidden = await cdp.evaluate(`
    !document.querySelector('aside.w-64')
  `);
  assert.ok(leftHidden, "LeftSidebar should be hidden after toggle");

  // Toggle RightInspector off
  await cdp.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('header button')).find(b =>
        b.getAttribute('title')?.includes('Event Details') ||
        b.getAttribute('title')?.includes(']')
      );
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  const rightHidden = await cdp.evaluate(`
    !document.querySelector('aside.w-80')
  `);
  assert.ok(rightHidden, "EventInspector should be hidden after toggle");

  // Expanded canvas width should be wider than initial
  const expandedCanvasWidth = await cdp.evaluate(`
    document.querySelector('.flex-1.grid.relative')?.clientWidth || 0
  `);
  assert.ok(
    expandedCanvasWidth > initialCanvasWidth,
    `Canvas width when sidebars are collapsed (${expandedCanvasWidth}px) should be wider than initial (${initialCanvasWidth}px)`
  );

  // Restore sidebars
  await cdp.evaluate(`
    (() => {
      const buttons = Array.from(document.querySelectorAll('header button'));
      const leftBtn = buttons.find(b => b.getAttribute('title')?.includes('Sidebar ([)'));
      if (leftBtn) leftBtn.click();
      const rightBtn = buttons.find(b =>
        b.getAttribute('title')?.includes('Event Details') ||
        b.getAttribute('title')?.includes(']')
      );
      if (rightBtn) rightBtn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  await harness.saveScreenshot("tier4_06_sidebars_toggle");
});

if (process.argv[1]?.endsWith("tier4_user_flows.test.js")) {
  suite.run().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}

export { suite };
