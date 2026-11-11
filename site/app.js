/* Is Tahoe In? — renders data.json produced by src/build.js */
const app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DNAME = ["", "Low", "Moderate", "Considerable", "High", "Extreme"];
const ASPECTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const dColor = n => (n ? `var(--d${n})` : "var(--line)");
const ftf = n => n == null ? "–" : (Math.round(n / 100) * 100).toLocaleString("en-US");
const MONO = "DM Mono, monospace", SANS = "Figtree, sans-serif";
let DATA = null, BYID = {}, filter = "all";
try { filter = localStorage.getItem("ti-filter") || "all"; } catch (e) {}

const dayLabel = iso => { const d = new Date(iso + "T12:00:00"); return ["Su", "M", "Tu", "W", "Th", "F", "Sa"][d.getDay()] + " " + d.getDate(); };
const dayName = iso => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
const ago = iso => { const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)); return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} hr ago`; };

function dangerMini(a) {
  if (!a) return "";
  return `<span class="danger-mini" title="Avalanche danger: above, near and below treeline">${[a.atl, a.ntl, a.btl].map(n => `<i style="background:${dColor(n)}"></i>`).join("")}</span>`;
}
function liftLabel(d) {
  const L = d.lifts;
  if (!L) return "Status unknown";
  if (L.manualOpen === false || L.liftsOpen === 0) return "Closed";
  if (L.liftsTotal) return `${L.liftsOpen}/${L.liftsTotal} lifts`;
  return L.manualOpen ? "Open" : "Status unknown";
}
const WAVE = `<svg class="wave" viewBox="0 0 240 10" preserveAspectRatio="none" aria-hidden="true"><path d="M0 5 Q 10 0 20 5 T 40 5 T 60 5 T 80 5 T 100 5 T 120 5 T 140 5 T 160 5 T 180 5 T 200 5 T 220 5 T 240 5" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;

/* ---------------- Home ---------------- */
function home() {
  const all = DATA.locations, inCount = all.filter(d => d.yes).length;
  const tmrIn = all.filter(d => d.tomorrow?.yes).length;
  const tmrName = all[0]?.tomorrow?.date ? dayName(all[0].tomorrow.date) : "Tomorrow";
  const shown = all.filter(d => filter === "all" || d.kind === filter);
  const groups = DATA.regions.map(R => {
    const items = shown.filter(d => d.region === R.id); if (!items.length) return "";
    return `<section class="region"><div class="region-head"><h2>${esc(R.name)}</h2><span class="count">${items.filter(d => d.yes).length} of ${items.length} in</span></div>${WAVE}<div class="grid">${items.map(tile).join("")}</div></section>`;
  }).join("");
  app.innerHTML = `
  <header class="hero">
    <div class="bumper"><h1><small>Is Tahoe</small>In?</h1></div>
    <div class="tagline">Yes or no · <b>every resort</b> · <b>every skin track</b></div>
    <div class="tally"><span class="big"><em>${inCount}</em> of ${all.length} are in</span><span class="when">${tmrName}: ${tmrIn} of ${all.length} · updated ${ago(DATA.generatedAt)}</span></div>
    ${DATA.issues.length ? `<details class="notice"><summary><b>${DATA.issues.length} data note${DATA.issues.length > 1 ? "s" : ""}.</b> Affected tiles use what's available.</summary><ul>${DATA.issues.map(i => `<li>${esc(i)}</li>`).join("")}</ul></details>` : ""}
  </header>
  <div class="controls" role="group" aria-label="Filter">
    ${[["all", "Everything"], ["resort", "Resorts"], ["tour", "Touring"]].map(([k, l]) => `<button class="chip" id="f-${k}" data-f="${k}" aria-pressed="${filter === k}">${l}</button>`).join("")}
  </div>
  ${groups}
  <footer><span class="sig">Lake Tahoe · CA / NV · Elev. 6,225 ft</span><span>YES means it's worth the drive today. Built from Open-Meteo weather, NRCS SNOTEL snow depth, Sierra Avalanche Center forecasts and observations, Caltrans road status and resort lift status. Not a substitute for your own avalanche assessment.</span></footer>`;
  app.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { filter = b.dataset.f; try { localStorage.setItem("ti-filter", filter); } catch (e) {} home(); });
  app.querySelectorAll(".tile").forEach(t => t.onclick = () => { location.hash = t.dataset.id; });
}

