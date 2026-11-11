// Parsers checked against real page snapshots taken 2026-11-11 (Mt. Rose's opening day; everyone else pre-season).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as R from "../src/sources/resorts.js";

const fx = f => gunzipSync(readFileSync(new URL(`./fixtures/${f}.gz`, import.meta.url))).toString("utf8");
const names = r => Object.keys(r.lifts);

test("Sugar Bowl: 11 lifts, 105 trails across four zones", () => {
  const r = R.parseSugarBowl(fx("sugar-bowl-0.html"));
  assert.equal(r.liftsTotal, 11); assert.equal(r.liftsOpen, 0); assert.equal(r.trailsTotal, 105);
  assert.ok(names(r).includes("Mt. Lincoln Express") && names(r).includes("Crow's Peak"));
});

test("Boreal: 7 ski lifts (tubing carpet excluded) and winter trails from the POWDR API", () => {
  const r = R.parseBoreal(JSON.parse(fx("boreal-0.json")), JSON.parse(fx("boreal-1.json")));
  assert.equal(r.liftsTotal, 7); assert.ok(r.trailsTotal > 30);
  assert.ok(names(r).includes("Castle Peak Quad Chairlift"));
});

test("Mt. Rose: opening day, Lakeview and Magic open, resort base 8-10 in", () => {
  const r = R.parseMtRose(fx("mt-rose-0.html"));
  assert.equal(r.liftsTotal, 7); assert.equal(r.liftsOpen, 2);
  assert.equal(r.lifts["Lakeview Express"], "open"); assert.equal(r.lifts["Northwest Express"], "closed");
  assert.equal(r.reportedBase, 10);
});

test("Sierra: 13 lifts (tubing excluded), 50 trails", () => {
  const r = R.parseSierra(fx("sierra-0.html"));
  assert.equal(r.liftsTotal, 13); assert.equal(r.trailsTotal, 50);
  assert.ok(!names(r).some(n => /tubing/i.test(n)));
  assert.ok(names(r).includes("Grandview Express") && names(r).includes("West Bowl Express"));
});

test("Homewood: 7 lifts, 67 runs from the summary stats", () => {
  const r = R.parseHomewood(fx("homewood-0.html"));
  assert.equal(r.liftsTotal, 7); assert.equal(r.trailsTotal, 67);
  assert.ok(names(r).includes("Old Homewood Express"));
});

test("Diamond Peak: 7 lifts (section headings excluded), 45 trails", () => {
  const r = R.parseDiamondPeak(fx("diamond-peak-0.html"));
  assert.equal(r.liftsTotal, 7); assert.equal(r.trailsTotal, 45);
  assert.ok(names(r).includes("Crystal Express"));
});

test("Tahoe Donner: 5 lifts from the status table", () => {
  const r = R.parseTahoeDonner(fx("tahoe-donner-0.html"));
  assert.equal(r.liftsTotal, 5); assert.ok(names(r).includes("Eagle Rock Chairlift"));
});

test("Donner Ski Ranch: chairs 1-6 plus the carpet, tubing excluded", () => {
  const r = R.parseDonnerSkiRanch(fx("donner-ski-ranch-0.html"));
  assert.equal(r.liftsTotal, 7); assert.ok(!names(r).some(n => /tubing/i.test(n)));
});

test("status words normalise", () => {
  assert.equal(R.normStatus("Open"), "open"); assert.equal(R.normStatus("🚫 Closed"), "closed");
  assert.equal(R.normStatus("wind hold"), "hold"); assert.equal(R.normStatus("Scheduled"), "scheduled");
  assert.equal(R.normStatus("Not open"), "closed"); assert.equal(R.parseBase('Base Depth 8-10"'), 10);
});

test("a page with no lifts throws instead of reporting zero", () => {
  assert.throws(() => R.parseMtRose("<html></html>"), /no lifts found/);
});
