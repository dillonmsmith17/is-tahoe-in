// Per-resort lift and terrain parsers for resorts that publish status on their own websites.
// Each parser takes the raw page (or JSON) and returns a common shape:
//   { lifts: {name: status}, liftsOpen, liftsHold, liftsTotal, trailsOpen, trailsTotal, terrainPct, groomersOnly, reportedBase }
// Statuses are normalised to: open | hold | scheduled | closed.
// Built against real page snapshots in test/fixtures; `npm run probe` re-checks them live every run.

const clean = s => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&")
  .replace(/&#8217;|&rsquo;/g, "'").replace(/&#8211;|&ndash;/g, "-").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const strip = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<!--[\s\S]*?-->/gi, "");

export function normStatus(s) {
  const t = String(s ?? "").toLowerCase();
  if (/hold|delay/.test(t)) return "hold";
  if (/sched|expect|soon|planned|clock/.test(t)) return "scheduled";
  if (/^\s*open|\bopen\b|check/.test(t) && !/not open|closed/.test(t)) return "open";
  return "closed";
}

// Tubing hills and section headings aren't ski lifts.
const NOT_A_LIFT = /tubing|terrain parks?$|snow\s*play/i;

export function summarize(allLifts, { trailsOpen = null, trailsTotal = null, groomed = null, reportedBase = null, source } = {}) {
  const lifts = Object.fromEntries(Object.entries(allLifts).filter(([n]) => !NOT_A_LIFT.test(n)));
  const v = Object.values(lifts);
  if (!v.length) throw new Error("no lifts found on page (layout may have changed)");
  return {
    lifts,
    liftsOpen: v.filter(s => s === "open").length,
    liftsHold: v.filter(s => s === "hold").length,
    liftsTotal: v.length,
    trailsOpen, trailsTotal,
    terrainPct: trailsTotal ? Math.round(100 * trailsOpen / trailsTotal) : null,
    groomersOnly: trailsOpen && groomed != null ? groomed >= trailsOpen : null,
    reportedBase, source
  };
}

// "8-10"" or "24"" -> upper number in inches
export function parseBase(text) {
  const m = String(text).match(/base(?:\s*depth)?\s*:?\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:"|&quot;|”|in\b)/i);
  return m ? Number(m[2] || m[1]) : null;
}

/* ---- Sugar Bowl: status icons on each lift row, trail counts per zone ---- */
export function parseSugarBowl(html) {
  const lifts = {};
  const rx = /icon_lift_([a-z_]+)\.svg"[^>]*data-update-id="(lift_\d+)_status_icon"[^>]*\/?>\s*<\/div>\s*<div class="txt_0001_conditions">([^<]+)<\/div>/g;
  for (const [, st, , name] of html.matchAll(rx)) lifts[clean(name)] = normStatus(st);
  let tOpen = 0, tTotal = 0;
  const seen = new Set();
  for (const m of html.matchAll(/id="card_summary_(\w+?)_02"[\s\S]{0,400}?headline_02">\s*(\d+)\s*<span class="txt_0001_conditions">\/\s*(\d+)<\/span>[\s\S]{0,200}?Trails Open[\s\S]{0,200}?headline_02">\s*(\d+)/g)) {
    if (seen.has(m[1])) continue; seen.add(m[1]);
    tOpen += +m[2]; tTotal += +m[3];
  }
  const groomed = [...html.matchAll(/id="card_summary_(\w+?)_02"[\s\S]{0,700}?headline_02">\s*\d+[\s\S]{0,300}?headline_02">\s*(\d+)\s*<div class="txt_0001_conditions">Trails Groomed/g)]
    .reduce((m, x) => (m.set(x[1], +x[2]), m), new Map());
  return summarize(lifts, { trailsOpen: tTotal ? tOpen : null, trailsTotal: tTotal || null, groomed: groomed.size ? [...groomed.values()].reduce((a, b) => a + b, 0) : null,
    reportedBase: parseBase(clean(html.match(/Base[\s\S]{0,200}/i)?.[0] || "")), source: "Sugar Bowl site" });
}

/* ---- Boreal (POWDR): JSON lifts + trails ---- */
export function parseBoreal(liftsJson, trailsJson) {
  const lifts = {};
  for (const l of liftsJson || []) lifts[clean(l.name)] = normStatus(l.status);
  const trails = (trailsJson || []).filter(t => t.include !== false && t.season !== "summer");
  const open = trails.filter(t => normStatus(t.status) === "open");
  return summarize(lifts, { trailsOpen: trails.length ? open.length : null, trailsTotal: trails.length || null,
    groomed: open.filter(t => /^groomed$/i.test(t.groom_status || "")).length, source: "Boreal (POWDR)" });
}

/* ---- Mt. Rose: lift rows with a status column; base depth in the snow report card ---- */
export function parseMtRose(html) {
  const lifts = {};
  const rx = /column-lift-name">\s*<div class="flexy">\s*<div class="rose-name">\s*([^<]+?)\s*<\/div>[\s\S]{0,200}?column-status">\s*<span[^>]*>([^<]+)<\/span>/g;
  for (const [, name, st] of html.matchAll(rx)) lifts[clean(name)] = normStatus(st);
  return summarize(lifts, { reportedBase: parseBase(clean(html.match(/Base Depth[\s\S]{0,120}/i)?.[0] || "")), source: "Mt. Rose site" });
}

/* ---- Sierra-at-Tahoe: WordPress list items per lift (and per trail) with a status badge ---- */
export function parseSierra(html) {
  const lifts = {}, trails = [];
  for (const li of html.split(/<li class="wp-block-post /).slice(1)) {
    const kind = (li.match(/^post-\d+ (sierra_\w+)/) || [])[1];
    const name = clean((li.match(/<h4[^>]*>([\s\S]*?)<\/h4>/) || [])[1]);
    const st = clean((li.match(/sierra-status-badge[^>]*>([\s\S]*?)<\/p>/) || [])[1]);
    if (!name || !st) continue;
    if (kind === "sierra_lift") lifts[name] = normStatus(st);
    else if (/trail|run/.test(kind || "")) trails.push({ name, st: normStatus(st), groomed: /groom/i.test(li) && !/not\s+groomed/i.test(li) });
  }
  const open = trails.filter(t => t.st === "open");
  return summarize(lifts, { trailsOpen: trails.length ? open.length : null, trailsTotal: trails.length || null, source: "Sierra-at-Tahoe site" });
}

/* ---- Homewood: summary stats + a status line under each lift heading ---- */
export function parseHomewood(html) {
  const lifts = {};
  for (const m of html.matchAll(/<h3 class="sector-name">([^<]+)<\/h3>\s*<div class="lifts-status">\s*<div>\s*<strong>Status:<\/strong>([^<]+)</g)) lifts[clean(m[1])] = normStatus(m[2]);
  const stat = label => { const m = html.match(new RegExp(`<strong>${label}<\\/strong>\\s*<div class="number">\\s*(\\d+)\\s*\\/\\s*(\\d+)`)); return m ? [+m[1], +m[2]] : null; };
  const runs = stat("Open Runs"), groomed = stat("Groomed");
  return summarize(lifts, { trailsOpen: runs?.[0] ?? null, trailsTotal: runs?.[1] ?? null, groomed: groomed?.[0] ?? null, source: "Homewood site" });
}

/* ---- Diamond Peak: header row per lift, then its trails as open/closed rows ---- */
export function parseDiamondPeak(html) {
  const lifts = {};
  let tOpen = 0, tTotal = 0;
  for (const m of html.matchAll(/conditions__row([^"]*)">\s*<div class="conditions__label">\s*<h3 class="conditions__name">\s*([^<]+?)\s*<\/h3>[\s\S]*?<div class="conditions__status">\s*([^<]*?)\s*<\/div>/g)) {
    const [, cls, name, st] = m;
    if (/--header/.test(cls)) lifts[clean(name).replace(/\s+-\s+.*$/, "")] = normStatus(st);
    else { tTotal++; if (/--open/.test(cls) || normStatus(st) === "open") tOpen++; }
  }
  return summarize(lifts, { trailsOpen: tTotal ? tOpen : null, trailsTotal: tTotal || null, source: "Diamond Peak site" });
}

/* ---- Tahoe Donner: lift table with check / X / clock icons ---- */
export function parseTahoeDonner(html) {
  const lifts = {};
  const sections = html.split(/<h2>/i);
  const liftSec = sections.find(s => /^LIFT STATUS/i.test(s)) || "";
  for (const m of liftSec.matchAll(/<tr>\s*<td>([^<]+)<\/td>[\s\S]*?<i class="fa (fa-[a-z-]+)"/g)) lifts[clean(m[1])] = m[2] === "fa-check-circle" ? "open" : m[2] === "fa-clock-o" ? "scheduled" : "closed";
  const trailSec = sections.find(s => /^(TRAIL|RUN)/i.test(s));
  let tOpen = null, tTotal = null;
  if (trailSec) { const icons = [...trailSec.matchAll(/<i class="fa (fa-[a-z-]+)"/g)].map(x => x[1]).filter(x => /circle|clock/.test(x)); tTotal = icons.length || null; tOpen = icons.filter(x => x === "fa-check-circle").length; }
  return summarize(lifts, { trailsOpen: tTotal ? tOpen : null, trailsTotal: tTotal, source: "Tahoe Donner site" });
}

/* ---- Donner Ski Ranch: Squarespace text lines like "Chair 1: Closed" ---- */
export function parseDonnerSkiRanch(html) {
  const lifts = {};
  for (const m of strip(html).matchAll(/<p[^>]*>((?:Chair \d+|[^<:]*Carpet[^<:]*|[^<:]*Conveyor[^<:]*))\s*:\s*([\s\S]*?)<\/p>/gi)) lifts[clean(m[1])] = normStatus(clean(m[2]));
  return summarize(lifts, { source: "Donner Ski Ranch site" });
}

/* ---- Registry: how to fetch and parse each resort ---- */
export const RESORT_SOURCES = {
  "sugar-bowl": { urls: ["https://www.sugarbowl.com/conditions"], parse: ([h]) => parseSugarBowl(h) },
  "boreal": { urls: ["https://api.rideboreal.com/api/v1/dor/drupal/lifts", "https://api.rideboreal.com/api/v1/dor/drupal/trails"], json: true, parse: ([l, t]) => parseBoreal(l, t) },
  "mt-rose": { urls: ["https://skirose.com/snow-report/"], parse: ([h]) => parseMtRose(h) },
  "sierra": { urls: ["https://sierraattahoe.com/lifts-trails-grooming/"], parse: ([h]) => parseSierra(h) },
  "homewood": { urls: ["https://skihomewood.com/snowreport/"], parse: ([h]) => parseHomewood(h) },
  "diamond-peak": { urls: ["https://www.diamondpeak.com/the-mountain/mountain-report/"], parse: ([h]) => parseDiamondPeak(h) },
  "tahoe-donner": { urls: ["https://www.tahoedonner.com/amenities/amenities/downhill-ski/trails-conditions/conditions/"], parse: ([h]) => parseTahoeDonner(h) },
  "donner-ski-ranch": { urls: ["https://www.donnerskiranch.com/liftstatus"], parse: ([h]) => parseDonnerSkiRanch(h) }
};
