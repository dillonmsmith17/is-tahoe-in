# Is Tahoe In?

Yes or no for every Tahoe resort and touring zone, rebuilt every 30 minutes.

## How it works

```
config/locations.json     24 spots: coords, elevations, SNOTEL station, lift-status ids
config/manual-status.json hand overrides (lift status, road closures)
src/sources/openmeteo.js  hourly + daily weather at two points per spot (core band and summit), incl. freezing level and wind direction
src/sources/snotel.js     snow depth from the nearest NRCS SNOTEL station
src/sources/avalanche.js  Sierra Avalanche Center danger by band + problems (avalanche.org API)
src/sources/lifts.js      lift/terrain status: Vail site adapter -> Liftie API -> manual overrides
src/sources/roads.js      Caltrans chain controls (R1–R3) and full closures; NV-431 needs NV511_KEY
src/sources/avyobs.js     SAC observations that report an avalanche (last 3 days)
src/bands.js              each spot's elevation bands: base/trailhead, core skiing band, top
src/engine.js             the verdict rules (thresholds in RULES at the top), today + tomorrow
src/build.js              runs everything, writes public/data.json, copies the site
site/                     the page (index.html + app.js), reads data.json
```

Any one source can fail without breaking the build; the site lists what didn't respond.

## Run it

Requires Node 20+. No dependencies.

```
npm test          # engine + parser tests (offline)
npm run demo      # build public/ from the sample storm, offline
npm run probe     # hit every real source and every resort id, report what works
npm run build     # real build
npm run serve     # preview public/ at localhost:3000
```

## First run: do this before going public

`npm run probe` checks each item below. Expect to fix a few.

1. **SNOTEL triplets.** Station numbers in `locations.json` are best-known values; any that come back empty need the right triplet from the NRCS station list.
2. **Liftie ids.** Each resort lists candidate ids; the probe shows which one answers. Liftie covers lifts only, not trails.
3. **Vail adapter** (Heavenly, Northstar, Kirkwood). It reads the `TerrainStatusFeed` object embedded in their terrain-status pages. If Vail has changed the page, the probe says so and Liftie takes over.
4. **Resorts with no feed.** Add an adapter in `lifts.js` (same shape as `parseVail`), or set them in `manual-status.json`.

## Deploy (GitHub Pages)

1. Push this folder to a new GitHub repo.
2. Settings → Pages → Source: **GitHub Actions**.
3. The workflow in `.github/workflows/update.yml` runs tests, builds and deploys on every push and every 30 minutes. Trigger it once from the Actions tab.
4. Custom domain: add it under Settings → Pages and point DNS at GitHub.

## What drives the call

- **Snow line.** For the most recent storm, the engine finds the rain line (highest elevation where 25%+ fell as rain) and compares it to the base, the core skiing band and the top. Rain over most of the core band is a NO (rain crust or rain-soaked); rain on the lower mountain is a flag and a "stay above X ft" note.
- **Overnight.** Snow from 4 pm yesterday to 8 am today at the core band leads the tile when it's 3" or more.
- **Wind.** Ski-hours (9–4) gusts at the summit and core. Resorts: summit 50+ flags upper-lift holds, core 60+ is a NO. Touring: summit 40+ is a NO on an exposed skin track and a flag on a sheltered one; core 55+ is a NO. Three days of wind direction give loaded and scoured aspects.
- **Roads.** Chain controls flag the tile; a full closure on any listed approach route is a NO.
- **Recent avalanches.** An avalanche reported within 10 km in the last 72 h shows up; within 48 h with Considerable+ danger it's a NO.
- **Tomorrow.** Same engine on forecast data, carrying over today's lift status and avalanche rating.

`skinTrack` (sheltered/exposed), `trailhead`, `routes` and the optional `core` band in `locations.json` are starting guesses. Tune them; you know these tours better than any model.

## Tuning the call

All thresholds live in `RULES` in `src/engine.js`: minimum base (resort 14", touring 20"), powder window (8" in 72 h, summit high ≤ 34°F), wind (45 mph gusts above 8,500 ft), minimum lifts (2), and the avalanche veto (High or above at the tour's top band). Change a number, run `npm test`, and the tests show what moved.

## Etiquette

Scrape every 30 minutes at most, identify yourself in the user agent (`src/http.js`), and show status rather than copying resort content. Check each resort's terms before launching publicly. Liftie's hosted API is a community service; if traffic grows, self-host it.
