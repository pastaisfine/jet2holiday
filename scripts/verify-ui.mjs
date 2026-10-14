// Browser verification for the better-ui fixes.
//   npm i -D playwright && npx playwright install chromium
//   npm run dev &            # serves on :5173
//   node scripts/verify-ui.mjs
//
// Playwright is not a declared dependency, deliberately: this is a one-off
// regression harness for the motion policy, not part of the test suite.
// Point it elsewhere with BASE_URL=https://host node scripts/verify-ui.mjs
//
// Drives the same Chromium the Playwright MCP would, but launched directly:
// the MCP server is pinned to the `chrome` channel at /opt/google/chrome, which
// needs root to create. Asserts the four HIGH fixes plus the mechanical checks,
// and collects console/network errors per route.

import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const results = [];
let failures = 0;

function record(ok, name, detail) {
  results.push({ ok, name, detail });
  if (!ok) failures++;
}

const browser = await chromium.launch();

// Vite injects each stylesheet as its own <style> as modules evaluate, so a
// computed-style probe can otherwise read a page before the last chunk lands.
const settle = async (page, min = 5) => {
  await page.waitForFunction(
    (n) => document.styleSheets.length >= n,
    min,
    { timeout: 10000 },
  ).catch(() => {});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};

// ── 1. reduced-motion: the HIGH gate ────────────────────────────────────────
{
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await settle(page);

  const screen = page.locator(".screen.active").first();
  const anim = await screen.evaluate((el) => {
    const s = getComputedStyle(el);
    return { name: s.animationName, dur: s.animationDuration };
  });
  record(
    anim.name === "motion-fade-in",
    "reduced-motion: .screen.active cross-fades instead of sliding",
    `animation-name=${anim.name} duration=${anim.dur}`,
  );

  // :active cannot be forced from script; assert the rule itself instead.
  const rule = await page.evaluate(() => {
    // A plain CSSStyleRule also exposes .cssRules under CSS Nesting, as an
    // empty (but truthy) list. Recursing on truthiness silently skips every
    // declaration, so recurse only on real container at-rules.
    const walk = (rules, fn, container) => {
      for (const r of rules) {
        if (r.conditionText !== undefined && r.cssRules && r.cssRules.length) {
          walk(r.cssRules, fn, r.conditionText);
        } else if (r.selectorText !== undefined) {
          fn(r, container);
        } else if (r.cssRules && r.cssRules.length) {
          walk(r.cssRules, fn, container);
        }
      }
    };
    const eachRule = (fn) => {
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        walk(rules, fn, null);
      }
    };

    let hit = null;
    eachRule((r, container) => {
      if (hit) return;
      if (!container?.includes("prefers-reduced-motion")) return;
      const parts = r.selectorText.split(",").map((p) => p.trim());
      if (parts.includes(".btn:active") || parts.includes(".sw-btn:active")) {
        hit = { sel: r.selectorText, transform: r.style.transform };
      }
    });
    return hit;
  });
  record(
    rule && rule.transform === "none",
    "reduced-motion: press scale is switched off",
    rule ? `${rule.sel} => transform:${rule.transform}` : "rule not found",
  );

  // motion.css must be the last stylesheet so its ties actually win.
  // Vite injects each stylesheet as its own <style> in import order, so the
  // reduced-motion gate must be the last one injected for its ties to win.
  // Measured, not inferred. Inject elements carrying each gated class and read
  // what the cascade actually resolves to. A static rule-order analysis gets
  // this wrong: it cannot model how Vite's <style> injection order maps to
  // cascade order, and a false "conflict" here hides a real regression.
  const reduced = await page.evaluate(() => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;top:0;left:0;width:10px;height:10px";
    document.body.appendChild(host);
    const probe = (cls) => {
      const el = document.createElement("div");
      el.className = cls;
      host.appendChild(el);
      const cs = getComputedStyle(el);
      const out = { transform: cs.transform, filter: cs.filter, opacity: cs.opacity };
      el.remove();
      return out;
    };
    const out = {
      sheet: probe("sheet"),
      swcardBack1: probe("swcard back1"),
      swcardBack2: probe("swcard back2"),
      btn: probe("btn"),
    };
    host.remove();
    return out;
  });

  const identity = /matrix\(1, 0, 0, 1, 0, 0\)/;
  const stillMoves = Object.entries(reduced)
    .filter(([, v]) => v.transform !== "none" && !identity.test(v.transform))
    .map(([k]) => k);
  record(
    stillMoves.length === 0,
    "reduced motion: no gated element resolves to a transform",
    stillMoves.length
      ? `still transformed: ${stillMoves.join(", ")}`
      : Object.entries(reduced).map(([k, v]) => `${k}=${v.transform}`).join(" "),
  );

  const stillFiltered = Object.entries(reduced)
    .filter(([, v]) => v.filter !== "none")
    .map(([k]) => k);
  record(
    stillFiltered.length === 0,
    "reduced motion: card filters dropped, opacity cues kept",
    stillFiltered.length
      ? `still filtered: ${stillFiltered.join(", ")}`
      : Object.entries(reduced).map(([k, v]) => `${k} filter=${v.filter} opacity=${v.opacity}`).join(" "),
  );

  // ...and the motion must still be there when the user has not opted out.
  const normalCtx = await browser.newContext({ reducedMotion: "no-preference" });
  const normalPage = await normalCtx.newPage();
  await normalPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await settle(normalPage);
  const normal = await normalPage.evaluate(() => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const probe = (cls) => {
      const el = document.createElement("div");
      el.className = cls;
      host.appendChild(el);
      const out = {
        transform: getComputedStyle(el).transform,
        filter: getComputedStyle(el).filter,
      };
      el.remove();
      return out;
    };
    const out = { sheet: probe("sheet"), swcardBack1: probe("swcard back1") };
    host.remove();
    return out;
  });
  await normalCtx.close();

  record(
    normal.sheet.transform !== "none" && normal.swcardBack1.filter !== "none",
    "normal motion preserved (the gate is opt-out, not opt-in)",
    `sheet=${normal.sheet.transform} back1=${normal.swcardBack1.filter}`,
  );

  await ctx.close();
}

