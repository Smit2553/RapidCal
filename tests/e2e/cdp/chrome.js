import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_CHROME_PATH =
  "/home/asurite.ad.asu.edu/ssdevruk/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

/**
 * Launches headless Chromium with remote debugging enabled.
 * Returns Chrome process handles and WebSocket debugger endpoints.
 */
export async function launchChrome(options = {}) {
  const chromePath =
    options.chromePath ||
    process.env.CHROME_PATH ||
    process.env.CHROME_BIN ||
    DEFAULT_CHROME_PATH;

  if (!fs.existsSync(chromePath)) {
    throw new Error(`Chrome binary not found at path: ${chromePath}`);
  }

  const port = options.port !== undefined ? options.port : Number(process.env.CDP_PORT) || 0;
  const userDataDir = path.join(
    os.tmpdir(),
    `rapidcal_chrome_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  );

  fs.mkdirSync(userDataDir, { recursive: true });

  const chromeArgs = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-default-apps",
    "--disable-domain-reliability",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--mute-audio",
    "about:blank",
  ];

  const proc = spawn(chromePath, chromeArgs, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let killed = false;
  const cleanup = () => {
    if (killed) return;
    killed = true;
    try {
      proc.kill("SIGKILL");
    } catch {}
    try {
      if (fs.existsSync(userDataDir)) {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    } catch {}
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  let wsUrl = null;
  const wsPromise = new Promise((resolve) => {
    proc.stderr.on("data", (d) => {
      const text = d.toString();
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match && !wsUrl) {
        wsUrl = match[1];
        resolve(wsUrl);
      }
    });
  });

  const timeoutMs = options.timeoutMs || 10000;
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(`Timed out waiting for Chrome to output DevTools URL`)
        ),
      timeoutMs
    );
  });

  const webSocketDebuggerUrl = await Promise.race([wsPromise, timeoutPromise]);
  const parsedUrl = new URL(webSocketDebuggerUrl);
  const actualPort = Number(parsedUrl.port);

  return {
    proc,
    port: actualPort,
    userDataDir,
    webSocketDebuggerUrl,
    kill: cleanup,
  };
}
