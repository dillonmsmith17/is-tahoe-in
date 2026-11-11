import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate, aspectsFor, vectorMeanDir } from "../src/engine.js";
import { bands } from "../src/bands.js";
import { parse as parseSnotel, parseStations } from "../src/sources/snotel.js";
import { parseForecast } from "../src/sources/avalanche.js";
import { parseObservations } from "../src/sources/avyobs.js";
import { parseChainControls, parseClosures, mergeRoads } from "../src/sources/roads.js";
import { parseLiftie, parseVail, applyManual } from "../src/sources/lifts.js";
import * as F from "./fixture.js";

const { locations } = JSON.parse(readFileSync(new URL("../config/locations.json", import.meta.url)));
const loc = id => locations.find(l => l.id === id);
const run = (id, extra = {}) => { const l = loc(id); return evaluate(l, F.wx(l), { ...F.opts(l), ...extra }); };
// Deep-copy a location's weather and edit today's ski-hours gusts.
const withGust = (id, top, core) => {
  const l = loc(id), w = structuredClone(F.wx(l));
  for (let h = 6 * 24 + 9; h < 6 * 24 + 16; h++) { w.top.hours.gust[h] = top; w.core.hours.gust[h] = core; }
  return evaluate(l, w, F.opts(l));
};

/* ---- bands & snow line ---- */
test("core band defaults to 25–85% of resort vertical", () => {
  const b = bands(loc("palisades-olympic"));
  assert.equal(b.coreLo, Math.round(6200 + .25 * 2850));
  assert.equal(b.coreHi, Math.round(6200 + .85 * 2850));
});

test("rain line above the core band means a rain crust and a NO", () => {
  const r = run("boreal");
  assert.equal(r.snowLine.hit, "most");
  assert.match(r.surface, /^Rain/);
  assert.equal(r.yes, false);
});

test("rain line through the lower mountain flags it and adds a stay-high qualifier", () => {
  const r = run("sugar-bowl");
  assert.equal(r.snowLine.hit, "lower");
  assert.ok(r.flags.some(f => f.kind === "rain"));
  assert.match(r.qual, /Stay above/);
});

test("high spot stays all snow", () => {
  assert.equal(run("carson-pass").snowLine.hit, "none");
});

/* ---- overnight & tomorrow ---- */
test("overnight snow counts 4pm yesterday to 8am today and leads the tile reason", () => {
  const r = run("palisades-olympic");
  assert.ok(r.overnight >= 3);
  assert.match(r.why, /overnight/);
});

test("tomorrow verdict is produced from forecast data", () => {
  const r = run("kirkwood");
  assert.equal(r.tomorrow.date, F.DATES[7]);
  assert.equal(typeof r.tomorrow.yes, "boolean");
});

/* ---- wind ---- */
test("wind from SW loads NE aspects and scours SW", () => {
  const a = aspectsFor(225);
  assert.deepEqual(a.loaded, ["N", "NE", "E"]);
  assert.deepEqual(a.scoured, ["S", "SW", "W"]);
  assert.equal(Math.round(vectorMeanDir([350, 10])), 0);
});

test("exposed skin track is a NO in ridge gusts; sheltered one gets a flag instead", () => {
  const exposed = withGust("castle-peak", 50, 30);
  assert.ok(exposed.trace.some(t => t.s === "bad" && /Summit gusts/.test(t.t)));
  const sheltered = withGust("mt-judah", 50, 30);
  assert.equal(sheltered.yes, true);
  assert.ok(sheltered.flags.some(f => f.kind === "wind"));
});

test("resort: summit gusts flag upper-lift holds; mid-mountain gusts are a NO", () => {
  assert.ok(withGust("kirkwood", 55, 35).flags.some(f => /hold/.test(f.text)));
  const r = withGust("kirkwood", 70, 62);
  assert.equal(r.yes, false); assert.equal(r.why, "Wind holds likely");
});

/* ---- roads, avalanche obs, base ---- */
test("chain control flags; full closure is a NO", () => {
  assert.ok(run("sugar-bowl").flags.some(f => /Chains on 80 \(R1\)/.test(f.text)));
  const r = run("sugar-bowl", { roads: { "80": { status: "CLOSED", where: "Donner Summit" } } });
  assert.equal(r.yes, false); assert.equal(r.why, "I-80 closed");
});