// ── 2. press scale: 0.96 over 150ms, never on a disabled button ─────────────
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await settle(page);

  const btnRule = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) {
        if (r.selectorText === ".btn:active:not(:disabled)") {
          return { transform: r.style.transform, transition: null };
        }
      }
    }
    return null;
  });
  record(btnRule?.transform === "scale(0.96)", "press scale is 0.96", btnRule ? `.btn:active:not(:disabled){transform:${btnRule.transform}}` : "not found");

  const timing = await page.evaluate(() => {
    const el = document.querySelector(".btn");
    if (!el) return null;
    const s = getComputedStyle(el);
    return { property: s.transitionProperty, duration: s.transitionDuration };
  });
  const transform150 = timing && timing.property.includes("transform") &&
    timing.duration.split(",").some((d) => d.trim() === "0.15s");
  record(!!transform150, "press transition is 150ms on transform", timing ? `${timing.property} / ${timing.duration}` : "no .btn found");

  const tap = await page.evaluate(() => {
    const el = document.querySelector(".btn");
    return el ? getComputedStyle(el).webkitTapHighlightColor : null;
  });
  record(tap === "rgba(0, 0, 0, 0)", "tap-highlight cleared on .btn", `webkit-tap-highlight-color=${tap}`);

  await ctx.close();
}

