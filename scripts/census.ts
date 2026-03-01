#!/usr/bin/env tsx
/**
 * Cuban Law MCP -- Census Script
 *
 * Enumerates Cuban laws from the Official Gazette portal
 * (gacetaoficial.gob.cu), which runs on Drupal.
 *
 * Strategy:
 *   Browse /es/algunas-legislaciones-cubanas with Drupal pagination
 *   (?page=0, ?page=1, ...). Each page lists legislation entries with
 *   direct PDF download links whose href contains /sites/default/files/.
 *
 *   Pagination: Drupal pager at the bottom of the page has an "última"
 *   (last page) link whose href gives the max page number (?page=N).
 *   Pages are 0-indexed.
 *
 * Source: https://www.gacetaoficial.gob.cu/es/algunas-legislaciones-cubanas
 * Language: Spanish
 * Format: Drupal HTML listing pages with embedded PDF links
 *
 * Usage:
 *   npx tsx scripts/census.ts
 *   npx tsx scripts/census.ts --limit 100
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../data');
const CENSUS_PATH = path.join(DATA_DIR, 'census.json');

const BASE_URL = 'https://www.gacetaoficial.gob.cu';
const LISTINGS_PATH = '/es/algunas-legislaciones-cubanas';
const LISTINGS_URL = `${BASE_URL}${LISTINGS_PATH}`;

const USER_AGENT = 'cuban-law-mcp/1.0 (https://github.com/Ansvar-Systems/Cuban-law-mcp; hello@ansvar.ai)';
const MIN_DELAY_MS = 500;

/* ---------- Types ---------- */

interface RawLawEntry {
  title: string;
  pdfUrl: string;
  year: string;
  normType: string;
  filename: string;
}

/* ---------- HTTP ---------- */

let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_DELAY_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_DELAY_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

async function fetchPage(url: string): Promise<string> {
  await rateLimit();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html, application/xhtml+xml, */*',
        'Accept-Language': 'es,en;q=0.5',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return response.text();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/* ---------- Parsing ---------- */

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í').replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú').replace(/&ntilde;/gi, 'ñ')
    .replace(/&Aacute;/gi, 'Á').replace(/&Eacute;/gi, 'É')
    .replace(/&Iacute;/gi, 'Í').replace(/&Oacute;/gi, 'Ó')
    .replace(/&Uacute;/gi, 'Ú').replace(/&Ntilde;/gi, 'Ñ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»');
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60);
}

/**
 * Extract the maximum page number from the Drupal pager.
 *
 * The pager has an "última" (last) link:
 *   <a href="?page=N">última »</a>
 * or
 *   <a href="/es/algunas-legislaciones-cubanas?page=N" ...>última »</a>
 *
 * Returns the max page number, or 0 if pagination is not found.
 */
function extractMaxPage(html: string): number {
  // Look for the "última" link in the pager section
  // Pattern: href containing ?page=N near the text "última"
  const ultimaRe = /<a\s+[^>]*href="[^"]*\?page=(\d+)"[^>]*>[^<]*[uú]ltima[^<]*<\/a>/gi;
  let match: RegExpExecArray | null;
  let maxPage = 0;

  while ((match = ultimaRe.exec(html)) !== null) {
    const pageNum = parseInt(match[1], 10);
    if (pageNum > maxPage) {
      maxPage = pageNum;
    }
  }

  if (maxPage > 0) return maxPage;

  // Fallback: look for any pager link with ?page=N and find the highest
  const pagerRe = /\?page=(\d+)/g;
  while ((match = pagerRe.exec(html)) !== null) {
    const pageNum = parseInt(match[1], 10);
    if (pageNum > maxPage) {
      maxPage = pageNum;
    }
  }

  return maxPage;
}

/**
 * Extract PDF links from a listing page.
 *
 * Each legislation entry has:
 *   <a href="https://www.gacetaoficial.gob.cu/sites/default/files/{filename}.pdf">Title</a>
 * or
 *   <a href="/sites/default/files/{filename}.pdf">Title</a>
 *
 * We keep only links whose href contains "/sites/default/files/" and ends with ".pdf".
 */
