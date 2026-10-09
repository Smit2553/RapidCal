import fs from "node:fs";
import path from "node:path";

/**
 * Native Node 22 Chrome DevTools Protocol Client over WebSocket.
 */
export class CDPClient {
  constructor(wsDebuggerUrl) {
    this.wsUrl = wsDebuggerUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.eventListeners = new Map();
    this.sessionId = null;
    this.targetId = null;
  }

  async init() {
    this.ws = new WebSocket(this.wsUrl);

    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = (err) =>
        reject(new Error(`WebSocket connection failed: ${err.message}`));
    });

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) {
            reject(
              new Error(
                `CDP Error (${msg.error.code}): ${msg.error.message}`
              )
            );
          } else {
            resolve(msg.result);
          }
          return;
        }

        // Handle unsolicited events
        if (msg.method) {
          const listeners = this.eventListeners.get(msg.method) || [];
          for (const listener of listeners) {
            try {
              listener(msg.params, msg.sessionId);
            } catch (e) {
              console.error(`Error in CDP event listener for ${msg.method}:`, e);
            }
          }
        }
      } catch (err) {
        console.error("Failed to parse CDP message:", err);
      }
    };
  }

  on(method, callback) {
    if (!this.eventListeners.has(method)) {
      this.eventListeners.set(method, []);
    }
    this.eventListeners.get(method).push(callback);
    return () => {
      const list = this.eventListeners.get(method);
      if (list) {
        this.eventListeners.set(
          method,
          list.filter((cb) => cb !== callback)
        );
      }
    };
  }

  send(method, params = {}, sessionId = this.sessionId) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) {
        payload.sessionId = sessionId;
      }
      this.ws.send(JSON.stringify(payload));
    });
  }

  async createPageSession(initialUrl = "about:blank") {
    const { targetId } = await this.send("Target.createTarget", {
      url: initialUrl,
    });
    this.targetId = targetId;

    const { sessionId } = await this.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    this.sessionId = sessionId;

    await this.send("Page.enable", {}, sessionId);
    await this.send("Runtime.enable", {}, sessionId);
    await this.send("DOM.enable", {}, sessionId);

    return sessionId;
  }

  async navigate(url, timeoutMs = 15000) {
    let loadFired = false;
    const unlisten = this.on("Page.loadEventFired", (params, sid) => {
      if (sid === this.sessionId) {
        loadFired = true;
      }
    });

    await this.send("Page.navigate", { url });

    const deadline = Date.now() + timeoutMs;
    while (!loadFired && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    unlisten();

    // Give DOM a brief moment to stabilize and mount reactive components
    await new Promise((r) => setTimeout(r, 600));
  }

  async setViewport(width, height, options = {}) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: options.deviceScaleFactor || 1,
      mobile: options.mobile || false,
      screenOrientation: { angle: 0, type: "landscapePrimary" },
    });
    // Brief reflow settle
    await new Promise((r) => setTimeout(r, 200));
  }

  async setUserAgent(userAgent, platform) {
    await this.send("Emulation.setUserAgentOverride", {
      userAgent,
      platform,
    });
    await new Promise((r) => setTimeout(r, 100));
  }

  async evaluate(expression) {
    const expr =
      typeof expression === "function"
        ? `(${expression.toString()})()`
        : expression;

    const res = await this.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });

    if (res.exceptionDetails) {
      throw new Error(
        `Evaluation failed: ${
          res.exceptionDetails.exception?.description ||
          res.exceptionDetails.text
        }`
      );
    }

    return res.result?.value;
  }

  async waitForFunction(fn, timeoutMs = 8000, pollIntervalMs = 150) {
    const expr = typeof fn === "function" ? `(${fn.toString()})()` : fn;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const val = await this.evaluate(expr);
        if (Boolean(val)) return val;
      } catch {}
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new Error(
      `waitForFunction timed out after ${timeoutMs}ms: ${expr.slice(0, 80)}`
    );
  }

  async waitForSelector(selector, timeoutMs = 8000) {
    return this.waitForFunction(
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
      timeoutMs
    );
  }

  async click(selector) {
    await this.waitForSelector(selector);
    const success = await this.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.scrollIntoView({ block: 'nearest' });
        el.click();
        return true;
      })()
    `);
    if (!success) {
      throw new Error(`Failed to click selector: ${selector}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  async type(selector, text, clearFirst = true) {
    await this.waitForSelector(selector);
    const success = await this.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.focus();
        if (${clearFirst}) {
          el.value = '';
        }
        el.value = (el.value || '') + ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);
    if (!success) {
      throw new Error(`Failed to type into selector: ${selector}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  async getText(selector) {
    return this.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        return el ? (el.innerText ?? el.textContent ?? '').trim() : null;
      })()
    `);
  }

  async getBoundingBox(selector) {
    return this.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right
        };
      })()
    `);
  }

  /**
   * Scans visible DOM elements to detect unintentional horizontal overflow
   * where scrollWidth > clientWidth without explicit scroll configuration.
   */
  async checkHorizontalOverflow() {
    return this.evaluate(`
      (() => {
        const overflows = [];
        const allElements = document.querySelectorAll('*');

        for (const el of allElements) {
          if (!el || el.offsetParent === null) continue; // Skip hidden/unrendered
          const style = window.getComputedStyle(el);
          if (
            style.overflowX === 'auto' ||
            style.overflowX === 'scroll' ||
            style.display === 'none'
          ) {
            continue;
          }

          // Check if content exceeds client width by more than 1px rounding tolerance
          if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
            overflows.push({
              tag: el.tagName.toLowerCase(),
              id: el.id || undefined,
              className: el.className || undefined,
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
              diff: el.scrollWidth - el.clientWidth,
              text: (el.innerText || '').slice(0, 50).trim()
            });
          }
        }

        return overflows;
      })()
    `);
  }

  async captureScreenshot(outputPath) {
    const shot = await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    if (outputPath) {
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(outputPath, Buffer.from(shot.data, "base64"));
    }
    return shot.data;
  }

  async close() {
    if (this.targetId) {
      try {
        await this.send("Target.closeTarget", { targetId: this.targetId });
      } catch {}
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.close();
      } catch {}
    }
  }
}
