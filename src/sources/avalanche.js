// Sierra Avalanche Center forecast via the avalanche.org public API.
// SAC issues one zone (Central Sierra Nevada), so every touring location shares it.
import { get } from "../http.js";

const CENTER = "SAC";

// danger values: 1 Low .. 5 Extreme; 0 or -1 = no rating issued.
const rating = v => (typeof v === "number" && v >= 1 && v <= 5 ? v : null);

export function parseForecast(p, zone) {
  const cur = (p.danger || []).find(d => d.valid_day === "current") || (p.danger || [])[0] || {};
  return {
    zone: zone?.properties?.name || p.forecast_zone?.[0]?.name || "Central Sierra Nevada",
    link: zone?.properties?.link || "https://www.sierraavalanchecenter.org/forecasts",
    published: p.published_time || null,
    expires: p.expires_time || null,
    atl: rating(cur.upper),
    ntl: rating(cur.middle),
    btl: rating(cur.lower),
    bottomLine: stripHtml(p.bottom_line || ""),
    problems: (p.forecast_avalanche_problems || []).map(pr => ({
      name: pr.name,
      where: summarizeLocation(pr.location || []),
      likelihood: pr.likelihood || null,
      detail: stripHtml(pr.discussion || "").slice(0, 280)
    }))
  };
}

// ["north upper","northeast upper","east middle"] -> "N–NE–E · above/near treeline"
function summarizeLocation(locs) {
  const ab = { north: "N", northeast: "NE", east: "E", southeast: "SE", south: "S", southwest: "SW", west: "W", northwest: "NW" };
  const band = { upper: "above treeline", middle: "near treeline", lower: "below treeline" };
  const aspects = new Set(), bands = new Set();
  for (const s of locs) {
    const [a, b] = String(s).toLowerCase().split(" ");
    if (ab[a]) aspects.add(ab[a]);
    if (band[b]) bands.add(band[b]);
  }
  const order = Object.values(ab);
  const a = order.filter(x => aspects.has(x));
  return [a.length === 8 ? "All aspects" : a.join("–"), [...bands].join(", ")].filter(Boolean).join(" · ");
}

const stripHtml = s => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export async function fetchAvalanche() {
  const layer = await get(`https://api.avalanche.org/v2/public/products/map-layer/${CENTER}`);
  const zone = (layer.features || [])[0];
  if (!zone) throw new Error("SAC map layer returned no zones");
  const product = await get(`https://api.avalanche.org/v2/public/product?type=forecast&center_id=${CENTER}&zone_id=${zone.id}`);
  return parseForecast(product, zone);
}