// ── 3. hover guards: no :hover rule outside @media (hover: hover) ───────────
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await settle(page);

  const audit = await page.evaluate(() => {
    const strays = [];
    let total = 0;
    // mapbox ships its own stylesheet; its control hovers are not ours to guard
    const THIRD_PARTY = /^\.(mapboxgl|mapbox)/;
    const walk = (rules, guarded, isMotionGate) => {
      for (const r of rules) {
        if (r.conditionText !== undefined && r.cssRules && r.cssRules.length) {
          const c = r.conditionText;
          walk(r.cssRules, guarded || c.includes("(hover: hover)"), c.includes("prefers-reduced-motion"));
        } else if (r.selectorText !== undefined) {
          if (!r.selectorText.includes(":hover")) continue;
          if (THIRD_PARTY.test(r.selectorText)) return;
          if (isMotionGate) return; // a reduced-motion override of a hover rule is correct
          total++;
          if (!guarded) strays.push(r.selectorText);
        } else if (r.cssRules && r.cssRules.length) {
          walk(r.cssRules, guarded, isMotionGate);
        }
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules, false, false); } catch { /* cross-origin */ }
    }
    return { strays, total };
  });
  record(audit.strays.length === 0, "every :hover rule sits inside @media (hover: hover)", `${audit.total} :hover rules audited, ${audit.strays.length} unguarded${audit.strays.length ? ` — ${audit.strays.slice(0, 5).join(", ")}` : ""}`);

  await ctx.close();
}

// ── 4. overscroll containment on the scrollable overlays ────────────────────
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await settle(page);
  const n = await page.evaluate(() => {
    const walk = (rules, fn, container) => {
      for (const r of rules) {
        if (r.conditionText !== undefined && r.cssRules && r.cssRules.length) {
          walk(r.cssRules, fn, r.conditionText);
        } else if (r.selectorText !== undefined) {
          fn(r, container);
        } else if (r.cssRules && r.cssRules.length) {
          walk(r.cssRules, fn, container);
        }
      }
    };
    const eachRule = (fn) => {
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        walk(rules, fn, null);
      }
    };

    let count = 0;
    const names = [];
    eachRule((r) => {
      if (r.style?.overscrollBehavior === "contain") { count++; names.push(r.selectorText); }
    });
    return count;
  });
  record(n >= 8, "overscroll-behavior: contain present on scroll overlays", `${n} rules`);
  await ctx.close();
}

// ── 5. theme switch suppression + pre-paint theme, in both themes ───────────
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  record(theme === scheme, `pre-paint theme script applies "${scheme}" before first paint`, `data-theme=${theme}`);

  const suppressed = await page.evaluate(() => {
    const walk = (rules, fn, container) => {
      for (const r of rules) {
        if (r.conditionText !== undefined && r.cssRules && r.cssRules.length) {
          walk(r.cssRules, fn, r.conditionText);
        } else if (r.selectorText !== undefined) {
          fn(r, container);
        } else if (r.cssRules && r.cssRules.length) {
          walk(r.cssRules, fn, container);
        }
      }
    };
    const eachRule = (fn) => {
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        walk(rules, fn, null);
      }
    };

    let sel = null;
    eachRule((r) => { if (r.selectorText?.startsWith("html.theme-switching")) sel = r.selectorText; });
    return sel;
  });
  if (scheme === "light") {
    record(!!suppressed, "theme-switch suppression rule is present", suppressed || "not found");
  }
  await ctx.close();
}

