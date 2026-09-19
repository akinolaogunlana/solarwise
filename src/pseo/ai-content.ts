/**
 * AI-generated supporting content, per the project's own rule (spec section 27):
 * AI may write explanations/summaries, but the PRIMARY value of every page must
 * remain the real calculated data. This module enforces that boundary structurally:
 *
 *  1. Build-time only. Never called at request time - keeps the site static,
 *     free to host, and fast. A page's AI text is generated once and baked in.
 *
 *  2. Cached by a hash of the FACTS, not the slug. If a location's real rate or
 *     sun-hour data changes, the cache key changes and new text is generated.
 *     If nothing about the underlying facts changed, we never re-call the API -
 *     this is what keeps 380+ pages affordable instead of 380+ calls every build.
 *
 *  3. Fact-checked after generation, not trusted blindly. Every number the model
 *     writes is extracted and checked against the exact facts it was given. A
 *     model can still contradict a real number - that failure mode is exactly
 *     the one this whole project has been built to avoid, so it gets flagged
 *     loudly rather than silently shipped.
 *
 *  4. Fails open, not closed: if no API key is configured, or a call fails, the
 *     build proceeds without AI content rather than breaking - the site's core
 *     value (the calculators) never depends on this succeeding.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface FactSet {
  [key: string]: string | number;
}

interface CacheEntry {
  factsHash: string;
  text: string;
  generatedAt: string;
  model: string;
}

type CacheFile = Record<string, CacheEntry>;

const CACHE_PATH = path.join(process.cwd(), 'data', 'ai-content-cache.json');
const MODEL = 'gemini-2.5-flash'; // cheap/fast tier - fine for short supporting paragraphs

function loadCache(): CacheFile {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cache: CacheFile): void {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

export function hashFacts(facts: FactSet): string {
  const normalized = JSON.stringify(facts, Object.keys(facts).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Extracts every standalone number from generated text and checks each one
 * appears somewhere in the fact set's values. This is a heuristic, not a
 * guarantee - it will occasionally flag a legitimate incidental number (a
 * year, "24/7") as a false positive. It is a WARNING signal for review, not
 * an automatic build failure, because natural-language number extraction is
 * inherently imprecise. Treat a flag as "a human should read this," not
 * "this is definitely wrong."
 */
export function checkFactualDrift(text: string, facts: FactSet): string[] {
  const factNumbers = new Set(
    Object.values(facts)
      .filter(v => typeof v === 'number' || /^-?\d+\.?\d*$/.test(String(v)))
      .map(v => parseFloat(String(v)).toString())
  );
  const foundNumbers = text.match(/-?\d+\.?\d*/g) || [];
  const suspicious: string[] = [];
  for (const n of foundNumbers) {
    const normalized = parseFloat(n).toString();
    if (!factNumbers.has(normalized)) {
      // ignore tiny numbers likely to be incidental (list markers, "one of two", etc.)
      if (Math.abs(parseFloat(n)) >= 10) suspicious.push(n);
    }
  }
  return suspicious;
}

/**
 * Synchronous, read-only lookup used by the regular build (generate.ts).
 * NEVER calls the API - the regular build must work with zero network
 * dependency on Gemini. Returns null if there's no cached content for this
 * key, OR if the underlying facts have changed since it was written (stale
 * content is treated as absent, never shown as if it were current).
 */
export function readCachedContent(pageKey: string, facts: FactSet): string | null {
  const cache = loadCache();
  const entry = cache[pageKey];
  if (!entry) return null;
  if (entry.factsHash !== hashFacts(facts)) {
    console.warn(`[ai-content] ${pageKey}: cached content is stale (underlying facts changed) - run "npm run ai:generate" to refresh. Omitting for now.`);
    return null;
  }
  return entry.text;
}

function buildPrompt(topic: string, facts: FactSet): string {
  const factLines = Object.entries(facts).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  return `Write a short (2-3 sentence) plain-English explanation for a webpage about: ${topic}

You MUST use only these exact facts - do not introduce any other numbers, statistics, or claims not listed here:
${factLines}

Rules:
- Do not invent any number not listed above.
- Do not make claims about trends, rankings, or comparisons unless directly supported by the facts given.
- Write in a neutral, helpful tone. No marketing language, no exclamation points.
- Output only the explanation text, nothing else.`;
}

/**
 * Returns cached text if the facts haven't changed since last generation.
 * Otherwise calls Gemini, fact-checks the result, and caches it.
 * Returns null (not an error) if no API key is set or the call fails -
 * callers should treat null as "skip the AI section for this page."
 */
export async function getOrGenerateContent(
  pageKey: string,
  topic: string,
  facts: FactSet
): Promise<{ text: string; warnings: string[] } | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  const cache = loadCache();
  const factsHash = hashFacts(facts);

  const cached = cache[pageKey];
  if (cached && cached.factsHash === factsHash) {
    return { text: cached.text, warnings: [] };
  }

  if (!apiKey) {
    console.warn(`[ai-content] No GEMINI_API_KEY set - skipping AI content for ${pageKey}`);
    return null;
  }

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const prompt = buildPrompt(topic, facts);

    const response = await ai.models.generateContent({ model: MODEL, contents: prompt });
    const text = (response.text ?? '').trim();

    if (!text) {
      console.warn(`[ai-content] Empty response for ${pageKey} - skipping`);
      return null;
    }

    const warnings = checkFactualDrift(text, facts);
    if (warnings.length) {
      console.warn(`[ai-content] ${pageKey}: possible unsupported numbers in AI text: ${warnings.join(', ')} - review before trusting this page's AI section`);
    }

    cache[pageKey] = { factsHash, text, generatedAt: new Date().toISOString().slice(0, 10), model: MODEL };
    saveCache(cache);

    return { text, warnings };
  } catch (err) {
    console.warn(`[ai-content] Generation failed for ${pageKey}: ${err instanceof Error ? err.message : String(err)} - skipping`);
    return null;
  }
}
