// Builds public/ from the sample scenario, no network needed. `npm run demo && npm run serve`
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { assemble } from "../src/build.js";
import * as F from "../test/fixture.js";

const root = new URL("../", import.meta.url);
const { regions, locations } = JSON.parse(await readFile(new URL("config/locations.json", root), "utf8"));
const weather = Object.fromEntries(locations.map(l => [l.id, F.wx(l)]));
const depths = Object.fromEntries(locations.map(l => { const s = F.station(l); return [l.snotel, { depth: s.depth, elev: s.elev, date: s.date }]; }));
const out = assemble({ regions, locations, weather, depths, avy: F.SAMPLE_AVY, obs: F.SAMPLE_OBS, roads: F.SAMPLE_ROADS,
  lifts: locations.map(F.lifts), todayIndex: 6, issues: ["Demo mode: sample storm data, not live conditions."] });
await mkdir(new URL("public/", root), { recursive: true });
await writeFile(new URL("public/data.json", root), JSON.stringify(out));
for (const f of ["index.html", "app.js"]) await copyFile(new URL(`site/${f}`, root), new URL(`public/${f}`, root));
console.log(`Demo built: ${out.locations.filter(r => r.yes).length}/${out.locations.length} in.`);
