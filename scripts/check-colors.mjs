#!/usr/bin/env node
// Enforces brand-spec.md "Token Discipline": raw colour literals may only appear in the
// token blocks (`:root`, `[data-theme="dark"]`). Everywhere else a colour must be a var().
//
// Scanned:
//   *.css  - every literal outside a token block
//   *.jsx - literals inside a `style={{ ... }}` prop only
//
// Not scanned, and therefore a KNOWN GAP rather than a design exemption:
//   - *.js / *.ts / *.html are not scanned at all, so `src/data/members.js` avatar tints
//     pass only because of their extension, not because data colours are exempt.
//   - CSS outside style={{}} (e.g. a colour in a <style> block inside a .jsx) is unscanned.
//   - Named CSS colours (`white`, `red`) are not matched by LITERAL.
// See brand-spec.md "Token Discipline" for the documented scope.
//
// Known pre-existing debt lives in color-baseline.json as a per-file count per literal.
// Counts rather than line numbers, so that moving code around never manufactures a
// violation, while adding one more of an already-baselined literal still fails.
// Run `node scripts/check-colors.mjs --write-baseline` to (re)generate it.

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const BASELINE_PATH = join(ROOT, "scripts/color-baseline.json");

// Must match the selector *alone* on the line. An earlier version used startsWith(),
// which let `[data-theme="dark"] .anything { color: #ff00ff }` open a "token block" and
// exempt every colour inside it - i.e. the exact `[data-theme="dark"]` hardcode that
// brand-spec.md forbids. Anchored, trailing brace optional.
const TOKEN_BLOCK_SELECTOR = /^(:root|\[data-theme="dark"\])\s*\{?\s*$/;
const LITERAL = /#[0-9a-fA-F]{3,8}\b|oklch\([^)]*\)|\bhsla?\([^)]*\)|\brgba?\([^)]*\)/g;

const walk = (dir, exts, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
};

// Line indices (0-indexed) covered by a `:root` / `[data-theme="dark"]` block.
const tokenBlockLines = (lines) => {
  const covered = new Set();
  let inBlock = false;
  let depth = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (!inBlock && TOKEN_BLOCK_SELECTOR.test(lines[i].trim())) {
      inBlock = true;
      depth = 0;
    }
    if (!inBlock) continue;
    covered.add(i);
    depth += (lines[i].match(/\{/g) || []).length;
    depth -= (lines[i].match(/\}/g) || []).length;
    if (depth <= 0) inBlock = false;
  }
  return covered;
};

const stripCssComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

const findAll = (text, re) => {
  const out = [];
  for (const m of text.matchAll(re)) out.push({ literal: m[0], index: m.index });
  return out;
};

// file -> literal -> count
const findings = new Map();
const record = (file, literal) => {
  if (!findings.has(file)) findings.set(file, new Map());
  const m = findings.get(file);
  m.set(literal, (m.get(literal) || 0) + 1);
};

for (const file of walk(join(ROOT, "src"), [".css"])) {
  const rel = relative(ROOT, file);
  const raw = readFileSync(file, "utf8");
  const src = stripCssComments(raw);
  const lines = src.split("\n");
  const covered = tokenBlockLines(lines);
  lines.forEach((line, i) => {
    if (covered.has(i)) return;
    for (const { literal } of findAll(line, LITERAL)) record(rel, literal);
  });
}

for (const file of walk(join(ROOT, "src"), [".jsx"])) {
  const rel = relative(ROOT, file);
  const src = stripCssComments(readFileSync(file, "utf8"));
  // Tolerate `style={ { ... } }`; a literal `style={{` match let that spacing through.
  for (const open of src.matchAll(/style=\{\s*\{/g)) {
    const start = open.index;
    // Walk to the matching close by depth, not indexOf("}}"): the `} }` spacing that this
    // very rule tolerates on the way in would otherwise hide the whole object.
    let depth = 0;
    let end = -1;
    for (let i = start + "style=".length; i < src.length; i += 1) {
      const c = src[i];
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end === -1) continue;
    for (const { literal } of findAll(src.slice(start, end), LITERAL)) record(rel, literal);
  }
}

if (process.argv.includes("--write-baseline")) {
  const out = {};
  for (const file of [...findings.keys()].sort()) {
    out[file] = Object.fromEntries(
      [...findings.get(file).entries()].sort((a, b) => b[1] - a[1]),
    );
  }
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(
      {
        _comment:
          "Known pre-existing raw colour literals, as file -> literal -> count. Brand rules " +
          "live in brand-spec.md. Per-record data colours and third-party library props are " +
          "not scanned at all. Counts, not line numbers, so reordering never trips the " +
          "guard. Shrink this file as debt is paid.",
        files: out,
      },
      null,
      2,
    )}\n`,
  );
  const total = [...findings.values()].reduce(
    (n, m) => n + [...m.values()].reduce((a, b) => a + b, 0),
    0,
  );
  console.log(`baseline written: ${total} known literals across ${findings.size} files`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")).files
  : {};

const offenders = [];
let baselinedTotal = 0;
for (const [file, literals] of findings) {
  for (const [literal, count] of literals) {
    const allowed = baseline[file]?.[literal] ?? 0;
    if (count > allowed) offenders.push(`${file}  ${literal}  (${count} new, ${allowed} baselined)`);
    baselinedTotal += Math.min(count, allowed);
  }
}

if (offenders.length === 0) {
  console.log(`check-colors: ok (${baselinedTotal} baselined literal(s), 0 new)`);
  process.exit(0);
}

console.error(`check-colors: ${offenders.length} unapproved colour literal(s)\n`);
for (const o of offenders) console.error(`  ${o}`);
console.error(
  '\nRaw colour literals belong only in the :root / [data-theme="dark"] token blocks.\n' +
    "See brand-spec.md 'Token Discipline'. If this is a genuine exception, raise the\n" +
    "count in scripts/color-baseline.json rather than adding a line number.",
);
process.exit(1);
