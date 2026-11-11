// NRCS SNOTEL snow depth (SNWD, inches) via the AWDB REST API. One request for all stations.
import { get, isoDate } from "../http.js";

export function buildUrl(triplets, today = new Date()) {
  const begin = new Date(today.getTime() - 3 * 86400000);
  const p = new URLSearchParams({
    stationTriplets: triplets.join(","),
    elements: "SNWD",
    duration: "DAILY",
    beginDate: isoDate(begin),
    endDate: isoDate(today)
  });
  return `https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data?${p}`;
}

// Returns { "652:NV:SNTL": { depth: 23, date: "2026-11-10" }, ... } using the latest non-null value.
export function parse(json) {
  const out = {};
  for (const st of json || []) {
    const series = (st.data || []).find(x => x.stationElement?.elementCode === "SNWD");
    const vals = (series?.values || []).filter(v => v.value != null && v.value >= 0);
    if (vals.length) {
      const last = vals[vals.length - 1];
      out[st.stationTriplet] = { depth: last.value, date: last.date };
    }
  }
  return out;
}

// Station metadata gives elevation (ft), so the engine can scale a low station's depth up to the skiing band.
export function parseStations(json) {
  const out = {};
  for (const s of json || []) if (s.stationTriplet) out[s.stationTriplet] = { name: s.name || null, elev: s.elevation ?? null };
  return out;
}

export async function fetchSnowDepth(locs) {
  const triplets = [...new Set(locs.map(l => l.snotel).filter(Boolean))];
  const [data, meta] = await Promise.all([
    get(buildUrl(triplets)).then(parse),
    get(`https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations?stationTriplets=${triplets.join(",")}`).then(parseStations).catch(() => ({}))
  ]);
  for (const t of Object.keys(data)) Object.assign(data[t], meta[t] || {});
  return data;
}
