#!/usr/bin/env node
// Fails on NEW oxlint warnings, ignoring the ones already recorded in
// lint-baseline.json. `oxlint` itself exits 0 on warnings, so without this a new unused
// import lands unnoticed. The baseline is split into two sections so that warnings
// signalling possible runtime bugs are never confused with cosmetic debt.
//
// Run `node scripts/check-lint-warnings.mjs --write-baseline` to regenerate.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const BASELINE_PATH = join(ROOT, "scripts/lint-baseline.json");

// A warning that can indicate a real runtime bug rather than tidiness. These are
// deliberately deferred, not overlooked - see baseline section `behaviourRisk`.
// Keys are the rule identifiers exactly as oxlint reports them.
const BEHAVIOUR_RISK = new Set([
  "react(set-state-in-effect)",
  "react-hooks(exhaustive-deps)",
]);

let out = "";
try {
  out = execFileSync("npx", ["oxlint", "-f", "unix"], { cwd: ROOT, encoding: "utf8" });
} catch (err) {
  out = `${err.stdout || ""}`;
  if (err.status !== 0 && !out.trim()) {
    console.error("check-lint-warnings: could not run oxlint");
    process.exit(1);
  }
}

const warnings = [];
const seen = new Map();
for (const line of out.split("\n")) {
  // oxlint -f unix format: file:line:col: Message [Warning/rule(id)]
  const m = line.match(/^(.+?):(\d+):(\d+): .+? \[Warning\/(\S+?)\]$/);
  if (!m) continue;
  const file = m[1].trim();
  const rule = m[4];
  const k = `${file}\u0000${rule}`;
  const ordinal = (seen.get(k) || 0) + 1;
  seen.set(k, ordinal);
  warnings.push({ file, rule, ordinal });
}

if (process.argv.includes("--write-baseline")) {
  // file -> rule -> count. Counts, not file:rule pairs, so a second unused var in a file
  // that already has one is still caught.
  const sections = { behaviourRisk: {}, cosmetic: {} };
  for (const w of warnings) {
    const section = BEHAVIOUR_RISK.has(w.rule) ? sections.behaviourRisk : sections.cosmetic;
    if (!section[w.file]) section[w.file] = {};
    section[w.file][w.rule] = (section[w.file][w.rule] || 0) + 1;
  }
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(
      {
        _comment:
          "Pre-existing oxlint warnings, as file -> rule -> count. `behaviourRisk` warnings " +
          "may indicate real runtime bugs (cascading renders, stale closures) and are " +
          "deliberately deferred, not overlooked. `cosmetic` is unused imports/variables. " +
          "The goal is an empty file - shrink it as debt is paid.",
        ...sections,
      },
      null,
      2,
    )}\n`,
  );
  const count = (s) => Object.values(s).reduce((n, r) => n + Object.values(r).reduce((a, b) => a + b, 0), 0);
  console.log(
    `baseline written: ${count(sections.behaviourRisk)} behaviour-risk, ${count(sections.cosmetic)} cosmetic`,
  );
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
  : { behaviourRisk: {}, cosmetic: {} };

// A guard that cannot see is worse than no guard: if oxlint still *says* "warning" but
// the regex above matched none, the output format drifted and everything would pass
// silently. Fail loudly instead.
if (warnings.length === 0 && /warning/i.test(out)) {
  console.error(
    "check-lint-warnings: oxlint reported warnings but none could be parsed.\n" +
      "oxlint's output format likely changed; update the regex above. Refusing to pass.",
  );
  process.exit(1);
}

const offenders = [];
for (const w of warnings) {
  const section = BEHAVIOUR_RISK.has(w.rule) ? baseline.behaviourRisk : baseline.cosmetic;
  const allowed = section[w.file]?.[w.rule] ?? 0;
  if (w.ordinal > allowed) {
    offenders.push(`${w.file}  ${w.rule}  (#${w.ordinal}, ${allowed} baselined)`);
  }
}

if (offenders.length === 0) {
  console.log(`check-lint-warnings: ok (${warnings.length} warning(s), all baselined)`);
  process.exit(0);
}

console.error(`check-lint-warnings: ${offenders.length} NEW warning(s)\n`);
for (const o of offenders) console.error(`  ${o}`);
console.error(
  "\nFix these, or raise the count in scripts/lint-baseline.json if the deferral is deliberate.",
);
process.exit(1);