test("recent nearby avalanche with Considerable danger vetoes; a distant one does not", () => {
  assert.equal(run("castle-peak").why, "Recent avalanche nearby");
  assert.ok(!run("tallac").flags.some(f => f.kind === "avy"));
});

test("High danger vetoes a tour", () => {
  const r = run("mt-judah", { avy: { ...F.SAMPLE_AVY, atl: 4, ntl: 4 } });
  assert.equal(r.yes, false); assert.match(r.why, /High/);
});

test("low station depth is scaled up to the core band, capped", () => {
  const r = run("castle-peak", { station: { depth: 20, elev: 6000, date: "x", triplet: "428:CA:SNTL" } });
  assert.ok(r.depth > 20 && r.depth <= 32);
  assert.match(r.depthSource, /scaled/);
});

test("resort gates: closed, barely open, groomers only", () => {
  assert.equal(run("heavenly").why, "Lifts not spinning");
  assert.equal(run("mt-rose", { lifts: { liftsOpen: 1, liftsTotal: 8, source: "t" } }).why, "Barely open");
  assert.equal(run("northstar", { lifts: { liftsOpen: 4, liftsTotal: 20, groomersOnly: true, source: "t" } }).surface, "Packed groomers");
});

/* ---- parsers ---- */
test("SNOTEL data and station parsers", () => {
  const d = parseSnotel([{ stationTriplet: "652:NV:SNTL", data: [{ stationElement: { elementCode: "SNWD" }, values: [{ date: "2026-11-10", value: 22 }, { date: "2026-11-11", value: null }] }] }]);
  assert.deepEqual(d["652:NV:SNTL"], { depth: 22, date: "2026-11-10" });
  assert.equal(parseStations([{ stationTriplet: "652:NV:SNTL", elevation: 8801 }])["652:NV:SNTL"].elev, 8801);
});

test("avalanche forecast parser maps bands and summarizes aspects", () => {
  const a = parseForecast({ danger: [{ valid_day: "current", upper: 3, middle: 2, lower: 1 }], forecast_avalanche_problems: [{ name: "Wind Slab", location: ["north upper", "northeast upper", "east middle"] }] });
  assert.equal(a.atl, 3);
  assert.equal(a.problems[0].where, "N–NE–E · above treeline, near treeline");
});

test("avalanche observation parser keeps only reported avalanches", () => {
  const o = parseObservations([{ id: 1, start_date: "2026-11-10", location_point: { lat: 39.37, lng: -120.35 }, avalanches: [{ trigger: "Skier" }] }, { id: 2, start_date: "2026-11-10", location_point: { lat: 39, lng: -120 }, avalanches: [] }]);
  assert.equal(o.length, 1); assert.equal(o[0].trigger, "Skier");
});

test("road parsers find chain controls and full closures", () => {
  const cc = parseChainControls({ data: [{ cc: { route: "80", location: { locationName: "Kingvale" }, statusData: { status: "R2" } } }, { cc: { route: "50", statusData: { status: "R0" } } }] });
  assert.equal(cc["80"].status, "R2");
  const cl = parseClosures({ data: [{ lcs: { route: "SR-89", closure: { closureType: "Full", typeOfClosure: "Full closure" } } }] });
  assert.equal(cl["89"].status, "CLOSED");
  assert.equal(mergeRoads(cc, { "80": { status: "R1" } })["80"].status, "R2");
});

test("Liftie and Vail lift parsers", () => {
  assert.equal(parseLiftie({ lifts: { status: { A: "open", B: "closed" } } }).liftsOpen, 1);
  const v = parseVail(`<script>FR.TerrainStatusFeed = {"Lifts":[{"Status":1},{"Status":0}],"GroomingAreas":[{"Runs":[{"IsOpen":true,"IsGroomed":true},{"IsOpen":false}]}]};</script>`);
  assert.equal(v.terrainPct, 50); assert.equal(v.groomersOnly, true);
  assert.equal(applyManual(v, { open: false }).manualOpen, false);
});
