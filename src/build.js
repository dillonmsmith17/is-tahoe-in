// Pulls every source, runs the engine, writes public/data.json. Any single source can fail
// without killing the build; failures are recorded in data.json and shown on the site.
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { fetchWeather, TODAY_INDEX } from "./sources/openmeteo.js";
import { fetchSnowDepth } from "./sources/snotel.js";
import { fetchAvalanche } from "./sources/avalanche.js";
import { fetchAvalancheObs } from "./sources/avyobs.js";
import { fetchRoads } from "./sources/roads.js";
import { fetchLiftStatus } from "./sources/lifts.js";
import { evaluate } from "./engine.js";

const root = new URL("../", import.meta.url);
const readJson = async p => JSON.parse(await readFile(new URL(p, root), "utf8"));

export function assemble({ regions, locations, overrides = {}, weather, depths, avy, obs, roads, lifts, issues = [], todayIndex = TODAY_INDEX }) {
  const results = locations.map((loc, i) => {
    const st = depths?.[loc.snotel];
    const station = st ? { depth: st.depth, elev: st.elev ?? null, date: st.date, triplet: loc.snotel } : null;
    const L = lifts?.[i];
    if (L?.errors?.length) issues.push(`${loc.name} lifts: ${L.errors.join("; ")}`);
    const r = evaluate(loc, weather[loc.id], { today: todayIndex, station, avy, lifts: L, manual: overrides[loc.id] || {}, roads, obs });
    return { id: loc.id, name: loc.name, kind: loc.kind, region: loc.region, top: loc.top, base: loc.base ?? null, trailhead: loc.trailhead ?? null,
      note: loc.note ?? null, routes: loc.routes || [], skinTrack: loc.skinTrack ?? null, ...r };
  });
  return { generatedAt: new Date().toISOString(), todayIndex, regions, avalanche: avy, roads: roads || null, issues, locations: results };
}

export async function build() {
  const { regions, locations } = await readJson("config/locations.json");
  const { overrides = {} } = await readJson("config/manual-status.json");
  const issues = [];
  const settle = async (label, p) => { try { return await p; } catch (e) { issues.push(`${label}: ${e.message}`); return null; } };

  const [weather, depths, avy, obs, roads, ...lifts] = await Promise.all([
    settle("Open-Meteo", fetchWeather(locations)),
    settle("SNOTEL", fetchSnowDepth(locations)),
    settle("Sierra Avalanche Center forecast", fetchAvalanche()),
    settle("SAC observations", fetchAvalancheObs()),
    settle("Caltrans road status", fetchRoads()),
    ...locations.map(l => fetchLiftStatus(l, overrides[l.id]).catch(e => ({ errors: [e.message] })))
  ]);
  if (!weather) throw new Error(`Weather is required and failed. ${issues.join("; ")}`);
  if (!process.env.NV511_KEY) issues.push("NV-431 (Mt. Rose Hwy) road status is off. Set NV511_KEY to enable it.");

  const out = assemble({ regions, locations, overrides, weather, depths, avy, obs, roads, lifts, issues });
  await mkdir(new URL("public/", root), { recursive: true });
  await writeFile(new URL("public/data.json", root), JSON.stringify(out));
  for (const f of ["index.html", "app.js"]) await copyFile(new URL(`site/${f}`, root), new URL(`public/${f}`, root));
  console.log(`Built data.json: ${out.locations.filter(r => r.yes).length}/${out.locations.length} in. ${issues.length} note(s).`);
  for (const s of issues) console.log("  -", s);
  console.log("\nVerdicts (today | tomorrow | new snow | surface | reason):");
  for (const r of out.locations) console.log(`  ${r.id.padEnd(18)} ${r.yes ? "YES" : "no "} | ${r.tomorrow?.yes ? "YES" : "no "} | ${String(Math.round(r.overnight)).padStart(2)}" overnight, ${String(Math.round(r.s72)).padStart(2)}" 72h | base ${String(r.depth).padStart(3)}" | ${r.surface.padEnd(15)} | ${r.why}`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) build().catch(e => { console.error(e); process.exit(1); });
