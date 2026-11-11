// Sample early-November storm cycle, built hour by hour so snow line, overnight totals and wind all behave.
// Used by tests and `npm run demo`. Reference elevation 7,000 ft.
import { bands } from "../src/bands.js";

export const DATES = ["2026-11-05","2026-11-06","2026-11-07","2026-11-08","2026-11-09","2026-11-10","2026-11-11","2026-11-12","2026-11-13","2026-11-14","2026-11-15","2026-11-16"];
// Daily liquid precip (in) at the reference point, daily hi/lo (°F) at 7,000 ft, daily max gust and wind direction at a summit.
const LIQ  = [0, 0, 1.0, 1.0, 1.1, .45, .3, 0, 0, 0, .25, .6];
const HI   = [52, 54, 47, 34, 29, 30, 33, 38, 42, 40, 33, 28];
const LO   = [34, 38, 37, 31, 20, 16, 18, 22, 25, 27, 24, 19];
const GUST = [20, 15, 35, 50, 55, 40, 38, 15, 15, 25, 40, 50];
const DIR  = [270, 270, 225, 225, 230, 250, 280, 270, 270, 220, 215, 225];
// Fraction of each day's precip that falls in each hour (front-loaded overnight on storm days).
const SHAPE = Array.from({ length: 24 }, (_, h) => (h < 8 ? 2 : h >= 18 ? 1 : 0.3));
const SHAPE_SUM = SHAPE.reduce((a, b) => a + b, 0);

export const FACTOR = { "mt-rose":.75,"northstar":.95,"diamond-peak":.8,"tamarack":.75,"palisades-olympic":1.2,"palisades-alpine":1.2,"homewood":1.2,"silver-peak":1.2,"ellis-peak":1.05,"rubicon":1.15,"jakes":1.1,"sugar-bowl":1.3,"boreal":1.3,"donner-ski-ranch":1.3,"tahoe-donner":1.0,"castle-peak":1.3,"mt-judah":1.3,"heavenly":.85,"kirkwood":1.15,"sierra":1.05,"tallac":1.1,"echo":1.05,"luther":.95,"carson-pass":1.15 };
export const SAMPLE_OPEN = { "mt-rose":[5,8], "northstar":[4,20], "palisades-olympic":[6,23], "sugar-bowl":[4,13], "boreal":[3,7], "kirkwood":[5,15] };
export const SAMPLE_AVY = { zone:"Central Sierra Nevada", link:"https://www.sierraavalanchecenter.org/forecasts", atl:3, ntl:2, btl:1, bottomLine:"", problems:[
  { name:"Wind slab", where:"N–NE–E · above treeline, near treeline", detail:"Southwest winds loaded leeward terrain below ridgelines." },
  { name:"Storm slab", where:"All aspects · above treeline", detail:"New snow sits on a thin, rain-crusted early-season base." }]};
export const SAMPLE_ROADS = { "80": { status: "R1", where: "Kingvale" } };
export const SAMPLE_OBS = [{ date: "2026-11-10", lat: 39.372, lon: -120.352, place: "Castle Peak, NE face", trigger: "Natural", size: "D1.5", link: "https://www.sierraavalanchecenter.org/observations" }];
export const STATION_ELEV = 6900;

const refTemp = (d, h) => { // low at 06:00, high at 15:00
  const lo = LO[d], hi = HI[d];
  if (h < 6) { const hp = HI[Math.max(d - 1, 0)]; return lo + (hp - lo) * (6 - h) / 15; }
  if (h <= 15) return lo + (hi - lo) * 0.5 * (1 - Math.cos(Math.PI * (h - 6) / 9));
  return hi - (hi - LO[Math.min(d + 1, 11)]) * (h - 15) / 15;
};
const tAt = (t, e) => t - 3.5 * (e - 7000) / 1000;
const orog = e => 1 + .08 * (e - 7000) / 1000;

function series(loc, elev) {
  const f = FACTOR[loc.id] ?? 1, top = elev >= 8500;
  const H = { time: [], temp: [], precip: [], rain: [], snow: [], freezeFt: [], speed: [], gust: [], dir: [] };
  DATES.forEach((date, d) => {
    for (let h = 0; h < 24; h++) {
      const tr = refTemp(d, h), fz = 7000 + (tr - 32) / 3.5 * 1000, sl = fz - 1000;
      const liq = LIQ[d] * SHAPE[h] / SHAPE_SUM * f * orog(elev);
      const isSnow = elev >= sl;
      const g = GUST[d] * (top ? 1.15 : .8) * (0.85 + 0.3 * Math.sin((h - 3) / 24 * Math.PI * 2) ** 2);
      H.time.push(`${date}T${String(h).padStart(2, "0")}:00`);
      H.temp.push(tAt(tr, elev)); H.precip.push(liq); H.rain.push(isSnow ? 0 : liq); H.snow.push(isSnow ? liq * 10 : 0);
      H.freezeFt.push(fz); H.gust.push(g); H.speed.push(g * .6); H.dir.push(DIR[d]);
    }
  });
  const days = DATES.map((date, d) => {
    const s = (a) => a.slice(d * 24, d * 24 + 24);
    return { date, snow: s(H.snow).reduce((a, b) => a + b, 0), rain: s(H.rain).reduce((a, b) => a + b, 0),
      hi: Math.max(...s(H.temp)), lo: Math.min(...s(H.temp)), gust: Math.max(...s(H.gust)), forecast: d > 6 };
  });
  return { days, hours: H };
}

export function wx(loc) { const b = bands(loc); return { core: series(loc, b.core), top: series(loc, loc.top) }; }

export function station(loc) {
  const s = series(loc, STATION_ELEV), snow = s.days.slice(0, 7).reduce((a, d) => a + d.snow, 0);
  return { depth: Math.round(3 + .55 * snow), elev: STATION_ELEV, date: DATES[6], triplet: loc.snotel || "sample" };
}
export function lifts(loc) {
  if (loc.kind !== "resort") return null;
  const o = SAMPLE_OPEN[loc.id];
  return o ? { liftsOpen: o[0], liftsTotal: o[1], source: "sample" } : { liftsOpen: 0, liftsTotal: 10, source: "sample" };
}
export const opts = loc => ({ today: 6, station: station(loc), avy: SAMPLE_AVY, lifts: lifts(loc), roads: SAMPLE_ROADS, obs: SAMPLE_OBS });
