// Lift and terrain status. Order of precedence per resort:
//   1. operator adapter: vail (embedded terrain feed), alterra (MtnPowder), site (per-resort page parsers)
//   2. manual overrides in config/manual-status.json (always applied last)
import { get } from "../http.js";
import { RESORT_SOURCES } from "./resorts.js";

/* ---------- Vail Resorts (Heavenly, Northstar, Kirkwood) ---------- */
// Vail's terrain-and-lift-status pages embed `FR.TerrainStatusFeed = {...}` twice: once with numeric
// statuses and once with words. Lifts sit under GroomingAreas[].Lifts (and again in a top-level Lifts list).
// Before a resort opens, Vail lists no lifts at all; that means "not open yet", not "unknown".
// Note: fetch these pages with our own user agent. A bare browser user agent gets Akamai's block page.
function objectAt(html, start) {
  let depth = 0, inStr = false, esc = false;
  for (let k = start; k < html.length; k++) {
    const c = html[k];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) { try { return JSON.parse(html.slice(start, k + 1)); } catch { return null; } }
  }
  return null;
}
export function extractAllAssignedJson(html, varName) {
  const out = [];
  for (let i = html.indexOf(varName); i >= 0; i = html.indexOf(varName, i + varName.length)) {
    const start = html.indexOf("{", i);
    if (start < 0) break;
    const o = objectAt(html, start);
    if (o) out.push(o);
  }
  return out;
}
export const extractAssignedJson = (html, varName) => extractAllAssignedJson(html, varName)[0] ?? null;

const VAIL_NUM = { 0: "closed", 1: "open", 2: "hold", 3: "scheduled" };
const vailStatus = s => typeof s === "number" ? (VAIL_NUM[s] || "closed")
  : /hold/i.test(s) ? "hold" : /sched|expect/i.test(s) ? "scheduled" : /^open/i.test(String(s ?? "")) ? "open" : "closed";
const NOT_SKIING = /summer|top of gondola|sightseeing|scenic|cross country|nordic/i;

