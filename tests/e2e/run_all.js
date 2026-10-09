import fs from "node:fs";
import path from "node:path";
import { suite as tier1Suite } from "./tier1_views.test.js";
import { suite as tier2Suite } from "./tier2_boundaries.test.js";
import { suite as tier3Suite } from "./tier3_cross_features.test.js";
import { suite as tier4Suite } from "./tier4_user_flows.test.js";

const REPORT_PATH = path.resolve(
  "/home/asurite.ad.asu.edu/ssdevruk/Documents/Projects/RapidCal/tests/e2e/test_report.json"
);

const SUITES = [
  { id: "tier1", suite: tier1Suite },
  { id: "tier2", suite: tier2Suite },
  { id: "tier3", suite: tier3Suite },
  { id: "tier4", suite: tier4Suite },
];

async function main() {
  const filterArg = process.argv[2]?.toLowerCase();
  const selectedSuites = filterArg
    ? SUITES.filter((s) => s.id.includes(filterArg))
    : SUITES;

  if (selectedSuites.length === 0) {
    console.error(`No test suites matching filter: "${filterArg}"`);
    console.log(`Available suites: tier1, tier2, tier3, tier4`);
    process.exit(1);
  }

  console.log("===============================================================");
  console.log("       RapidCal Automated E2E Chromium Verification Suite      ");
  console.log("===============================================================");
  console.log(`Selected Suites: ${selectedSuites.map((s) => s.id).join(", ")}`);
  console.log(`Start Time:      ${new Date().toISOString()}\n`);

  const globalResults = {
    timestamp: new Date().toISOString(),
    totalSuites: selectedSuites.length,
    totalTests: 0,
    passed: 0,
    failed: 0,
    durationMs: 0,
    suites: [],
  };

  const overallStartTime = Date.now();

  for (const item of selectedSuites) {
    try {
      const res = await item.suite.run();
      globalResults.totalTests += res.total;
      globalResults.passed += res.passed;
      globalResults.failed += res.failed;
      globalResults.suites.push(res);
    } catch (err) {
      console.error(`Fatal suite execution failure in ${item.id}:`, err);
      globalResults.failed++;
    }
  }

  globalResults.durationMs = Date.now() - overallStartTime;

  // Print final summary
  console.log("\n===============================================================");
  console.log("                      E2E TEST SUMMARY                         ");
  console.log("===============================================================");
  console.log(`Total Suites:     ${globalResults.totalSuites}`);
  console.log(`Total Tests:      ${globalResults.totalTests}`);
  console.log(`Passed:           \x1b[32m${globalResults.passed}\x1b[0m`);
  console.log(
    `Failed:           ${
      globalResults.failed > 0
        ? `\x1b[31m${globalResults.failed}\x1b[0m`
        : "\x1b[32m0\x1b[0m"
    }`
  );
  console.log(`Total Duration:   ${(globalResults.durationMs / 1000).toFixed(2)}s`);
  console.log("===============================================================");

  // Write JSON report
  fs.writeFileSync(REPORT_PATH, JSON.stringify(globalResults, null, 2));
  console.log(`\nDetailed JSON report generated: ${REPORT_PATH}`);

  if (globalResults.failed > 0) {
    console.log("\n\x1b[31mE2E Verification Failed with errors.\x1b[0m\n");
    process.exit(1);
  } else {
    console.log("\n\x1b[32mAll E2E Test Suites Passed Cleanly!\x1b[0m\n");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Unhandled test runner exception:", err);
  process.exit(1);
});
