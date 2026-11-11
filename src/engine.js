// The verdict engine: raw data for one location -> YES/NO, surface call, flags and a rule trace,
// for today and (from forecast data) tomorrow. Pure function, no I/O.
import { bands } from "./bands.js";
import { routeKey } from "./sources/roads.js";

export const RULES = {
  resortMinBase: 14, tourMinBase: 20,       // in
  powder72: 8, powderMaxHi: 34,             // in / °F at the core elevation
  windGust: 45, exposedElev: 8500,          // gust that wrecks exposed snow; summit elevation counted as exposed
  dustMin: 1, dustMax: 6, thawHi: 40,
  snowLevelBelowFreeze: 1000,               // ft: snow level ≈ freezing level minus this
  minLifts: 2, minTerrainPct: 10,
  vetoDanger: 4,                            // High+ at the tour's top band
  resortUpperHoldGust: 50,                  // mph summit gust in ski hours -> upper lifts likely on hold (flag)
  resortWindNo: 60,                         // mph mid-mountain gust in ski hours -> NO
  tourExposedGust: 40,                      // mph summit gust in ski hours -> NO if skin track exposed, flag if sheltered
  tourCoreGustNo: 55,                       // mph gust at core elevation -> NO regardless
  obsRadiusKm: 10, obsVetoHours: 48,        // recent avalanche within radius + Considerable+ -> NO
  stationScaleCap: 1.6                      // max upscale of a low SNOTEL station's depth
};
export const DNAME = ["", "Low", "Moderate", "Considerable", "High", "Extreme"];
export const ASPECTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

