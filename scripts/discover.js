// One-off discovery: find where each resort publishes lift status. Run via the "Discover lift sources" workflow.
import { get } from "../src/http.js";

const SITES = {
  "sugar-bowl": "https://www.sugarbowl.com/",
  "boreal": "https://www.rideboreal.com/",
  "mt-rose": "https://skirose.com/",
  "sierra": "https://www.sierraattahoe.com/",
  "homewood": "https://www.skihomewood.com/",
  "diamond-peak": "https://www.diamondpeak.com/",
  "tahoe-donner": "https://www.tahoedonner.com/",
  "donner-ski-ranch": "https://www.donnerskiranch.com/"
};
const PAGE_RX = /lift|condition|snow-?report|mountain-?report|terrain|status|grooming|trail-?report/i;
const FEED_RX = /https?:\/\/[^"'\s<>()]+?(?:api|\.json|feed|graphql|wp-json|ajax|widget|dor|report)[^"'\s<>()]*/gi;
const VENDOR_RX = /mtnpowder|mtnfeed|snocountry|inntopia|resortsuite|lumiplan|skilynx|siriusware|skiresort|onthesnow|liftopia|trailmap|conditions-widget|powdr|wp-json|drupal|__NEXT_DATA__|nuxt|graphql/gi;

const uniq = a => [...new Set(a)];
const strip = s => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

async function page(url) {
  const html = await get(url, { type: "html", browser: true, retries: 0, timeoutMs: 25000 });
  const text = strip(html);
  return {
    html, text,
    links: uniq([...html.matchAll(/href="([^"#]+)"/gi)].map(m => { try { return new URL(m[1], url).href; } catch { return null; } }).filter(Boolean)),
    feeds: uniq((html.match(FEED_RX) || []).map(u => u.replace(/&amp;/g, "&"))).filter(u => !/\.(css|png|jpg|svg|woff2?)(\?|$)/i.test(u)).slice(0, 25),
    vendors: uniq((html.match(VENDOR_RX) || []).map(v => v.toLowerCase())),
    scripts: uniq([...html.matchAll(/<script[^>]+src="([^"]+)"/gi)].map(m => m[1])).filter(s => !/google|facebook|gtm|analytics|hotjar|doubleclick|cookie|onetrust|jquery/i.test(s)).slice(0, 15),
    openWords: (text.match(/\bopen\b/gi) || []).length, closedWords: (text.match(/\bclosed\b/gi) || []).length
  };
}

for (const [id, home] of Object.entries(SITES)) {
  console.log(`\n=== ${id} (${home})`);
  let p;
  try { p = await page(home); } catch (e) { console.log(`  home: ${e.message}`); continue; }
  const host = new URL(home).host.replace(/^www\./, "");
  const cands = p.links.filter(l => l.includes(host) && PAGE_RX.test(new URL(l).pathname)).slice(0, 6);
  console.log(`  home ok, ${p.html.length} bytes, vendors [${p.vendors.join(", ")}]`);
  console.log(`  candidate pages: ${cands.join("  ") || "none"}`);
  for (const c of cands.slice(0, 4)) {
    try {
      const q = await page(c);
      console.log(`  -- ${c}: ${q.html.length} bytes, "open"x${q.openWords} "closed"x${q.closedWords}, vendors [${q.vendors.join(", ")}]`);
      if (q.feeds.length) console.log(`     feeds: ${q.feeds.join("  ")}`);
      if (q.scripts.length) console.log(`     scripts: ${q.scripts.join("  ")}`);
      const m = q.text.match(/.{0,120}\b(lift|chair)s?\b.{0,200}/i);
      if (m) console.log(`     text: ${m[0].trim().slice(0, 320)}`);
    } catch (e) { console.log(`  -- ${c}: ${e.message}`); }
  }
}

console.log("\n=== Boreal POWDR API");
for (const k of ["lifts", "trails"]) {
  try {
    const j = await get(`https://api.rideboreal.com/api/v1/dor/drupal/${k}`, { browser: true, retries: 0 });
    const a = Array.isArray(j) ? j : j?.data || [];
    const cnt = a.reduce((m, x) => (m[x.status] = (m[x.status] || 0) + 1, m), {});
    console.log(`  ${k}: ${a.length} items, statuses ${JSON.stringify(cnt)}`);
    if (a[0]) console.log(`  sample: ${JSON.stringify(a[0]).slice(0, 500)}`);
  } catch (e) { console.log(`  ${k}: ${e.message}`); }
}
