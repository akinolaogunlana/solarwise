/**
 * Post-build verification. Does NOT trust the generator's own math twice —
 * it re-derives expected values from the canonical calc-engine using the same
 * inputs the generator claims to have used, then diffs against what actually
 * landed in the HTML. This is what should have caught the days-param bug
 * at build time instead of by manual inspection three stages later.
 *
 * Run after every build: npm run build && npm run verify
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');
const OUT = path.join(ROOT, 'dist');

const batteries = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/batteries.json'), 'utf8'));
const panels = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/solar-panels.json'), 'utf8'));
const appliances = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/appliances.json'), 'utf8'));
const locations = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/locations.json'), 'utf8'));

const failures: string[] = [];
let checks = 0;

function approxEqual(a: number, b: number, tolerance = 0.01): boolean {
  return Math.abs(a - b) <= tolerance;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readPage(relPath: string): string {
  return fs.readFileSync(path.join(OUT, relPath), 'utf8');
}

function checkNumberOnPage(pagePath: string, label: string, expected: number, extractRegex: RegExp) {
  checks++;
  let html: string;
  try {
    html = readPage(pagePath);
  } catch {
    failures.push(`${pagePath}: page does not exist`);
    return;
  }
  const match = html.match(extractRegex);
  if (!match) {
    failures.push(`${pagePath} [${label}]: could not find expected pattern in HTML (regex: ${extractRegex})`);
    return;
  }
  const capturedValue = match[1];
  if (capturedValue === undefined) {
    failures.push(`${pagePath} [${label}]: regex matched but capture group was empty (regex: ${extractRegex})`);
    return;
  }
  const actual = parseFloat(capturedValue);
  if (!approxEqual(actual, expected, Math.max(0.01, expected * 0.005))) {
    failures.push(`${pagePath} [${label}]: expected ${expected.toFixed(4)}, page shows ${actual} — MISMATCH`);
  }
}

// ---------- Battery pages: verify the runtime table ----------
const COMMON_LOADS = [50, 100, 200, 500, 1000];
for (const b of batteries) {
  const slug = `${b.voltage}v-${b.capacityAh}ah`;
  const pagePath = `battery/${slug}/index.html`;
  for (const w of COMMON_LOADS) {
    const expected = calculateBatteryRuntime({ batteryVoltage: b.voltage, batteryAh: b.capacityAh, loadWatts: w });
    // matches "<td>50W</td><td>10.20 hours</td>" style row
    const re = new RegExp(`<td>${w}W</td><td>([\\d.]+) hours</td>`);
    checkNumberOnPage(pagePath, `runtime @ ${w}W`, expected.hours, re);
  }
  // The calculator's own default output (100W, 100% DoD, 85% eff)
  const defaultResult = calculateBatteryRuntime({ batteryVoltage: b.voltage, batteryAh: b.capacityAh, loadWatts: 100 });
  checkNumberOnPage(pagePath, `${slug} calculator default hours`, defaultResult.hours, /<strong data-output-hours>([\d.]+)<\/strong> hours/);
  checkNumberOnPage(pagePath, `${slug} calculator default usable Wh`, defaultResult.usableWh, /<strong data-output-wh>([\d.]+)<\/strong> Wh usable/);
}

// ---------- Panel pages: verify the scenario table (daily kWh) ----------
const SUN_SCENARIOS = [{ label: 'Low', hours: 3 }, { label: 'Average', hours: 5 }, { label: 'High', hours: 7 }];
for (const p of panels) {
  const pagePath = `solar-panel/${p.wattage}w/index.html`;
  for (const s of SUN_SCENARIOS) {
    const r = calculateSolarPanelOutput({ wattage: p.wattage, peakSunHours: s.hours });
    const expectedDailyKwh = r.dailyOutputWh / 1000;
    const re = new RegExp(`\\(${s.hours}h\\)</td><td>([\\d.]+) kWh/day`);
    checkNumberOnPage(pagePath, `${p.wattage}W @ ${s.hours}h daily kWh`, expectedDailyKwh, re);
  }
  // The calculator's own default output (5h, 14% loss) - not the scenario table
  const defaultResult = calculateSolarPanelOutput({ wattage: p.wattage, peakSunHours: 5 });
  checkNumberOnPage(pagePath, `${p.wattage}W calculator default daily`, defaultResult.dailyOutputWh / 1000, /<strong data-output-daily>([\d.]+)<\/strong> kWh\/day/);
  checkNumberOnPage(pagePath, `${p.wattage}W calculator default annual`, defaultResult.annualOutputWh / 1000, /<strong data-output-annual>([\d.]+)<\/strong> kWh\/year/);
}

// ---------- Appliance pages: verify the displayed default cost is DAILY, not monthly ----------
for (const a of appliances) {
  const pagePath = `appliance/${a.slug}/electricity-cost/index.html`;
  const dailyKwh = calculateApplianceConsumption({ wattsTypical: a.wattsTypical, hoursPerDay: a.hoursPerDayTypical });
  const expectedDailyCost = calculateElectricityCost({ kwhPerDay: dailyKwh, ratePerKwh: 0.15, days: 1 });
  checkNumberOnPage(pagePath, 'default daily cost', expectedDailyCost, /<strong data-output-daily>\$([\d.]+)<\/strong>\/day/);
  const expectedMonthlyCost = calculateElectricityCost({ kwhPerDay: dailyKwh, ratePerKwh: 0.15, days: 30 });
  checkNumberOnPage(pagePath, 'default monthly cost', expectedMonthlyCost, /<strong data-output-monthly>\$([\d.]+)<\/strong>\/month/);
}

// ---------- Location hubs: verify BOTH daily and monthly appliance costs use the REAL rate ----------
for (const loc of locations) {
  const pagePath = `solar/${loc.slug}/index.html`;
  const rate = loc.electricityRateCentsPerKwh / 100;
  for (const a of appliances.slice(0, 4)) {
    const dailyKwh = calculateApplianceConsumption({ wattsTypical: a.wattsTypical, hoursPerDay: a.hoursPerDayTypical });
    const expectedDaily = calculateElectricityCost({ kwhPerDay: dailyKwh, ratePerKwh: rate, days: 1 });
    const expectedMonthly = calculateElectricityCost({ kwhPerDay: dailyKwh, ratePerKwh: rate, days: 30 });
    const escapedName = escapeRegex(a.name);
    const reDaily = new RegExp(`>${escapedName}</a></td><td>\\$([\\d.]+)/day</td>`);
    const reMonthly = new RegExp(`>${escapedName}</a></td><td>\\$[\\d.]+/day</td><td>\\$([\\d.]+)/month</td>`);
    checkNumberOnPage(pagePath, `${a.name} daily cost in ${loc.name}`, expectedDaily, reDaily);
    checkNumberOnPage(pagePath, `${a.name} monthly cost in ${loc.name}`, expectedMonthly, reMonthly);
    // Guards against the exact bug found: monthly must be ~30x daily, not equal to it or 30x that again
    const ratio = expectedMonthly / expectedDaily;
    if (!approxEqual(ratio, 30, 0.5)) {
      failures.push(`${pagePath} [${a.name}]: monthly/daily ratio is ${ratio.toFixed(1)}, expected ~30 — sanity check failed`);
    }
    checks++;
  }
}

// ---------- Panel-at-location pages: verify real peak sun hours were actually used ----------
for (const loc of locations) {
  for (const p of panels) {
    const pagePath = `solar-panel/${p.wattage}w/output/${loc.slug}/index.html`;
    const r = calculateSolarPanelOutput({ wattage: p.wattage, peakSunHours: loc.peakSunHours });
    const expectedDaily = r.dailyOutputWh / 1000;
    const expectedAnnual = r.annualOutputWh / 1000;
    checkNumberOnPage(pagePath, `${p.wattage}W daily output in ${loc.name}`, expectedDaily, /<strong data-output-daily>([\d.]+)<\/strong> kWh\/day/);
    checkNumberOnPage(pagePath, `${p.wattage}W annual output in ${loc.name}`, expectedAnnual, /<strong data-output-annual>([\d.]+)<\/strong> kWh\/year/);
  }
}

// ---------- Appliance-at-location pages: verify BOTH daily and monthly figures ----------
for (const loc of locations) {
  const rate = loc.electricityRateCentsPerKwh / 100;
  for (const a of appliances) {
    const pagePath = `appliance/${a.slug}/electricity-cost/${loc.slug}/index.html`;
    const dailyKwh = calculateApplianceConsumption({ wattsTypical: a.wattsTypical, hoursPerDay: a.hoursPerDayTypical });
    const expectedDaily = calculateElectricityCost({ kwhPerDay: dailyKwh, ratePerKwh: rate, days: 1 });
    const expectedMonthly = calculateElectricityCost({ kwhPerDay: dailyKwh, ratePerKwh: rate, days: 30 });
    checkNumberOnPage(pagePath, `${a.name} daily cost in ${loc.name} (dedicated page)`, expectedDaily, /<strong data-output-daily>\$([\d.]+)<\/strong>\/day/);
    checkNumberOnPage(pagePath, `${a.name} monthly cost in ${loc.name} (dedicated page)`, expectedMonthly, /<strong data-output-monthly>\$([\d.]+)<\/strong>\/month/);
  }
}

// ---------- Standalone calculators: verify each one's default server-rendered output ----------
{
  const r = calculateSolarSystemSize({ dailyConsumptionKwh: 10, peakSunHours: 5, systemLossFraction: 0.14 });
  checkNumberOnPage('calculators/solar-system-size/index.html', 'solar system size default', r, /<strong data-output>([\d.]+)<\/strong> kW/);
}
{
  const r = calculatePanelCount({ dailyLoadWh: 5000, panelWattage: 400, peakSunHours: 5, systemLossFraction: 0.14 });
  checkNumberOnPage('calculators/panel-count/index.html', 'panel count default', r, /<strong data-output>([\d.]+)<\/strong>/);
}
{
  const r = calculateBatteryCapacity({ dailyLoadWh: 1200, systemVoltage: 12, daysOfAutonomy: 2, depthOfDischargeFraction: 0.5, efficiencyFraction: 0.85 });
  checkNumberOnPage('calculators/battery-capacity/index.html', 'battery capacity default', r, /<strong data-output>([\d.]+)<\/strong> Ah/);
}
{
  const r = calculateInverterSize({ continuousLoadWatts: 500, startingLoadWatts: 1500, safetyMarginFraction: 0.2 });
  checkNumberOnPage('calculators/inverter-size/index.html', 'inverter continuous default', r.recommendedContinuousWatts, /<strong data-output-continuous>([\d.]+)<\/strong> W continuous/);
  checkNumberOnPage('calculators/inverter-size/index.html', 'inverter surge default', r.recommendedSurgeWatts, /<strong data-output-surge>([\d.]+)<\/strong> W surge/);
}
{
  const r = calculateChargeControllerSize({ panelWattage: 400, systemVoltage: 12, safetyMarginFraction: 0.25 });
  checkNumberOnPage('calculators/charge-controller-size/index.html', 'charge controller default', r, /<strong data-output>([\d.]+)<\/strong> A/);
}
{
  const savings = calculateSolarSavings({ monthlyConsumptionKwh: 900, ratePerKwh: 0.15, solarOffsetFraction: 0.8 });
  const payback = calculateSolarPayback(15000, savings.annualSavings);
  const roi = calculateSolarROI(15000, savings.annualSavings);
  const p = 'calculators/solar-savings-roi-payback/index.html';
  checkNumberOnPage(p, 'monthly savings default', savings.monthlySavings, /<strong data-output-monthly>\$([\d.]+)<\/strong>\/mo/);
  checkNumberOnPage(p, 'annual savings default', savings.annualSavings, /<strong data-output-annual>\$([\d.]+)<\/strong>\/yr/);
  checkNumberOnPage(p, 'payback default', payback, /<strong data-output-payback>([\d.]+)<\/strong> years/);
  checkNumberOnPage(p, 'roi default', roi, /<strong data-output-roi>([\d.]+)<\/strong>%/);
}
{
  const r = calculateGeneratorSize({ totalRunningWatts: 1800, largestApplianceStartingWatts: 2200, largestApplianceRunningWatts: 1200, safetyMarginFraction: 0.2 });
  checkNumberOnPage('calculators/generator-size/index.html', 'generator size default', r, /<strong data-output>([\d.]+)<\/strong> W/);
}
{
  const r = calculateEVChargingCost({ batteryCapacityKwh: 60, chargeFromFraction: 0.2, chargeToFraction: 0.8, ratePerKwh: 0.15, chargingEfficiencyFraction: 0.9 });
  checkNumberOnPage('calculators/ev-charging-cost/index.html', 'EV charging cost default', r, /<strong data-output>\$([\d.]+)<\/strong>/);
}

// Structural guard: the shared calculators.js must actually import every engine function it claims to use
{
  const content = fs.readFileSync(path.join(OUT, 'assets/calculators.js'), 'utf8');
  const requiredImports = [
    'calculateSolarSystemSize', 'calculatePanelCount', 'calculateBatteryCapacity',
    'calculateInverterSize', 'calculateChargeControllerSize', 'calculateSolarSavings',
    'calculateSolarPayback', 'calculateSolarROI', 'calculateGeneratorSize', 'calculateEVChargingCost'
  ];
  for (const fn of requiredImports) {
    if (!content.includes(fn)) failures.push(`assets/calculators.js: missing reference to ${fn} — a standalone calculator may have regressed to a hand-duplicated formula`);
  }
}

console.log(`Verification: ${checks} numeric checks run across the built site.`);

// ---------- Structural guard: client calculators must import the engine, not duplicate it ----------
const clientScripts = [
  { file: 'battery-calc.js', mustImport: 'calculateBatteryRuntime' },
  { file: 'panel-calc.js', mustImport: 'calculateSolarPanelOutput' },
  { file: 'appliance-calc.js', mustImport: 'calculateApplianceConsumption' }
];
for (const s of clientScripts) {
  const scriptPath = path.join(OUT, 'assets', s.file);
  const content = fs.readFileSync(scriptPath, 'utf8');
  if (!content.includes(`from '/assets/calc-engine.js'`) || !content.includes(s.mustImport)) {
    failures.push(`assets/${s.file}: does not import ${s.mustImport} from the compiled engine — may have regressed to a hand-duplicated formula`);
  }
}
if (!fs.readFileSync(path.join(OUT, 'assets/battery-calc.js'), 'utf8').includes('usableWh')) {
  failures.push('assets/battery-calc.js: no longer computes usable Wh live — regression from the API update');
}
if (!fs.readFileSync(path.join(OUT, 'assets/appliance-calc.js'), 'utf8').includes('data-output-monthly')) {
  failures.push('assets/appliance-calc.js: no longer computes monthly cost live — regression from the interactivity update');
}
if (!fs.readFileSync(path.join(OUT, 'assets/panel-calc.js'), 'utf8').includes('data-output-annual')) {
  failures.push('assets/panel-calc.js: no longer computes annual output live — regression from the interactivity update');
}
if (!fs.existsSync(path.join(OUT, 'assets/calc-engine.js'))) {
  failures.push('assets/calc-engine.js was not compiled into the build output');
}

if (failures.length) {
  console.error(`\n${failures.length} MISMATCH(ES) FOUND:\n`);
  failures.forEach(f => console.error(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('All generated numbers match the canonical calc-engine. No drift detected.');
}
