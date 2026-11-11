// Open-Meteo weather at two points per location: the core skiing elevation and the summit.
// One batched request. Window: 6 past days + today + 5 forecast days = 12 days; today is index 6.
// Hourly arrays start at 00:00 local on day 0, so hour h of day d is index d*24+h.
import { get, ftToM } from "../http.js";
import { bands } from "../bands.js";

export const PAST_DAYS = 6;
export const FORECAST_DAYS = 6; // includes today
export const TODAY_INDEX = PAST_DAYS;

const DAILY = ["snowfall_sum", "rain_sum", "temperature_2m_max", "temperature_2m_min", "wind_gusts_10m_max"];
const HOURLY = ["temperature_2m", "precipitation", "rain", "snowfall", "freezing_level_height", "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m"];

// Points: [loc0 core, loc0 top, loc1 core, loc1 top, ...]
export function points(locs) {
  return locs.flatMap(l => { const b = bands(l); return [{ l, lat: l.lat, lon: l.lon, elev: b.core }, { l, lat: l.lat, lon: l.lon, elev: l.top }]; });
}

export function buildUrl(locs) {
  const pts = points(locs);
  const p = new URLSearchParams({
    latitude: pts.map(x => x.lat).join(","),
    longitude: pts.map(x => x.lon).join(","),
    elevation: pts.map(x => ftToM(x.elev)).join(","),
    daily: DAILY.join(","),
    hourly: HOURLY.join(","),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "America/Los_Angeles",
    past_days: String(PAST_DAYS),
    forecast_days: String(FORECAST_DAYS)
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

const toIn = (v, unit) => v == null ? 0 : unit === "cm" ? v / 2.54 : unit === "mm" ? v / 25.4 : v;
const toFt = (v, unit) => v == null ? null : unit === "ft" ? v : v * 3.281; // freezing level arrives in m unless ft

function one(r) {
  const d = r.daily, du = r.daily_units || {}, h = r.hourly, hu = r.hourly_units || {};
  return {
    days: d.time.map((date, k) => ({
      date,
      snow: toIn(d.snowfall_sum[k], du.snowfall_sum),
      rain: toIn(d.rain_sum[k], du.rain_sum),
      hi: d.temperature_2m_max[k], lo: d.temperature_2m_min[k],
      gust: d.wind_gusts_10m_max[k] ?? 0,
      forecast: k > TODAY_INDEX
    })),
    hours: {
      time: h.time,
      temp: h.temperature_2m,
      precip: h.precipitation.map(v => toIn(v, hu.precipitation)),
      rain: h.rain.map(v => toIn(v, hu.rain)),
      snow: h.snowfall.map(v => toIn(v, hu.snowfall)),
      freezeFt: h.freezing_level_height.map(v => toFt(v, hu.freezing_level_height)),
      speed: h.wind_speed_10m, gust: h.wind_gusts_10m, dir: h.wind_direction_10m
    }
  };
}

export function parse(json, locs) {
  const arr = Array.isArray(json) ? json : [json];
  const out = {};
  locs.forEach((l, i) => { out[l.id] = { core: one(arr[2 * i]), top: one(arr[2 * i + 1]) }; });
  return out;
}

export async function fetchWeather(locs) {
  return parse(await get(buildUrl(locs), { timeoutMs: 40000 }), locs);
}
