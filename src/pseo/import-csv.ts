/**
 * CSV -> JSON import, per the original spec's Stage 19.
 *
 * data/csv/*.csv is the human-editable authoring format (open it in Excel,
 * Google Sheets, whatever). This script converts it into the exact JSON shape
 * generate.ts already reads - generate.ts itself never changes.
 *
 * Safety property: if ANY row in ANY file fails validation, NOTHING is written.
 * A typo in one spreadsheet cell must never corrupt the production data that's
 * already working. Fix the CSV, re-run, or nothing changes.
 *
 * Usage: npm run data:import
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');
const CSV_DIR = path.join(ROOT, 'data/csv');
const JSON_DIR = path.join(ROOT, 'data');

interface ImportResult<T> {
  rows: T[];
  errors: string[];
}

function parseCsv(filename: string): { data: Record<string, string>[]; parseErrors: string[] } {
  const filePath = path.join(CSV_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return { data: [], parseErrors: [`${filename}: file not found at data/csv/${filename}`] };
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const result = Papa.parse<Record<string, string>>(raw, { header: true, skipEmptyLines: true, delimiter: ',' });
  const parseErrors = result.errors.map(e => `${filename} row ${e.row}: ${e.message}`);
  return { data: result.data, parseErrors };
}

function requireNumber(row: Record<string, string>, col: string, rowLabel: string, errors: string[]): number {
  const raw = row[col];
  const n = parseFloat(raw ?? '');
  if (raw === undefined || raw === '' || isNaN(n)) {
    errors.push(`${rowLabel}: column "${col}" must be a number, got "${raw}"`);
    return NaN;
  }
  return n;
}

function requireString(row: Record<string, string>, col: string, rowLabel: string, errors: string[]): string {
  const raw = row[col];
  if (raw === undefined || raw.trim() === '') {
    errors.push(`${rowLabel}: column "${col}" is required and cannot be empty`);
    return '';
  }
  return raw.trim();
}

function requireBoolean(row: Record<string, string>, col: string, rowLabel: string, errors: string[]): boolean {
  const raw = (row[col] ?? '').trim().toLowerCase();
  if (raw !== 'true' && raw !== 'false') {
    errors.push(`${rowLabel}: column "${col}" must be exactly "true" or "false", got "${row[col]}"`);
    return false;
  }
  return raw === 'true';
}

function importBatteries(): ImportResult<{ voltage: number; capacityAh: number; chemistry: string }> {
  const { data, parseErrors } = parseCsv('batteries.csv');
  const errors = [...parseErrors];
  const seen = new Set<string>();
  const rows = data.map((row, i) => {
    const rowLabel = `batteries.csv row ${i + 2}`; // +2: header is row 1, data starts row 2
    const voltage = requireNumber(row, 'voltage', rowLabel, errors);
    const capacityAh = requireNumber(row, 'capacityAh', rowLabel, errors);
    const chemistry = requireString(row, 'chemistry', rowLabel, errors);
    const key = `${voltage}v-${capacityAh}ah`;
    if (seen.has(key)) errors.push(`${rowLabel}: duplicate battery ${key}`);
    seen.add(key);
    return { voltage, capacityAh, chemistry };
  });
  return { rows, errors };
}

function importPanels(): ImportResult<{ wattage: number }> {
  const { data, parseErrors } = parseCsv('solar-panels.csv');
  const errors = [...parseErrors];
  const seen = new Set<number>();
  const rows = data.map((row, i) => {
    const rowLabel = `solar-panels.csv row ${i + 2}`;
    const wattage = requireNumber(row, 'wattage', rowLabel, errors);
    if (seen.has(wattage)) errors.push(`${rowLabel}: duplicate wattage ${wattage}`);
    seen.add(wattage);
    return { wattage };
  });
  return { rows, errors };
}

function importAppliances(): ImportResult<{ slug: string; name: string; wattsTypical: number; wattsStarting: number; hoursPerDayTypical: number; isEstimated: boolean }> {
  const { data, parseErrors } = parseCsv('appliances.csv');
  const errors = [...parseErrors];
  const seen = new Set<string>();
  const rows = data.map((row, i) => {
    const rowLabel = `appliances.csv row ${i + 2}`;
    const slug = requireString(row, 'slug', rowLabel, errors);
    const name = requireString(row, 'name', rowLabel, errors);
    const wattsTypical = requireNumber(row, 'wattsTypical', rowLabel, errors);
    const wattsStarting = requireNumber(row, 'wattsStarting', rowLabel, errors);
    const hoursPerDayTypical = requireNumber(row, 'hoursPerDayTypical', rowLabel, errors);
    const isEstimated = requireBoolean(row, 'isEstimated', rowLabel, errors);
    if (seen.has(slug)) errors.push(`${rowLabel}: duplicate slug "${slug}"`);
    seen.add(slug);
    if (hoursPerDayTypical > 24) errors.push(`${rowLabel}: hoursPerDayTypical (${hoursPerDayTypical}) cannot exceed 24`);
    return { slug, name, wattsTypical, wattsStarting, hoursPerDayTypical, isEstimated };
  });
  return { rows, errors };
}

function importLocations(): ImportResult<{
  slug: string; name: string; nameShort?: string; peakSunHours: number; sunSource: string; sunSourceUrl: string; sunCollectedAt: string;
  electricityRateCentsPerKwh: number; rateSource: string; rateSourceUrl: string; rateCollectedAt: string;
}> {
  const { data, parseErrors } = parseCsv('locations.csv');
  const errors = [...parseErrors];
  const seen = new Set<string>();
  const rows = data.map((row, i) => {
    const rowLabel = `locations.csv row ${i + 2}`;
    const slug = requireString(row, 'slug', rowLabel, errors);
    const name = requireString(row, 'name', rowLabel, errors);
    const nameShort = (row.nameShort ?? '').trim() || undefined; // optional - falls back to `name` in titles
    const peakSunHours = requireNumber(row, 'peakSunHours', rowLabel, errors);
    const sunSource = requireString(row, 'sunSource', rowLabel, errors);
    const sunSourceUrl = requireString(row, 'sunSourceUrl', rowLabel, errors);
    const sunCollectedAt = requireString(row, 'sunCollectedAt', rowLabel, errors);
    const electricityRateCentsPerKwh = requireNumber(row, 'electricityRateCentsPerKwh', rowLabel, errors);
    const rateSource = requireString(row, 'rateSource', rowLabel, errors);
    const rateSourceUrl = requireString(row, 'rateSourceUrl', rowLabel, errors);
    const rateCollectedAt = requireString(row, 'rateCollectedAt', rowLabel, errors);
    if (seen.has(slug)) errors.push(`${rowLabel}: duplicate slug "${slug}"`);
    seen.add(slug);
    // Per the project's own no-fabrication rule: a location without a real source citation
    // must not import at all, even if the numbers look plausible.
    if (sunSourceUrl && !sunSourceUrl.startsWith('http')) errors.push(`${rowLabel}: sunSourceUrl doesn't look like a real URL: "${sunSourceUrl}"`);
    if (rateSourceUrl && !rateSourceUrl.startsWith('http')) errors.push(`${rowLabel}: rateSourceUrl doesn't look like a real URL: "${rateSourceUrl}"`);
    return { slug, name, nameShort, peakSunHours, sunSource, sunSourceUrl, sunCollectedAt, electricityRateCentsPerKwh, rateSource, rateSourceUrl, rateCollectedAt };
  });
  return { rows, errors };
}

function main() {
  const results = {
    'batteries.json': importBatteries(),
    'solar-panels.json': importPanels(),
    'appliances.json': importAppliances(),
    'locations.json': importLocations()
  };

  const allErrors = Object.values(results).flatMap(r => r.errors);

  if (allErrors.length) {
    console.error(`\nImport failed - ${allErrors.length} problem(s) found. NOTHING was written.\n`);
    allErrors.forEach(e => console.error(`  ✗ ${e}`));
    console.error('\nFix data/csv/*.csv and re-run "npm run data:import".');
    process.exit(1);
  }

  for (const [filename, result] of Object.entries(results)) {
    fs.writeFileSync(path.join(JSON_DIR, filename), JSON.stringify(result.rows, null, 2) + '\n');
    console.log(`✓ ${filename}: ${result.rows.length} rows imported`);
  }
  console.log('\nAll CSVs validated and imported successfully. Run "npm run build:verified" next.');
}

main();
