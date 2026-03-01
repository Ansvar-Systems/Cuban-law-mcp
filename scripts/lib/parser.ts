/**
 * Cuban Law PDF/Text Parser
 *
 * Parses law text extracted from PDFs downloaded from the
 * Cuban Official Gazette (gacetaoficial.gob.cu). Uses `pdftotext`
 * (poppler-utils) for PDF extraction, then applies regex-based
 * article parsing tuned for Cuban civil law conventions.
 *
 * Cuban legal drafting conventions:
 *
 *   Article patterns:
 *     "Articulo N" / "ARTICULO N" / "Art. N"
 *     "Articulo N.1" (sub-articles in modern laws)
 *     "ARTICULO UNICO" / "Articulo Unico"
 *
 *   Structural patterns:
 *     "TITULO I - ...", "CAPITULO I - ..."
 *     "SECCION Primera", "DISPOSICIONES TRANSITORIAS"
 *     "DISPOSICIONES FINALES", "DISPOSICIONES GENERALES"
 *
 *   Definition patterns:
 *     "se entiende por ..." / "a los efectos de esta ley ..."
 *     "se define como ..." / "se denomina ..."
 *
 * Cuba's legal system is socialist civil law (Spanish-influenced).
 * Laws are published in the Gaceta Oficial de la Republica de Cuba.
 *
 * SECURITY: Uses execFileSync (NOT exec/execSync). The pdfPath argument
 * is passed as an array element to execFileSync, which does NOT spawn a
 * shell. This prevents shell injection even if pdfPath contains malicious
 * characters like backticks, semicolons, or pipes. The file path is never
 * interpolated into a shell command string.
 */

import { execFileSync } from 'child_process';

/* ---------- Shared Types ---------- */

export interface ActIndexEntry {
  id: string;
  title: string;
  titleEn: string;
  shortName: string;
  status: 'in_force' | 'amended' | 'repealed' | 'not_yet_in_force';
  issuedDate: string;
  inForceDate: string;
  url: string;
  description?: string;
}

export interface ParsedProvision {
  provision_ref: string;
  chapter?: string;
  section: string;
  title: string;
  content: string;
}

export interface ParsedDefinition {
  term: string;
  definition: string;
  source_provision?: string;
}

export interface ParsedAct {
  id: string;
  type: 'statute';
  title: string;
  title_en: string;
  short_name: string;
  status: string;
  issued_date: string;
  in_force_date: string;
  url: string;
  description?: string;
  provisions: ParsedProvision[];
  definitions: ParsedDefinition[];
}

/* ---------- PDF Text Extraction ---------- */

/**
 * Extract text from a PDF file using pdftotext (poppler-utils).
 *
 * SECURITY: execFileSync passes arguments as an array, bypassing
 * shell parsing entirely. No shell injection is possible because
 * the arguments are never concatenated into a command string.
 * This is the recommended pattern for running external tools with
 * untrusted file paths.
 */
export function extractTextFromPdf(pdfPath: string): string {
  // First attempt: -layout preserves column structure (gazette PDFs)
  try {
    return execFileSync('pdftotext', ['-layout', pdfPath, '-'], {
      maxBuffer: 50 * 1024 * 1024, // 50 MB
      encoding: 'utf-8',
      timeout: 30000,
    });
  } catch {
    // Fallback: raw extraction without layout (handles corrupt PDFs)
    try {
      return execFileSync('pdftotext', [pdfPath, '-'], {
        maxBuffer: 50 * 1024 * 1024,
        encoding: 'utf-8',
        timeout: 30000,
      });
    } catch {
      return '';
    }
  }
}

/* ---------- Text Cleaning ---------- */

function decodeEntities(text: string): string {
  return text
    .replace(/&aacute;/g, '\u00e1').replace(/&eacute;/g, '\u00e9')
    .replace(/&iacute;/g, '\u00ed').replace(/&oacute;/g, '\u00f3')
    .replace(/&uacute;/g, '\u00fa').replace(/&ntilde;/g, '\u00f1')
    .replace(/&Aacute;/g, '\u00c1').replace(/&Eacute;/g, '\u00c9')
    .replace(/&Iacute;/g, '\u00cd').replace(/&Oacute;/g, '\u00d3')
    .replace(/&Uacute;/g, '\u00da').replace(/&Ntilde;/g, '\u00d1')
    .replace(/&uuml;/g, '\u00fc').replace(/&Uuml;/g, '\u00dc')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
}

function cleanText(text: string): string {
  return decodeEntities(text)
    .replace(/<[^>]*>/g, '')     // Strip any residual HTML tags
    .replace(/\r\n/g, '\n')     // Normalize line endings
    .replace(/\f/g, '\n')       // Form feeds to newlines (PDF page breaks)
    .replace(/\n{3,}/g, '\n\n') // Collapse excessive blank lines
    .trim();
}

/* ---------- Article/Section Parsing ---------- */

