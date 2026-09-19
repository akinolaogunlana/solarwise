# Solar pSEO Platform

A programmatic SEO platform for solar/energy calculators — battery runtime, solar
panel output, appliance electricity cost, real per-state location data, and 8
standalone calculators (system sizing, inverter sizing, EV charging cost, etc.).

## Architecture

```
data/*.json          -> the single source of truth for all entities
src/calc-engine/      -> pure calculation functions, unit tested, zero I/O
src/pseo/generate.ts  -> the static site generator, produces /dist
src/pseo/verify.ts    -> post-build verification: recomputes every displayed
                         number independently and diffs against the engine
src/pseo/ai-content.ts -> optional Gemini-generated supporting text (see below)
dist/                 -> build output (regenerate any time, don't hand-edit)
```

## Quick start

```bash
npm install
npm run build:verified   # typecheck -> unit tests -> build -> numeric verification
```

## AI-generated supporting content (optional, one-time authoring)

Every page type (battery, panel, appliance, location hub, and the location-crossed
combinations) can show a short, unique AI-written paragraph. This is a genuine
one-time authoring pass, not a live build-time dependency:

**The regular build (`npm run build`) NEVER calls Gemini.** It only reads whatever
`npm run ai:generate` has already written to `data/ai-content-cache.json`. With
an empty or missing cache, the site builds exactly as it always has — same 380
pages, same speed, zero API cost, zero network dependency on Google.

**To author content (run this once, or whenever you add new data):**
```bash
npm run ai:plan       # free - shows how many pieces would be generated, no API call
export GEMINI_API_KEY=your-real-key-here
npm run ai:generate   # the only command that actually calls Gemini
npm run build         # bakes the generated content into the static pages
```

Currently plans **365 content pieces** (9 batteries + 8 panels + 8 appliances +
20 location hubs + 160 panel-location + 160 appliance-location combinations).
`npm run ai:plan` shows this breakdown without spending anything.

**Safety mechanisms, in order:**
1. **Idempotent** — already-generated content for unchanged facts is never
   regenerated, so re-running after adding 5 new states only pays for those 5.
2. **Fact-hashed** — each cache entry is keyed to a hash of the exact real
   numbers it was written from. If you later change a state's rate or add a
   different appliance wattage, that specific cached entry becomes stale and
   is silently omitted from the page (not shown with outdated numbers) until
   you re-run `ai:generate`.
3. **Fact-checked at generation time** — every number the model writes is
   checked against the real facts it was given; anything unrecognized prints
   a console warning for manual review (`checkFactualDrift` in `ai-content.ts`).
   This is a heuristic, not a guarantee.
4. **Visibly disclosed** — every AI section on the live site carries a visible
   disclosure sentence. Don't remove it without checking your jurisdiction's
   requirements for AI-generated content disclosure.

**What has and hasn't been verified:** the job-planning logic (`npm run ai:plan`,
confirmed to correctly enumerate 365 jobs), caching, fact-hashing, staleness
detection, and fail-open behavior are all covered by real tests
(`src/pseo/ai-content.test.ts`) and were also confirmed end-to-end with seeded
mock responses — including one deliberate facts-mismatch test that correctly
resulted in content being omitted rather than shown incorrectly. **The actual
live network call to Gemini has not been tested** — this environment can't
reach `generativelanguage.googleapis.com`. That specific piece needs a real
API key and a real run of `npm run ai:generate` to confirm.

## Editing data via spreadsheet (CSV import)

`data/csv/*.csv` is the human-editable authoring format — open it directly in
Excel, Google Sheets, or any spreadsheet tool. `data/*.json` is the format
`generate.ts` actually reads; the import step converts one into the other.

```bash
npm run data:import   # validates data/csv/*.csv, writes data/*.json
npm run build:verified
```

**Safety property, tested directly:** if any row in any CSV fails validation,
**nothing is written** — the existing JSON stays exactly as it was. Confirmed
this by deliberately corrupting a CSV (a non-numeric value, a duplicate slug)
and hashing the JSON file before and after the failed import: identical hash,
proving a bad spreadsheet edit cannot corrupt working production data.

**What gets validated per row:**
- All required columns present and non-empty
- Numeric columns actually parse as numbers
- No duplicate identifying keys (battery voltage+capacity, panel wattage, appliance/location slug)
- Location source URLs must look like real URLs (`http...`) — a location without
  a real citation cannot import, even if the numbers look plausible
- Appliance `hoursPerDayTypical` can't exceed 24

**Round-trip fidelity confirmed:** the current CSVs were generated from the
existing JSON, then re-imported and diffed byte-for-byte against the original —
identical across all 4 files, 45 total rows, zero data loss.

**A real parsing edge case found and fixed:** `solar-panels.csv` has only one
column (`wattage`), which broke the CSV parser's delimiter auto-detection (no
comma anywhere to detect a delimiter from). Fixed by specifying the delimiter
explicitly rather than relying on auto-detection — worth knowing if you add
another single-column file later.

## Deploying

Same pattern as the reference project: push to GitHub, connect the repo on
Vercel. `vercel.json` sets the build command to `npm run build:verified` —
typecheck, unit tests, build, and 1,000+ numeric checks all have to pass
before a deploy can succeed. A GitHub Actions workflow
(`.github/workflows/ci.yml`) runs the same check independently on every push
and pull request.

## Design

Self-hosted fonts (Sora for headings, IBM Plex Sans for body, IBM Plex Mono
for numeric output) — zero external requests, verified directly against the
built site. Calculator results render in a dark "digital readout" panel,
deliberately distinct from the rest of the page's flat, quiet styling — the
one bold visual choice, tied to the subject matter (multimeters, power
meters) rather than decoration for its own sake.

## Known limitations

- Only 20 of 51 US states have real location data (peak sun hours + electricity
  rate), each independently sourced and dated — see `data/locations.json`.
  Expanding further needs either a real NREL API key or additional secondary-source
  research; nothing here is fabricated.
- Not deployed. This exists as generated `dist/` output only.
- No database, admin dashboard, or CSV import pipeline — data is hand-authored JSON.
