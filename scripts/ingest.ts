#!/usr/bin/env tsx
/**
 * Cuban Law MCP -- Census-Driven Ingestion Pipeline
 *
 * Reads data/census.json and fetches + parses every ingestable law
 * from gacetaoficial.gob.cu (PDF downloads from the Official Gazette).
 *
 * Pipeline per law:
 *   1. Download PDF from gacetaoficial.gob.cu
 *   2. Extract text using pdftotext (poppler-utils)
 *   3. Parse articles, definitions, chapter structure
 *   4. Write seed JSON for build-db.ts
 *
 * Features:
 *   - Resume support: skips laws that already have a seed JSON file
 *   - Census update: writes provision counts + ingestion dates back to census.json
 *   - Checkpoint: saves census every 50 laws
 *   - Rate limiting: 300ms minimum between requests
 *
 * Usage:
 *   npm run ingest                    # Full census-driven ingestion
 *   npm run ingest -- --limit 5       # Test with 5 laws
 *   npm run ingest -- --skip-fetch    # Reuse cached PDFs (re-parse only)
 *   npm run ingest -- --force         # Re-ingest even if seed exists
 *
 * Data source: gacetaoficial.gob.cu (Gaceta Oficial de la Republica de Cuba)
 * Format: PDF (text extracted via pdftotext)
 * License: Government Publication
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parseCULawPdf, type ActIndexEntry, type ParsedAct } from './lib/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = path.resolve(__dirname, '../data/source');
const SEED_DIR = path.resolve(__dirname, '../data/seed');
const CENSUS_PATH = path.resolve(__dirname, '../data/census.json');

const USER_AGENT = 'cuban-law-mcp/1.0 (https://github.com/Ansvar-Systems/Cuban-law-mcp; hello@ansvar.ai)';
const MIN_DELAY_MS = 300;

/* ---------- Types ---------- */

interface CensusLawEntry {
  id: string;
  title: string;
  identifier: string;
  url: string;
  status: 'in_force' | 'amended' | 'repealed';
  category: 'act';
  classification: 'ingestable' | 'excluded' | 'inaccessible';
  ingested: boolean;
  provision_count: number;
  ingestion_date: string | null;
  issued_date?: string;
  norm_type?: string;
  gazette_number?: string;
  issuing_body?: string;
}

interface CensusFile {
  schema_version: string;
  jurisdiction: string;
  jurisdiction_name: string;
  portal: string;
  census_date: string;
  agent: string;
  summary: {
    total_laws: number;
    ingestable: number;
    ocr_needed: number;
    inaccessible: number;
    excluded: number;
  };
  laws: CensusLawEntry[];
}

/* ---------- Helpers ---------- */

function parseArgs(): { limit: number | null; skipFetch: boolean; force: boolean } {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let skipFetch = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--skip-fetch') {
      skipFetch = true;
    } else if (args[i] === '--force') {
      force = true;
    }
  }

  return { limit, skipFetch, force };
}

function censusToActEntry(law: CensusLawEntry): ActIndexEntry {
  const shortName = law.identifier || (law.title.length > 30 ? law.title.substring(0, 27) + '...' : law.title);

  return {
    id: law.id,
    title: law.title,
    titleEn: law.title, // Cuban laws are in Spanish; no translation
    shortName,
    status: law.status === 'in_force' ? 'in_force' : law.status === 'amended' ? 'amended' : 'repealed',
    issuedDate: law.issued_date ?? '',
    inForceDate: law.issued_date ?? '',
    url: law.url,
  };
}

/**
 * Download a PDF file with rate limiting.
 */
