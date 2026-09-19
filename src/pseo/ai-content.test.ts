import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hashFacts, checkFactualDrift, getOrGenerateContent } from './ai-content.ts';

const TEST_CACHE_PATH = path.join(process.cwd(), 'data', 'ai-content-cache.json');

test('hashFacts: identical facts produce identical hashes regardless of key order', () => {
  const a = hashFacts({ rate: 12.74, state: 'Arizona' });
  const b = hashFacts({ state: 'Arizona', rate: 12.74 });
  assert.equal(a, b);
});

test('hashFacts: different facts produce different hashes', () => {
  const a = hashFacts({ rate: 12.74, state: 'Arizona' });
  const b = hashFacts({ rate: 27.04, state: 'California' });
  assert.notEqual(a, b);
});

test('checkFactualDrift: clean text using only given facts produces no warnings', () => {
  const facts = { peakSunHours: 6.54, rateCents: 12.74 };
  const text = 'Arizona averages 6.54 peak sun hours per day and pays 12.74 cents per kWh.';
  const warnings = checkFactualDrift(text, facts);
  assert.deepEqual(warnings, []);
});

test('checkFactualDrift: catches a number NOT present in the given facts (the exact failure mode this exists to prevent)', () => {
  const facts = { peakSunHours: 6.54, rateCents: 12.74 };
  const text = 'Arizona averages 6.54 peak sun hours and has seen a 45 percent increase in solar adoption.';
  const warnings = checkFactualDrift(text, facts);
  assert.ok(warnings.includes('45'), `Expected to catch the fabricated "45" - got: ${JSON.stringify(warnings)}`);
});

test('checkFactualDrift: ignores small incidental numbers to reduce false positives', () => {
  const facts = { peakSunHours: 6.54 };
  const text = 'This is one of 3 factors to consider, alongside 6.54 peak sun hours.';
  const warnings = checkFactualDrift(text, facts);
  assert.deepEqual(warnings, []); // "3" and "one" are below the size threshold, not flagged
});

test('getOrGenerateContent: returns null (fails open) when no API key is set and cache is empty', async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const result = await getOrGenerateContent('test-page-no-key', 'a test topic', { value: 42 });
    assert.equal(result, null);
  } finally {
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
  }
});

test('getOrGenerateContent: returns cached text without needing an API key when facts match', async () => {
  const cacheDir = path.dirname(TEST_CACHE_PATH);
  fs.mkdirSync(cacheDir, { recursive: true });
  const facts = { rate: 12.74 };
  const factsHash = hashFacts(facts);
  const existingCache = fs.existsSync(TEST_CACHE_PATH) ? JSON.parse(fs.readFileSync(TEST_CACHE_PATH, 'utf8')) : {};
  existingCache['test-page-cached'] = { factsHash, text: 'Cached explanation text.', generatedAt: '2026-01-01', model: 'test' };
  fs.writeFileSync(TEST_CACHE_PATH, JSON.stringify(existingCache, null, 2));

  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY; // prove this works WITHOUT a key - it's a pure cache hit
  try {
    const result = await getOrGenerateContent('test-page-cached', 'irrelevant', facts);
    assert.ok(result);
    assert.equal(result?.text, 'Cached explanation text.');
  } finally {
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    // clean up test entries so repeated test runs don't accumulate cruft
    const cache = JSON.parse(fs.readFileSync(TEST_CACHE_PATH, 'utf8'));
    delete cache['test-page-cached'];
    delete cache['test-page-no-key'];
    fs.writeFileSync(TEST_CACHE_PATH, JSON.stringify(cache, null, 2));
  }
});

test('getOrGenerateContent: cache MISS when facts change, even with the same page key', async () => {
  const facts1 = { rate: 12.74 };
  const facts2 = { rate: 99.99 }; // different facts, same page key
  const cache: Record<string, unknown> = fs.existsSync(TEST_CACHE_PATH) ? JSON.parse(fs.readFileSync(TEST_CACHE_PATH, 'utf8')) : {};
  cache['test-page-drift'] = { factsHash: hashFacts(facts1), text: 'Stale text for old facts.', generatedAt: '2026-01-01', model: 'test' };
  fs.writeFileSync(TEST_CACHE_PATH, JSON.stringify(cache, null, 2));

  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    // facts2 doesn't match the cached hash, and no API key means it fails open (null) -
    // the important assertion is that it does NOT return the stale cached text for new facts.
    const result = await getOrGenerateContent('test-page-drift', 'irrelevant', facts2);
    assert.notEqual(result?.text, 'Stale text for old facts.');
  } finally {
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    const finalCache = JSON.parse(fs.readFileSync(TEST_CACHE_PATH, 'utf8'));
    delete finalCache['test-page-drift'];
    fs.writeFileSync(TEST_CACHE_PATH, JSON.stringify(finalCache, null, 2));
  }
});
