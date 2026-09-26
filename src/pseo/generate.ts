import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readCachedContent } from './ai-content.ts';
import {
  calculateBatteryRuntime,
  calculateSolarPanelOutput,
  calculateApplianceConsumption,
  calculateElectricityCost,
  calculateSolarSystemSize,
  calculatePanelCount,
  calculateBatteryCapacity,
  calculateInverterSize,
  calculateChargeControllerSize,
  calculateSolarSavings,
  calculateSolarPayback,
  calculateSolarROI,
  calculateGeneratorSize,
  calculateEVChargingCost
} from '../calc-engine/index.ts';
import {
  SITE_NAME, SITE_URL, buildTitle, breadcrumbLd, faqLd, webApplicationLd,
  itemListLd, pageHead, pageFoot, websiteLd, organizationLd
} from './seo.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');
const OUT = path.join(ROOT, 'dist');
const BUILD_DATE = new Date().toISOString().slice(0, 10);

interface Battery {
  voltage: number;
  capacityAh: number;
  chemistry: string;
}

interface SolarPanel {
  wattage: number;
}

interface Appliance {
  slug: string;
  name: string;
  wattsTypical: number;
  wattsStarting: number;
  hoursPerDayTypical: number;
  isEstimated: boolean;
}

interface Location {
  slug: string;
  name: string;
  nameShort?: string; // used only in <title> tags where length is tight; falls back to name
  peakSunHours: number;
  sunSource: string;
  sunSourceUrl: string;
  sunCollectedAt: string;
  electricityRateCentsPerKwh: number;
  rateSource: string;
  rateSourceUrl: string;
  rateCollectedAt: string;
}

function titleName(loc: Location): string {
  return loc.nameShort || loc.name;
}