const sum = a => a.reduce((s, x) => s + (x || 0), 0);
const r1 = x => Math.round(x * 10) / 10;
const clamp01 = x => Math.max(0, Math.min(1, x));
const ft = x => `${Math.round(x / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const slice = (a, i, j) => (a || []).slice(Math.max(0, i), Math.max(0, j));
const orog = e => 1 + 0.08 * (e - 7000) / 1000;

export function vectorMeanDir(dirs, weights) {
  let x = 0, y = 0;
  dirs.forEach((d, i) => { if (d == null) return; const w = weights?.[i] ?? 1, rad = d * Math.PI / 180; x += w * Math.sin(rad); y += w * Math.cos(rad); });
  if (!x && !y) return null;
  return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
}
export const cardinal = d => d == null ? null : ASPECTS[Math.round(d / 45) % 8];
// Wind FROM `dir` loads the downwind (lee) aspects and scours the windward ones.
export function aspectsFor(dir) {
  if (dir == null) return { loaded: [], scoured: [] };
  const near = (c, t) => Math.min(Math.abs(c - t), 360 - Math.abs(c - t)) <= 67.5;
  const lee = (dir + 180) % 360;
  return { loaded: ASPECTS.filter((_, i) => near(i * 45, lee)), scoured: ASPECTS.filter((_, i) => near(i * 45, dir)) };
}
const kmBetween = (a, b, c, d) => { const R = 6371, t = Math.PI / 180, x = (d - b) * t * Math.cos((a + c) / 2 * t), y = (c - a) * t; return Math.sqrt(x * x + y * y) * R; };

function snowLine(hrs, i0, i1, B, R) {
  const p = slice(hrs.precip, i0, i1), fz = slice(hrs.freezeFt, i0, i1);
  let w = 0, acc = 0, max = null;
  p.forEach((v, k) => { if (v > 0.01 && fz[k] != null) { const sl = fz[k] - R.snowLevelBelowFreeze; w += v; acc += v * sl; max = max == null ? sl : Math.max(max, sl); } });
  if (!w) return null;
  const avg = acc / w;
  // Rain line: highest elevation where at least 25% of the storm fell as rain.
  const pairs = [];
  p.forEach((v, k) => { if (v > 0.01 && fz[k] != null) pairs.push([fz[k] - R.snowLevelBelowFreeze, v]); });
  pairs.sort((a, b) => b[0] - a[0]);
  let c = 0, line = pairs[pairs.length - 1][0];
  for (const [e, v] of pairs) { c += v; if (c >= 0.25 * w) { line = e; break; } }
  const rainFrac = e => pairs.reduce((s, [sl, v]) => s + (sl > e ? v : 0), 0) / w;
  const hit = line >= B.core ? "most" : line > B.coreLo ? "lower" : line > B.bottom ? "bottom" : "none";
  return {
    line: Math.round(line), avg: Math.round(avg), max: Math.round(max), hit, precip: r1(w),
    pctAbove: Math.round(100 * clamp01((B.top - Math.max(line, B.bottom)) / (B.top - B.bottom))),
    rainAt: { bottom: Math.round(100 * rainFrac(B.bottom)), core: Math.round(100 * rainFrac(B.core)), top: Math.round(100 * rainFrac(B.top)) }
  };
}

// Latest run of precip hours (gaps under 12 h count as one storm) inside [i0, i1).
function lastStorm(hrs, i0, i1) {
  const p = hrs.precip || [];
  let end = -1;
  for (let i = Math.min(i1, p.length) - 1; i >= i0; i--) if (p[i] > 0.01) { end = i; break; }
  if (end < 0) return null;
  let start = end, gap = 0;
  for (let i = end - 1; i >= i0; i--) { if (p[i] > 0.01) { start = i; gap = 0; } else if (++gap >= 12) break; }
  return { i0: start, i1: end + 1 };
}

function windFor(hrs, dayIdx) {
  const i0 = dayIdx * 24 + 9, i1 = dayIdx * 24 + 16;
  const g = slice(hrs.gust, i0, i1), s = slice(hrs.speed, i0, i1), d = slice(hrs.dir, i0, i1);
  const dir = vectorMeanDir(d, s);
  return { gust: g.length ? Math.round(Math.max(...g)) : 0, speed: s.length ? Math.round(sum(s) / s.length) : 0, dir: dir == null ? null : Math.round(dir), from: cardinal(dir) };
}

/**
 * @param loc  config entry
 * @param wx   { core: {days, hours}, top: {days, hours} } from openmeteo.parse
 * @param o    { today, station:{depth,elev,date,triplet}, avy, lifts, manual, roads, obs }
 */
export function evaluate(loc, wx, o = {}) {
  const today = o.today ?? 6;
  const now = verdict(loc, wx, today, o, true);
  const tmr = wx.core.days.length > today + 1 ? verdict(loc, wx, today + 1, { ...o, roads: null, obs: null }, false) : null;
  return { ...now, tomorrow: tmr && { yes: tmr.yes, why: tmr.why, surface: tmr.surface, snow: tmr.s24, overnight: tmr.overnight, wind: tmr.wind, snowLine: tmr.snowLine, date: wx.core.days[today + 1].date } };
}

function verdict(loc, wx, di, o, live) {
  const R = RULES, B = bands(loc);
  const cd = wx.core.days, td = wx.top.days, ch = wx.core.hours, th = wx.top.hours;
  const win = cd.slice(0, di + 1), last3 = win.slice(-3), tLast3 = td.slice(Math.max(0, di - 2), di + 1);
  const day = cd[di];

  const s24 = day.snow, s72 = sum(last3.map(d => d.snow)), s7 = sum(win.slice(-7).map(d => d.snow));
  const s72Top = sum(tLast3.map(d => d.snow));
  const overnight = sum(slice(ch.snow, (di - 1) * 24 + 16, di * 24 + 8));
  const skiHoursSnow = sum(slice(ch.snow, di * 24 + 9, di * 24 + 16));
  const fc = sum(cd.slice(di + 1, di + 6).map(d => d.snow));
  const maxHi72 = Math.max(...last3.map(d => d.hi));
  const gust72Top = Math.max(...tLast3.map(d => d.gust));

  /* Snow line of the most recent storm in the last 7 days (the snow you'd actually be skiing) */
  const storm = lastStorm(ch, Math.max(0, (di - 6) * 24), di * 24 + 16);
  const sl = storm ? { ...snowLine(ch, storm.i0, storm.i1, B, R), from: ch.time[storm.i0], to: ch.time[storm.i1 - 1] } : null;
  const rain72 = storm ? sum(slice(ch.rain, storm.i0, storm.i1)) : 0;

  /* Wind: ski hours today, plus 72-h loading direction from the summit */
  const wind = { top: windFor(th, di), core: windFor(ch, di) };
  const lI0 = (di - 2) * 24, lI1 = di * 24 + 16;
  const ld = vectorMeanDir(slice(th.dir, lI0, lI1), slice(th.speed, lI0, lI1).map(s => (s > 15 ? s : 0)));
  wind.loadFrom = cardinal(ld); Object.assign(wind, aspectsFor(ld));

  /* Snow temperature -> density */
  const sh = slice(ch.snow, lI0, lI1), st = slice(ch.temp, lI0, lI1);
  let tw = 0, ta = 0; sh.forEach((v, k) => { if (v > 0.05 && st[k] != null) { tw += v; ta += v * st[k]; } });
  const snowTemp = tw ? ta / tw : null;
  const density = snowTemp == null ? null : snowTemp >= 29 ? "dense (Sierra cement)" : snowTemp <= 22 ? "light and cold" : "medium density";

  /* Base: station reading scaled to the core band; tomorrow adds forecast snow */
  let baseIn, baseSource;
  const st0 = o.station;
  if (st0?.depth != null) {
    const k = st0.elev ? Math.min(R.stationScaleCap, Math.max(1, orog(B.core) / orog(st0.elev))) : 1;
    baseIn = Math.round(st0.depth * k);
    baseSource = `SNOTEL ${String(st0.triplet || "").split(":")[0]}${st0.elev ? ` at ${ft(st0.elev)} ft, scaled to ${ft(B.core)} ft` : ""} (${st0.date})`;
  } else { baseIn = Math.round(0.62 * s7); baseSource = "modeled from 7-day snowfall (no station reading)"; }
  // Resorts make snow; a station can't see that. Use the resort's own base report when it's higher.
  const rb = loc.kind === "resort" ? o.lifts?.reportedBase : null;
  if (rb != null && rb > baseIn) { baseIn = rb; baseSource = `${o.lifts.source} base report (includes snowmaking)`; }
  if (!live) baseIn += Math.round(0.62 * s24);

  let lastSnow = -1; for (let i = win.length - 1; i >= 0; i--) if (win[i].snow >= 2) { lastSnow = i; break; }
  const daysSince = lastSnow < 0 ? 99 : win.length - 1 - lastSnow;
  const thawBefore = win.slice(0, -3).some(d => d.hi > R.thawHi) || win.some(d => d.rain > 0.1);

  /* ---- Surface (at the core band) ---- */
  let surface, surfWhy;
  const exposedTop = loc.top >= R.exposedElev;
  if (baseIn < 12) { surface = "Thin coverage"; surfWhy = `About ${baseIn}" on the ground where you'd ski. Rocks and logs are still the main event.`; }
  else if (sl?.hit === "most" && rain72 > 0.1) { surface = day.lo < 28 ? "Rain crust" : "Rain-soaked"; surfWhy = `Rain fell up to ~${ft(sl.line)} ft, above most of the skiing (${ft(B.coreLo)}–${ft(B.coreHi)} ft). ${day.lo < 28 ? "It has since refrozen hard." : "It hasn't refrozen."}`; }
  else if (day.lo > 32 || day.rain > 0.1) { surface = "Wet / mank"; surfWhy = day.rain > 0.1 ? "Rain in the skiing band today." : "No overnight refreeze. Expect heavy, sticky snow."; }
  else if (s72 >= R.powder72 && maxHi72 <= R.powderMaxHi) {
    const dens = density ? ` Fell ${density}.` : "";
    if (gust72Top >= R.windGust && exposedTop) { surface = "Wind-affected"; surfWhy = `${r1(s72)}" in 72 hours, but summit gusts hit ${Math.round(gust72Top)} mph${wind.loadFrom ? ` from the ${wind.loadFrom}` : ""}.${wind.loaded.length ? ` Soft and loaded on ${wind.loaded.join("–")}, scoured on ${wind.scoured.join("–")}.` : ""}${dens}`; }
    else { surface = "Powder"; surfWhy = `${r1(s72)}" in 72 hours and highs no warmer than ${Math.round(maxHi72)}°F.${dens}`; }
  }
  else if (s72 >= R.dustMin && s72 < R.dustMax && thawBefore) { surface = "Dust on crust"; surfWhy = `Only ${r1(s72)}" of new snow on top of a melt-freeze or rain crust.`; }
  else if (daysSince <= 6) { surface = loc.kind === "resort" ? "Packed powder" : "Settled powder"; surfWhy = `Last real snow ${daysSince} day${daysSince === 1 ? "" : "s"} ago and it has stayed cold.`; }
  else if (maxHi72 > R.thawHi && day.lo < 28) { surface = "Corn cycle"; surfWhy = "Hard overnight freeze with warm afternoons. Time it for the soften."; }
  else { surface = "Firm / refrozen"; surfWhy = "No new snow in a week and the surface has refrozen. Edges required."; }

  /* ---- Verdict ---- */
  const trace = [], flags = [], quals = [];
  let yes = true, why = null;
  const fail = (t, d, w) => { trace.push({ s: "bad", t, d }); if (yes) why = w; yes = false; };
  const note = (t, d) => trace.push({ s: "note", t, d });
  const ok = (t, d) => trace.push({ s: "ok", t, d });
  const band = loc.top >= 8500 ? "atl" : loc.top >= 7500 ? "ntl" : "btl";
  const bandName = { atl: "above treeline", ntl: "near treeline", btl: "below treeline" }[band];

  // Roads (today only)
  if (live && o.roads) {
    const st = (loc.routes || []).map(r => ({ r, s: o.roads[routeKey(r)] })).filter(x => x.s);
    const closed = st.find(x => x.s.status === "CLOSED");
    const chains = st.filter(x => /^R[1-3]$/.test(x.s.status)).sort((a, b) => b.s.status.localeCompare(a.s.status))[0];
    if (closed) { fail(`${closed.r} closed`, closed.s.where ? `Full closure near ${closed.s.where}.` : "Full closure on the approach.", `${closed.r} closed`); flags.push({ kind: "road", text: `${closed.r} closed` }); }
    else if (chains) { note(`Chain control ${chains.s.status} on ${chains.r}`, chains.s.where ? `Near ${chains.s.where}.` : "Carry chains."); flags.push({ kind: "road", text: `Chains on ${chains.r.replace(/^(I|US|SR|NV)-/, "")} (${chains.s.status})` }); }
    else if ((loc.routes || []).length) ok("No chain controls on the approach", (loc.routes || []).join(", "));
  }
  if (live && o.manual?.roadClosed) { fail("Access road closed", o.manual.note || "Marked closed in manual status.", "Road closed"); flags.push({ kind: "road", text: "Road closed" }); }

  // Snow line of the latest storm vs. this spot's elevations
  if (sl) {
    const msg = `Rain line ~${ft(sl.line)} ft (snow level ranged up to ${ft(sl.max)}). Rain was ${sl.rainAt.bottom}% of the storm at the ${loc.kind === "resort" ? "base" : "trailhead"}, ${sl.rainAt.core}% mid-${loc.kind === "resort" ? "mountain" : "route"}, ${sl.rainAt.top}% on top.`;
    if (sl.hit === "most") { note("Rained on most of the skiing", msg); flags.push({ kind: "rain", text: `Rain to ${ft(sl.line)}′` }); }
    else if (sl.hit === "lower") { note("Rain on the lower mountain", msg); flags.push({ kind: "rain", text: `Rain below ${ft(sl.line)}′` }); quals.push(`Stay above ${ft(sl.line)} ft. It rained below that.`); }
    else if (sl.hit === "bottom") ok("Rain stayed below the skiing", `${msg} Expect a crust near the ${loc.kind === "resort" ? "base" : "trailhead"}.`);
    else ok("All snow, top to bottom", msg);
  }

  if (loc.kind === "resort") {
    const L = o.lifts || {};
    if (L.groomersOnly && surface !== "Thin coverage") { surface = "Packed groomers"; surfWhy = "Only groomed runs are open, whatever the storm totals say."; }
    const open = L.manualOpen ?? (L.liftsOpen != null ? L.liftsOpen > 0 : null);
    if (open === false) fail(live ? "Not open" : "Not open (as of today)", `Source: ${L.source || "unknown"}.`, "Lifts not spinning");
    else if (open == null) note("Lift status unknown", "No lift data came back. The verdict uses snow and wind only.");
    else {
      const enough = (L.liftsOpen ?? 0) >= R.minLifts || (L.terrainPct ?? 0) >= R.minTerrainPct || (L.manualOpen && L.liftsOpen == null);
      const lt = L.liftsTotal ? `${L.liftsOpen} of ${L.liftsTotal} lifts` : "Open";
      const tp = L.terrainPct != null ? `, ${L.terrainPct}% of terrain` : "";
      if (enough) ok(`${lt}${tp}`, `Source: ${L.source}.`); else fail(`${lt}${tp}`, `Needs ${R.minLifts}+ lifts or ${R.minTerrainPct}%+ of terrain.`, "Barely open");
    }
    if (baseIn >= R.resortMinBase) ok(`Base about ${baseIn}"`, `${R.resortMinBase}" or more needed. ${baseSource}.`);
    else fail(`Base about ${baseIn}"`, `${R.resortMinBase}" or more needed. ${baseSource}.`, `Base only ~${baseIn}"`);
    if (wind.core.gust >= R.resortWindNo) { fail(`Mid-mountain gusts ${wind.core.gust} mph`, "Most lifts go on wind hold at this speed.", "Wind holds likely"); flags.push({ kind: "wind", text: `Gusts ${wind.core.gust}` }); }
    else if (wind.top.gust >= R.resortUpperHoldGust) { note(`Summit gusts ${wind.top.gust} mph${wind.top.from ? ` from the ${wind.top.from}` : ""}`, "Expect holds on the upper lifts."); flags.push({ kind: "wind", text: "Upper lifts on hold?" }); quals.push("Upper lifts will probably run on and off with the wind."); }
    else ok(`Ski-hours gusts ${wind.top.gust} mph up top`, "No wind holds expected.");
  } else {
    if (baseIn >= R.tourMinBase) ok(`Base about ${baseIn}"`, `${R.tourMinBase}" or more needed. ${baseSource}.`);
    else fail(`Base about ${baseIn}"`, `${R.tourMinBase}" or more needed. ${baseSource}.`, `Base only ~${baseIn}"`);
    const dl = o.avy?.[band] ?? null;
    if (dl == null) note("No avalanche rating issued", "SAC hasn't started daily ratings, or the forecast didn't load.");
    else if (dl >= R.vetoDanger) fail(`Avalanche danger ${DNAME[dl]} ${bandName}`, "High or Extreme is an automatic no.", `${DNAME[dl]} avy danger`);
    else if (dl === 3) note(`Avalanche danger Considerable ${bandName}`, "A go with terrain limits."); else ok(`Avalanche danger ${DNAME[dl]} ${bandName}`, "Within normal touring tolerance.");
    if (!live) note("Avalanche rating is today's", "Tomorrow's forecast isn't out yet.");

    if (live && o.obs?.length) {
      const near = o.obs.map(x => ({ ...x, km: kmBetween(loc.lat, loc.lon, x.lat, x.lon), hrs: (new Date(day.date + "T12:00:00") - new Date(x.date + "T12:00:00")) / 3.6e6 }))
        .filter(x => x.km <= R.obsRadiusKm && x.hrs <= 72).sort((a, b) => a.hrs - b.hrs)[0];
      if (near) {
        const txt = `Avalanche reported ${near.km < 1 ? "here" : `${Math.round(near.km)} km away`} on ${near.date}${near.trigger ? ` (${near.trigger})` : ""}`;
        flags.push({ kind: "avy", text: "Recent avalanche nearby", link: near.link });
        if ((dl ?? 0) >= 3 && near.hrs <= R.obsVetoHours) fail(txt, "A slide nearby in the last 48 hours with Considerable danger is a no.", "Recent avalanche nearby");
        else note(txt, "Check the observation before you go.");
      }
    }

    const sheltered = loc.skinTrack === "sheltered";
    const wt = `${wind.top.gust} mph${wind.top.from ? ` from the ${wind.top.from}` : ""}`;
    if (wind.core.gust >= R.tourCoreGustNo) { fail(`Gusts ${wind.core.gust} mph even mid-route`, "No part of the tour will be pleasant.", "Blowing hard"); flags.push({ kind: "wind", text: `Gusts ${wind.core.gust}` }); }
    else if (wind.top.gust >= R.tourExposedGust && !sheltered) { fail(`Summit gusts ${wt}`, "This skin track is exposed.", "Too windy up top"); flags.push({ kind: "wind", text: `Ridge gusts ${wind.top.gust}` }); }
    else if (wind.top.gust >= R.tourExposedGust) { note(`Summit gusts ${wt}`, "The skin track is sheltered, but the top will be brutal."); flags.push({ kind: "wind", text: `Ridge gusts ${wind.top.gust}` }); quals.push("Skin up in the trees and skip the summit ridge."); }
    else ok(`Ski-hours gusts ${wt} up top`, sheltered ? "Sheltered skin track." : "Exposed skin track, but calm enough.");
  }

  const bad = ["Thin coverage", "Wet / mank", "Firm / refrozen", "Rain crust", "Rain-soaked"].includes(surface);
  if (bad) fail(`Surface: ${surface}`, surfWhy, surface); else ok(`Surface: ${surface}`, surfWhy);

  if (yes) {
    why = overnight >= 3 ? `${Math.round(overnight)}" overnight` : surface === "Powder" ? `${Math.round(s72)}" in 72 hrs, still soft` : surface === "Wind-affected" ? `${Math.round(s72)}" new, wind-hammered up top` : surface;
    const dl = o.avy?.[band];
    if (loc.kind === "tour" && dl === 3) quals.unshift(`Keep to slopes under 30°. Danger is Considerable ${bandName}${wind.loaded.length ? `, worst on ${wind.loaded.join("–")}` : ""}.`);
    if (loc.kind === "tour" && dl == null) quals.unshift("Make your own stability call. There's no avalanche rating.");
    if (surface === "Wind-affected" && wind.loaded.length) quals.push(`Look for soft snow on ${wind.loaded.join("–")} aspects and in the trees.`);
    if (loc.kind === "resort" && baseIn < 20) quals.push("Early-season cover. Bring rock skis.");
    if (skiHoursSnow >= 2) quals.push(`Still snowing: ~${Math.round(skiHoursSnow)}" more during the day.`);
  }
  const qual = yes ? ["Go.", ...quals].join(" ")
    : why === "Lifts not spinning" ? "Check back when the lifts start."
    : /^Base/.test(why) ? `Wait for the next storm. ${fc >= 4 ? `About ${Math.round(fc)}" is in the forecast.` : "Nothing big in the forecast."}`
    : /closed/i.test(why) ? "The approach is closed. Pick another spot."
    : /wind|windy|blowing/i.test(why) ? "Wait for the wind to drop."
    : "Conditions don't justify the drive.";

  return {
    yes, why, qual, surface, surfWhy, trace, flags, band, bands: B,
    s24: r1(s24), s72: r1(s72), s72Top: r1(s72Top), s7: r1(s7), overnight: r1(overnight), fc5: r1(fc),
    depth: baseIn, depthSource: baseSource, gust72: Math.round(gust72Top),
    snowLine: sl, density, wind,
    series: {
      dates: cd.map(d => d.date), snow: cd.map(d => r1(d.snow)), rain: cd.map(d => d.rain > 0.1),
      hi: cd.map(d => Math.round(d.hi)), lo: cd.map(d => Math.round(d.lo)),
      gustTop: Array.from({ length: cd.length }, (_, k) => windFor(th, k).gust)
    },
    lifts: loc.kind === "resort" ? o.lifts || null : null
  };
}