const FLAG_ORDER = { avy: 0, road: 1, wind: 2, rain: 3 };
function flagPills(flags, max = 2) {
  const f = [...(flags || [])].sort((a, b) => FLAG_ORDER[a.kind] - FLAG_ORDER[b.kind]).slice(0, max);
  return f.length ? `<div class="flags">${f.map(x => `<span class="flag ${x.kind}">${esc(x.text)}</span>`).join("")}</div>` : "";
}

// Only flags serious enough for the front page; everything else lives on the deep dive.
const majorFlag = d => (d.flags || []).find(f => f.kind === "avy") || (d.flags || []).find(f => f.kind === "road" && /closed/i.test(f.text));

function tile(d) {
  const t = d.tomorrow, flag = majorFlag(d);
  const fresh = d.overnight >= 1 ? { n: d.overnight, l: "overnight" } : { n: d.s72, l: "last 3 days" };
  return `<button class="tile ${d.yes ? "yes" : "no"}" data-id="${d.id}" aria-label="${esc(d.name)}: today ${d.yes ? "yes" : "no"}${t ? `, ${dayName(t.date)} ${t.yes ? "yes" : "no"}` : ""}. ${Math.round(fresh.n)} inches ${fresh.l}.">
    <div class="name">${esc(d.name)}</div>
    <div class="verdict">${d.yes ? "YES" : "NO"}</div>
    <div class="meta">
      <span class="fresh"><b>${Math.round(fresh.n)}″</b> ${fresh.l}</span>
      ${t ? `<span class="tmr">${esc(dayName(t.date).slice(0, 3))} <b class="${t.yes ? "y" : "n"}">${t.yes ? "YES" : "NO"}</b></span>` : ""}
    </div>
    ${flag ? `<div class="flags"><span class="flag ${flag.kind}">${esc(flag.text)}</span></div>` : ""}
  </button>`;
}

/* ---------------- Charts ---------------- */
function axisDays(g, d, L, bw, H, B, T) {
  const t = DATA.todayIndex;
  d.series.dates.forEach((iso, i) => g.push(`<text x="${L + i * bw + bw / 2}" y="${H - B + 16}" text-anchor="middle" font-size="11" fill="${i === t ? "var(--ink)" : "var(--muted)"}" font-weight="${i === t ? 600 : 400}" font-family="${SANS}">${dayLabel(iso)}</text>`));
  const sx = L + (t + 1) * bw;
  g.push(`<line x1="${sx}" x2="${sx}" y1="${T - 6}" y2="${H - B + 4}" stroke="var(--muted)" stroke-dasharray="2 3"/><text x="${sx + 4}" y="${T}" font-size="10" fill="var(--muted)" font-family="${SANS}">FORECAST</text>`);
}
function barChart(d, values, { unit, step, threshold, thresholdLabel, label, rain }) {
  const W = 560, H = 180, L = 38, R = 8, T = 14, B = 34, n = values.length, bw = (W - L - R) / n, t = DATA.todayIndex;
  const peak = Math.max(step, ...values, threshold || 0);
  const max = Math.ceil(peak / step) * step, y = v => T + (H - T - B) * (1 - v / max), g = [];
  for (let v = 0; v <= max; v += max / 4) g.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="${MONO}">${Math.round(v)}${unit}</text>`);
  values.forEach((v, i) => {
    const x = L + i * bw + bw * .18, w = bw * .64, fc = i > t;
    if (v > 0) g.push(`<rect x="${x}" y="${y(v)}" width="${w}" height="${y(0) - y(v)}" rx="2" fill="${fc ? "var(--sky)" : "var(--tahoe)"}" ${fc ? 'stroke="var(--tahoe)" stroke-dasharray="3 2"' : ""}/>`);
    if (v >= .5) g.push(`<text x="${x + w / 2}" y="${y(v) - 4}" text-anchor="middle" font-size="11" fill="var(--ink)" font-family="${MONO}">${Math.round(v)}</text>`);
    if (rain?.[i]) g.push(`<text x="${x + w / 2}" y="${y(0) - 5}" text-anchor="middle" font-size="10" fill="var(--warn)" font-family="${SANS}">rain</text>`);
  });
  if (threshold) g.push(`<line x1="${L}" x2="${W - R}" y1="${y(threshold)}" y2="${y(threshold)}" stroke="var(--d3)" stroke-width="1.5" stroke-dasharray="5 3"/><text x="${W - R}" y="${y(threshold) - 4}" text-anchor="end" font-size="10" fill="var(--warn)" font-family="${SANS}">${thresholdLabel}</text>`);
  axisDays(g, d, L, bw, H, B, T);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${g.join("")}</svg>`;
}
function tempChart(d) {
  const W = 560, H = 180, L = 38, R = 8, T = 14, B = 34, { hi, lo } = d.series, n = hi.length, bw = (W - L - R) / n, t = DATA.todayIndex;
  const mn = Math.floor((Math.min(...lo) - 4) / 10) * 10, mx = Math.ceil((Math.max(...hi) + 4) / 10) * 10, y = v => T + (H - T - B) * (1 - (v - mn) / (mx - mn)), g = [];
  for (let v = mn; v <= mx; v += 10) g.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="${MONO}">${v}°</text>`);
  if (32 > mn && 32 < mx) g.push(`<line x1="${L}" x2="${W - R}" y1="${y(32)}" y2="${y(32)}" stroke="var(--tahoe)" stroke-width="1.5"/><text x="${W - R}" y="${y(32) - 4}" text-anchor="end" font-size="10" fill="var(--tahoe)" font-family="${SANS}">32°F</text>`);
  hi.forEach((a, i) => {
    const cx = L + i * bw + bw / 2;
    g.push(`<line x1="${cx}" x2="${cx}" y1="${y(a)}" y2="${y(lo[i])}" stroke="var(--ink)" stroke-width="${bw * .32}" stroke-linecap="round" opacity="${i > t ? .35 : .85}"/><text x="${cx}" y="${y(a) - 7}" text-anchor="middle" font-size="10.5" fill="var(--ink)" font-family="${MONO}">${a}</text>`);
  });
  axisDays(g, d, L, bw, H, B, T);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily high and low temperature where you'd ski">${g.join("")}</svg>`;
}

