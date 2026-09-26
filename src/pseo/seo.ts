export const SITE_NAME = 'SolarStack'; // CHANGE ME before launch
export const SITE_URL = 'https://example.com'; // CHANGE ME before launch, no trailing slash

/**
 * Keeps <title> tags from being truncated in search results (~60 char safe zone).
 * Drops the branding suffix on long combinations rather than truncating the actual
 * page subject — same fix that was needed on Convertly's fuel-economy pages.
 */
export function buildTitle(base: string): string {
  if (base.includes(SITE_NAME)) return base; // already has the site name - never append it twice
  const withSuffix = `${base} — ${SITE_NAME}`;
  return withSuffix.length <= 60 ? withSuffix : base;
}

/** Warns (does not throw) if a description is outside the safe search-snippet range. */
export function checkDescriptionLength(desc: string, context: string): void {
  if (desc.length < 50 || desc.length > 160) {
    console.warn(`[seo] "${context}" description is ${desc.length} chars (safe range: 50-160): "${desc}"`);
  }
}

export interface JsonLdObject {
  '@context': string;
  '@type': string;
  [key: string]: unknown;
}

export function breadcrumbLd(items: Array<{ name: string; url: string }>): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url
    }))
  };
}

export function faqLd(pairs: Array<{ question: string; answer: string }>): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map(p => ({
      '@type': 'Question',
      name: p.question,
      acceptedAnswer: { '@type': 'Answer', text: p.answer }
    }))
  };
}

export function websiteLd(): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL
  };
}

export function organizationLd(): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL
  };
}

export function webApplicationLd(name: string, dateModified?: string): JsonLdObject {
  const obj: JsonLdObject = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
  };
  if (dateModified) obj.dateModified = dateModified;
  return obj;
}

export function itemListLd(items: Array<{ name: string; url: string }>): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      url: it.url
    }))
  };
}

/**
 * Page HTML shell. Emits one <script> tag per JSON-LD object (not a bundled array —
 * bundling multiple schema objects into one script tag is non-standard and risks
 * being partially ignored by crawlers).
 */
export function pageHead(opts: {
  title: string;
  description: string;
  canonical: string;
  jsonLd?: JsonLdObject[];
  noindex?: boolean;
}): string {
  const { title, description, canonical, jsonLd = [], noindex = false } = opts;
  checkDescriptionLength(description, title);
  const jsonLdTags = jsonLd.map(obj => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow'}">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/style.css">
${jsonLdTags}
</head>
<body>`;
}

export function pageFoot(): string {
  return `</body></html>`;
}

/** Singularizes only the first word of a label - fixes the exact bug found on Convertly's
 * multi-word unit labels ("Minutes per Kilometer" -> "minute per kilometer", not the
 * naive whole-string trailing-s strip which breaks on "Meters per Second" etc. */
export function singularizeLabel(label: string): string {
  const words = label.toLowerCase().split(' ');
  words[0] = (words[0] ?? '').replace(/s$/, '');
  return words.join(' ');
}

export function slugify(s: string): string {
  return s.toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