const batteries: Battery[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/batteries.json'), 'utf8'));
const panels: SolarPanel[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/solar-panels.json'), 'utf8'));
const appliances: Appliance[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/appliances.json'), 'utf8'));
const locations: Location[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/locations.json'), 'utf8'));

const batteryUrls: string[] = [];
const panelUrls: string[] = [];
const applianceUrls: string[] = [];
const locationUrls: string[] = [];
const otherUrls: string[] = [];
let noindexedCount = 0; // pages that exist as real files but are excluded from the sitemap

// ---------- Validation (fail loudly, never generate silently-broken pages) ----------
function validateData() {
  const errors: string[] = [];
  const seenBatterySlugs = new Set<string>();
  for (const b of batteries) {
    const slug = `${b.voltage}v-${b.capacityAh}ah`;
    if (seenBatterySlugs.has(slug)) errors.push(`Duplicate battery slug: ${slug}`);
    seenBatterySlugs.add(slug);
    if (!(b.voltage > 0) || !(b.capacityAh > 0)) errors.push(`Battery has invalid voltage/capacity: ${JSON.stringify(b)}`);
  }
  const seenPanelSlugs = new Set<string>();
  for (const p of panels) {
    const slug = `${p.wattage}w`;
    if (seenPanelSlugs.has(slug)) errors.push(`Duplicate panel slug: ${slug}`);
    seenPanelSlugs.add(slug);
    if (!(p.wattage > 0)) errors.push(`Panel has invalid wattage: ${JSON.stringify(p)}`);
  }
  const seenApplianceSlugs = new Set<string>();
  for (const a of appliances) {
    if (seenApplianceSlugs.has(a.slug)) errors.push(`Duplicate appliance slug: ${a.slug}`);
    seenApplianceSlugs.add(a.slug);
    if (!a.name || !(a.wattsTypical > 0)) errors.push(`Appliance missing required fields: ${JSON.stringify(a)}`);
    if (a.isEstimated === undefined) errors.push(`Appliance "${a.slug}" must explicitly declare isEstimated (true/false) - no silent defaults on data provenance`);
  }
  const seenLocationSlugs = new Set<string>();
  for (const loc of locations) {
    if (seenLocationSlugs.has(loc.slug)) errors.push(`Duplicate location slug: ${loc.slug}`);
    seenLocationSlugs.add(loc.slug);
    if (!(loc.peakSunHours > 0) || !loc.sunSource || !loc.sunSourceUrl) errors.push(`Location "${loc.slug}" missing sun data or source citation`);
    if (!(loc.electricityRateCentsPerKwh > 0) || !loc.rateSource || !loc.rateSourceUrl) errors.push(`Location "${loc.slug}" missing rate data or source citation`);
  }
  if (errors.length) {
    console.error(`\nBuild failed — ${errors.length} data problem(s):\n`);
    errors.forEach(e => console.error(`  ✗ ${e}`));
    process.exit(1);
  }
}

function write(relPath: string, content: string) {
  const full = path.join(OUT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function header(crumbs: string): string {
  return `<header class="site"><div class="wrap">
  <a class="wordmark" href="/">${SITE_NAME}</a>
  <nav class="crumbs">${crumbs}</nav>
</div></header>`;
}

function footer(): string {
  return `<footer class="site"><div class="wrap">
  Calculations use documented formulas and disclosed assumptions — see each page for details. Not a substitute for a licensed electrician's load calculation.
</div></footer>`;
}

function adSlot(label: string): string {
  return `<div class="ad-slot">[ ${label} — drop your ad unit here ]</div>`;
}

// ---------- Cross-cluster linking (section 13) ----------
// Every detail page links toward the OTHER two calculator types, not just siblings
// within its own cluster — this is what turns 3 isolated clusters into one connected
// topical graph instead of 3 unrelated mini-sites.
function crossClusterLinks(current: 'battery' | 'panel' | 'appliance'): string {
  const all = [
    { key: 'battery', label: 'Battery Runtime Calculators', href: '/battery/' },
    { key: 'panel', label: 'Solar Panel Output Calculators', href: '/solar-panel/' },
    { key: 'appliance', label: 'Appliance Electricity Cost Calculators', href: '/appliance/' }
  ];
  const others = all.filter(c => c.key !== current);
  const links = others.map(c => `<a href="${c.href}">${c.label}</a>`).join('\n');
  return `<div class="related">
    <h2>Related calculators</h2>
    <div class="pill-list">${links}</div>
  </div>`;
}

// ---------- Sources & assumptions disclosure (section 26 requirement) ----------
function sourcesBlock(notes: string): string {
  return `<div class="sources">
    <h2>Assumptions &amp; sources</h2>
    <p>${notes}</p>
    <p class="last-updated">Last updated: ${BUILD_DATE}</p>
  </div>`;
}

// ---------- Battery runtime pages (Cluster 1) ----------
const COMMON_LOADS = [50, 100, 200, 500, 1000];

function aiSection(pageKey: string, facts: Record<string, string | number>, headingText: string): string {
  const text = readCachedContent(pageKey, facts);
  if (!text) return '';
  return `<div class="ai-note"><h2>${headingText}</h2><p>${text}</p><p class="ai-disclosure">This summary was AI-generated from the real figures on this page and has not been independently reviewed.</p></div>`;
}

function buildBatteryPage(battery: { voltage: number; capacityAh: number; chemistry: string }) {
  const { voltage, capacityAh, chemistry } = battery;
  const slug = `${voltage}v-${capacityAh}ah`;
  const url = `/battery/${slug}/`;
  const canonical = `${SITE_URL}${url}`;
  const title = buildTitle(`${voltage}V ${capacityAh}Ah Battery Runtime Calculator`);
  const desc = `How long will a ${voltage}V ${capacityAh}Ah ${chemistry} battery run your load? Free calculator with runtime at common wattages, 85% efficiency assumed.`;

  const rows = COMMON_LOADS.map(w => {
    const r = calculateBatteryRuntime({ batteryVoltage: voltage, batteryAh: capacityAh, loadWatts: w });
    return `<tr><td>${w}W</td><td>${r.hours.toFixed(2)} hours</td></tr>`;
  }).join('\n');

  const example = calculateBatteryRuntime({ batteryVoltage: voltage, batteryAh: capacityAh, loadWatts: 100 });
  const howToAnswer = `Runtime (hours) = (Voltage × Ah × depth of discharge × efficiency) ÷ load watts. At 100W: (${voltage} × ${capacityAh} × 1 × 0.85) ÷ 100 = ${example.hours.toFixed(2)} hours.`;
  const howManyAnswer = `A ${voltage}V ${capacityAh}Ah battery running a 100W load lasts approximately ${example.hours.toFixed(2)} hours (${example.usableWh.toFixed(0)} Wh usable), assuming 85% round-trip efficiency and full usable depth of discharge (typical for LiFePO4).`;

  const related = batteries
    .filter((b: Battery) => `${b.voltage}v-${b.capacityAh}ah` !== slug)
    .slice(0, 6)
    .map((b: Battery) => `<a href="/battery/${b.voltage}v-${b.capacityAh}ah/">${b.voltage}V ${b.capacityAh}Ah</a>`)
    .join('\n');

  const jsonLd = [
    breadcrumbLd([{ name: 'Home', url: `${SITE_URL}/` }, { name: 'Battery Runtime', url: `${SITE_URL}/battery/` }, { name: `${voltage}V ${capacityAh}Ah`, url: canonical }]),
    webApplicationLd(`${voltage}V ${capacityAh}Ah Battery Runtime Calculator`, BUILD_DATE),
    faqLd([
      { question: `How do you calculate ${voltage}V ${capacityAh}Ah battery runtime?`, answer: howToAnswer },
      { question: `How long will a ${voltage}V ${capacityAh}Ah battery last?`, answer: howManyAnswer }
    ])
  ];

  const html = pageHead({ title, description: desc, canonical, jsonLd }) + `
${header(`<a href="/">Home</a> / <a href="/battery/">Battery Runtime</a> / ${voltage}V ${capacityAh}Ah`)}
<main class="wrap">
  <h1>${voltage}V ${capacityAh}Ah Battery Runtime Calculator</h1>
  <p class="subhead">${chemistry} battery, ${voltage}V nominal, ${capacityAh}Ah rated capacity. Runtime assumes 85% round-trip efficiency and full usable depth of discharge — both adjustable below.</p>

  <div class="calc" data-battery-calc data-voltage="${voltage}" data-capacity="${capacityAh}" data-default-load="100" data-default-dod="100" data-default-eff="85">
    <div class="field-row">
      <div class="field">
        <label for="load">Your load (watts)</label>
        <input id="load" type="number" value="100" inputmode="decimal">
      </div>
      <div class="field">
        <label for="dod">Depth of discharge (%)</label>
        <input id="dod" type="number" value="100" min="1" max="100">
      </div>
      <div class="field">
        <label for="eff">Efficiency (%)</label>
        <input id="eff" type="number" value="85" min="1" max="100">
      </div>
    </div>
    <button class="reset-btn" data-role="reset" type="button">Reset</button>
    <p class="result-line">Estimated runtime: <strong data-output-hours>${example.hours.toFixed(2)}</strong> hours · <strong data-output-wh>${example.usableWh.toFixed(0)}</strong> Wh usable</p>
  </div>

  ${aiSection(`battery-${slug}`, { voltage, capacityAh, chemistry, exampleRuntimeHours: Number(example.hours.toFixed(2)) }, `About the ${voltage}V ${capacityAh}Ah ${chemistry} battery`)}

  ${adSlot('battery calculator, in-content')}

  <div class="related">
    <h2>Runtime at common loads (85% efficiency, full DoD)</h2>
    <table class="unit-table"><tr><th>Load</th><th>Runtime</th></tr>${rows}</table>
  </div>

  <div class="faq">
    <h2>Frequently asked</h2>
    <div class="faq-item"><h3>How do you calculate ${voltage}V ${capacityAh}Ah battery runtime?</h3><p>${howToAnswer}</p></div>
    <div class="faq-item"><h3>How long will a ${voltage}V ${capacityAh}Ah battery last?</h3><p>${howManyAnswer}</p></div>
  </div>

  <div class="related">
    <h2>Other battery configurations</h2>
    <div class="pill-list">${related}</div>
  </div>

  ${crossClusterLinks('battery')}
  ${sourcesBlock('Runtime formula and 85% default efficiency assumption per src/calc-engine (documented in Stage 3). Depth of discharge default of 100% assumes LiFePO4; lead-acid batteries should use a lower DoD to protect battery life — adjust above.')}
</main>
${footer()}
<script type="module" src="/assets/battery-calc.js"></script>
${pageFoot()}`;

  write(`battery/${slug}/index.html`, html);
  batteryUrls.push(canonical);
}

// ---------- Solar panel output pages (Cluster 2, location-independent) ----------
const SUN_SCENARIOS = [
  { label: 'Low (winter / cloudy climate)', hours: 3 },
  { label: 'Average', hours: 5 },
  { label: 'High (sunny climate, summer)', hours: 7 }
];

function buildPanelPage(panel: { wattage: number }) {
  const { wattage } = panel;
  const slug = `${wattage}w`;
  const url = `/solar-panel/${slug}/`;
  const canonical = `${SITE_URL}${url}`;
  const title = buildTitle(`${wattage}W Solar Panel Output Calculator`);
  const avg = calculateSolarPanelOutput({ wattage, peakSunHours: 5 });
  const desc = `How much power does a ${wattage}W solar panel produce? ~${(avg.dailyOutputWh / 1000).toFixed(2)} kWh/day at 5 peak sun hours (average case). Free calculator for your conditions.`;

  const rows = SUN_SCENARIOS.map(s => {
    const r = calculateSolarPanelOutput({ wattage, peakSunHours: s.hours });
    return `<tr><td>${s.label} (${s.hours}h)</td><td>${(r.dailyOutputWh / 1000).toFixed(2)} kWh/day</td><td>${(r.monthlyOutputWh / 1000).toFixed(1)} kWh/month</td></tr>`;
  }).join('\n');

  const howToAnswer = `Daily output (Wh) = wattage × peak sun hours × (1 − system loss). At 5 peak sun hours and 14% assumed system loss: ${wattage} × 5 × 0.86 = ${avg.dailyOutputWh.toFixed(0)} Wh/day.`;
  const howManyAnswer = `A ${wattage}W panel produces approximately ${(avg.dailyOutputWh / 1000).toFixed(2)} kWh per day at 5 peak sun hours — actual output depends on your real location's sun hours, panel angle, shading, and temperature.`;

  const related = panels
    .filter((p: SolarPanel) => p.wattage !== wattage)
    .slice(0, 6)
    .map((p: SolarPanel) => `<a href="/solar-panel/${p.wattage}w/">${p.wattage}W</a>`)
    .join('\n');

  const jsonLd = [
    breadcrumbLd([{ name: 'Home', url: `${SITE_URL}/` }, { name: 'Solar Panel Output', url: `${SITE_URL}/solar-panel/` }, { name: `${wattage}W`, url: canonical }]),
    webApplicationLd(`${wattage}W Solar Panel Output Calculator`, BUILD_DATE),
    faqLd([
      { question: `How do you calculate ${wattage}W solar panel output?`, answer: howToAnswer },
      { question: `How much power does a ${wattage}W solar panel produce per day?`, answer: howManyAnswer }
    ])
  ];

  const html = pageHead({ title, description: desc, canonical, jsonLd }) + `
${header(`<a href="/">Home</a> / <a href="/solar-panel/">Solar Panel Output</a> / ${wattage}W`)}
<main class="wrap">
  <h1>${wattage}W Solar Panel Output Calculator</h1>
  <p class="subhead">Output scales directly with your local peak sun hours — these are illustrative scenarios, not a specific location's data. Enter your own numbers below for an estimate that matches where you actually are.</p>

  <div class="calc" data-panel-calc data-wattage="${wattage}" data-default-hours="5" data-default-loss="14">
    <div class="field-row">
      <div class="field">
        <label for="hours">Peak sun hours/day</label>
        <input id="hours" type="number" value="5" inputmode="decimal">
      </div>
      <div class="field">
        <label for="loss">System loss (%)</label>
        <input id="loss" type="number" value="14" min="0" max="99">
      </div>
    </div>
    <button class="reset-btn" data-role="reset" type="button">Reset</button>
    <p class="result-line">Estimated output: <strong data-output-daily>${(avg.dailyOutputWh / 1000).toFixed(2)}</strong> kWh/day · <strong data-output-annual>${(avg.annualOutputWh / 1000).toFixed(0)}</strong> kWh/year</p>
  </div>

  ${aiSection(`panel-${wattage}w`, { wattage, exampleDailyKwh: Number((avg.dailyOutputWh / 1000).toFixed(2)) }, `About ${wattage}W solar panels`)}

  ${adSlot('panel calculator, in-content')}

  <div class="related">
    <h2>Output under different conditions (14% system loss assumed)</h2>
    <table class="unit-table"><tr><th>Scenario</th><th>Daily</th><th>Monthly</th></tr>${rows}</table>
  </div>

  <div class="faq">
    <h2>Frequently asked</h2>
    <div class="faq-item"><h3>How do you calculate ${wattage}W solar panel output?</h3><p>${howToAnswer}</p></div>
    <div class="faq-item"><h3>How much power does a ${wattage}W solar panel produce per day?</h3><p>${howManyAnswer}</p></div>
  </div>

  <div class="related">
    <h2>Other panel wattages</h2>
    <div class="pill-list">${related}</div>
  </div>

  ${crossClusterLinks('panel')}
  ${sourcesBlock('14% default system loss is NREL PVWatts\' commonly cited convention for wiring, inverter, temperature, and soiling losses — not a measurement of any specific installation. Peak sun hour scenarios (3/5/7h) are illustrative, not location data; use your real location\'s peak sun hours for an accurate estimate.')}
</main>
${footer()}
<script type="module" src="/assets/panel-calc.js"></script>
${pageFoot()}`;

  write(`solar-panel/${slug}/index.html`, html);
  panelUrls.push(canonical);
}

// ---------- Appliance electricity cost pages (Cluster 3, partial) ----------
function buildAppliancePage(appliance: Appliance) {
  const { slug, name, wattsTypical, hoursPerDayTypical, isEstimated } = appliance;
  const url = `/appliance/${slug}/electricity-cost/`;
  const canonical = `${SITE_URL}${url}`;
  const title = buildTitle(`${name} Electricity Cost Calculator`);
  const dailyKwh = calculateApplianceConsumption({ wattsTypical, hoursPerDay: hoursPerDayTypical });
  const exampleCost = calculateElectricityCost({ kwhPerDay: dailyKwh, ratePerKwh: 0.15, days: 1 });
  const exampleMonthlyCost = calculateElectricityCost({ kwhPerDay: dailyKwh, ratePerKwh: 0.15, days: 30 });
  const desc = `Estimate electricity cost for a ${name.toLowerCase()} (~${wattsTypical}W typical). Enter your own rate and hours/day for an accurate number — free calculator.`;

  const howToAnswer = `Daily cost = (watts × hours/day ÷ 1000) × your rate per kWh. Using a typical ${wattsTypical}W and ${hoursPerDayTypical} hours/day at an example rate of $0.15/kWh: ${dailyKwh.toFixed(2)} kWh/day × $0.15 = $${exampleCost.toFixed(2)}/day.`;
  const howManyAnswer = `At a typical ${wattsTypical}W and ${hoursPerDayTypical} hours/day, a ${name.toLowerCase()} uses about ${dailyKwh.toFixed(2)} kWh/day — check your unit's actual nameplate wattage for a precise figure, since this varies by model.`;

  const related = appliances
    .filter((a: Appliance) => a.slug !== slug)
    .slice(0, 6)
    .map((a: Appliance) => `<a href="/appliance/${a.slug}/electricity-cost/">${a.name}</a>`)
    .join('\n');

  const jsonLd = [
    breadcrumbLd([{ name: 'Home', url: `${SITE_URL}/` }, { name: 'Appliances', url: `${SITE_URL}/appliance/` }, { name: name, url: canonical }]),
    webApplicationLd(`${name} Electricity Cost Calculator`, BUILD_DATE),
    faqLd([
      { question: `How much does it cost to run a ${name.toLowerCase()}?`, answer: howToAnswer },
      { question: `How many kWh does a ${name.toLowerCase()} use per day?`, answer: howManyAnswer }
    ])
  ];

  const html = pageHead({ title, description: desc, canonical, jsonLd }) + `
${header(`<a href="/">Home</a> / <a href="/appliance/">Appliances</a> / ${name}`)}
<main class="wrap">
  <h1>${name} Electricity Cost Calculator</h1>
  <p class="subhead">${isEstimated ? `Wattage (${wattsTypical}W) and typical usage (${hoursPerDayTypical}h/day) shown here are commonly cited estimates, not a measurement of your specific unit — check your appliance's nameplate or manual for its actual rating.` : ''} Enter your real numbers below.</p>

  <div class="calc" data-appliance-calc data-default-watts="${wattsTypical}" data-default-hours="${hoursPerDayTypical}" data-default-rate="0.15">
    <div class="field-row">
      <div class="field">
        <label for="watts">Watts</label>
        <input id="watts" type="number" value="${wattsTypical}" inputmode="decimal">
      </div>
      <div class="field">
        <label for="hours">Hours/day</label>
        <input id="hours" type="number" value="${hoursPerDayTypical}" inputmode="decimal">
      </div>
      <div class="field">
        <label for="rate">Your rate ($/kWh)</label>
        <input id="rate" type="number" value="0.15" step="0.01" inputmode="decimal">
      </div>
    </div>
    <button class="reset-btn" data-role="reset" type="button">Reset</button>
    <p class="result-line">Estimated cost: <strong data-output-daily>$${exampleCost.toFixed(2)}</strong>/day · <strong data-output-monthly>$${exampleMonthlyCost.toFixed(2)}</strong>/month</p>
  </div>

  ${aiSection(`appliance-${slug}`, { name, wattsTypical, hoursPerDayTypical, exampleDailyCost: Number(exampleCost.toFixed(2)) }, `About ${name.toLowerCase()} electricity use`)}

  ${adSlot('appliance calculator, in-content')}

  <div class="faq">
    <h2>Frequently asked</h2>
    <div class="faq-item"><h3>How much does it cost to run a ${name.toLowerCase()}?</h3><p>${howToAnswer}</p></div>
    <div class="faq-item"><h3>How many kWh does a ${name.toLowerCase()} use per day?</h3><p>${howManyAnswer}</p></div>
  </div>

  <div class="related">
    <h2>Other appliances</h2>
    <div class="pill-list">${related}</div>
  </div>

  <div class="related">
    <h2>Cost in specific states (real local rates)</h2>
    <div class="pill-list">${locations.map(l => `<a href="/appliance/${slug}/electricity-cost/${l.slug}/">${name} in ${l.name}</a>`).join('\n')}</div>
  </div>

  ${crossClusterLinks('appliance')}
  ${sourcesBlock(`${isEstimated ? `Wattage (${wattsTypical}W) and typical daily usage (${hoursPerDayTypical}h) are commonly cited estimates for this appliance type, not a measurement — verify against your specific unit's nameplate.` : ''} Example rate of $0.15/kWh shown in the FAQ is illustrative, not a claim about your actual electricity rate — replace it with yours in the calculator above.`)}
</main>
${footer()}
<script type="module" src="/assets/appliance-calc.js"></script>
${pageFoot()}`;

  write(`appliance/${slug}/electricity-cost/index.html`, html);
  applianceUrls.push(canonical);
}

// ---------- Hub pages ----------
// ---------- Panel output AT a real location (Template F) ----------
// Real, cited national averages used to select genuinely different sentence
// structures below - not random variation, tied to an actual data comparison.
// US_AVG_PSH: TheGreenWatt, "the U.S. average is 4.98 PSH/day" (same source as location data).
// US_AVG_RATE_CENTS: EIA State Electricity Profile 2024, "U.S. Total 12.94" cents/kWh.
const US_AVG_PSH = 4.98;
const US_AVG_RATE_CENTS = 12.94;

function panelLocationHowTo(loc: Location, wattage: number, dailyWh: number): string {
  const psh = loc.peakSunHours;
  const calc = `${wattage}W × ${psh} × 0.86 (accounting for 14% system loss) = ${dailyWh.toFixed(0)} Wh/day`;
  if (psh > US_AVG_PSH + 0.3) {
    return `${loc.name} sits above the U.S. average of ${US_AVG_PSH} peak sun hours/day, averaging ${psh} (${loc.sunSource}). Multiplying that out: ${calc}.`;
  } else if (psh < US_AVG_PSH - 0.3) {
    return `${loc.name} averages ${psh} peak sun hours per day, somewhat below the U.S. average of ${US_AVG_PSH} (${loc.sunSource}). Even so, the math works the same way: ${calc}.`;
  }
  return `At ${psh} peak sun hours/day, ${loc.name} is close to the U.S. average of ${US_AVG_PSH} (${loc.sunSource}). Working through it: ${calc}.`;
}

// Real computed rankings across all locations - genuine comparative analysis per
// page, not just a formula with a swapped number. Computed once, reused everywhere.
function computeRankings(): { sunRank: Map<string, number>; rateRank: Map<string, number> } {
  const bySun = [...locations].sort((a, b) => b.peakSunHours - a.peakSunHours);
  const byRate = [...locations].sort((a, b) => b.electricityRateCentsPerKwh - a.electricityRateCentsPerKwh);
  const sunRank = new Map<string, number>();
  const rateRank = new Map<string, number>();
  bySun.forEach((l, i) => sunRank.set(l.slug, i + 1));
  byRate.forEach((l, i) => rateRank.set(l.slug, i + 1));
  return { sunRank, rateRank };
}
const RANKINGS = computeRankings();

function sunRankFact(loc: Location): string {
  const rank = RANKINGS.sunRank.get(loc.slug)!;
  const pctVsAvg = ((loc.peakSunHours - US_AVG_PSH) / US_AVG_PSH) * 100;
  const direction = pctVsAvg >= 0 ? 'above' : 'below';
  return `${loc.name} ranks ${rank} of ${locations.length} states + DC for peak sun hours, ${Math.abs(pctVsAvg).toFixed(0)}% ${direction} the national average.`;
}

function rateRankFact(loc: Location): string {
  const rank = RANKINGS.rateRank.get(loc.slug)!;
  const pctVsAvg = ((loc.electricityRateCentsPerKwh - US_AVG_RATE_CENTS) / US_AVG_RATE_CENTS) * 100;
  const direction = pctVsAvg >= 0 ? 'above' : 'below';
  return `${loc.name} ranks ${rank} of ${locations.length} states + DC for electricity rate (highest to lowest), ${Math.abs(pctVsAvg).toFixed(0)}% ${direction} the national average.`;
}

function panelLocationHowMany(loc: Location, wattage: number, dailyKwh: number, annualKwh: number): string {
  const disclaimer = `treat this as a state-level estimate, not an address-level one — actual output can vary by coastal vs. inland position and elevation within ${loc.name}`;
  if (loc.peakSunHours > US_AVG_PSH + 0.3) {
    return `Thanks to ${loc.name}'s above-average sun exposure, a ${wattage}W panel there produces roughly ${dailyKwh.toFixed(2)} kWh/day, or about ${annualKwh.toFixed(0)} kWh over a full year. As always, ${disclaimer}.`;
  } else if (loc.peakSunHours < US_AVG_PSH - 0.3) {
    return `A ${wattage}W panel in ${loc.name} produces about ${dailyKwh.toFixed(2)} kWh/day (${annualKwh.toFixed(0)} kWh/year) — lower than sunnier states, reflecting ${loc.name}'s below-average sun hours. As always, ${disclaimer}.`;
  }
  return `A ${wattage}W panel in ${loc.name} produces approximately ${dailyKwh.toFixed(2)} kWh/day and ${annualKwh.toFixed(0)} kWh/year, in line with the national average. As always, ${disclaimer}.`;
}

// Real, disclosed thresholds for whether location meaningfully changes the practical
// decision for a given entity. Computed from actual cross-state spread, not guessed.
// Below threshold: the page still exists and works, but is noindexed (not deleted,
// not a broken link) since location doesn't add much decision-relevant differentiation.
const PANEL_SPREAD_THRESHOLD_KWH = 1.0;   // daily kWh spread across all 51 states
const APPLIANCE_SPREAD_THRESHOLD_USD = 10; // monthly $ spread across all 51 states

function computePanelSpreadKwh(wattage: number): number {
  const outputs = locations.map(l => calculateSolarPanelOutput({ wattage, peakSunHours: l.peakSunHours }).dailyOutputWh / 1000);
  return Math.max(...outputs) - Math.min(...outputs);
}

function computeApplianceSpreadUsd(appliance: Appliance): number {
  const dailyKwh = calculateApplianceConsumption({ wattsTypical: appliance.wattsTypical, hoursPerDay: appliance.hoursPerDayTypical });
  const costs = locations.map(l => calculateElectricityCost({ kwhPerDay: dailyKwh, ratePerKwh: l.electricityRateCentsPerKwh / 100, days: 30 }));
  return Math.max(...costs) - Math.min(...costs);
}

function buildPanelLocationPage(panel: { wattage: number }, loc: Location) {
  const { wattage } = panel;
  const url = `/solar-panel/${wattage}w/output/${loc.slug}/`;
  const canonical = `${SITE_URL}${url}`;
  const title = buildTitle(`${wattage}W Solar Panel Output in ${titleName(loc)}`);
  const result = calculateSolarPanelOutput({ wattage, peakSunHours: loc.peakSunHours });
  const dailyKwh = result.dailyOutputWh / 1000;
  const desc = `A ${wattage}W solar panel produces about ${dailyKwh.toFixed(2)} kWh/day in ${loc.name}, based on ${loc.name}'s real ${loc.peakSunHours} peak sun hour average.`;
  const spreadKwh = computePanelSpreadKwh(wattage);
  const shouldNoindex = spreadKwh < PANEL_SPREAD_THRESHOLD_KWH;

  const howToAnswer = panelLocationHowTo(loc, wattage, result.dailyOutputWh);
  const howManyAnswer = panelLocationHowMany(loc, wattage, dailyKwh, result.annualOutputWh / 1000);

  const otherWattages = panels.filter((p: SolarPanel) => p.wattage !== wattage).slice(0, 4)
    .map((p: SolarPanel) => `<a href="/solar-panel/${p.wattage}w/output/${loc.slug}/">${p.wattage}W in ${loc.name}</a>`).join('\n');
  const otherLocations = locations.filter((l: Location) => l.slug !== loc.slug).slice(0, 4)
    .map((l: Location) => `<a href="/solar-panel/${wattage}w/output/${l.slug}/">${wattage}W in ${l.name}</a>`).join('\n');

  const jsonLd = [
    breadcrumbLd([{ name: 'Home', url: `${SITE_URL}/` }, { name: 'Solar Panel Output', url: `${SITE_URL}/solar-panel/` }, { name: loc.name, url: canonical }]),
    webApplicationLd(`${wattage}W Solar Panel Output in ${loc.name}`, BUILD_DATE),
    faqLd([
      { question: `How much does a ${wattage}W solar panel produce in ${loc.name}?`, answer: howToAnswer },
      { question: `How many kWh per day/year from a ${wattage}W panel in ${loc.name}?`, answer: howManyAnswer }
    ])
  ];

  const html = pageHead({ title, description: desc, canonical, jsonLd, noindex: shouldNoindex }) + `
${header(`<a href="/">Home</a> / <a href="/solar-panel/">Solar Panel Output</a> / ${wattage}W / ${loc.name}`)}
<main class="wrap">
  <h1>${wattage}W Solar Panel Output in ${loc.name}</h1>
  <p class="subhead">Based on ${loc.name}'s real average of ${loc.peakSunHours} peak sun hours/day — not a generic scenario.</p>
  <p class="rank-fact">${sunRankFact(loc)}</p>
  <div class="calc" data-panel-calc data-wattage="${wattage}" data-default-hours="${loc.peakSunHours}" data-default-loss="14">
    <div class="field-row">
      <div class="field">
        <label for="hours">Peak sun hours/day</label>
        <input id="hours" type="number" value="${loc.peakSunHours}" inputmode="decimal">
      </div>
      <div class="field">
        <label for="loss">System loss (%)</label>
        <input id="loss" type="number" value="14" min="0" max="99">
      </div>
    </div>
    <button class="reset-btn" data-role="reset" type="button">Reset to ${loc.name} defaults</button>
    <p class="result-line">Estimated output: <strong data-output-daily>${dailyKwh.toFixed(2)}</strong> kWh/day · <strong data-output-annual>${(result.annualOutputWh / 1000).toFixed(0)}</strong> kWh/year</p>
  </div>
  ${aiSection(`panel-${wattage}w-${loc.slug}`, { wattage, state: loc.name, peakSunHours: loc.peakSunHours, exampleDailyKwh: Number(dailyKwh.toFixed(2)) }, `${wattage}W solar output in ${loc.name}`)}

  ${adSlot('panel-location calculator, in-content')}
  <div class="faq">
    <h2>Frequently asked</h2>
    <div class="faq-item"><h3>How much does a ${wattage}W solar panel produce in ${loc.name}?</h3><p>${howToAnswer}</p></div>
    <div class="faq-item"><h3>How many kWh per day/year from a ${wattage}W panel in ${loc.name}?</h3><p>${howManyAnswer}</p></div>
  </div>
  <div class="related"><h2>Other wattages in ${loc.name}</h2><div class="pill-list">${otherWattages}</div></div>
  <div class="related"><h2>${wattage}W in other states</h2><div class="pill-list">${otherLocations}</div></div>
  ${crossClusterLinks('panel')}
  ${sourcesBlock(`Peak sun hours (${loc.peakSunHours}/day): ${loc.sunSource}, collected ${loc.sunCollectedAt}. This is a state-level average — actual output can vary 15-25% within a state due to coastal vs. inland climate and elevation differences; it is not a substitute for an address-level PVWatts lookup.`)}
</main>
${footer()}
<script type="module" src="/assets/panel-calc.js"></script>
${pageFoot()}`;

  write(`solar-panel/${wattage}w/output/${loc.slug}/index.html`, html);
  if (!shouldNoindex) locationUrls.push(canonical); else noindexedCount++;
}

// ---------- Location hub (Template G) ----------
// ---------- Appliance cost AT a real location (Template D extension) ----------
function applianceLocationHowTo(loc: Location, name: string, wattsTypical: number, hoursPerDayTypical: number, dailyKwh: number, rate: number, dailyCost: number): string {
  const nameL = name.toLowerCase();
  const calc = `${dailyKwh.toFixed(2)} kWh/day × $${rate.toFixed(4)} = $${dailyCost.toFixed(2)}/day`;
  if (loc.electricityRateCentsPerKwh > US_AVG_RATE_CENTS + 1) {
    return `${loc.name} pays ${loc.electricityRateCentsPerKwh}¢/kWh (${loc.rateSource}), above the U.S. average of ${US_AVG_RATE_CENTS}¢. A ${nameL} at ${wattsTypical}W for ${hoursPerDayTypical}h/day works out to ${calc}.`;
  } else if (loc.electricityRateCentsPerKwh < US_AVG_RATE_CENTS - 1) {
    return `At ${loc.electricityRateCentsPerKwh}¢/kWh (${loc.rateSource}), ${loc.name}'s rate runs below the U.S. average of ${US_AVG_RATE_CENTS}¢. Running a ${nameL} at ${wattsTypical}W for ${hoursPerDayTypical}h/day: ${calc}.`;
  }
  return `${loc.name}'s rate of ${loc.electricityRateCentsPerKwh}¢/kWh (${loc.rateSource}) is close to the U.S. average. For a ${nameL} at ${wattsTypical}W, ${hoursPerDayTypical}h/day: ${calc}.`;
}

function applianceLocationHowMany(loc: Location, name: string, dailyCost: number, monthlyCost: number): string {
  const nameL = name.toLowerCase();
  if (loc.electricityRateCentsPerKwh > US_AVG_RATE_CENTS + 1) {
    return `Because ${loc.name}'s electricity costs more than the national average, running a ${nameL} there costs about $${dailyCost.toFixed(2)}/day, or $${monthlyCost.toFixed(2)}/month.`;
  } else if (loc.electricityRateCentsPerKwh < US_AVG_RATE_CENTS - 1) {
    return `${loc.name}'s below-average electricity rate keeps this cheap: about $${dailyCost.toFixed(2)}/day, or $${monthlyCost.toFixed(2)}/month, to run a ${nameL} there.`;
  }
  return `Running a ${nameL} in ${loc.name} costs approximately $${dailyCost.toFixed(2)}/day or $${monthlyCost.toFixed(2)}/month, using the real local rate.`;
}

function buildApplianceLocationPage(appliance: Appliance, loc: Location) {
  const { slug, name, wattsTypical, hoursPerDayTypical, isEstimated } = appliance;
  const url = `/appliance/${slug}/electricity-cost/${loc.slug}/`;
  const canonical = `${SITE_URL}${url}`;
  const title = buildTitle(`${name} Electricity Cost in ${titleName(loc)}`);
  const rate = loc.electricityRateCentsPerKwh / 100;
  const dailyKwh = calculateApplianceConsumption({ wattsTypical, hoursPerDay: hoursPerDayTypical });
  const dailyCost = calculateElectricityCost({ kwhPerDay: dailyKwh, ratePerKwh: rate, days: 1 });
  const monthlyCost = calculateElectricityCost({ kwhPerDay: dailyKwh, ratePerKwh: rate, days: 30 });
  const desc = `A ${name.toLowerCase()} costs about $${dailyCost.toFixed(2)}/day to run in ${loc.name}, using ${loc.name}'s real ${loc.electricityRateCentsPerKwh}¢/kWh rate.`;
  const spreadUsd = computeApplianceSpreadUsd(appliance);
  const shouldNoindex = spreadUsd < APPLIANCE_SPREAD_THRESHOLD_USD;

  const howToAnswer = applianceLocationHowTo(loc, name, wattsTypical, hoursPerDayTypical, dailyKwh, rate, dailyCost);
  const howManyAnswer = applianceLocationHowMany(loc, name, dailyCost, monthlyCost);

  const otherAppliances = appliances.filter(a => a.slug !== slug).slice(0, 4)
    .map(a => `<a href="/appliance/${a.slug}/electricity-cost/${loc.slug}/">${a.name} in ${loc.name}</a>`).join('\n');
  const otherLocations = locations.filter(l => l.slug !== loc.slug).slice(0, 4)
    .map(l => `<a href="/appliance/${slug}/electricity-cost/${l.slug}/">${name} in ${l.name}</a>`).join('\n');

  const jsonLd = [
    breadcrumbLd([
      { name: 'Home', url: `${SITE_URL}/` },
      { name: 'Appliances', url: `${SITE_URL}/appliance/` },
      { name: name, url: `${SITE_URL}/appliance/${slug}/electricity-cost/` },
      { name: loc.name, url: canonical }
    ]),
    webApplicationLd(`${name} Electricity Cost Calculator — ${loc.name}`, BUILD_DATE),
    faqLd([
      { question: `How much does it cost to run a ${name.toLowerCase()} in ${loc.name}?`, answer: howToAnswer },
      { question: `What's the monthly cost of a ${name.toLowerCase()} in ${loc.name}?`, answer: howManyAnswer }
    ])
  ];

  const html = pageHead({ title, description: desc, canonical, jsonLd, noindex: shouldNoindex }) + `
${header(`<a href="/">Home</a> / <a href="/appliance/">Appliances</a> / <a href="/appliance/${slug}/electricity-cost/">${name}</a> / ${loc.name}`)}
<main class="wrap">
  <h1>${name} Electricity Cost in ${loc.name}</h1>
  <p class="subhead">Using ${loc.name}'s real average rate of ${loc.electricityRateCentsPerKwh}¢/kWh — not a generic example rate.</p>
  <p class="rank-fact">${rateRankFact(loc)}</p>
  <div class="calc" data-appliance-calc data-default-watts="${wattsTypical}" data-default-hours="${hoursPerDayTypical}" data-default-rate="${rate}">
    <div class="field-row">
      <div class="field">
        <label for="watts">Watts</label>
        <input id="watts" type="number" value="${wattsTypical}" inputmode="decimal">
      </div>
      <div class="field">
        <label for="hours">Hours/day</label>
        <input id="hours" type="number" value="${hoursPerDayTypical}" inputmode="decimal">
      </div>
      <div class="field">
        <label for="rate">Rate ($/kWh) — ${loc.name}'s real average</label>
        <input id="rate" type="number" value="${rate.toFixed(4)}" step="0.01" inputmode="decimal">
      </div>
    </div>
    <button class="reset-btn" data-role="reset" type="button">Reset to ${loc.name} defaults</button>
    <p class="result-line">Estimated cost: <strong data-output-daily>$${dailyCost.toFixed(2)}</strong>/day · <strong data-output-monthly>$${monthlyCost.toFixed(2)}</strong>/month</p>
  </div>
  ${aiSection(`appliance-${slug}-${loc.slug}`, { name, state: loc.name, rateCentsPerKwh: loc.electricityRateCentsPerKwh, exampleDailyCost: Number(dailyCost.toFixed(2)) }, `${name} costs in ${loc.name}`)}
  ${adSlot('appliance-location calculator, in-content')}
  <div class="faq">
    <h2>Frequently asked</h2>
    <div class="faq-item"><h3>How much does it cost to run a ${name.toLowerCase()} in ${loc.name}?</h3><p>${howToAnswer}</p></div>
    <div class="faq-item"><h3>What's the monthly cost of a ${name.toLowerCase()} in ${loc.name}?</h3><p>${howManyAnswer}</p></div>
  </div>
  <div class="related"><h2>Other appliances in ${loc.name}</h2><div class="pill-list">${otherAppliances}</div></div>
  <div class="related"><h2>${name} in other states</h2><div class="pill-list">${otherLocations}</div></div>
  ${crossClusterLinks('appliance')}
  ${sourcesBlock(`${isEstimated ? `Wattage (${wattsTypical}W) and typical usage (${hoursPerDayTypical}h/day) are commonly cited estimates for this appliance type — verify against your unit's nameplate.` : ''} Electricity rate: ${loc.rateSource}, collected ${loc.rateCollectedAt}. This is a state-level average rate, not your specific utility's rate.`)}
</main>
${footer()}
<script type="module" src="/assets/appliance-calc.js"></script>
${pageFoot()}`;

  write(`appliance/${slug}/electricity-cost/${loc.slug}/index.html`, html);
  if (!shouldNoindex) locationUrls.push(canonical); else noindexedCount++;
}

function buildLocationHub(loc: Location) {
  const url = `/solar/${loc.slug}/`;
  const canonical = `${SITE_URL}${url}`;
  const title = buildTitle(`Solar Power in ${titleName(loc)}: Sun Hours, Rates & Output`);
  const rate = loc.electricityRateCentsPerKwh / 100;
  const desc = `${loc.name} averages ${loc.peakSunHours} peak sun hours/day and pays ${loc.electricityRateCentsPerKwh}¢/kWh for electricity. See real solar output and cost estimates for ${loc.name}.`;

  const applianceRows = appliances.slice(0, 4).map((a: Appliance) => {
    const dailyKwh = calculateApplianceConsumption({ wattsTypical: a.wattsTypical, hoursPerDay: a.hoursPerDayTypical });
    const dailyCost = calculateElectricityCost({ kwhPerDay: dailyKwh, ratePerKwh: rate, days: 1 });
    const monthlyCost = calculateElectricityCost({ kwhPerDay: dailyKwh, ratePerKwh: rate, days: 30 });
    return `<tr><td><a href="/appliance/${a.slug}/electricity-cost/${loc.slug}/">${a.name}</a></td><td>$${dailyCost.toFixed(2)}/day</td><td>$${monthlyCost.toFixed(2)}/month</td></tr>`;
  }).join('\n');

  const panelLinks = panels.map((p: SolarPanel) => `<a href="/solar-panel/${p.wattage}w/output/${loc.slug}/">${p.wattage}W output in ${loc.name}</a>`).join('\n');

  // One-time AI-authored supporting paragraph, generated by `npm run ai:generate`
  // and read here at build time - the regular build NEVER calls Gemini.
  const aiSectionHtml = aiSection(
    `location-hub-${loc.slug}`,
    { state: loc.name, peakSunHoursPerDay: loc.peakSunHours, electricityRateCentsPerKwh: loc.electricityRateCentsPerKwh },
    `About solar in ${loc.name}`
  );

  const jsonLd = [
    breadcrumbLd([{ name: 'Home', url: `${SITE_URL}/` }, { name: loc.name, url: canonical }]),
    webApplicationLd(`Solar Calculators for ${loc.name}`, BUILD_DATE)
  ];

  const html = pageHead({ title, description: desc, canonical, jsonLd }) + `
${header(`<a href="/">Home</a> / ${loc.name}`)}
<main class="wrap">
  <h1>Solar power in ${loc.name}</h1>
  <p class="subhead">Real, sourced numbers for ${loc.name} — not a national average.</p>
  <p class="rank-fact">${sunRankFact(loc)}</p>
  <p class="rank-fact">${rateRankFact(loc)}</p>
  <table class="unit-table">
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td>Average peak sun hours</td><td>${loc.peakSunHours}/day</td></tr>
    <tr><td>Average electricity rate</td><td>${loc.electricityRateCentsPerKwh}¢/kWh</td></tr>
  </table>

  ${aiSectionHtml}

  ${adSlot('location hub banner')}

  <div class="related">
    <h2>Estimated appliance costs in ${loc.name} (using ${loc.name}'s real rate)</h2>
    <table class="unit-table"><tr><th>Appliance</th><th>Daily</th><th>Monthly</th></tr>${applianceRows}</table>
  </div>

  <div class="related">
    <h2>Solar panel output in ${loc.name}</h2>
    <div class="pill-list">${panelLinks}</div>
  </div>

  ${sourcesBlock(`Peak sun hours: ${loc.sunSource}, collected ${loc.sunCollectedAt}. Electricity rate: ${loc.rateSource}, collected ${loc.rateCollectedAt}. Both are state-level averages, not address-specific figures.`)}
</main>
${footer()}
${pageFoot()}`;

  write(`solar/${loc.slug}/index.html`, html);
  locationUrls.push(canonical);
}

// ---------- Standalone calculators (Template A - Stage 5) ----------
// These are the general-purpose calculators from the original spec's Stage 5 that
// were skipped in favor of the parameterized pSEO templates (battery/panel/appliance).
// The engine functions behind these (calculateSolarSystemSize, calculatePanelCount, etc.)
// were built and unit-tested in Stage 3 but had zero user-facing page until now.
const standaloneCalcUrls: string[] = [];

function standaloneShell(opts: {
  slug: string;
  title: string;
  subhead: string;
  calcBlockHtml: string;
  faqPairs: Array<{ question: string; answer: string }>;
  sourcesNote: string;
  scriptId: string;
}): void {
  const url = `/calculators/${opts.slug}/`;
  const canonical = `${SITE_URL}${url}`;
  const desc = opts.subhead.length > 160 ? opts.subhead.slice(0, 157) + '...' : opts.subhead;
  const jsonLd = [
    breadcrumbLd([{ name: 'Home', url: `${SITE_URL}/` }, { name: 'Calculators', url: `${SITE_URL}/calculators/` }, { name: opts.title, url: canonical }]),
    webApplicationLd(opts.title, BUILD_DATE),
    faqLd(opts.faqPairs)
  ];
  const faqHtml = opts.faqPairs.map(f => `<div class="faq-item"><h3>${f.question}</h3><p>${f.answer}</p></div>`).join('\n');

  const html = pageHead({ title: buildTitle(opts.title), description: desc, canonical, jsonLd }) + `
${header(`<a href="/">Home</a> / <a href="/calculators/">Calculators</a> / ${opts.title}`)}
<main class="wrap">
  <h1>${opts.title}</h1>
  <p class="subhead">${opts.subhead}</p>
  ${opts.calcBlockHtml}
  ${adSlot(`${opts.slug} calculator, in-content`)}
  <div class="faq"><h2>Frequently asked</h2>${faqHtml}</div>
  <div class="related"><h2>Other calculators</h2><div class="pill-list">${standaloneCalcList.filter(c => c.slug !== opts.slug).map(c => `<a href="/calculators/${c.slug}/">${c.title}</a>`).join('\n')}</div></div>
  ${sourcesBlock(opts.sourcesNote)}
</main>
${footer()}
<script type="module" src="/assets/${opts.scriptId}.js"></script>
${pageFoot()}`;

  write(`calculators/${opts.slug}/index.html`, html);
  standaloneCalcUrls.push(canonical);
}

// Registry used for cross-linking between standalone calculators - populated below,
// referenced above via closure (function hoisting handles the forward reference).
const standaloneCalcList: Array<{ slug: string; title: string }> = [
  { slug: 'solar-system-size', title: 'Solar System Size Calculator' },
  { slug: 'panel-count', title: 'Solar Panel Count Calculator' },
  { slug: 'battery-capacity', title: 'Battery Capacity Calculator' },
  { slug: 'inverter-size', title: 'Inverter Size Calculator' },
  { slug: 'charge-controller-size', title: 'Charge Controller Size Calculator' },
  { slug: 'solar-savings-roi-payback', title: 'Solar Savings, ROI & Payback Calculator' },
  { slug: 'generator-size', title: 'Generator Size Calculator' },
  { slug: 'ev-charging-cost', title: 'EV Charging Cost Calculator' }
];

function fieldHtml(id: string, label: string, value: number, opts: { step?: string; min?: string } = {}): string {
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" value="${value}" step="${opts.step ?? 'any'}" ${opts.min ? `min="${opts.min}"` : ''} inputmode="decimal"></div>`;
}

function buildSolarSystemSizeCalc(): void {
  const dailyConsumptionKwh = 10, peakSunHours = 5, systemLossFraction = 14;
  const result = calculateSolarSystemSize({ dailyConsumptionKwh, peakSunHours, systemLossFraction: systemLossFraction / 100 });
  const calcBlockHtml = `<div class="calc" data-calc="solar-system-size" data-default-daily="${dailyConsumptionKwh}" data-default-hours="${peakSunHours}" data-default-loss="${systemLossFraction}">
    <div class="field-row">
      ${fieldHtml('daily', 'Daily consumption (kWh)', dailyConsumptionKwh)}
      ${fieldHtml('hours', 'Peak sun hours/day', peakSunHours)}
      ${fieldHtml('loss', 'System loss (%)', systemLossFraction, { min: '0' })}
    </div>
    <button class="reset-btn" data-role="reset" type="button">Reset</button>
    <p class="result-line">Recommended system size: <strong data-output>${result.toFixed(2)}</strong> kW</p>
  </div>`;
  standaloneShell({
    slug: 'solar-system-size',
    title: 'Solar System Size Calculator',
    subhead: 'Enter your daily electricity use and local peak sun hours to estimate the system size (in kW) needed to cover it.',
    calcBlockHtml,
    faqPairs: [
      { question: 'How is solar system size calculated?', answer: 'System size (kW) = daily consumption (kWh) ÷ (peak sun hours × (1 − system loss)). This tells you the array capacity needed to produce your daily usage on an average day.' },
      { question: 'What system loss percentage should I use?', answer: '14% is a commonly cited default (NREL PVWatts) covering wiring, inverter, temperature, and soiling losses. Well-designed systems can be lower; older or poorly-sited systems can be higher.' }
    ],
    sourcesNote: '14% default system loss: NREL PVWatts convention, not a measurement of any specific system. This calculator estimates array size only — it does not account for battery storage, net metering rules, or roof space constraints.',
    scriptId: 'calculators'
  });
}

function buildPanelCountCalc(): void {
  const dailyLoadWh = 5000, panelWattage = 400, peakSunHours = 5, systemLossFraction = 14;
  const result = calculatePanelCount({ dailyLoadWh, panelWattage, peakSunHours, systemLossFraction: systemLossFraction / 100 });
  const calcBlockHtml = `<div class="calc" data-calc="panel-count" data-default-daily="${dailyLoadWh}" data-default-wattage="${panelWattage}" data-default-hours="${peakSunHours}" data-default-loss="${systemLossFraction}">
    <div class="field-row">
      ${fieldHtml('daily', 'Daily load (Wh)', dailyLoadWh)}
      ${fieldHtml('wattage', 'Panel wattage (W)', panelWattage)}
      ${fieldHtml('hours', 'Peak sun hours/day', peakSunHours)}
      ${fieldHtml('loss', 'System loss (%)', systemLossFraction, { min: '0' })}
    </div>
    <button class="reset-btn" data-role="reset" type="button">Reset</button>
    <p class="result-line">Panels needed: <strong data-output>${result}</strong></p>
  </div>`;
  standaloneShell({
    slug: 'panel-count',
    title: 'Solar Panel Count Calculator',
    subhead: 'Find out how many panels of a given wattage you need to cover a daily energy load.',
    calcBlockHtml,
    faqPairs: [
      { question: 'How many solar panels do I need?', answer: 'Divide your daily load (Wh) by what one panel produces per day (wattage × peak sun hours × (1 − system loss)), then round up — you can\'t buy a fraction of a panel.' },
      { question: 'Why does the count round up instead of to the nearest whole number?', answer: 'Rounding down would leave you short of your target on an average day; rounding up guarantees the array can meet or exceed the stated load.' }
    ],
    sourcesNote: '14% default system loss: NREL PVWatts convention. Real panel output varies by manufacturer and real-world conditions — check your specific panel\'s datasheet for its actual rating.',
    scriptId: 'calculators'
  });
}

function buildBatteryCapacityCalc(): void {
  const dailyLoadWh = 1200, systemVoltage = 12, daysOfAutonomy = 2, dod = 50, eff = 85;
  const result = calculateBatteryCapacity({ dailyLoadWh, systemVoltage, daysOfAutonomy, depthOfDischargeFraction: dod / 100, efficiencyFraction: eff / 100 });
  const calcBlockHtml = `<div class="calc" data-calc="battery-capacity" data-default-daily="${dailyLoadWh}" data-default-voltage="${systemVoltage}" data-default-days="${daysOfAutonomy}" data-default-dod="${dod}" data-default-eff="${eff}">
    <div class="field-row">
      ${fieldHtml('daily', 'Daily load (Wh)', dailyLoadWh)}
      ${fieldHtml('voltage', 'System voltage (V)', systemVoltage)}
      ${fieldHtml('days', 'Days of autonomy', daysOfAutonomy)}
      ${fieldHtml('dod', 'Depth of discharge (%)', dod, { min: '1' })}
      ${fieldHtml('eff', 'Efficiency (%)', eff, { min: '1' })}
    </div>
    <button class="reset-btn" data-role="reset" type="button">Reset</button>
    <p class="result-line">Required capacity: <strong data-output>${result.toFixed(1)}</strong> Ah</p>
  </div>`;
  standaloneShell({
    slug: 'battery-capacity',
    title: 'Battery Capacity Calculator',
    subhead: 'Find the battery capacity (Ah) needed to cover your daily load for a chosen number of autonomy days.',
    calcBlockHtml,
    faqPairs: [
      { question: 'How do you size a battery bank?', answer: 'Required Ah = (daily load Wh × days of autonomy) ÷ (system voltage × depth of discharge × efficiency). A lower depth of discharge (safer for lead-acid) or lower efficiency both increase the required capacity.' },
      { question: 'What depth of discharge should I use?', answer: 'LiFePO4 batteries can typically use 95-100% DoD safely. Lead-acid batteries are commonly limited to 50% DoD to protect battery lifespan — using 100% DoD on lead-acid will undersize your bank and shorten its life.' }
    ],
    sourcesNote: 'Default 50% depth of discharge is a conservative, lead-acid-safe assumption, not a universal figure — adjust it up for LiFePO4 chemistries. This calculator does not account for temperature derating or battery aging.',
    scriptId: 'calculators'
  });
}

function buildInverterSizeCalc(): void {
  const continuousLoadWatts = 500, startingLoadWatts = 1500, safetyMargin = 20;
  const result = calculateInverterSize({ continuousLoadWatts, startingLoadWatts, safetyMarginFraction: safetyMargin / 100 });
  const calcBlockHtml = `<div class="calc" data-calc="inverter-size" data-default-continuous="${continuousLoadWatts}" data-default-starting="${startingLoadWatts}" data-default-margin="${safetyMargin}">
    <div class="field-row">
      ${fieldHtml('continuous', 'Continuous load (W)', continuousLoadWatts)}
      ${fieldHtml('starting', 'Starting/surge load (W)', startingLoadWatts, { min: '0' })}
      ${fieldHtml('margin', 'Safety margin (%)', safetyMargin, { min: '0' })}
    </div>
    <button class="reset-btn" data-role="reset" type="button">Reset</button>
    <p class="result-line">Recommended: <strong data-output-continuous>${result.recommendedContinuousWatts.toFixed(0)}</strong> W continuous · <strong data-output-surge>${result.recommendedSurgeWatts.toFixed(0)}</strong> W surge</p>
  </div>`;
  standaloneShell({
    slug: 'inverter-size',
    title: 'Inverter Size Calculator',
    subhead: 'Size an inverter using your continuous load plus the surge from motor-driven appliances (compressors, pumps).',
    calcBlockHtml,
    faqPairs: [
      { question: 'How do you size an inverter?', answer: 'Recommended continuous rating = continuous load × (1 + safety margin). The inverter must also handle the higher of that figure or your known starting/surge load — motors and compressors briefly draw far more than their running wattage.' },
      { question: 'Where do I find my starting/surge wattage?', answer: 'Check the appliance nameplate or manufacturer specs. If unlisted, a common rule of thumb is 2-3x running watts for motor-driven appliances (compressors, pumps) — but a nameplate figure is always more reliable than a rule of thumb.' }
    ],
    sourcesNote: '20% default safety margin is a common sizing convention, not a code requirement. This does not replace a licensed electrician\'s load calculation for a real installation.',
    scriptId: 'calculators'
  });
}

function buildChargeControllerCalc(): void {
  const panelWattage = 400, systemVoltage = 12, safetyMargin = 25;
  const result = calculateChargeControllerSize({ panelWattage, systemVoltage, safetyMarginFraction: safetyMargin / 100 });
  const calcBlockHtml = `<div class="calc" data-calc="charge-controller-size" data-default-wattage="${panelWattage}" data-default-voltage="${systemVoltage}" data-default-margin="${safetyMargin}">
    <div class="field-row">
      ${fieldHtml('wattage', 'Panel wattage (W)', panelWattage)}
      ${fieldHtml('voltage', 'System voltage (V)', systemVoltage)}
      ${fieldHtml('margin', 'Safety margin (%)', safetyMargin, { min: '0' })}
    </div>
    <button class="reset-btn" data-role="reset" type="button">Reset</button>
    <p class="result-line">Recommended controller: <strong data-output>${result.toFixed(1)}</strong> A</p>
  </div>`;
  standaloneShell({
    slug: 'charge-controller-size',
    title: 'Charge Controller Size Calculator',
    subhead: 'Estimate the amperage rating needed for an MPPT/PWM charge controller from panel wattage and system voltage.',
    calcBlockHtml,
    faqPairs: [
      { question: 'How do you size a charge controller?', answer: 'Approximate amps = (panel wattage ÷ system voltage) × (1 + safety margin). This is an estimate — real MPPT sizing should use the panel\'s actual Voc/Isc rating from its datasheet, not just wattage ÷ voltage.' },
      { question: 'Why is this only an approximation?', answer: 'Wattage ÷ voltage assumes ideal conditions. A panel\'s actual current draw depends on its specific Voc/Isc curve, which varies by panel model — always cross-check against your panel\'s datasheet before buying a controller.' }
    ],
    sourcesNote: '25% default safety margin follows common NEC-influenced sizing practice. This is a wattage/voltage approximation, not a substitute for checking your specific panel\'s Voc/Isc datasheet rating.',
    scriptId: 'calculators'
  });
}

function buildSavingsRoiPaybackCalc(): void {
  const monthlyConsumptionKwh = 900, ratePerKwh = 0.15, solarOffsetPct = 80, systemCost = 15000;
  const savings = calculateSolarSavings({ monthlyConsumptionKwh, ratePerKwh, solarOffsetFraction: solarOffsetPct / 100 });
  const payback = calculateSolarPayback(systemCost, savings.annualSavings);
  const roi = calculateSolarROI(systemCost, savings.annualSavings);
  const calcBlockHtml = `<div class="calc" data-calc="solar-savings-roi-payback" data-default-consumption="${monthlyConsumptionKwh}" data-default-rate="${ratePerKwh}" data-default-offset="${solarOffsetPct}" data-default-cost="${systemCost}">
    <div class="field-row">
      ${fieldHtml('consumption', 'Monthly consumption (kWh)', monthlyConsumptionKwh)}
      ${fieldHtml('rate', 'Electricity rate ($/kWh)', ratePerKwh, { step: '0.01' })}
      ${fieldHtml('offset', 'Solar offset (%)', solarOffsetPct, { min: '0' })}
      ${fieldHtml('cost', 'System cost ($)', systemCost)}
    </div>
    <button class="reset-btn" data-role="reset" type="button">Reset</button>
    <p class="result-line">Savings: <strong data-output-monthly>$${savings.monthlySavings.toFixed(2)}</strong>/mo · <strong data-output-annual>$${savings.annualSavings.toFixed(2)}</strong>/yr</p>
    <p class="result-line">Payback: <strong data-output-payback>${payback.toFixed(1)}</strong> years · First-year ROI: <strong data-output-roi>${roi.toFixed(2)}</strong>%</p>
  </div>`;
  standaloneShell({
    slug: 'solar-savings-roi-payback',
    title: 'Solar Savings, ROI & Payback Calculator',
    subhead: 'Estimate monthly and annual savings, simple payback period, and first-year ROI from a solar system.',
    calcBlockHtml,
    faqPairs: [
      { question: 'How are solar savings calculated?', answer: 'Monthly savings = monthly consumption (kWh) × your rate × solar offset fraction (how much of your usage solar covers). Annual savings is that figure × 12.' },
      { question: 'What does "simple payback" mean here?', answer: 'Payback (years) = system cost ÷ annual savings. This is undiscounted and doesn\'t account for financing costs, rate changes over time, or panel degradation — a real financial analysis would need those. Same for ROI, which is a first-year figure, not an IRR.' }
    ],
    sourcesNote: 'These are simple, undiscounted estimates — not a substitute for a real financial analysis that accounts for financing, electricity rate changes over the system\'s life, incentives/rebates, and panel degradation.',
    scriptId: 'calculators'
  });
}

function buildGeneratorSizeCalc(): void {
  const totalRunningWatts = 1800, largestStartingWatts = 2200, largestRunningWatts = 1200, safetyMargin = 20;
  const result = calculateGeneratorSize({ totalRunningWatts, largestApplianceStartingWatts: largestStartingWatts, largestApplianceRunningWatts: largestRunningWatts, safetyMarginFraction: safetyMargin / 100 });
  const calcBlockHtml = `<div class="calc" data-calc="generator-size" data-default-total="${totalRunningWatts}" data-default-largest-start="${largestStartingWatts}" data-default-largest-run="${largestRunningWatts}" data-default-margin="${safetyMargin}">
    <div class="field-row">
      ${fieldHtml('total', 'Total running watts (all appliances)', totalRunningWatts)}
      ${fieldHtml('largeststart', 'Largest appliance starting watts', largestStartingWatts)}
      ${fieldHtml('largestrun', 'That appliance\'s running watts', largestRunningWatts)}
      ${fieldHtml('margin', 'Safety margin (%)', safetyMargin, { min: '0' })}
    </div>
    <button class="reset-btn" data-role="reset" type="button">Reset</button>
    <p class="result-line">Recommended generator: <strong data-output>${result.toFixed(0)}</strong> W</p>
  </div>`;
  standaloneShell({
    slug: 'generator-size',
    title: 'Generator Size Calculator',
    subhead: 'Size a generator using total running load plus the extra surge from your single largest motor-driven appliance.',
    calcBlockHtml,
    faqPairs: [
      { question: 'How do you size a generator for a house or off-grid setup?', answer: 'Add up all appliances\' running watts, then add ONLY the extra surge from your single largest appliance (its starting watts minus its own running watts) — not every appliance\'s surge, since they rarely all start simultaneously. Apply a safety margin on top.' },
      { question: 'Why only the largest appliance\'s surge, not all of them?', answer: 'Appliances don\'t all start at the exact same instant in normal use. Sizing for every surge simultaneously would recommend a far larger (and more expensive) generator than realistically needed.' }
    ],
    sourcesNote: '20% default safety margin is a common rule of thumb, not a manufacturer specification. For a real installation, especially one with multiple large motors that might start together, consult the generator manufacturer\'s sizing guidance.',
    scriptId: 'calculators'
  });
}

function buildEvChargingCostCalc(): void {
  const batteryCapacityKwh = 60, chargeFromPct = 20, chargeToPct = 80, ratePerKwh = 0.15, efficiency = 90;
  const result = calculateEVChargingCost({ batteryCapacityKwh, chargeFromFraction: chargeFromPct / 100, chargeToFraction: chargeToPct / 100, ratePerKwh, chargingEfficiencyFraction: efficiency / 100 });
  const calcBlockHtml = `<div class="calc" data-calc="ev-charging-cost" data-default-capacity="${batteryCapacityKwh}" data-default-from="${chargeFromPct}" data-default-to="${chargeToPct}" data-default-rate="${ratePerKwh}" data-default-eff="${efficiency}">
    <div class="field-row">
      ${fieldHtml('capacity', 'Battery capacity (kWh)', batteryCapacityKwh)}
      ${fieldHtml('from', 'Charge from (%)', chargeFromPct, { min: '0' })}
      ${fieldHtml('to', 'Charge to (%)', chargeToPct, { min: '1' })}
      ${fieldHtml('rate', 'Electricity rate ($/kWh)', ratePerKwh, { step: '0.01' })}
      ${fieldHtml('eff', 'Charging efficiency (%)', efficiency, { min: '1' })}
    </div>
    <button class="reset-btn" data-role="reset" type="button">Reset</button>
    <p class="result-line">Estimated cost: <strong data-output>$${result.toFixed(2)}</strong></p>
  </div>`;
  standaloneShell({
    slug: 'ev-charging-cost',
    title: 'EV Charging Cost Calculator',
    subhead: 'Estimate the cost of charging an EV between two battery percentages, accounting for charging losses.',
    calcBlockHtml,
    faqPairs: [
      { question: 'How is EV charging cost calculated?', answer: 'Energy needed (kWh) = battery capacity × (charge-to % − charge-from %) ÷ charging efficiency. Cost = that energy × your electricity rate. The efficiency factor accounts for AC-DC conversion and battery heat losses during charging.' },
      { question: 'Why does charging efficiency matter?', answer: 'Not all the electricity you pay for reaches the battery as usable charge — some is lost as heat during AC-DC conversion. A 90% efficiency assumption is a common estimate; DC fast charging and home Level 2 charging can differ slightly in real-world efficiency.' }
    ],
    sourcesNote: '90% default charging efficiency is a commonly cited estimate — actual efficiency varies by charger type, ambient temperature, and vehicle. This does not include demand charges some utilities apply for fast charging.',
    scriptId: 'calculators'
  });
}

function buildHub(urlPath: string, title: string, desc: string, items: Array<{ name: string; href: string }>, extraContentHtml: string = '') {
  const canonical = `${SITE_URL}${urlPath}`;
  const links = items.map(i => `<a href="${i.href}">${i.name}</a>`).join('\n');
  const jsonLd = [
    breadcrumbLd([{ name: 'Home', url: `${SITE_URL}/` }, { name: title, url: canonical }]),
    itemListLd(items.map(i => ({ name: i.name, url: `${SITE_URL}${i.href}` })))
  ];
  const html = pageHead({ title: buildTitle(title), description: desc, canonical, jsonLd }) + `
${header(`<a href="/">Home</a> / ${title}`)}
<main class="wrap">
  <h1>${title}</h1>
  <p class="subhead">${desc}</p>
  ${extraContentHtml}
  ${adSlot('hub page banner')}
  <div class="pill-list">${links}</div>
</main>
${footer()}
${pageFoot()}`;
  write(`${urlPath.replace(/^\//, '').replace(/\/$/, '')}/index.html`, html);
  otherUrls.push(canonical);
}

function build404() {
  const html = pageHead({
    title: `Page not found — ${SITE_NAME}`,
    description: 'That calculator page does not exist.',
    canonical: `${SITE_URL}/404.html`,
    noindex: true
  }) + `
${header('')}
<main class="wrap"><h1>Page not found</h1><p class="subhead">Try the <a href="/">homepage</a>.</p></main>
${footer()}
${pageFoot()}`;
  write('404.html', html);
}

const ICONS: Record<string, string> = {
  battery: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="17" height="10" rx="1.5"/><path d="M21 10v4"/><path d="M6 10v4M10 10v4"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>`,
  plug: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v5M15 2v5M7 7h10v4a5 5 0 0 1-10 0V7Z"/><path d="M12 16v6"/></svg>`,
  map: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.3"/></svg>`,
  grid: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`
};

function buildHome() {
  const canonical = `${SITE_URL}/`;
  const jsonLd = [breadcrumbLd([{ name: 'Home', url: canonical }]), websiteLd(), organizationLd()];
  const totalCalcTypes = batteries.length + panels.length + appliances.length + standaloneCalcList.length;
  const html = pageHead({
    title: buildTitle(`${SITE_NAME} — Free solar & energy calculators`),
    description: 'Free calculators for battery runtime, solar panel output, and appliance electricity cost. No signup, no ads blocking the number you came for.',
    canonical,
    jsonLd
  }) + `
${header('')}
<main class="wrap">
  <h1>Free solar & energy calculators</h1>
  <p class="subhead">Every number is calculated from a documented formula with disclosed assumptions — never fabricated.</p>
  <div class="stat-strip">
    <div class="stat"><strong>${locations.length}</strong><span>states + DC covered</span></div>
    <div class="stat"><strong>${totalCalcTypes}</strong><span>calculator types</span></div>
    <div class="stat"><strong>$0</strong><span>always, no signup</span></div>
  </div>
  ${adSlot('homepage banner')}
  <div class="category-grid">
    <a href="/battery/"><span class="cat-icon">${ICONS.battery}</span><div class="cat-name">Battery Runtime</div><div class="cat-count">${batteries.length} configurations</div></a>
    <a href="/solar-panel/"><span class="cat-icon">${ICONS.sun}</span><div class="cat-name">Solar Panel Output</div><div class="cat-count">${panels.length} wattages</div></a>
    <a href="/appliance/"><span class="cat-icon">${ICONS.plug}</span><div class="cat-name">Appliance Electricity Cost</div><div class="cat-count">${appliances.length} appliances</div></a>
    <a href="/solar/"><span class="cat-icon">${ICONS.map}</span><div class="cat-name">Solar Power By State</div><div class="cat-count">${locations.length} states + DC</div></a>
    <a href="/calculators/"><span class="cat-icon">${ICONS.grid}</span><div class="cat-name">All Calculators</div><div class="cat-count">${standaloneCalcList.length} standalone tools</div></a>
  </div>
</main>
${footer()}
${pageFoot()}`;
  write('index.html', html);
  otherUrls.push(canonical);
}

function buildSitemaps() {
  const clusters: Array<{ name: string; urls: string[] }> = [
    { name: 'batteries', urls: batteryUrls },
    { name: 'solar-panels', urls: panelUrls },
    { name: 'appliances', urls: applianceUrls },
    { name: 'locations', urls: locationUrls },
    { name: 'standalone-calculators', urls: standaloneCalcUrls },
    { name: 'pages', urls: otherUrls }
  ];

  const sitemapEntries: string[] = [];
  for (const c of clusters) {
    if (!c.urls.length) continue;
    const urlXml = c.urls.map(u => `  <url><loc>${u}</loc><lastmod>${BUILD_DATE}</lastmod></url>`).join('\n');
    write(`sitemaps/${c.name}.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlXml}\n</urlset>`);
    sitemapEntries.push(`  <sitemap><loc>${SITE_URL}/sitemaps/${c.name}.xml</loc><lastmod>${BUILD_DATE}</lastmod></sitemap>`);
  }

  // Top-level sitemap.xml is an INDEX pointing to the segmented files, per spec section 16 -
  // not a flat list. Only indexable pages appear anywhere in this tree.
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries.join('\n')}\n</sitemapindex>`);
}

function buildLlmsTxt() {
  const totalCalcTypes = batteries.length + panels.length + appliances.length + standaloneCalcList.length;
  const standaloneList = standaloneCalcList.map(c => `- [${c.title}](${SITE_URL}/calculators/${c.slug}/)`).join('\n');

  const content = `# ${SITE_NAME}

> Free, static calculators for solar panel output, battery runtime, appliance electricity cost, and ${standaloneCalcList.length} standalone energy-sizing tools (${totalCalcTypes} calculator types total). Every number is computed live from a documented formula, not written as editorial content. Location-specific data (peak sun hours, electricity rates) is real and independently sourced per state, with defaults explicitly labeled as estimates where they are estimates - nothing is presented as measured when it is not.

## Core calculators

- [Battery Runtime Calculators](${SITE_URL}/battery/) - runtime and usable energy (Wh) for ${batteries.length} battery configurations (12V/24V/48V at 100/200/300Ah, LiFePO4)
- [Solar Panel Output Calculators](${SITE_URL}/solar-panel/) - daily and annual output for ${panels.length} panel wattages (100W-1000W)
- [Appliance Electricity Cost Calculators](${SITE_URL}/appliance/) - daily and monthly cost for ${appliances.length} common household appliances
- [Solar Power By State](${SITE_URL}/solar/) - real peak sun hours and electricity rates for ${locations.length} US states + DC, each independently sourced and dated

## Standalone calculators

${standaloneList}

## Data sources

- Peak sun hours: TheGreenWatt, using NREL PVWatts v8 / NSRDB methodology (1kW reference system, 20° tilt, 14% system loss)
- Electricity rates: U.S. Energy Information Administration, State Electricity Profile 2024 (released November 10, 2025)
- Every location page cites both sources individually with a collection date, in its "Assumptions & sources" section

## Notes for AI systems and answer engines

- All calculated figures on this site are deterministic outputs of documented formulas (see each page's FAQ section for the exact formula used), not claims requiring independent fact-checking beyond the cited primary sources.
- Appliance wattage and typical-usage figures are explicitly disclosed as commonly-cited estimates, not measurements of a specific unit - each appliance page states this directly.
- Peak-sun-hour and electricity-rate figures are state-level averages, not address-specific data - each location page states this limitation directly.
- This site has no paywall and no login requirement. All content, including the underlying formulas, is free to read, cite, and link to.
`;

  fs.writeFileSync(path.join(OUT, 'llms.txt'), content);
}

function buildRobots() {
  const aiBots = [
    'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',      // OpenAI
    'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'anthropic-ai', // Anthropic
    'PerplexityBot', 'Perplexity-User',              // Perplexity
    'Google-Extended',                                // Google AI (Gemini/AI Overviews training)
    'CCBot',                                          // Common Crawl (widely used as LLM training source)
    'Applebot-Extended',                              // Apple AI features
    'Amazonbot',                                      // Amazon (Alexa/AI features)
    'Bytespider',                                     // ByteDance
    'meta-externalagent'                              // Meta AI
  ];
  const aiBotBlocks = aiBots.map(bot => `User-agent: ${bot}\nAllow: /`).join('\n\n');
  write('robots.txt', `User-agent: *\nAllow: /\n\n# Explicitly welcoming AI crawlers and answer engines - this site's entire\n# purpose is free, publicly citable factual data. There is no ad-paywalled\n# content here for these bots to "cannibalize", so citation and exposure via\n# AI answers is pure upside, not a risk to hedge against.\n${aiBotBlocks}\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
}

const FONT_FILES: Array<[string, string]> = [
  ['@fontsource/sora/files/sora-latin-500-normal.woff2', 'sora-500.woff2'],
  ['@fontsource/sora/files/sora-latin-600-normal.woff2', 'sora-600.woff2'],
  ['@fontsource/sora/files/sora-latin-700-normal.woff2', 'sora-700.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', 'plex-sans-400.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2', 'plex-sans-500.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', 'plex-sans-600.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'plex-mono-400.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', 'plex-mono-500.woff2']
];

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#1A231E"/><path d="M17 5 L9 18 H15 L14 27 L23 13 H17 Z" fill="#D9A521"/></svg>`;

function copyAssets() {
  const assetsDir = path.join(ROOT, 'assets');
  const outAssets = path.join(OUT, 'assets');
  fs.mkdirSync(path.join(outAssets, 'fonts'), { recursive: true });
  for (const f of fs.readdirSync(assetsDir)) {
    fs.copyFileSync(path.join(assetsDir, f), path.join(outAssets, f));
  }
  for (const [src, destName] of FONT_FILES) {
    fs.copyFileSync(path.join(ROOT, 'node_modules', src), path.join(outAssets, 'fonts', destName));
  }
  fs.writeFileSync(path.join(outAssets, 'favicon.svg'), FAVICON_SVG);
}

/**
 * Compiles the canonical calc-engine (TypeScript, types stripped) into a real
 * browser-runnable ES module and copies it to dist/assets/calc-engine.js.
 * This is the fix for the duplication flagged in Stages 4 and 9: the browser
 * calculators now import this file directly instead of hand-copying formulas,
 * so there is structurally one implementation, not two kept in sync by hand.
 */
function compileEngineForBrowser() {
  const tmpOut = path.join(ROOT, '.tsc-out');
  fs.rmSync(tmpOut, { recursive: true, force: true });
  execSync(
    `npx tsc src/calc-engine/index.ts --target es2020 --module es2020 --outDir ${tmpOut} --declaration false --ignoreConfig`,
    { cwd: ROOT, stdio: 'inherit' }
  );
  fs.copyFileSync(path.join(tmpOut, 'index.js'), path.join(OUT, 'assets/calc-engine.js'));
  fs.rmSync(tmpOut, { recursive: true, force: true });
}

function main() {
  validateData();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  copyAssets();
  compileEngineForBrowser();

  buildHome();
  build404();

  for (const b of batteries) buildBatteryPage(b);
  const batteryTableRows = batteries.map((b: Battery) => {
    const r = calculateBatteryRuntime({ batteryVoltage: b.voltage, batteryAh: b.capacityAh, loadWatts: 100 });
    return `<tr><td><a href="/battery/${b.voltage}v-${b.capacityAh}ah/">${b.voltage}V ${b.capacityAh}Ah</a></td><td>${b.chemistry}</td><td>${r.hours.toFixed(1)} hours</td></tr>`;
  }).join('\n');
  buildHub('/battery/', 'Battery Runtime Calculators',
    'Pick a battery configuration to see runtime at common loads, or use the calculator for your exact setup.',
    batteries.map((b: Battery) => ({ name: `${b.voltage}V ${b.capacityAh}Ah`, href: `/battery/${b.voltage}v-${b.capacityAh}ah/` })),
    `<p>Runtime scales with capacity: a 12V 300Ah bank lasts three times as long as a 12V 100Ah bank under the same load, since capacity (Ah) is the direct measure of stored energy. Doubling system voltage at the same Ah rating (say, 12V to 24V) also roughly doubles usable energy, since watt-hours = volts × amp-hours. The table below compares all ${batteries.length} configurations at a fixed 100W reference load, using each one's default 85% efficiency assumption, so you can see the relative differences at a glance before picking one to explore further.</p>
    <table class="unit-table"><tr><th>Configuration</th><th>Chemistry</th><th>Runtime at 100W</th></tr>${batteryTableRows}</table>`);

  for (const p of panels) buildPanelPage(p);
  const panelTableRows = panels.map((p: SolarPanel) => {
    const r = calculateSolarPanelOutput({ wattage: p.wattage, peakSunHours: 5 });
    return `<tr><td><a href="/solar-panel/${p.wattage}w/">${p.wattage}W</a></td><td>${(r.dailyOutputWh / 1000).toFixed(2)} kWh/day</td><td>${(r.annualOutputWh / 1000).toFixed(0)} kWh/year</td></tr>`;
  }).join('\n');
  buildHub('/solar-panel/', 'Solar Panel Output Calculators',
    'Pick a panel wattage to see output under different sun conditions, or use the calculator for your exact location.',
    panels.map((p: SolarPanel) => ({ name: `${p.wattage}W`, href: `/solar-panel/${p.wattage}w/` })),
    `<p>Output scales roughly linearly with wattage at a given location — an 800W array produces about twice what a 400W array does under identical sun conditions, since both are driven by the same peak-sun-hour and system-loss assumptions. The real variable that matters more than wattage alone is location: the same 400W panel produces about 1.09 kWh/day in Alaska (the lowest-sun state in this dataset) versus about 2.25 kWh/day in Arizona (the highest) — see the <a href="/solar/">by-state pages</a> for real numbers instead of the generic 5-peak-sun-hour scenario used below.</p>
    <table class="unit-table"><tr><th>Wattage</th><th>Daily (5 PSH avg.)</th><th>Annual</th></tr>${panelTableRows}</table>`);

  for (const a of appliances) buildAppliancePage(a);
  const applianceTableRows = appliances.map((a: Appliance) => {
    const dailyKwh = calculateApplianceConsumption({ wattsTypical: a.wattsTypical, hoursPerDay: a.hoursPerDayTypical });
    const cost = calculateElectricityCost({ kwhPerDay: dailyKwh, ratePerKwh: 0.15, days: 1 });
    return `<tr><td><a href="/appliance/${a.slug}/electricity-cost/">${a.name}</a></td><td>${dailyKwh.toFixed(2)} kWh/day</td><td>$${cost.toFixed(2)}/day at $0.15/kWh</td></tr>`;
  }).join('\n');
  buildHub('/appliance/', 'Appliance Electricity Cost Calculators',
    'Pick an appliance to estimate its electricity cost, or enter your own wattage and rate.',
    appliances.map((a: Appliance) => ({ name: a.name, href: `/appliance/${a.slug}/electricity-cost/` })),
    `<p>Cost depends on three things: wattage, hours of use per day, and your local electricity rate — this site's calculators let you adjust all three. The table below uses each appliance's typical wattage and usage pattern at an illustrative $0.15/kWh rate; your actual cost could be meaningfully different depending on where you live — see the <a href="/solar/">by-state pages</a> for real local rates instead of this generic example.</p>
    <table class="unit-table"><tr><th>Appliance</th><th>Typical use</th><th>Example cost</th></tr>${applianceTableRows}</table>`);

  buildSolarSystemSizeCalc();
  buildPanelCountCalc();
  buildBatteryCapacityCalc();
  buildInverterSizeCalc();
  buildChargeControllerCalc();
  buildSavingsRoiPaybackCalc();
  buildGeneratorSizeCalc();
  buildEvChargingCostCalc();

  buildHub('/calculators/', 'All Calculators',
    'Every calculator on the site, grouped by type. Each one uses a documented formula with disclosed assumptions.',
    [
      { name: 'Battery Runtime Calculators', href: '/battery/' },
      { name: 'Solar Panel Output Calculators', href: '/solar-panel/' },
      { name: 'Appliance Electricity Cost Calculators', href: '/appliance/' },
      ...standaloneCalcList.map(c => ({ name: c.title, href: `/calculators/${c.slug}/` }))
    ]);

  for (const loc of locations) {
    buildLocationHub(loc);
    for (const p of panels) buildPanelLocationPage(p, loc);
    for (const a of appliances) buildApplianceLocationPage(a, loc);
  }
  buildHub('/solar/', 'Solar Power By State',
    'Real peak sun hours and electricity rates by state, each independently sourced and dated. Not every state yet — only where we have reliable, cited data.',
    locations.map((l: Location) => ({ name: l.name, href: `/solar/${l.slug}/` })));

  buildSitemaps();
  buildLlmsTxt();
  buildRobots();

  const totalIndexable = batteryUrls.length + panelUrls.length + applianceUrls.length + locationUrls.length + standaloneCalcUrls.length + otherUrls.length;
  const totalFiles = totalIndexable + noindexedCount + 1; // +1 for 404
  console.log(`Generated ${totalFiles} real pages into /dist: ${totalIndexable} indexed (in sitemap), ${noindexedCount} noindexed (exist, functional, deliberately excluded from sitemap per computed spread thresholds), 1 404 page.`);
}

main();
