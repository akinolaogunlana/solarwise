/**
 * One-time (or occasional) authoring pass: generates unique supporting copy for
 * every page on the site and saves it to data/ai-content-cache.json.
 *
 * The regular build (generate.ts) NEVER calls this or the Gemini API - it only
 * reads whatever this script has already written. Run this whenever you add
 * new entities (a new state, a new appliance) or want to refresh content after
 * changing the prompt. Already-cached, unchanged entries are skipped automatically
 * (idempotent), so re-running this after adding 5 new states only pays for those
 * 5, not the other 360+ pages that already have current content.
 *
 * Usage:
 *   export GEMINI_API_KEY=your-real-key
 *   npm run ai:generate
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOrGenerateContent } from './ai-content.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');

interface Battery { voltage: number; capacityAh: number; chemistry: string }
interface SolarPanel { wattage: number }
interface Appliance { slug: string; name: string; wattsTypical: number; hoursPerDayTypical: number }
interface Location { slug: string; name: string; peakSunHours: number; electricityRateCentsPerKwh: number }

const batteries: Battery[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/batteries.json'), 'utf8'));
const panels: SolarPanel[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/solar-panels.json'), 'utf8'));
const appliances: Appliance[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/appliances.json'), 'utf8'));
const locations: Location[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/locations.json'), 'utf8'));

interface Job {
  key: string;
  topic: string;
  facts: Record<string, string | number>;
}

const jobs: Job[] = [];

// Battery pages
for (const b of batteries) {
  const slug = `${b.voltage}v-${b.capacityAh}ah`;
  jobs.push({
    key: `battery-${slug}`,
    topic: `A ${b.voltage}V ${b.capacityAh}Ah ${b.chemistry} battery for off-grid or backup power use`,
    facts: { voltage: b.voltage, capacityAh: b.capacityAh, chemistry: b.chemistry }
  });
}

// Panel base pages
for (const p of panels) {
  jobs.push({
    key: `panel-${p.wattage}w`,
    topic: `A ${p.wattage}W solar panel's typical use case and output`,
    facts: { wattage: p.wattage }
  });
}

// Appliance base pages
for (const a of appliances) {
  jobs.push({
    key: `appliance-${a.slug}`,
    topic: `Electricity use of a ${a.name.toLowerCase()}`,
    facts: { name: a.name, wattsTypical: a.wattsTypical, hoursPerDayTypical: a.hoursPerDayTypical }
  });
}

// Location hubs
for (const loc of locations) {
  jobs.push({
    key: `location-hub-${loc.slug}`,
    topic: `Solar power potential in ${loc.name}, USA`,
    facts: { state: loc.name, peakSunHoursPerDay: loc.peakSunHours, electricityRateCentsPerKwh: loc.electricityRateCentsPerKwh }
  });
}

// Panel output AT a location (the largest, most repetitive cluster - arguably
// where unique copy matters most for avoiding a thin/near-duplicate pattern)
for (const loc of locations) {
  for (const p of panels) {
    jobs.push({
      key: `panel-${p.wattage}w-${loc.slug}`,
      topic: `${p.wattage}W solar panel output specifically in ${loc.name}`,
      facts: { wattage: p.wattage, state: loc.name, peakSunHours: loc.peakSunHours }
    });
  }
}

// Appliance cost AT a location
for (const loc of locations) {
  for (const a of appliances) {
    jobs.push({
      key: `appliance-${a.slug}-${loc.slug}`,
      topic: `Cost of running a ${a.name.toLowerCase()} in ${loc.name}`,
      facts: { name: a.name, state: loc.name, rateCentsPerKwh: loc.electricityRateCentsPerKwh }
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (dryRun) {
    console.log(`Dry run: ${jobs.length} content pieces would be planned across all page types.`);
    const byType: Record<string, number> = {};
    for (const j of jobs) {
      const type = j.key.split('-')[0] ?? 'unknown';
      byType[type] = (byType[type] ?? 0) + 1;
    }
    console.log(byType);
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set. Export it before running this script:');
    console.error('  export GEMINI_API_KEY=your-real-key');
    process.exit(1);
  }

  console.log(`Planning ${jobs.length} content pieces across all page types.`);
  console.log('Already-cached, unchanged entries will be skipped automatically (no charge).\n');

  let generated = 0, failed = 0;
  const totalWarnings: string[] = [];

  for (const [i, job] of jobs.entries()) {
    const result = await getOrGenerateContent(job.key, job.topic, job.facts);
    if (result === null) {
      failed++;
      console.log(`[${i + 1}/${jobs.length}] FAILED: ${job.key}`);
    } else if (result.warnings.length) {
      generated++;
      totalWarnings.push(`${job.key}: ${result.warnings.join(', ')}`);
      console.log(`[${i + 1}/${jobs.length}] generated (with warnings): ${job.key}`);
    } else {
      generated++;
      console.log(`[${i + 1}/${jobs.length}] ok: ${job.key}`);
    }
    // Small delay to be a reasonable API citizen - adjust to your actual rate limit.
    await sleep(200);
  }

  console.log(`\nDone. ${generated} generated/cached successfully, ${failed} failed.`);
  if (totalWarnings.length) {
    console.log(`\n${totalWarnings.length} page(s) had possible factual drift warnings - review before trusting:`);
    totalWarnings.forEach(w => console.log(`  - ${w}`));
  }
}

main();
