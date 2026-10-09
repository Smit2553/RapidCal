import assert from "node:assert";
import path from "node:path";
import { CDPClient } from "./cdp/cdp_client.js";
import { launchChrome } from "./cdp/chrome.js";
import { ensureDevServer } from "./cdp/dev_server.js";

const SCREENSHOTS_DIR = path.resolve(
  "/home/asurite.ad.asu.edu/ssdevruk/Documents/Projects/RapidCal/tests/e2e/screenshots"
);

/**
 * Creates and initializes the full E2E test harness.
 */
export async function createHarness(options = {}) {
  // 1. Ensure Vite dev server is running
  const devServer = await ensureDevServer(options);

  // 2. Launch headless Chrome with CDP
  const chrome = await launchChrome(options);

  // 3. Connect CDP client
  const cdp = new CDPClient(chrome.webSocketDebuggerUrl);
  await cdp.init();

  // 4. Create browser target & session
  await cdp.createPageSession("about:blank");

  // 5. Navigate to application URL
  await cdp.navigate(devServer.url);

  let isClosed = false;
  const teardown = async () => {
    if (isClosed) return;
    isClosed = true;
    try {
      await cdp.close();
    } catch {}
    try {
      chrome.kill();
    } catch {}
    if (devServer.spawned) {
      try {
        devServer.stop();
      } catch {}
    }
  };

  const saveScreenshot = async (name) => {
    const filename = `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
    const fullPath = path.join(SCREENSHOTS_DIR, filename);
    await cdp.captureScreenshot(fullPath);
    return fullPath;
  };

  return {
    url: devServer.url,
    chrome,
    devServer,
    cdp,
    saveScreenshot,
    teardown,
  };
}

/**
 * Lightweight test suite builder and runner.
 */
export class TestSuite {
  constructor(name) {
    this.name = name;
    this.tests = [];
    this.beforeAllHooks = [];
    this.afterAllHooks = [];
    this.beforeEachHooks = [];
    this.afterEachHooks = [];
  }

  beforeAll(fn) {
    this.beforeAllHooks.push(fn);
  }

  afterAll(fn) {
    this.afterAllHooks.push(fn);
  }

  beforeEach(fn) {
    this.beforeEachHooks.push(fn);
  }

  afterEach(fn) {
    this.afterEachHooks.push(fn);
  }

  test(description, fn) {
    this.tests.push({ description, fn });
  }

  async run(context = {}) {
    console.log(`\n==================================================`);
    console.log(`RUNNING SUITE: ${this.name}`);
    console.log(`==================================================`);

    const results = {
      name: this.name,
      total: this.tests.length,
      passed: 0,
      failed: 0,
      defects: [],
      tests: [],
    };

    try {
      for (const hook of this.beforeAllHooks) {
        await hook(context);
      }
    } catch (err) {
      console.error(`[SUITE SETUP FAILED]: ${err.message}`);
      throw err;
    }

    for (const t of this.tests) {
      const startTime = Date.now();
      process.stdout.write(`  • ${t.description} ... `);

      try {
        for (const hook of this.beforeEachHooks) {
          await hook(context);
        }

        await t.fn(context);

        for (const hook of this.afterEachHooks) {
          await hook(context);
        }

        const durationMs = Date.now() - startTime;
        console.log(`\x1b[32mPASS\x1b[0m (${durationMs}ms)`);
        results.passed++;
        results.tests.push({
          description: t.description,
          status: "PASS",
          durationMs,
        });
      } catch (err) {
        const durationMs = Date.now() - startTime;
        console.log(`\x1b[31mFAIL\x1b[0m (${durationMs}ms)`);
        console.log(`    \x1b[31mError: ${err.message}\x1b[0m`);
        results.failed++;
        const defectInfo = {
          suite: this.name,
          test: t.description,
          error: err.message,
          stack: err.stack,
        };
        results.defects.push(defectInfo);
        results.tests.push({
          description: t.description,
          status: "FAIL",
          durationMs,
          error: err.message,
        });
      }
    }

    try {
      for (const hook of this.afterAllHooks) {
        await hook(context);
      }
    } catch (err) {
      console.error(`[SUITE TEARDOWN FAILED]: ${err.message}`);
    }

    return results;
  }
}

export { assert };