export function parseVail(html) {
  const feeds = extractAllAssignedJson(html, "TerrainStatusFeed");
  if (!feeds.length) throw new Error("TerrainStatusFeed not found on page (blocked or layout changed)");
  const feed = feeds.find(f => /"Status":"/.test(JSON.stringify(f.Lifts || []))) || feeds[feeds.length - 1];
  if (feed.IsSuccessful === false) throw new Error(`terrain feed reported an error: ${feed.ErrorDetails || "no detail"}`);
  const areas = (feed.GroomingAreas || []).filter(a => !NOT_SKIING.test(a.Name || ""));
  const byId = new Map();
  for (const l of [...areas.flatMap(a => a.Lifts || []), ...(feed.Lifts || [])]) if (!NOT_SKIING.test(l.Mountain || "")) byId.set(l.Id ?? l.Name, l);
  const lifts = [...byId.values()];
  if (!lifts.length) return { liftsOpen: 0, liftsTotal: 0, lifts: {}, trailsOpen: null, trailsTotal: null, terrainPct: null, groomersOnly: null, notOpenYet: true, source: "Resort site (no lifts operating; not open for the season)" };
  const status = Object.fromEntries(lifts.map(l => [l.Name, vailStatus(l.Status)]));
  const v = Object.values(status);
  const liftsOpen = v.filter(x => x === "open").length;
  const trails = areas.flatMap(a => a.Trails || a.Runs || []);
  const openT = trails.filter(t => t.IsOpen === true);
  // Early season Vail often runs lifts without updating trail flags; don't report 0% terrain then.
  const trailsKnown = trails.length && !(liftsOpen > 0 && openT.length === 0);
  return {
    lifts: status, liftsOpen, liftsHold: v.filter(x => x === "hold").length, liftsTotal: lifts.length,
    trailsOpen: trailsKnown ? openT.length : null, trailsTotal: trailsKnown ? trails.length : null,
    terrainPct: trailsKnown ? Math.round(100 * openT.length / trails.length) : null,
    groomersOnly: trailsKnown && openT.length && openT.some(t => t.IsGroomed != null) ? openT.every(t => t.IsGroomed === true) : null,
    source: "Resort site"
  };
}

/* ---------- Alterra (Palisades Tahoe) via MtnPowder ---------- */
// Step 1: v4.mtnfeed.com/resorts/<slug>.json -> { bearerToken, resortIds }
// Step 2: mtnpowder.com/feed/v3.json?bearer_token=..&resortId[]=.. -> { Resorts: [{ Name, MountainAreas: [{ Name, Lifts, Trails }] }] }
// Both Palisades tiles share one fetch.
const alterraCache = new Map();
export function fetchAlterraFeed(slug) {
  if (!alterraCache.has(slug)) alterraCache.set(slug, (async () => {
    const meta = await get(`https://v4.mtnfeed.com/resorts/${slug}.json`, { browser: true });
    if (!meta?.bearerToken || !meta?.resortIds?.length) throw new Error("mtnfeed returned no token or resort ids");
    const q = new URLSearchParams({ bearer_token: meta.bearerToken });
    for (const id of meta.resortIds) q.append("resortId[]", id);
    return get(`https://mtnpowder.com/feed/v3.json?${q}`, { browser: true });
  })());
  return alterraCache.get(slug);
}

const LIFT_OPEN = new Set(["open", "open_ski_ride_school_only"]);
const LIFT_HOLD = /hold|delayed|^(wind|weather|lightning)_closure$/;
const TRAIL_OPEN = new Set(["open"]);
// Keep only the mountain areas listed for this tile (e.g. Alpine = Summit, Scott/Lakeview, Sherwood).
// With no list, use the whole resort.
export function alterraAreas(feed, names) {
  const resorts = feed?.Resorts || [];
  if (!resorts.length) throw new Error("MtnPowder feed has no Resorts");
  const all = resorts.flatMap(r => r.MountainAreas || []);
  if (!names?.length) return { areas: all, unmapped: [] };
  const want = new Set(names.map(n => n.toLowerCase()));
  const areas = all.filter(a => want.has(String(a.Name).toLowerCase()));
  if (!areas.length) throw new Error(`none of the configured areas are in the feed (feed has: ${all.map(a => a.Name).join(", ")})`);
  return { areas, unmapped: all.filter(a => (a.Lifts || []).length && !areas.includes(a)).map(a => a.Name) };
}

export function parseAlterra(feed, areaNames) {
  const { areas } = alterraAreas(feed, areaNames);
  const lifts = areas.flatMap(a => a.Lifts || []);
  const trails = areas.flatMap(a => a.Trails || []);
  if (!lifts.length) return { liftsOpen: null, liftsTotal: 0, terrainPct: null, groomersOnly: null, source: "MtnPowder (no lifts listed yet)" };
  const st = l => String(l.StatusEnglish || l.Status || "").toLowerCase();
  const openL = lifts.filter(l => LIFT_OPEN.has(st(l)));
  const holdL = lifts.filter(l => LIFT_HOLD.test(st(l)));
  const openT = trails.filter(t => TRAIL_OPEN.has(st(t)));
  const groomed = t => /^(yes|groomed|true)$/i.test(String(t.Grooming ?? ""));
  return {
    liftsOpen: openL.length, liftsHold: holdL.length, liftsTotal: lifts.length,
    trailsOpen: trails.length ? openT.length : null, trailsTotal: trails.length || null,
    terrainPct: trails.length ? Math.round(100 * openT.length / trails.length) : null,
    groomersOnly: openT.length ? openT.every(groomed) : null,
    lifts: Object.fromEntries(lifts.map(l => [l.Name, st(l) || "unknown"])),
    source: "Palisades Tahoe (MtnPowder)"
  };
}

export async function fetchSite(id) {
  const src = RESORT_SOURCES[id];
  if (!src) throw new Error(`no site parser for ${id}`);
  const bodies = await Promise.all(src.urls.map(u => get(u, { type: src.json ? "json" : "html", browser: true, timeoutMs: 30000 })));
  return src.parse(bodies);
}

const ADAPTERS = {
  site: loc => fetchSite(loc.id),
  vail: async loc => parseVail(await get(loc.statusUrl, { type: "html" })),
  alterra: async loc => parseAlterra(await fetchAlterraFeed(loc.alterra.slug), loc.alterra.areas)
};

/* ---------- Combine ---------- */
export function applyManual(status, manual) {
  if (!manual) return status;
  const s = { ...(status || {}) };
  for (const k of ["liftsOpen", "liftsTotal", "terrainPct", "groomersOnly", "reportedBase", "note"]) if (k in manual) s[k] = manual[k];
  if ("open" in manual) s.manualOpen = manual.open;
  if (Object.keys(manual).length) s.source = s.source ? `${s.source} + manual` : "Manual";
  return s;
}

export async function fetchLiftStatus(loc, manual) {
  if (loc.kind !== "resort") return null;
  const errors = [];
  let status = null;
  const adapter = ADAPTERS[loc.operator];
  if (adapter && (loc.statusUrl || loc.alterra || loc.operator === "site")) {
    try { status = await adapter(loc); } catch (e) { errors.push(`${loc.operator}: ${e.message}`); }
  }
  if (!status && !adapter) errors.push("no lift-status adapter yet; set it in config/manual-status.json");
  status = applyManual(status, manual);
  if (errors.length) status = { ...(status || {}), errors };
  return status;
}