// Cuban article patterns (Spanish civil law)
const ARTICLE_PATTERNS = [
  // Modern: "Articulo 1.-", "Articulo 1:", "Articulo 1."
  // With optional accents: "Articulo" or "Articulo"
  /(?:^|\n)\s*(?:Art[ií]culo|ART[IÍ]CULO|Art\.?)\s+((?:\d+[\s.]*(?:bis|ter)?|\d+[A-Z]?(?:\.\d+)?|[ÚU]NICO|PRIMERO|SEGUNDO|TERCERO))\s*[.\u00b0\u00ba]*[-.:;\u2013]?\s*([^\n]*)/gimu,

  // "ARTICULO 1o.-" (with ordinal suffix, common in older Cuban laws)
  /(?:^|\n)\s*ART[IÍ]CULO\s+(\d+)\s*[oO\u00ba\u00b0]\s*[.]*[-.:;\u2013]?\s*([^\n]*)/gimu,
];

// Structural patterns: TITULO, CAPITULO, SECCION, DISPOSICIONES
const CHAPTER_RE = /(?:^|\n)\s*((?:T[IÍ]TULO|CAP[IÍ]TULO|SECCI[OÓ]N|DISPOSICIONES?\s+(?:TRANSITORIAS?|FINALES?|GENERALES?|COMPLEMENTARIAS?|DEROGATORIAS?))\s*[IVXLC0-9]*[^\n]*)/gimu;

// Apartado / Parrafo patterns (sub-article divisions)
const APARTADO_RE = /(?:^|\n)\s*(?:APARTADO|P[AÁ]RRAFO)\s*((?:I{1,3}V?|V?I{0,3}|[ÚU]NICO|\d+)?)\s*[.\u00b0\u00ba]*[-.:;\u2013]?\s*([^\n]*)/gimu;

// Definition patterns specific to Cuban legal drafting
const DEFINITION_PATTERNS = [
  // "se entiende por X: ..." / "se entiende por X, ..."
  /se\s+(?:entiende|entender[aá])\s+por\s+"?([^".:,]{3,80})"?\s*[,:]\s*([^.;]+[.;])/gi,

  // "a los efectos de esta ley/del presente decreto" + numbered definitions
  /(?:a\s+los\s+efectos?\s+de\s+(?:esta|la\s+presente|el\s+presente)\s+(?:ley|decreto|c[oó]digo|norma)[^:]*:\s*)\n?\s*(?:\d+[.)]\s*)?([^:;\u2013-]+)\s*[:;\u2013-]\s*([^.;]+[.;])/gim,

  // "se define como X ..."
  /se\s+(?:define|denomina)\s+(?:como\s+)?"?([^".:]{3,80})"?\s*(?:a|al|la|el|los|las)?\s*([^.;]+[.;])/gi,

  // Quoted term definitions: "X": means/is...
  /["\u201C]([^"\u201D]{2,60})["\u201D]\s*[:;\u2013-]\s*([^.;]+[.;])/gi,
];

/* ---------- Law Text Boundary Detection ---------- */

/**
 * Find where the actual law text begins, skipping gazette headers,
 * preamble, and publishing metadata.
 *
 * Cuban gazette PDFs typically start with:
 *   GACETA OFICIAL DE LA REPUBLICA DE CUBA
 *   (masthead, issue number, date)
 *   ...preamble...
 *   POR CUANTO: ...
 *   RESUELVO: / DECRETA: / HA RESUELTO:
 *   Articulo 1.-
 */
function findLawTextStart(text: string): number {
  const startPatterns = [
    // Executive/legislative preamble closers
    /\bPOR\s+CUANTO\s*:/i,
    /\bRESUELVO\s*:/i,
    /\bDECRETA\s*:/i,
    /\bHA\s+(?:DADO|RESUELTO|APROBADO)\b/i,
    /\bACUERDA\s*:/i,
    /\bDISPONE\s*:/i,
    /\bSE\s+RESUELVE\s*:/i,

    // First article (most reliable marker)
    /(?:^|\n)\s*(?:ART[IÍ]CULO|Art[ií]culo)\s+(?:1|PRIMERO|[ÚU]NICO)\s*[.\u00b0\u00ba]*[-.:;\u2013]/im,

    // TITULO I / CAPITULO I (some laws start with structural headings)
    /(?:^|\n)\s*T[IÍ]TULO\s+(?:I|1|PRIMERO)\b/im,

    // Disposiciones Generales
    /\bDISPOSICIONES\s+GENERALES\b/i,
  ];

  let earliestPos = text.length;
  for (const pattern of startPatterns) {
    const match = pattern.exec(text);
    if (match && match.index < earliestPos) {
      earliestPos = match.index;
    }
  }

  return earliestPos === text.length ? 0 : earliestPos;
}

/* ---------- Main Parse Functions ---------- */

/**
 * Parse cleaned text into structured provisions and definitions.
 */
