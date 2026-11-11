// Recent avalanche observations from the Sierra Avalanche Center (avalanche.org observations API).
// Only observations that report an avalanche are kept; the engine matches them by distance.
import { get, isoDate } from "../http.js";

export function parseObservations(json) {
  const items = Array.isArray(json) ? json : json?.results || json?.observations || json?.data || [];
  const out = [];
  for (const o of items) {
    const avs = o.avalanches || o.avalanche_observations || [];
    const flagged = avs.length > 0 || /avalanche/i.test(o.observation_type || "") || o.avalanches_observed === true || o.instability?.avalanches_observed === true;
    if (!flagged) continue;
    const pt = o.location_point || o.location || {};
    const lat = Number(pt.lat ?? pt.latitude ?? o.latitude), lon = Number(pt.lng ?? pt.lon ?? pt.longitude ?? o.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const a0 = avs[0] || {};
    out.push({
      date: (o.start_date || o.observed_at || o.created_at || "").slice(0, 10),
      lat, lon,
      place: o.location_name || null,
      trigger: a0.trigger || a0.avalanche_trigger || null,
      size: a0.d_size || a0.size || null,
      link: o.id ? `https://www.sierraavalanchecenter.org/observations#/view/observations/${o.id}` : "https://www.sierraavalanchecenter.org/observations"
    });
  }
  return out;
}

export async function fetchAvalancheObs(today = new Date()) {
  const start = isoDate(new Date(today.getTime() - 3 * 86400000));
  const url = `https://api.avalanche.org/obs/v1/public/observation/?center=SAC&start_date=${start}&end_date=${isoDate(today)}`;
  return parseObservations(await get(url));
}