function extractPdfEntries(html: string): RawLawEntry[] {
  const entries: RawLawEntry[] = [];
  const seen = new Set<string>();

  // Cuba's Drupal page uses a table with <tr> rows.
  // Each row has: TD0 = title text, TD1 = <a href=URL.pdf> (download icon, no text).
  // The href is UNQUOTED: href=https://...pdf> (no quotes around URL).
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(html)) !== null) {
    const row = rowMatch[1];

    // Find PDF URL (unquoted or quoted href)
    const pdfMatch = row.match(/href=["']?([^\s"'>]*\/sites\/default\/files\/[^\s"'>]*\.pdf)/i);
    if (!pdfMatch) continue;

    const rawHref = pdfMatch[1];
    const pdfUrl = rawHref.startsWith('http')
      ? rawHref
      : `${BASE_URL}${rawHref}`;

    if (seen.has(pdfUrl)) continue;
    seen.add(pdfUrl);

    // Extract title from the first <td> cell
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const firstTd = tdRe.exec(row);
    const rawTitle = firstTd ? stripHtml(firstTd[1]).trim() : '';

    if (!rawTitle || rawTitle.length < 3) continue;

    const title = decodeHtmlEntities(rawTitle);

    const urlPath = new URL(pdfUrl).pathname;
    const filename = urlPath.split('/').pop() || '';

    const year = extractYearFromFilename(filename)
      || extractYearFromTitle(title);

    const normType = classifyNormType(title);

    entries.push({ title, pdfUrl, year, normType, filename });
  }

  return entries;
}

/**
 * Extract year from filename.
 * Common patterns:
 *   goc-2024-ex5.pdf        -> 2024
 *   goc-2023-o91.pdf        -> 2023
 *   goc-2019-ex56.pdf       -> 2019
 *   other-name-2020.pdf     -> 2020 (fallback)
 */
function extractYearFromFilename(filename: string): string {
  // Primary pattern: goc-YYYY-...
  const gocMatch = filename.match(/goc-(\d{4})-/i);
  if (gocMatch) return gocMatch[1];

  // Fallback: any 4-digit year in the filename
  const yearMatch = filename.match(/(19\d{2}|20[0-2]\d)/);
  return yearMatch ? yearMatch[1] : '';
}

function extractYearFromTitle(title: string): string {
  // Match years like "de 2019", "del 2020", "No. 35 de 2018"
  const yearMatch = title.match(/\b(19\d{2}|20[0-2]\d)\b/);
  return yearMatch ? yearMatch[1] : '';
}

function classifyNormType(title: string): string {
  const t = title.toLowerCase();
  // Order matters: "decreto-ley" must be checked before "decreto" and "ley"
  if (/\bdecreto[\s-]*ley\b/.test(t)) return 'decreto-ley';
  if (/\bconstituci[oó]n\b/.test(t)) return 'constitucion';
  if (/\bc[oó]digo\b/.test(t)) return 'codigo';
  if (/\bley\b/.test(t)) return 'ley';
  if (/\bdecreto\b/.test(t)) return 'decreto';
  if (/\bresoluci[oó]n\b/.test(t)) return 'resolucion';
  if (/\bacuerdo\b/.test(t)) return 'acuerdo';
  if (/\breglamento\b/.test(t)) return 'reglamento';
  if (/\bnorma\b/.test(t)) return 'norma';
  if (/\binstrucci[oó]n\b/.test(t)) return 'instruccion';
  return 'other';
}

function parseArgs(): { limit: number | null } {
  const args = process.argv.slice(2);
  let limit: number | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      if (isNaN(limit) || limit < 1) {
        console.error(`Invalid --limit value: ${args[i + 1]}`);
        process.exit(1);
      }
      i++;
    }
  }

  return { limit };
}

/* ---------- Main ---------- */