async function downloadPdf(url: string, outputPath: string): Promise<boolean> {
  await new Promise(resolve => setTimeout(resolve, MIN_DELAY_MS));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/pdf, */*',
        'Accept-Language': 'es,en;q=0.5',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status !== 200) {
      console.log(` HTTP ${response.status}`);
      return false;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Verify it is actually a PDF
    if (buffer.length < 100 || !buffer.subarray(0, 5).toString().startsWith('%PDF')) {
      console.log(' Not a PDF');
      return false;
    }

    fs.writeFileSync(outputPath, buffer);
    return true;
  } catch (err) {
    console.log(` Error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/* ---------- Census I/O ---------- */

function writeCensus(census: CensusFile, censusMap: Map<string, CensusLawEntry>): void {
  census.laws = Array.from(censusMap.values()).sort((a, b) =>
    a.title.localeCompare(b.title),
  );

  census.summary.total_laws = census.laws.length;
  census.summary.ingestable = census.laws.filter(l => l.classification === 'ingestable').length;
  census.summary.inaccessible = census.laws.filter(l => l.classification === 'inaccessible').length;
  census.summary.excluded = census.laws.filter(l => l.classification === 'excluded').length;

  fs.writeFileSync(CENSUS_PATH, JSON.stringify(census, null, 2));
}

/* ---------- Main ---------- */

async function main(): Promise<void> {
  const { limit, skipFetch, force } = parseArgs();

  console.log('Cuban Law MCP -- Ingestion Pipeline (Census-Driven)');
  console.log('====================================================\n');
  console.log('  Source: gacetaoficial.gob.cu (Gaceta Oficial de la Republica de Cuba)');
  console.log('  Format: PDF (text extracted via pdftotext)');
  console.log('  License: Government Publication');

  if (limit) console.log(`  --limit ${limit}`);
  if (skipFetch) console.log(`  --skip-fetch`);
  if (force) console.log(`  --force (re-ingest all)`);

  // Load census
  if (!fs.existsSync(CENSUS_PATH)) {
    console.error(`\nERROR: Census file not found at ${CENSUS_PATH}`);
    console.error('Run "npx tsx scripts/census.ts" first.');
    process.exit(1);
  }

  const census: CensusFile = JSON.parse(fs.readFileSync(CENSUS_PATH, 'utf-8'));
  const ingestable = census.laws.filter(l => l.classification === 'ingestable');
  const acts = limit ? ingestable.slice(0, limit) : ingestable;

  console.log(`\n  Census: ${census.summary.total_laws} total, ${ingestable.length} ingestable`);
  console.log(`  Processing: ${acts.length} laws\n`);

  fs.mkdirSync(SOURCE_DIR, { recursive: true });
  fs.mkdirSync(SEED_DIR, { recursive: true });

  let processed = 0;
  let ingested = 0;
  let skipped = 0;
  let failed = 0;
  let totalProvisions = 0;
  let totalDefinitions = 0;
  const results: { act: string; provisions: number; definitions: number; status: string }[] = [];

  const censusMap = new Map<string, CensusLawEntry>();
  for (const law of census.laws) {
    censusMap.set(law.id, law);
  }

  const today = new Date().toISOString().split('T')[0];

  for (const law of acts) {
    const act = censusToActEntry(law);
    const sourceFile = path.join(SOURCE_DIR, `${act.id}.pdf`);
    const seedFile = path.join(SEED_DIR, `${act.id}.json`);

    // Resume support: skip if seed file already exists
    if (!force && fs.existsSync(seedFile)) {
      try {
        const existing = JSON.parse(fs.readFileSync(seedFile, 'utf-8')) as ParsedAct;
        const provCount = existing.provisions?.length ?? 0;
        const defCount = existing.definitions?.length ?? 0;
        totalProvisions += provCount;
        totalDefinitions += defCount;

        const entry = censusMap.get(law.id);
        if (entry) {
          entry.ingested = true;
          entry.provision_count = provCount;
          entry.ingestion_date = entry.ingestion_date ?? today;
        }

        results.push({ act: act.shortName, provisions: provCount, definitions: defCount, status: 'resumed' });
        skipped++;
        processed++;
        continue;
      } catch {
        // Corrupt seed file, re-ingest
      }
    }

    try {
      // Step 1: Download PDF
      if (!fs.existsSync(sourceFile) || force) {
        if (skipFetch) {
          console.log(`  [${processed + 1}/${acts.length}] No cached PDF for ${act.id}, skipping`);
          results.push({ act: act.shortName, provisions: 0, definitions: 0, status: 'no-cache' });
          failed++;
          processed++;
          continue;
        }

        process.stdout.write(`  [${processed + 1}/${acts.length}] Downloading ${act.id}...`);
        const ok = await downloadPdf(act.url, sourceFile);
        if (!ok) {
          const entry = censusMap.get(law.id);
          if (entry) entry.classification = 'inaccessible';
          results.push({ act: act.shortName, provisions: 0, definitions: 0, status: 'download-failed' });
          failed++;
          processed++;
          continue;
        }

        const size = fs.statSync(sourceFile).size;
        console.log(` OK (${(size / 1024).toFixed(0)} KB)`);
      } else {
        const size = fs.statSync(sourceFile).size;
        console.log(`  [${processed + 1}/${acts.length}] Using cached ${act.id} (${(size / 1024).toFixed(0)} KB)`);
      }

      // Step 2: Parse PDF
      const parsed = parseCULawPdf(sourceFile, act);
      fs.writeFileSync(seedFile, JSON.stringify(parsed, null, 2));
      totalProvisions += parsed.provisions.length;
      totalDefinitions += parsed.definitions.length;
      console.log(`    -> ${parsed.provisions.length} provisions, ${parsed.definitions.length} definitions`);

      const entry = censusMap.get(law.id);
      if (entry) {
        entry.ingested = true;
        entry.provision_count = parsed.provisions.length;
        entry.ingestion_date = today;
      }

      results.push({
        act: act.shortName,
        provisions: parsed.provisions.length,
        definitions: parsed.definitions.length,
        status: 'OK',
      });
      ingested++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`  ERROR parsing ${act.id}: ${msg}`);
      results.push({ act: act.shortName, provisions: 0, definitions: 0, status: `ERROR: ${msg.substring(0, 80)}` });
      failed++;
    }

    processed++;

    // Checkpoint: save census every 50 laws
    if (processed % 50 === 0) {
      writeCensus(census, censusMap);
      console.log(`  [checkpoint] Census updated at ${processed}/${acts.length}`);
    }
  }

  // Final census write
  writeCensus(census, censusMap);

  console.log(`\n${'='.repeat(70)}`);
  console.log('Ingestion Report');
  console.log('='.repeat(70));
  console.log(`\n  Source:      gacetaoficial.gob.cu (PDF extraction)`);
  console.log(`  Processed:   ${processed}`);
  console.log(`  New:         ${ingested}`);
  console.log(`  Resumed:     ${skipped}`);
  console.log(`  Failed:      ${failed}`);
  console.log(`  Total provisions:  ${totalProvisions}`);
  console.log(`  Total definitions: ${totalDefinitions}`);

  // Report failures
  const failures = results.filter(r => r.status.startsWith('download') || r.status.startsWith('ERROR') || r.status === 'no-cache');
  if (failures.length > 0) {
    console.log(`\n  Failed laws:`);
    for (const f of failures.slice(0, 30)) {
      console.log(`    ${f.act}: ${f.status}`);
    }
    if (failures.length > 30) {
      console.log(`    ... and ${failures.length - 30} more`);
    }
  }

  // Report zero-provision successes (may indicate parsing issues)
  const zeroProv = results.filter(r => r.provisions === 0 && r.status === 'OK');
  if (zeroProv.length > 0) {
    console.log(`\n  Zero-provision laws (${zeroProv.length}):`);
    for (const z of zeroProv.slice(0, 20)) {
      console.log(`    ${z.act}`);
    }
    if (zeroProv.length > 20) {
      console.log(`    ... and ${zeroProv.length - 20} more`);
    }
  }

  console.log('');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