// ── 6. every route: no console errors, no failed requests, page renders ─────
// /join is a param route (/join/:tripId) and /setup/* sit behind RequireAuth,
// so each entry declares what an unauthenticated browser should end up seeing.
const routes = [
  { path: "/login", expect: "self" },
  { path: "/register", expect: "self" },
  { path: "/forgot-password", expect: "self" },
  { path: "/reset-password", expect: "self" },
  { path: "/join/not-a-real-trip", expect: "self" },   // renders the not-found card
  { path: "/setup/step1", expect: "/login" },         // RequireAuth bounces
  { path: "/setup/step2", expect: "/login" },
  { path: "/setup/step3", expect: "/login" },
];
for (const { path: route, expect } of routes) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  const failed = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));

  const resp = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" }).catch(() => null);
  const status = resp?.status();
  // Auth resolution is a network round trip; wait it out before judging.
  if (expect !== "self") {
    await page.waitForURL((u) => u.pathname === expect, { timeout: 15000 })
      .catch(() => {});
  }
  const landed = new URL(page.url()).pathname;
  const rendered = await page.evaluate(() => document.body.innerText.trim().length);
  const hasScreen = await page.locator(".screen, .screen-auth").count();
  const whereOk = expect === "self" ? landed === route : landed === expect;

  record(
    status === 200 && rendered > 0 && hasScreen > 0 && whereOk,
    `${route} renders`,
    `HTTP ${status} → ${landed}, ${rendered} chars, ${hasScreen} screen node(s)`,
  );
  // Supabase auth calls are expected to fail unauthenticated — a 401 is the
  // correct answer, not a defect. Anything 5xx or a real throw is.
  const hard = errors.filter((e) => !/401|Failed to fetch|net::ERR|Unauthorized|AuthSessionMissingError|Invalid Refresh Token/i.test(e));
  record(hard.length === 0, `${route} no unexpected console errors`, hard.length ? hard.slice(0, 3).join(" | ") : "clean");
  record(failed.length === 0, `${route} no failed requests`, failed.length ? failed.slice(0, 3).join(" | ") : "clean");
  await ctx.close();
}

// ── 7. the shared components that the fixes touched ─────────────────────────
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await settle(page);

  const radii = await page.evaluate(() => {
    const walk = (rules, fn, container) => {
      for (const r of rules) {
        if (r.conditionText !== undefined && r.cssRules && r.cssRules.length) {
          walk(r.cssRules, fn, r.conditionText);
        } else if (r.selectorText !== undefined) {
          fn(r, container);
        } else if (r.cssRules && r.cssRules.length) {
          walk(r.cssRules, fn, container);
        }
      }
    };
    const eachRule = (fn) => {
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        walk(rules, fn, null);
      }
    };

    const bad = [];
    eachRule((r) => {
      if (r.style?.borderRadius && /^\s*(99|999)px/.test(r.style.borderRadius)) bad.push(r.selectorText);
    });
    return bad;
  });
  record(radii.length === 0, "no hardcoded 99/999px pill radii left", radii.length ? radii.join(", ") : "clean");

  const imgOutlines = await page.evaluate(() => {
    const hits = [];
    const walk = (rules) => {
      for (const r of rules) {
        if (r.conditionText !== undefined && r.cssRules && r.cssRules.length) walk(r.cssRules);
        else if (r.selectorText !== undefined) {
          if ((r.style?.cssText || "").includes("--img-outline")) hits.push(r.selectorText);
        } else if (r.cssRules && r.cssRules.length) walk(r.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      walk(rules);
    }
    return hits;
  });
  record(
    imgOutlines.length >= 8,
    "content images carry the neutral outline",
    imgOutlines.length ? `${imgOutlines.length} rules: ${imgOutlines.join(", ")}` : "0 found",
  );

  const avatarBorder = await page.evaluate(() => {
    const walk = (rules, fn, container) => {
      for (const r of rules) {
        if (r.conditionText !== undefined && r.cssRules && r.cssRules.length) {
          walk(r.cssRules, fn, r.conditionText);
        } else if (r.selectorText !== undefined) {
          fn(r, container);
        } else if (r.cssRules && r.cssRules.length) {
          walk(r.cssRules, fn, container);
        }
      }
    };
    const eachRule = (fn) => {
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        walk(rules, fn, null);
      }
    };

    let border = null;
    eachRule((r) => { if (r.selectorText === ".avatar.done") border = r.style.border || ""; });
    return border;
  });
  record(!!avatarBorder && avatarBorder.includes("transparent"), ".avatar.done keeps a transparent border for forced-colors", `border=${avatarBorder}`);
  await ctx.close();
}

await browser.close();

// ── report ──────────────────────────────────────────────────────────────────
const pad = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(pad)}  ${r.detail}`);
}
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