/* Elevation profile: the mountain, the band you ski, and where the storm's rain line sat */
function profile(d) {
  const b = d.bands, sl = d.snowLine;
  const W = 320, H = 230, L = 58, R = 108, T = 14, Bm = 14;
  const lo = Math.min(b.bottom, sl?.line ?? b.bottom) - 300, hi = b.top + 250;
  const y = e => T + (H - T - Bm) * (1 - (e - lo) / (hi - lo));
  const x0 = L, x1 = W - R, peakX = x0 + (x1 - x0) * .58;
  const ridge = `M${x0},${y(b.bottom)} L${x0 + (x1 - x0) * .2},${y(b.bottom + (b.top - b.bottom) * .35)} L${x0 + (x1 - x0) * .34},${y(b.bottom + (b.top - b.bottom) * .55)} L${x0 + (x1 - x0) * .44},${y(b.bottom + (b.top - b.bottom) * .5)} L${peakX},${y(b.top)} L${x0 + (x1 - x0) * .78},${y(b.bottom + (b.top - b.bottom) * .62)} L${x1},${y(b.bottom + (b.top - b.bottom) * .3)} L${x1},${y(lo)} L${x0},${y(lo)} Z`;
  const g = [`<defs><clipPath id="mtn"><path d="${ridge}"/></clipPath><pattern id="rainhatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--no)" stroke-width="2"/></pattern></defs>`];
  g.push(`<g clip-path="url(#mtn)"><rect x="0" y="0" width="${W}" height="${H}" fill="var(--sky)"/>`);
  if (sl && sl.line > lo) g.push(`<rect x="0" y="${y(sl.line)}" width="${W}" height="${H}" fill="url(#rainhatch)" opacity=".7"/>`);
  g.push(`</g><path d="${ridge}" fill="none" stroke="var(--ink)" stroke-width="1.5" stroke-linejoin="round"/>`);
  // core band bracket
  const bx = x1 + 10;
  g.push(`<path d="M${bx},${y(b.coreHi)} h6 V${y(b.coreLo)} h-6" fill="none" stroke="var(--tahoe)" stroke-width="2.5"/><text x="${bx + 12}" y="${(y(b.coreHi) + y(b.coreLo)) / 2 - 2}" font-size="11" font-weight="600" fill="var(--tahoe)" font-family="${SANS}">Most of</text><text x="${bx + 12}" y="${(y(b.coreHi) + y(b.coreLo)) / 2 + 11}" font-size="11" font-weight="600" fill="var(--tahoe)" font-family="${SANS}">the skiing</text>`);
  // elevation labels
  for (const [e, lbl] of [[b.top, "Top"], [b.bottom, d.kind === "resort" ? "Base" : "Trailhead"]]) g.push(`<text x="${L - 6}" y="${y(e) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="${MONO}">${ftf(e)}</text><text x="${L - 6}" y="${y(e) + 16}" text-anchor="end" font-size="9.5" fill="var(--muted)" font-family="${SANS}">${lbl}</text>`);
  if (sl) g.push(`<line x1="${L - 2}" x2="${W - 4}" y1="${y(sl.line)}" y2="${y(sl.line)}" stroke="var(--warn)" stroke-width="2" stroke-dasharray="6 4"/><text x="${W - 4}" y="${y(sl.line) - 6}" text-anchor="end" font-size="11" font-weight="600" fill="var(--warn)" font-family="${SANS}">Rain line ${ftf(sl.line)}</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Elevation profile with the storm's rain line">${g.join("")}</svg>`;
}

/* Wind rose: wind direction arrow, loaded (lee) and scoured (windward) aspects */
function rose(w) {
  const S = 200, c = S / 2, r = 72, ri = 26, g = [];
  ASPECTS.forEach((a, i) => {
    const a0 = (i * 45 - 22.5 - 90) * Math.PI / 180, a1 = (i * 45 + 22.5 - 90) * Math.PI / 180;
    const p = (rad, rr) => `${c + rr * Math.cos(rad)},${c + rr * Math.sin(rad)}`;
    const loaded = w.loaded.includes(a), scoured = w.scoured.includes(a);
    g.push(`<path d="M${p(a0, ri)} L${p(a0, r)} A${r},${r} 0 0 1 ${p(a1, r)} L${p(a1, ri)} A${ri},${ri} 0 0 0 ${p(a0, ri)} Z" fill="${loaded ? "var(--tahoe)" : scoured ? "var(--line)" : "var(--sky)"}" stroke="var(--card)" stroke-width="2"/>`);
    const mid = (i * 45 - 90) * Math.PI / 180;
    g.push(`<text x="${c + (r + 14) * Math.cos(mid)}" y="${c + (r + 14) * Math.sin(mid) + 4}" text-anchor="middle" font-size="11" font-weight="${loaded ? 700 : 500}" fill="${loaded ? "var(--tahoe)" : "var(--muted)"}" font-family="${SANS}">${a}</text>`);
  });
  if (w.top.dir != null) {
    const rad = (w.top.dir - 90) * Math.PI / 180, ox = c + (r - 4) * Math.cos(rad), oy = c + (r - 4) * Math.sin(rad), ix = c + (ri + 4) * Math.cos(rad), iy = c + (ri + 4) * Math.sin(rad);
    g.push(`<defs><marker id="ah" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="var(--ink)"/></marker></defs><line x1="${ox}" y1="${oy}" x2="${ix}" y2="${iy}" stroke="var(--ink)" stroke-width="3" marker-end="url(#ah)"/>`);
  }
  g.push(`<text x="${c}" y="${c + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ink)" font-family="${MONO}">${w.top.gust}</text>`);
  return `<svg viewBox="0 0 ${S} ${S}" class="rose" role="img" aria-label="Wind from the ${w.top.from || "unknown"}, loading ${w.loaded.join(", ")} aspects">${g.join("")}</svg>`;
}

/* ---------------- Detail ---------------- */
function detail(d) {
  const A = DATA.avalanche, region = DATA.regions.find(r => r.id === d.region)?.name || "";
  const elev = d.kind === "resort" && d.base ? `${d.base.toLocaleString()}–${d.top.toLocaleString()} ft` : `${d.trailhead ? `${d.trailhead.toLocaleString()} → ` : ""}${d.top.toLocaleString()} ft`;
  const sl = d.snowLine, w = d.wind, t = d.tomorrow;

  const snowLinePanel = `
    <div class="panel"><h3>Snow line</h3>
      <div class="two">
        <div class="chart small">${profile(d)}</div>
        <div class="col">
          ${sl ? `<div class="big-line">${sl.hit === "none" ? "All snow" : sl.hit === "bottom" ? "Rain stayed low" : sl.hit === "lower" ? "Rain down low" : "Rained up high"}</div>
          <div>The last storm's rain line sat around <b>${ftf(sl.line)} ft</b>. ${sl.pctAbove}% of the ${d.kind === "resort" ? "mountain" : "route"} was above it.</div>
          <div class="rainrow"><span><b>${sl.rainAt.top}%</b> rain on top</span><span><b>${sl.rainAt.core}%</b> mid-${d.kind === "resort" ? "mountain" : "route"}</span><span><b>${sl.rainAt.bottom}%</b> at the ${d.kind === "resort" ? "base" : "trailhead"}</span></div>` : `<div>No precipitation in the last week.</div>`}
          ${d.density ? `<div class="foot">New snow fell ${esc(d.density)}.</div>` : ""}
        </div>
      </div>
    </div>`;

  const windPanel = `
    <div class="panel"><h3>Wind · ski hours</h3>
      <div class="two">
        ${rose(w)}
        <div class="col">
          <div class="big-line">${w.top.gust} mph${w.top.from ? ` <small>from ${w.top.from}</small>` : ""}</div>
          <div>Summit gusts today. Mid-${d.kind === "resort" ? "mountain" : "route"} ${w.core.gust} mph.</div>
          ${w.loaded.length ? `<div>Three days of ${esc(w.loadFrom)} wind have <b>loaded ${w.loaded.join("–")}</b> aspects and <b>scoured ${w.scoured.join("–")}</b>.</div>` : ""}
          ${d.kind === "tour" ? `<div class="foot">Skin track: ${esc(d.skinTrack || "unknown")}. ${d.skinTrack === "sheltered" ? "Trees block most of it until the top." : "Open to the wind most of the way."}</div>` : ""}
          ${t?.wind ? `<div class="foot">${esc(dayName(t.date))}: gusts ${t.wind.top.gust} mph${t.wind.top.from ? ` from ${t.wind.top.from}` : ""}.</div>` : ""}
        </div>
      </div>
      <div class="chart">${barChart(d, d.series.gustTop, { unit: "", step: 20, threshold: d.kind === "resort" ? 50 : 40, thresholdLabel: d.kind === "resort" ? "Upper lift holds" : "Too windy if exposed", label: "Daily summit gusts during ski hours" })}</div>
      <div class="foot">Peak summit gust, 9 am to 4 pm, mph</div>
    </div>`;

  const tmrPanel = t ? `
    <div class="panel tomorrow"><h3>${esc(dayName(t.date))}</h3>
      <div class="tmr-big"><div class="badge mini ${t.yes ? "yes" : "no"}">${t.yes ? "YES" : "NO"}</div><div><div class="big-line">${esc(t.why)}</div><div>${Math.round(t.snow)}″ forecast${t.overnight >= 1 ? `, ${Math.round(t.overnight)}″ of it overnight` : ""}. Surface: ${esc(t.surface)}.</div></div></div>
      <div class="foot">From the forecast. Lift status and the avalanche rating are carried over from today.</div>
    </div>` : "";

  const roads = d.routes.length ? `
    <div class="panel"><h3>Getting there</h3>
      <div class="routes">${d.routes.map(r => { const s = DATA.roads?.[String(r).match(/\d+/)?.[0]]; const st = !DATA.roads ? "Unknown" : s ? (s.status === "CLOSED" ? "Closed" : s.status === "R0" ? "Open" : `Chains ${s.status}`) : /^NV/.test(r) ? "Not checked" : "Open"; const cls = /Closed/.test(st) ? "bad" : /Chains/.test(st) ? "warn" : /Open/.test(st) ? "ok" : ""; return `<div class="route"><span class="shield">${esc(r)}</span><span class="rs ${cls}">${st}</span>${s?.where ? `<span class="foot">near ${esc(s.where)}</span>` : ""}</div>`; }).join("")}</div>
      <div class="foot">Caltrans chain controls: R1 chains or snow tires, R2 chains unless 4WD with snow tires, R3 chains on everything.</div>
    </div>` : "";

  const recentObs = (d.flags || []).find(f => f.kind === "avy");
  const avy = d.kind === "tour" ? `
    <div class="panel"><h3>Avalanche</h3>
      ${recentObs ? `<div class="alert">Avalanche reported nearby in the last 3 days. <a href="${esc(recentObs.link)}" target="_blank" rel="noopener">See the observation</a></div>` : ""}
      ${A ? `<div class="bands">${[["atl", "Above treeline"], ["ntl", "Near treeline"], ["btl", "Below treeline"]].map(([k, l]) => `<div class="band"><span>${l}</span><i style="background:${dColor(A[k])}"></i><span><b>${A[k] ? `${A[k]} · ${DNAME[A[k]]}` : "No rating"}</b>${k === d.band ? ' <span class="label">· tops out here</span>' : ""}</span></div>`).join("")}</div>
      <div class="problems">${A.problems.map(p => `<div><b>${esc(p.name)}</b>${p.where ? ` · ${esc(p.where)}` : ""}${p.detail ? `<br><span style="color:var(--muted)">${esc(p.detail)}</span>` : ""}</div>`).join("")}</div>
      <a href="${esc(A.link)}" target="_blank" rel="noopener">Read the full SAC forecast</a>` : `<div>The forecast didn't load this run.</div>`}
    </div>` : "";

  const L = d.lifts;
  const lifts = d.kind === "resort" ? `
    <div class="panel"><h3>Lifts & terrain</h3>
      <div class="stats">
        <div class="stat"><span class="label">Lifts</span><span class="v">${L?.liftsTotal ? `${L.liftsOpen}<small>/${L.liftsTotal}</small>` : "–"}</span></div>
        <div class="stat"><span class="label">Terrain</span><span class="v">${L?.terrainPct != null ? `${L.terrainPct}<small>%</small>` : "–"}</span></div>
      </div>
      <div class="foot">Source: ${esc(L?.source || "none")}${L?.note ? ` · ${esc(L.note)}` : ""}</div>
    </div>` : "";

  app.innerHTML = `
  <button class="back" id="back">← All of Tahoe</button>
  <div class="d-head">
    <div style="min-width:0"><div class="label">${d.kind === "resort" ? "Resort" : "Touring"} · ${esc(region)}</div><h1>${esc(d.name)}</h1><div class="sub">${elev}${d.note ? ` · ${esc(d.note)}` : ""}</div></div>
    <div class="badge ${d.yes ? "yes" : "no"}">${d.yes ? "YES" : "NO"}</div>
  </div>
  <div class="qual">${esc(d.qual)}</div>
  ${flagPills(d.flags, 6)}
  <div class="panels">
    <div class="panel"><h3>Snow</h3>
      <div class="stats">
        <div class="stat"><span class="label">Overnight</span><span class="v">${Math.round(d.overnight)}<small>″</small></span></div>
        <div class="stat"><span class="label">72 hr</span><span class="v">${Math.round(d.s72)}<small>″</small></span></div>
        <div class="stat"><span class="label">7 day</span><span class="v">${Math.round(d.s7)}<small>″</small></span></div>
        <div class="stat"><span class="label">Base</span><span class="v">${d.depth}<small>″</small></span></div>
      </div>
      <div class="chart">${barChart(d, d.series.snow, { unit: "″", step: 4, label: "Daily snowfall where you'd ski", rain: d.series.rain })}</div>
      <div class="foot">Snowfall at ${ftf(d.bands.core)} ft, mid-${d.kind === "resort" ? "mountain" : "route"} · ${Math.round(d.fc5)}″ in the 5-day forecast · base from ${esc(d.depthSource)}</div>
    </div>
    ${snowLinePanel}
    ${tmrPanel}
    ${windPanel}
    <div class="panel"><h3>Surface call</h3>
      <div class="surf-big">${esc(d.surface)}</div>
      <div>${esc(d.surfWhy)}</div>
      <div class="chart">${tempChart(d)}</div>
      <div class="foot">Highs and lows at ${ftf(d.bands.core)} ft</div>
    </div>
    ${lifts}${avy}${roads}
    <div class="panel"><h3>How the call was made</h3>
      <ul class="trace">${d.trace.map(x => `<li><span class="mk ${x.s}">${x.s === "ok" ? "✓" : x.s === "bad" ? "✕" : "!"}</span><span>${esc(x.t)}<small>${esc(x.d)}</small></span></li>`).join("")}</ul>
    </div>
  </div>`;
  document.getElementById("back").onclick = () => { location.hash = ""; };
  window.scrollTo(0, 0);
}

function route() {
  if (!DATA) return;
  const id = location.hash.replace("#", "");
  BYID[id] ? detail(BYID[id]) : home();
}
window.addEventListener("hashchange", route);

(window.__TAHOE_DATA__ ? Promise.resolve({ ok: true, json: () => window.__TAHOE_DATA__ }) : fetch("data.json", { cache: "no-store" }))
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(j => { DATA = j; BYID = Object.fromEntries(j.locations.map(l => [l.id, l])); route(); })
  .catch(() => { app.innerHTML = `<header class="hero"><div class="bumper"><h1><small>Is Tahoe</small>In?</h1></div><div class="notice">Conditions didn't load. Refresh in a minute; the data rebuilds every 30 minutes.</div></header>`; });
