import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

async function isUrlResponding(url, timeoutMs = 800) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const req = http.get(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          timeout: timeoutMs,
        },
        (res) => {
          resolve(res.statusCode >= 200 && res.statusCode < 400);
        }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Ensures a live Vite dev server is running.
 * If already active, reuses it. Otherwise, spawns a new instance.
 */
export async function ensureDevServer(options = {}) {
  const explicitUrl = options.url || process.env.RAPIDCAL_TEST_URL;

  if (explicitUrl) {
    if (await isUrlResponding(explicitUrl)) {
      return { url: explicitUrl, spawned: false, stop: () => {} };
    }
  }

  // Check default port 1420 if already running
  if (await isUrlResponding("http://127.0.0.1:1420/")) {
    return {
      url: "http://127.0.0.1:1420/",
      port: 1420,
      spawned: false,
      stop: () => {},
    };
  }

  // Check alternative test port 1422 if already running
  if (await isUrlResponding("http://127.0.0.1:1422/")) {
    return {
      url: "http://127.0.0.1:1422/",
      port: 1422,
      spawned: false,
      stop: () => {},
    };
  }

  const projectRoot =
    options.cwd ||
    process.env.PROJECT_ROOT ||
    "/home/asurite.ad.asu.edu/ssdevruk/Documents/Projects/RapidCal";

  const viteBin = path.join(projectRoot, "node_modules/.bin/vite");
  const binToRun = fs.existsSync(viteBin) ? viteBin : "npx";
  const startPort = options.port || Number(process.env.RAPIDCAL_PORT) || 1420;

  const binArgs = [
    "--port",
    String(startPort),
    "--host",
    "127.0.0.1",
    "--strictPort",
    "false",
  ];
  if (!fs.existsSync(viteBin)) {
    binArgs.unshift("vite");
  }

  const proc = spawn(binToRun, binArgs, {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BROWSER: "none" },
  });

  let detectedUrl = null;
  const urlPromise = new Promise((resolve) => {
    proc.stdout.on("data", (d) => {
      const text = d.toString();
      const match = text.match(/http:\/\/(?:127\.0\.0\.1|localhost):\d+\//);
      if (match && !detectedUrl) {
        detectedUrl = match[0];
        resolve(detectedUrl);
      }
    });
  });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      proc.kill("SIGTERM");
      setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {}
      }, 500);
    } catch {}
  };

  process.on("exit", stop);

  // Wait for either URL match or timeout
  const timeoutMs = options.timeoutMs || 15000;
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error("Timed out waiting for Vite to output listening URL")
        ),
      timeoutMs
    )
  );

  const serverUrl = await Promise.race([urlPromise, timeoutPromise]);
  const parsed = new URL(serverUrl);
  const targetPort = Number(parsed.port);

  // Wait for HTTP response
  const deadline = Date.now() + 5000;
  let ready = false;
  while (Date.now() < deadline) {
    if (await isUrlResponding(serverUrl, 500)) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  if (!ready) {
    stop();
    throw new Error(
      `Timed out waiting for Vite dev server to respond at ${serverUrl}`
    );
  }

  return {
    url: serverUrl,
    port: targetPort,
    spawned: true,
    proc,
    stop,
  };
}