export function parseCULawText(text: string, act: ActIndexEntry): ParsedAct {
  const cleaned = cleanText(text);
  const startIdx = findLawTextStart(cleaned);
  const lawText = cleaned.substring(startIdx);

  const provisions: ParsedProvision[] = [];
  const definitions: ParsedDefinition[] = [];

  interface Heading {
    ref: string;
    title: string;
    position: number;
  }

  const headings: Heading[] = [];

  // Extract article headings
  for (const pattern of ARTICLE_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = re.exec(lawText)) !== null) {
      const num = match[1].replace(/\s+/g, '').replace(/\.$/, '');
      const title = (match[2] ?? '').trim();
      const ref = `art${num.toLowerCase()}`;

      // Avoid duplicate refs at same position
      if (!headings.some(h => h.ref === ref && Math.abs(h.position - match!.index) < 20)) {
        headings.push({
          ref,
          title: title || `Art\u00edculo ${num}`,
          position: match.index,
        });
      }
    }
  }

  // Apartado/Parrafo headings (as sub-provisions)
  const apartadoRe = new RegExp(APARTADO_RE.source, APARTADO_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = apartadoRe.exec(lawText)) !== null) {
    const num = (match[1] ?? '').trim() || 'unico';
    const title = (match[2] ?? '').trim();

    // Find parent article for this apartado
    let parentRef = '';
    for (const h of headings) {
      if (h.position <= match.index) {
        parentRef = h.ref;
      }
    }

    const ref = parentRef
      ? `${parentRef}-apartado-${num.toLowerCase()}`
      : `apartado-${num.toLowerCase()}`;

    headings.push({
      ref,
      title: title || `Apartado ${num}`,
      position: match.index,
    });
  }

  // Sort all headings by position in text
  headings.sort((a, b) => a.position - b.position);

  // Extract chapter/title structure
  const chapterRe = new RegExp(CHAPTER_RE.source, CHAPTER_RE.flags);
  const chapterPositions: { chapter: string; position: number }[] = [];
  while ((match = chapterRe.exec(lawText)) !== null) {
    chapterPositions.push({
      chapter: match[1].trim(),
      position: match.index,
    });
  }

  // Build provisions from headings
  let currentChapter = '';
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const nextHeading = headings[i + 1];
    const endPos = nextHeading ? nextHeading.position : lawText.length;
    const content = lawText.substring(heading.position, endPos).trim();

    // Update current chapter based on position
    for (const cp of chapterPositions) {
      if (cp.position <= heading.position) {
        currentChapter = cp.chapter;
      }
    }

    // Clean up content: collapse whitespace but preserve paragraph breaks
    const cleanedContent = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');

    if (cleanedContent.length > 10) {
      provisions.push({
        provision_ref: heading.ref,
        chapter: currentChapter || undefined,
        section: currentChapter || act.title,
        title: heading.title,
        content: cleanedContent,
      });
    }
  }

  // Extract definitions
  for (const pattern of DEFINITION_PATTERNS) {
    const defRe = new RegExp(pattern.source, pattern.flags);
    while ((match = defRe.exec(lawText)) !== null) {
      const term = (match[1] ?? '').trim();
      const definition = (match[2] ?? '').trim();

      if (term.length > 2 && term.length < 100 && definition.length > 10) {
        // Find the source provision containing this definition
        let sourceProvision: string | undefined;
        for (let i = headings.length - 1; i >= 0; i--) {
          if (headings[i].position <= match.index) {
            sourceProvision = headings[i].ref;
            break;
          }
        }

        definitions.push({
          term,
          definition,
          source_provision: sourceProvision,
        });
      }
    }
  }

  // Fallback: if no articles found, store entire text as single provision
  if (provisions.length === 0 && lawText.length > 50) {
    provisions.push({
      provision_ref: 'full-text',
      section: act.title,
      title: act.title,
      content: lawText.substring(0, 50000),
    });
  }

  return {
    id: act.id,
    type: 'statute',
    title: act.title,
    title_en: act.titleEn,
    short_name: act.shortName,
    status: act.status,
    issued_date: act.issuedDate,
    in_force_date: act.inForceDate,
    url: act.url,
    provisions,
    definitions,
  };
}

/**
 * Parse a PDF file into a ParsedAct.
 * Extracts text via pdftotext, then parses articles.
 */
export function parseCULawPdf(pdfPath: string, act: ActIndexEntry): ParsedAct {
  const text = extractTextFromPdf(pdfPath);

  if (!text || text.trim().length < 50) {
    return {
      id: act.id,
      type: 'statute',
      title: act.title,
      title_en: act.titleEn,
      short_name: act.shortName,
      status: act.status,
      issued_date: act.issuedDate,
      in_force_date: act.inForceDate,
      url: act.url,
      provisions: [],
      definitions: [],
    };
  }

  return parseCULawText(text, act);
}

/**
 * Parse raw HTML content as if it were law text.
 * Used when gazette content is available as HTML instead of PDF.
 */
export function parseHtml(html: string, act: ActIndexEntry): ParsedAct {
  return parseCULawText(html, act);
}
