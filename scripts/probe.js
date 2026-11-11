// Checks every source and every per-resort id, so you can fix config before the first real build.
//   npm run probe
import { readFile } from "node:fs/promises";
import { get } from "../src/http.js";
import { fetchWeather } from "../src/sources/openmeteo.js";
import { fetchSnowDepth } from "../src/sources/snotel.js";
import { fetchAvalanche } from "../src/sources/avalanche.js";
import { parseLiftie, parseVail } from "../src/sources/lifts.js";
import { fetchAvalancheObs } from "../src/sources/avyobs.js";
import { fetchRoads, records, CC, LCS } from "../src/sources/roads.js";

const { locations } = JSON.parse(await readFile(new URL("../config/locations.json", import.meta.url), "utf8"));
const ok = s => console.log(`  ✓ ${s}`), bad = s => console.log(`  ✕ ${s}`);

console.log("Open-Meteo");
try { const w = await fetchWeather(locations); const a = w[locations[0].id]; ok(`${Object.keys(w).length} locations × 2 elevations, ${a.core.days.length} days, ${a.core.hours.time.length} hours, freezing level ${a.core.hours.freezeFt.some(x => x != null) ? "present" : "MISSING"}`); } catch (e) { bad(e.message); }

console.log("SNOTEL (depth, station elevation)");
try {
  const d = await fetchSnowDepth(locations);
  for (const t of [...new Set(locations.map(l => l.snotel))]) d[t] ? ok(`${t}: ${d[t].depth}" on ${d[t].date}${d[t].elev ? ` · ${d[t].name || ""} ${d[t].elev} ft` : " · elevation unknown"}`) : bad(`${t}: no SNWD reading (check the triplet)`);
} catch (e) { bad(e.message); }

console.log("Sierra Avalanche Center");
try { const a = await fetchAvalanche(); ok(`${a.zone}: ATL ${a.atl ?? "none"} / NTL ${a.ntl ?? "none"} / BTL ${a.btl ?? "none"}, ${a.problems.length} problem(s)`); } catch (e) { bad(e.message); }

console.log("SAC avalanche observations");
try { const o = await fetchAvalancheObs(); ok(`${o.length} avalanche observation(s) in the last 3 days`); } catch (e) { bad(`${e.message} (check the endpoint in src/sources/avyobs.js)`); }

console.log("Caltrans feeds (raw)");
for (const [label, url] of [["D3 chain controls", CC(3)], ["D10 chain controls", CC(10)], ["D3 lane closures", LCS(3)], ["D10 lane closures", LCS(10)]]) {
  try {
    const j = await get(url, { retries: 0 });
    const recs = [...records(j)];
    const routes = {};
    for (const r of recs) { const k = String(r.route ?? r.Route); const st = (JSON.stringify(r).match(/\bR[0-3]\b/) || ["-"])[0]; routes[k] = routes[k] || new Set(); routes[k].add(st); }
    ok(`${label}: ${recs.length} records, top-level keys [${Object.keys(j).join(", ")}], routes ${Object.entries(routes).map(([k, v]) => `${k}:${[...v].join("/")}`).join(" ") || "none"}`);
    if (recs[0]) console.log(`    sample: ${JSON.stringify(recs[0]).slice(0, 600)}`);
  } catch (e) { bad(`${label}: ${e.message}`); }
}

console.log("Caltrans road status");
try { const r = await fetchRoads(); const keys = Object.keys(r); ok(keys.length ? keys.map(k => `${k}: ${r[k].status}`).join(", ") : "feeds answered, no chain controls or closures right now"); } catch (e) { bad(e.message); }

console.log("Lift status");
for (const l of locations.filter(x => x.kind === "resort")) {
  if (l.operator === "vail" && l.statusUrl) {
    try { const s = parseVail(await get(l.statusUrl, { type: "html" })); ok(`${l.name} (resort site): ${s.liftsOpen}/${s.liftsTotal} lifts, trails ${s.trailsOpen ?? "?"}/${s.trailsTotal ?? "?"}`); }
    catch (e) { bad(`${l.name} (resort site): ${e.message}`); }
  }
}

console.log("Resorts with no lift-status source yet");
console.log("  " + locations.filter(x => x.kind === "resort" && x.operator !== "vail").map(x => x.name).join(", "));