async function main(): Promise<void> {
  const { limit } = parseArgs();

  console.log('Cuban Law MCP -- Census');
  console.log('========================\n');
  console.log('  Source: gacetaoficial.gob.cu (Official Gazette)');
  console.log('  URL:    ' + LISTINGS_URL);
  console.log('  Method: Drupal paginated listing with direct PDF links');
  if (limit) console.log(`  --limit ${limit}`);
  console.log('');

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Step 1: Fetch page 0 to discover total pages
  console.log('  Step 1: Fetching page 0 to discover pagination...');
  const firstPageHtml = await fetchPage(LISTINGS_URL);
  const maxPage = extractMaxPage(firstPageHtml);
  const totalPages = maxPage + 1; // 0-indexed

  console.log(`  Found ${totalPages} pages (0 to ${maxPage})\n`);

  // Step 2: Extract PDF entries from page 0
  const allEntries: RawLawEntry[] = [];
  const firstPageEntries = extractPdfEntries(firstPageHtml);
  allEntries.push(...firstPageEntries);
  console.log(`  Page 0: ${firstPageEntries.length} PDF entries`);

  // Step 3: Paginate through remaining pages
  let hitLimit = false;

  for (let page = 1; page <= maxPage; page++) {
    if (limit && allEntries.length >= limit) {
      hitLimit = true;
      console.log(`\n  Reached --limit ${limit}, stopping pagination.`);
      break;
    }

    const url = `${LISTINGS_URL}?page=${page}`;
    process.stdout.write(`  Page ${page}: `);

    try {
      const html = await fetchPage(url);
      const entries = extractPdfEntries(html);

      if (entries.length === 0) {
        console.log('0 entries (empty page)');
      } else {
        console.log(`${entries.length} PDF entries`);
        allEntries.push(...entries);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`error: ${msg}`);
    }
  }

  // Step 4: Deduplicate by PDF URL (already done per-page, but ensure cross-page dedup)
  const seenUrls = new Map<string, RawLawEntry>();
  for (const entry of allEntries) {
    const key = entry.pdfUrl.toLowerCase();
    if (!seenUrls.has(key)) {
      seenUrls.set(key, entry);
    }
  }

  const unique = Array.from(seenUrls.values());
  console.log(`\n  Total entries after dedup: ${unique.length}`);

  // Apply limit
  const finalEntries = limit ? unique.slice(0, limit) : unique;

  // Step 5: Build census entries
  const laws = finalEntries.map((entry) => {
    const id = `cu-${slugify(entry.title)}`;

    return {
      id,
      title: entry.title,
      identifier: entry.title,
      url: entry.pdfUrl,
      status: 'in_force' as const,
      category: 'act' as const,
      classification: 'ingestable' as const,
      ingested: false,
      provision_count: 0,
      ingestion_date: null as string | null,
      issued_date: entry.year ? `${entry.year}-01-01` : '',
      norm_type: entry.normType,
      filename: entry.filename,
    };
  });

  // Summary stats
  const normTypeCounts: Record<string, number> = {};
  const yearCounts: Record<string, number> = {};
  for (const entry of finalEntries) {
    normTypeCounts[entry.normType] = (normTypeCounts[entry.normType] || 0) + 1;
    if (entry.year) {
      yearCounts[entry.year] = (yearCounts[entry.year] || 0) + 1;
    }
  }

  const census = {
    schema_version: '2.0',
    jurisdiction: 'CU',
    jurisdiction_name: 'Cuba',
    portal: 'gacetaoficial.gob.cu',
    portal_url: LISTINGS_URL,
    census_date: new Date().toISOString().split('T')[0],
    agent: 'cuban-law-mcp/census.ts',
    summary: {
      total_laws: laws.length,
      ingestable: laws.length, // All entries have direct PDF links
      ocr_needed: 0,
      inaccessible: 0,
      excluded: 0,
    },
    breakdown: {
      by_norm_type: normTypeCounts,
      by_year: yearCounts,
    },
    laws,
  };

  fs.writeFileSync(CENSUS_PATH, JSON.stringify(census, null, 2));

  console.log('\n==================================================');
  console.log('CENSUS COMPLETE');
  console.log('==================================================');
  console.log(`  Total laws discovered:  ${laws.length}`);
  console.log(`  All ingestable (PDF):   ${laws.length}`);
  console.log('');
  console.log('  By norm type:');
  for (const [type, count] of Object.entries(normTypeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }
  if (Object.keys(yearCounts).length > 0) {
    const years = Object.keys(yearCounts).sort();
    console.log(`\n  Year range: ${years[0]} - ${years[years.length - 1]}`);
  }
  console.log(`\n  Output: ${CENSUS_PATH}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
