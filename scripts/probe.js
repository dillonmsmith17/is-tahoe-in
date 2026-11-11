// Checks every source and every per-resort id, so you can fix config before the first real build.
//   npm run probe
import { readFile } from "node:fs/promises";
import { get } from "../src/http.js";
import { fetchWeather } from "../src/sources/openmeteo.js";
import { fetchSnowDepth } from "../src/sources/snotel.js";
import { fetchAvalanche } from "../src/sources/avalanche.js";
import { parseVail, parseAlterra, fetchAlterraFeed, alterraAreas, fetchSite } from "../src/sources/lifts.js";
import { fetchAvalancheObs } from "../src/sources/avyobs.js";
import { fetchRoads, items, CC, LCS } from "../src/sources/roads.js";

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
    const recs = items(j);
    const routes = {};
    for (const r of recs) { const s = JSON.stringify(r); const k = (s.match(/"route"\s*:\s*"([^"]+)"/i) || [, "?"])[1]; const st = (s.match(/"status"\s*:\s*"([^"]{1,12})"/i) || [, "-"])[1]; routes[k] = routes[k] || new Set(); routes[k].add(st); }
    ok(`${label}: ${recs.length} entries, routes ${Object.entries(routes).filter(([k]) => /80|50|89|88|267|28|431/.test(k)).map(([k, v]) => `${k}:${[...v].join("/")}`).join(" ") || "none of ours"}`);
    if (recs[0]) console.log(`    sample entry: ${JSON.stringify(recs[0]).slice(0, 900)}`);
  } catch (e) { bad(`${label}: ${e.message}`); }
}

console.log("Caltrans lane closures on our routes (shape check)");
for (const d of [3, 10]) {
  try {
    const recs = items(await get(LCS(d), { retries: 0 }));
    const ours = recs.filter(r => /"beginRoute"\s*:\s*"(I-80|US-50|SR-89|SR-88|SR-267|SR-28)"/.test(JSON.stringify(r)));
    ok(`D${d}: ${ours.length} closure entries on Tahoe routes`);
    const sample = ours.find(r => /full/i.test(JSON.stringify(r))) || ours[0];
    if (sample) { const c = sample.lcs || sample; const { location, ...rest } = c; console.log(`    non-location fields: ${JSON.stringify(rest).slice(0, 1200)}`); }
  } catch (e) { bad(`D${d}: ${e.message}`); }
}

console.log("Caltrans road status");
try { const r = await fetchRoads(); const keys = Object.keys(r); ok(keys.length ? keys.map(k => `${k}: ${r[k].status}`).join(", ") : "feeds answered, no chain controls or closures right now"); } catch (e) { bad(e.message); }

console.log("Lift status");
for (const l of locations.filter(x => x.kind === "resort")) {
  if (l.operator === "alterra" && l.alterra) {
    try { const s = parseAlterra(await fetchAlterraFeed(l.alterra.slug), l.alterra.areas); ok(`${l.name} (MtnPowder): ${s.liftsOpen ?? "?"}/${s.liftsTotal} lifts open, ${s.liftsHold ?? 0} on hold, trails ${s.trailsOpen ?? "?"}/${s.trailsTotal ?? "?"}, groomers only: ${s.groomersOnly}, ${s.source}`); }
    catch (e) { bad(`${l.name} (MtnPowder): ${e.message}`); }
  }
  if (l.operator === "site") {
    try { const s = await fetchSite(l.id); ok(`${l.name} (${s.source}): ${s.liftsOpen}/${s.liftsTotal} lifts open, ${s.liftsHold} on hold, trails ${s.trailsOpen ?? "?"}/${s.trailsTotal ?? "?"}${s.reportedBase != null ? `, resort base ${s.reportedBase}"` : ""}`); }
    catch (e) { bad(`${l.name} (site): ${e.message}`); }
  }
  if (l.operator === "vail" && l.statusUrl) {
    try { const s = parseVail(await get(l.statusUrl, { type: "html" })); ok(`${l.name} (resort site): ${s.liftsOpen}/${s.liftsTotal} lifts, trails ${s.trailsOpen ?? "?"}/${s.trailsTotal ?? "?"}`); }
    catch (e) { bad(`${l.name} (resort site): ${e.message}`); }
  }
}

console.log("Resorts with no lift-status source yet");
console.log("  " + (locations.filter(x => x.kind === "resort" && !["vail", "alterra", "site"].includes(x.operator)).map(x => x.name).join(", ") || "none"));

console.log("MtnPowder area mapping check");
try {
  const f = await fetchAlterraFeed("palisades-tahoe");
  const mapped = locations.filter(x => x.alterra?.slug === "palisades-tahoe").flatMap(x => x.alterra.areas || []);
  const { unmapped } = alterraAreas(f, mapped);
  unmapped.length ? bad(`areas with lifts not assigned to either tile: ${unmapped.join(", ")}`) : ok("every area with lifts is assigned to Olympic Valley or Alpine");
  for (const x of locations.filter(y => y.alterra)) {
    const lifts = alterraAreas(f, x.alterra.areas).areas.flatMap(a => (a.Lifts || []).map(l => l.Name));
    console.log(`    ${x.name}: ${lifts.join(", ")}`);
  }
} catch (e) { bad(e.message); }

console.log("MtnPowder feed shape (palisades-tahoe)");
try {
  const f = await fetchAlterraFeed("palisades-tahoe");
  console.log(`  top-level keys: ${Object.keys(f).join(", ")}`);
  for (const r of f.Resorts || []) {
    console.log(`  Resort "${r.Name}" (id ${r.Id ?? "?"}), keys: ${Object.keys(r).slice(0, 25).join(", ")}`);
    for (const a of r.MountainAreas || []) {
      const ls = a.Lifts || [], ts = a.Trails || [];
      const cnt = (xs) => Object.entries(xs.reduce((m, x) => (m[x.StatusEnglish ?? x.Status] = (m[x.StatusEnglish ?? x.Status] || 0) + 1, m), {})).map(([k, v]) => `${k}:${v}`).join(" ");
      console.log(`    Area "${a.Name}": ${ls.length} lifts [${cnt(ls)}], ${ts.length} trails [${cnt(ts)}]`);
    }
    const l0 = r.MountainAreas?.find(a => a.Lifts?.length)?.Lifts[0], t0 = r.MountainAreas?.find(a => a.Trails?.length)?.Trails[0];
    if (l0) console.log(`    sample lift keys: ${Object.keys(l0).join(", ")}`);
    if (t0) console.log(`    sample trail: ${JSON.stringify(Object.fromEntries(Object.entries(t0).filter(([k]) => !/Hours|Description/i.test(k)))).slice(0, 700)}`);
  }
} catch (e) { bad(e.message); }
