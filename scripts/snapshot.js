// Saves each resort's lift-status page to snapshots/ so parsers can be built and tested against real markup.
import { mkdir, writeFile } from "node:fs/promises";
import { get } from "../src/http.js";

export const PAGES = {
  "sugar-bowl": ["https://www.sugarbowl.com/conditions", "https://www.sugarbowl.com/js/conditions_vars.js.cfm"],
  "boreal": ["https://api.rideboreal.com/api/v1/dor/drupal/lifts", "https://api.rideboreal.com/api/v1/dor/drupal/trails"],
  "mt-rose": ["https://skirose.com/snow-report/", "https://skirose.com/snow-report-lite/"],
  "sierra": ["https://sierraattahoe.com/lifts-trails-grooming/"],
  "homewood": ["https://skihomewood.com/snowreport/"],
  "diamond-peak": ["https://www.diamondpeak.com/the-mountain/mountain-report/"],
  "tahoe-donner": ["https://www.tahoedonner.com/amenities/amenities/downhill-ski/trails-conditions/conditions/"],
  "donner-ski-ranch": ["https://www.donnerskiranch.com/liftstatus"]
};

await mkdir("snapshots", { recursive: true });
for (const [id, urls] of Object.entries(PAGES)) {
  for (const [i, url] of urls.entries()) {
    try {
      const body = await get(url, { type: "html", browser: true, retries: 0, timeoutMs: 30000 });
      const ext = /\.json|api\./.test(url) ? "json" : /\.js/.test(url) ? "js" : "html";
      await writeFile(`snapshots/${id}-${i}.${ext}`, body);
      console.log(`saved ${id}-${i}.${ext} (${body.length} bytes) from ${url}`);
    } catch (e) { console.log(`FAILED ${id} ${url}: ${e.message}`); }
  }
}
