// Chain controls and full closures.
// California: Caltrans CWWP2 open data (District 3 = I-80, US-50, SR-89, SR-267; District 10 = SR-88).
// Nevada (NV-431 Mt. Rose Hwy): NDOT 511 requires a free API key; set NV511_KEY to enable, otherwise skipped.
// Feed field names vary by district and year, so parsing is deliberately tolerant. `npm run probe` shows what came back.
import { get } from "../http.js";

const CC = d => `https://cwwp2.dot.ca.gov/data/d${d}/cc/ccStatusD${String(d).padStart(2, "0")}.json`;
const LCS = d => `https://cwwp2.dot.ca.gov/data/d${d}/lcs/lcsStatusD${String(d).padStart(2, "0")}.json`;

const routeKey = r => (String(r).match(/\d+/) || [""])[0];         // "I-80" -> "80"
const RANK = { R0: 0, R1: 1, R2: 2, R3: 3, CLOSED: 4 };

// Walk every object in a feed and yield ones that mention a route.
function* records(node) {
  if (Array.isArray(node)) for (const x of node) yield* records(x);
  else if (node && typeof node === "object") {
    const keys = Object.keys(node);
    if (keys.some(k => /^route$/i.test(k))) yield node;
    for (const k of keys) if (node[k] && typeof node[k] === "object") yield* records(node[k]);
  }
}

// Each entry in `data` is one station/segment. Route and status sit in different nested objects,
// so read each entry as a whole rather than the object that happens to hold the route.
const items = json => (Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []);
const routeOf = s => (s.match(/"route"\s*:\s*"([^"]+)"/i) || [])[1];
const placeOf = s => (s.match(/"(?:locationName|beginLocationName|nearbyPlace)"\s*:\s*"([^"]{3,80})"/i) || [])[1] || null;

export function parseChainControls(json) {
  const out = {};
  for (const it of items(json)) {
    const s = JSON.stringify(it);
    const route = routeKey(routeOf(s) || "");
    const m = s.match(/"status"\s*:\s*"R-?([0-3])"/i) || s.match(/\bR-?([0-3])\b/);
    if (!route || !m) continue;
    const code = `R${m[1]}`;
    if (!out[route] || RANK[code] > RANK[out[route].status]) out[route] = { status: code, where: code === "R0" ? null : placeOf(s) };
  }
  return out;
}

export function parseClosures(json, now = new Date()) {
  const out = {};
  for (const it of items(json)) {
    const s = JSON.stringify(it);
    if (!/full/i.test(s) || !/clos/i.test(s)) continue;
    const start = (s.match(/"(?:closureStartDate|startDate|beginDate)"\s*:\s*"([^"]+)"/i) || [])[1];
    if (start && new Date(start) > now) continue;
    const route = routeKey(routeOf(s) || "");
    if (route) out[route] = { status: "CLOSED", where: placeOf(s) };
  }
  return out;
}

export function mergeRoads(...maps) {
  const out = {};
  for (const m of maps) for (const [r, v] of Object.entries(m || {})) if (!out[r] || RANK[v.status] > RANK[out[r].status]) out[r] = v;
  return out;
}

export async function fetchRoads() {
  const tasks = [CC(3), CC(10)].map(u => get(u).then(parseChainControls))
    .concat([LCS(3), LCS(10)].map(u => get(u).then(j => parseClosures(j))));
  const res = await Promise.allSettled(tasks);
  const ok = res.filter(r => r.status === "fulfilled").map(r => r.value);
  if (!ok.length) throw new Error(res.map(r => r.reason?.message).join("; "));
  return mergeRoads(...ok);
}

export { routeKey, records, items, CC, LCS };
