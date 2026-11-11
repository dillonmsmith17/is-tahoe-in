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

const ADAPTERS = {
  vail: async loc => parseVail(await get(loc.statusUrl, { type: "html" }))
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
  if (adapter && loc.statusUrl) {
    try { status = await adapter(loc); } catch (e) { errors.push(`${loc.operator}: ${e.message}`); }
  }
  // Liftie's hosted API now blocks automated requests (project archived 2023), so there is no generic fallback.
  if (!status && !adapter) errors.push("no lift-status adapter yet; set it in config/manual-status.json");
  status = applyManual(status, manual);
  if (errors.length) status = { ...(status || {}), errors };
  return status;
}
