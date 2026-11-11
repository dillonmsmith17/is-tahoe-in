// Lift and terrain status. Order of precedence per resort:
//   1. operator adapter (Vail sites: lifts + trails from the embedded terrain feed)
//   2. Liftie public API (lifts only, broad coverage)
//   3. manual overrides in config/manual-status.json (always applied last)
import { get } from "../http.js";

/* ---------- Liftie ---------- */
// GET https://liftie.info/api/resort/<id> -> { lifts: { status: {name: "open"|"closed"|"hold"|"scheduled"}, stats: {...} } }
export function parseLiftie(json) {
  const status = json?.lifts?.status;
  if (!status || typeof status !== "object") throw new Error("no lift status in Liftie response");
  const vals = Object.values(status);
  return {
    liftsOpen: vals.filter(v => v === "open").length,
    liftsHold: vals.filter(v => v === "hold").length,
    liftsTotal: vals.length,
    lifts: status,
    source: "Liftie"
  };
}

async function fromLiftie(ids) {
  let lastErr;
  for (const id of ids || []) {
    try { return { ...parseLiftie(await get(`https://liftie.info/api/resort/${id}`, { browser: true })), liftieId: id }; }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("no Liftie id configured");
}

/* ---------- Vail Resorts (Heavenly, Northstar, Kirkwood) ---------- */
// Vail's terrain-and-lift-status pages embed a JSON object assigned to `TerrainStatusFeed`.
// Field names have shifted over the years, so matching is deliberately loose.
export function extractAssignedJson(html, varName) {
  const i = html.indexOf(varName);
  if (i < 0) return null;
  const start = html.indexOf("{", i);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let k = start; k < html.length; k++) {
    const c = html[k];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(html.slice(start, k + 1)); } catch { return null; }
    }
  }
  return null;
}

const isOpen = x => x?.IsOpen === true || x?.Status === 1 || /^open$/i.test(String(x?.Status ?? x?.status ?? ""));

export function parseVail(html) {
  const feed = extractAssignedJson(html, "TerrainStatusFeed");
  if (!feed) throw new Error("TerrainStatusFeed not found on page");
  const lifts = feed.Lifts || feed.lifts || [];
  if (!lifts.length) return { liftsOpen: null, liftsTotal: 0, trailsOpen: null, trailsTotal: null, terrainPct: null, groomersOnly: null, source: "Resort site (no lifts listed yet)" };
  const trails = (feed.GroomingAreas || []).flatMap(a => a.Runs || a.Trails || []).concat(feed.Trails || feed.Runs || []);
  const openTrails = trails.filter(isOpen);
  const groomedFlag = openTrails.some(t => "IsGroomed" in t);
  return {
    liftsOpen: lifts.filter(isOpen).length,
    liftsTotal: lifts.length,
    trailsOpen: trails.length ? openTrails.length : null,
    trailsTotal: trails.length || null,
    terrainPct: trails.length ? Math.round(100 * openTrails.length / trails.length) : null,
    groomersOnly: groomedFlag && openTrails.length > 0 ? openTrails.every(t => t.IsGroomed) : null,
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
const LIFT_HOLD = /hold|delayed|closure$/;
const TRAIL_OPEN = new Set(["open"]);
const SIDE_RX = { alpine: /alpine/i, olympic: /^(?!.*alpine)/i };

// Pick the part of the feed for one side of a two-sided resort: a separate Resort entry if the feed
// has one, otherwise the MountainAreas whose names match. Falls back to the whole resort, flagged.
export function alterraSide(feed, side) {
  const resorts = feed?.Resorts || [];
  if (!resorts.length) throw new Error("MtnPowder feed has no Resorts");
  const rx = side ? SIDE_RX[side] : null;
  if (rx && resorts.length > 1) {
    const r = resorts.find(x => side === "alpine" ? rx.test(x.Name) : !/alpine/i.test(x.Name));
    if (r) return { areas: r.MountainAreas || [], split: "resort" };
  }
  const areas = resorts.flatMap(r => r.MountainAreas || []);
  if (rx) {
    const mine = areas.filter(a => side === "alpine" ? /alpine/i.test(a.Name) : !/alpine/i.test(a.Name));
    if (mine.length && mine.length < areas.length) return { areas: mine, split: "area" };
  }
  return { areas, split: "none" };
}

export function parseAlterra(feed, side) {
  const { areas, split } = alterraSide(feed, side);
  const lifts = areas.flatMap(a => a.Lifts || []);
  const trails = areas.flatMap(a => a.Trails || []);
  if (!lifts.length) return { liftsOpen: null, liftsTotal: 0, terrainPct: null, groomersOnly: null, source: "MtnPowder (no lifts listed yet)" };
  const st = l => String(l.StatusEnglish || l.Status || "").toLowerCase();
  const openL = lifts.filter(l => LIFT_OPEN.has(st(l)) || /^open$/i.test(l.StatusIcon || ""));
  const holdL = lifts.filter(l => LIFT_HOLD.test(st(l)));
  const openT = trails.filter(t => TRAIL_OPEN.has(st(t)) || /^open$/i.test(t.StatusIcon || ""));
  const groomed = t => t.Grooming === true || /groom/i.test(String(t.Grooming ?? t.GroomingStatus ?? t.GroomingEnglish ?? ""));
  return {
    liftsOpen: openL.length, liftsHold: holdL.length, liftsTotal: lifts.length,
    trailsOpen: trails.length ? openT.length : null, trailsTotal: trails.length || null,
    terrainPct: trails.length ? Math.round(100 * openT.length / trails.length) : null,
    groomersOnly: openT.length && openT.some(t => "Grooming" in t || "GroomingStatus" in t) ? openT.every(groomed) : null,
    lifts: Object.fromEntries(lifts.map(l => [l.Name, st(l) || "unknown"])),
    source: split === "none" && side ? "MtnPowder (whole resort; sides not split)" : "MtnPowder"
  };
}

const ADAPTERS = {
  vail: async loc => parseVail(await get(loc.statusUrl, { type: "html" })),
  alterra: async loc => parseAlterra(await fetchAlterraFeed(loc.alterra.slug), loc.alterra.side)
};

/* ---------- Combine ---------- */
export function applyManual(status, manual) {
  if (!manual) return status;
  const s = { ...(status || {}) };
  for (const k of ["liftsOpen", "liftsTotal", "terrainPct", "groomersOnly", "note"]) if (k in manual) s[k] = manual[k];
  if ("open" in manual) s.manualOpen = manual.open;
  if (Object.keys(manual).length) s.source = s.source ? `${s.source} + manual` : "Manual";
  return s;
}

export async function fetchLiftStatus(loc, manual) {
  if (loc.kind !== "resort") return null;
  const errors = [];
  let status = null;
  const adapter = ADAPTERS[loc.operator];
  if (adapter && (loc.statusUrl || loc.alterra)) {
    try { status = await adapter(loc); } catch (e) { errors.push(`${loc.operator}: ${e.message}`); }
  }
  // Liftie's hosted API now blocks automated requests (project archived 2023), so there is no generic fallback.
  if (!status && !adapter) errors.push("no lift-status adapter yet; set it in config/manual-status.json");
  status = applyManual(status, manual);
  if (errors.length) status = { ...(status || {}), errors };
  return status;
}
