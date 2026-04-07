# Cuban Law MCP Server

**The Gaceta Oficial de Cuba alternative for the AI age.**

[![npm version](https://badge.fury.io/js/@ansvar%2Fcuban-law-mcp.svg)](https://www.npmjs.com/package/@ansvar/cuban-law-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![GitHub stars](https://img.shields.io/github/stars/Ansvar-Systems/Cuban-law-mcp?style=social)](https://github.com/Ansvar-Systems/Cuban-law-mcp)
[![CI](https://github.com/Ansvar-Systems/Cuban-law-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Ansvar-Systems/Cuban-law-mcp/actions/workflows/ci.yml)
[![Provisions](https://img.shields.io/badge/provisions-8%2C948-blue)]()

Query **54 Cuban statutes** -- from the Constitución de la República and the Código Civil to the Código Penal, Código de Trabajo, and more -- directly from Claude, Cursor, or any MCP-compatible client.

If you're building legal tech, compliance tools, or doing Cuban legal research, this is your verified reference database.

Built by [Ansvar Systems](https://ansvar.eu) -- Stockholm, Sweden

---

## Why This Exists

Cuban legal research means navigating the Gaceta Oficial de Cuba (gacetaoficial.gob.cu), sourcing PDFs of legislative texts from a portal that can be slow and difficult to search, and manually cross-referencing across the civil, penal, and commercial codes. Whether you're:

- A **lawyer** validating citations for matters involving Cuban law or Cuban-connected transactions
- A **compliance officer** assessing obligations under Cuban trade, labor, or data regulations
- A **legal tech developer** building tools for researchers or practitioners working with Cuban law
- A **researcher** studying Cuban constitutional, civil, or criminal law across 54 statutes and 8,948 provisions

...you shouldn't need dozens of browser tabs and manual PDF cross-referencing. Ask Claude. Get the exact provision. With context.

This MCP server makes Cuban law **searchable, cross-referenceable, and AI-readable**.

---

## Quick Start

### Use Remotely (No Install Needed)

> Connect directly to the hosted version -- zero dependencies, nothing to install.

**Endpoint:** `https://mcp.ansvar.eu/law-cu/mcp`

| Client | How to Connect |
|--------|---------------|
| **Claude.ai** | Settings > Connectors > Add Integration > paste URL |
| **Claude Code** | `claude mcp add cuban-law --transport http https://mcp.ansvar.eu/law-cu/mcp` |
| **Claude Desktop** | Add to config (see below) |
| **GitHub Copilot** | Add to VS Code settings (see below) |

**Claude Desktop** -- add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cuban-law": {
      "type": "url",
      "url": "https://mcp.ansvar.eu/law-cu/mcp"
    }
  }
}
```

**GitHub Copilot** -- add to VS Code `settings.json`:

```json
{
  "github.copilot.chat.mcp.servers": {
    "cuban-law": {
      "type": "http",
      "url": "https://mcp.ansvar.eu/law-cu/mcp"
    }
  }
}
```

### Use Locally (npm)

```bash
npx @ansvar/cuban-law-mcp
```

**Claude Desktop** -- add to `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "cuban-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/cuban-law-mcp"]
    }
  }
}
```

**Cursor / VS Code:**

```json
{
  "mcp.servers": {
    "cuban-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/cuban-law-mcp"]
    }
  }
}
```

---

## Example Queries

Once connected, just ask naturally (Spanish examples):

- *"¿Qué establece la Constitución de la República de Cuba sobre los derechos fundamentales?"*
- *"¿Cuáles son las disposiciones del Código Civil cubano sobre contratos y obligaciones?"*
- *"Busca artículos sobre propiedad privada en la legislación cubana"*
- *"¿Qué dice el Código Penal sobre los delitos económicos?"*
- *"¿Cuáles son los derechos y deberes del trabajador según el Código de Trabajo?"*
- *"¿Está vigente la Ley de Inversión Extranjera (Ley No. 118)?"*
- *"Valida la cita 'Ley No. 59 de 1987, Código Civil de Cuba'"*
- *"Construye un argumento legal sobre responsabilidad civil contractual en Cuba"*
- *"¿Qué disposiciones regula la Ley de Empresas sobre las formas de gestión no estatal?"*

---

## What's Included

| Category | Count | Details |
|----------|-------|---------|
| **Statutes** | 54 statutes | Key Cuban legislation from official sources |
| **Provisions** | 8,948 sections | Full-text searchable with FTS5 |
| **Database Size** | ~16 MB | Optimized SQLite, portable |
| **Freshness Checks** | Automated | Drift detection against source |

**Verified data only** -- every citation is validated against official sources (gacetaoficial.gob.cu). Zero LLM-generated content.

---

## See It In Action

### Why This Works

**Verbatim Source Text (No LLM Processing):**
- All statute text is ingested from [gacetaoficial.gob.cu](https://www.gacetaoficial.gob.cu) and official Cuban government sources
- Provisions are returned **unchanged** from SQLite FTS5 database rows
- Zero LLM summarization or paraphrasing -- the database contains regulation text, not AI interpretations

**Smart Context Management:**
- Search returns ranked provisions with BM25 scoring (safe for context)
- Provision retrieval gives exact text by statute identifier + chapter/article
- Cross-references help navigate without loading everything at once

**Technical Architecture:**
```
gacetaoficial.gob.cu --> Parse --> SQLite --> FTS5 snippet() --> MCP response
                           ^                        ^
                    Provision parser         Verbatim database query
```

### Traditional Research vs. This MCP

| Traditional Approach | This MCP Server |
|---------------------|-----------------|
| Search Gaceta Oficial by issue number | Search by plain Spanish: *"inversión extranjera propiedad"* |
| Navigate multi-chapter codes manually | Get the exact provision with context |
| Manual cross-referencing between codes | `build_legal_stance` aggregates across sources |
| "¿Está vigente esta ley?" → check manually | `check_currency` tool → answer in seconds |
| Find international basis → dig through UN/IACHR | `get_eu_basis` → linked international instruments |
| No API, no integration | MCP protocol → AI-native |

**Traditional:** Download Gaceta Oficial PDF → Ctrl+F → Cross-reference with Código Civil or Código Penal → Repeat

**This MCP:** *"¿Qué dice el Código Civil sobre el contrato de compraventa de bienes inmuebles?"* → Done.

---

## Available Tools (13)

### Core Legal Research Tools (8)

| Tool | Description |
|------|-------------|
| `search_legislation` | FTS5 full-text search across 8,948 provisions with BM25 ranking. Supports quoted phrases, boolean operators, prefix wildcards |
| `get_provision` | Retrieve specific provision by statute identifier + article/section number |
| `check_currency` | Check if a statute is in force, amended, or repealed |
| `validate_citation` | Validate citation against database -- zero-hallucination check |
| `build_legal_stance` | Aggregate citations from multiple statutes for a legal topic |
| `format_citation` | Format citations per Cuban legal conventions |
| `list_sources` | List all available statutes with metadata and coverage scope |
| `about` | Server info, capabilities, dataset statistics, and coverage summary |

### International Law Integration Tools (5)

| Tool | Description |
|------|-------------|
| `get_eu_basis` | Get international instruments (UN treaties, ILO conventions, IACHR) that a Cuban statute aligns with |
| `get_cuban_implementations` | Find Cuban laws aligning with a specific international instrument |
| `search_eu_implementations` | Search international documents with Cuban implementation counts |
| `get_provision_eu_basis` | Get international law references for a specific provision |
| `validate_eu_compliance` | Check alignment status of Cuban statutes against international standards |

---

## International Law Alignment

Cuba is not an EU member state, but Cuban law intersects with several international frameworks:

- **UN Human Rights Treaties** -- Cuba has ratified the International Covenant on Economic, Social and Cultural Rights and other core UN human rights instruments; these obligations shape the constitutional framework
- **ILO Conventions** -- Cuba has ratified numerous ILO conventions; the Código de Trabajo reflects labor rights obligations including protections against forced labor and discrimination
- **Vienna Convention on Consular Relations** -- Relevant for matters involving foreign nationals in Cuba
- **UN Convention Against Corruption (UNCAC)** -- Cuban anti-corruption statutes reflect UNCAC obligations
- **GAFILAT** -- Cuba participates in the Latin American FATF-style regional body; AML/CFT legislation aligns with FATF recommendations
- **WTO** -- Cuba is a WTO member; trade-related intellectual property and commercial statutes reflect WTO commitments

The international alignment tools allow you to explore these relationships -- checking which Cuban provisions correspond to treaty obligations, and vice versa.

> **Note:** International cross-references reflect alignment and treaty relationships. Cuban law operates within a distinct socialist legal tradition, and the tools help identify where Cuban and international frameworks address similar domains.

---

## Data Sources & Freshness

All content is sourced from authoritative Cuban legal databases:

- **[Gaceta Oficial de Cuba](https://www.gacetaoficial.gob.cu)** -- Official Cuban legislative gazette (primary source)
- **[Asamblea Nacional del Poder Popular](http://www.parlamentocubano.gob.cu)** -- National Assembly official portal

### Data Provenance

| Field | Value |
|-------|-------|
| **Primary source** | gacetaoficial.gob.cu |
| **Retrieval method** | Structured ingestion from official government sources |
| **Language** | Spanish |
| **Coverage** | 54 key Cuban statutes |
| **Database size** | ~16 MB |

**Verified data only** -- every citation is validated against official sources. Zero LLM-generated content.

---

## Security

This project uses multiple layers of automated security scanning:

| Scanner | What It Does | Schedule |
|---------|-------------|----------|
| **CodeQL** | Static analysis for security vulnerabilities | Weekly + PRs |
| **Semgrep** | SAST scanning (OWASP top 10, secrets, TypeScript) | Every push |
| **Gitleaks** | Secret detection across git history | Every push |
| **Trivy** | CVE scanning on filesystem and npm dependencies | Daily |
| **Docker Security** | Container image scanning + SBOM generation | Daily |
| **Socket.dev** | Supply chain attack detection | PRs |
| **OSSF Scorecard** | OpenSSF best practices scoring | Weekly |
| **Dependabot** | Automated dependency updates | Weekly |

See [SECURITY.md](SECURITY.md) for the full policy and vulnerability reporting.

---

## Important Disclaimers

### Legal Advice

> **THIS TOOL IS NOT LEGAL ADVICE**
>
> Statute text is sourced from the Gaceta Oficial de Cuba and official Cuban government sources. However:
> - This is a **research tool**, not a substitute for professional legal counsel
> - **Court case coverage is not included** -- do not rely solely on this for case law research
> - **Verify critical citations** against the Gaceta Oficial for formal proceedings
> - **International cross-references** reflect alignment relationships, not formal transposition
> - **Provincial and municipal legislation is not included** -- this covers national statutes only
> - **Coverage is selective** -- 54 statutes represent key legislation; the full Cuban legal corpus is larger

**Before using professionally, read:** [DISCLAIMER.md](DISCLAIMER.md) | [SECURITY.md](SECURITY.md)

### Client Confidentiality

Queries go through the Claude API. For privileged or confidential matters, use on-premise deployment.

### Professional Responsibility

Members of the **Organización Nacional de Bufetes Colectivos (ONBC)** and other authorized Cuban legal practitioners should ensure any AI-assisted research complies with professional standards on competence and verification of sources before relying on output in client matters or formal proceedings.

---

## Development

### Setup

```bash
git clone https://github.com/Ansvar-Systems/Cuban-law-mcp
cd Cuban-law-mcp
npm install
npm run build
npm test
```

### Running Locally

```bash
npm run dev                                       # Start MCP server
npx @anthropic/mcp-inspector node dist/index.js   # Test with MCP Inspector
```

### Data Management

```bash
npm run ingest           # Ingest statutes from source
npm run build:db         # Rebuild SQLite database
npm run drift:detect     # Run drift detection against anchors
npm run check-updates    # Check for source updates
npm run census           # Generate coverage census
```

### Performance

- **Search Speed:** <100ms for most FTS5 queries
- **Database Size:** ~16 MB (efficient, portable)
- **Reliability:** 100% ingestion success rate across 54 statutes

---

## Related Projects: Complete Compliance Suite

This server is part of **Ansvar's Compliance Suite** -- MCP servers that work together for end-to-end compliance coverage:

### [@ansvar/eu-regulations-mcp](https://github.com/Ansvar-Systems/EU_compliance_MCP)
**Query 49 EU regulations directly from Claude** -- GDPR, AI Act, DORA, NIS2, MiFID II, eIDAS, and more. Full regulatory text with article-level search. `npx @ansvar/eu-regulations-mcp`

### [@ansvar/venezuelan-law-mcp](https://github.com/Ansvar-Systems/Venezuelan-law-mcp)
**Query 474 Venezuelan statutes directly from Claude** -- Latin American legal research companion. `npx @ansvar/venezuelan-law-mcp`

### [@ansvar/us-regulations-mcp](https://github.com/Ansvar-Systems/US_Compliance_MCP)
**Query US federal and state compliance laws** -- HIPAA, CCPA, SOX, GLBA, FERPA, and more. `npx @ansvar/us-regulations-mcp`

### [@ansvar/security-controls-mcp](https://github.com/Ansvar-Systems/security-controls-mcp)
**Query 261 security frameworks** -- ISO 27001, NIST CSF, SOC 2, CIS Controls, SCF, and more. `npx @ansvar/security-controls-mcp`

**70+ national law MCPs** covering Brazil, Canada, Colombia, Denmark, France, Germany, Honduras, Ireland, Netherlands, Nicaragua, Norway, Panama, El Salvador, Sweden, UK, Venezuela, and more.

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Priority areas:
- Statute coverage expansion (beyond the current 54)
- Court case law coverage (Tribunal Supremo Popular)
- Gaceta Oficial amendment tracking
- International treaty cross-reference mapping

---

## Roadmap

- [x] Core statute database with FTS5 search
- [x] Initial corpus ingestion (54 statutes, 8,948 provisions)
- [x] International law alignment tools
- [x] Vercel Streamable HTTP deployment
- [x] npm package publication
- [ ] Statute corpus expansion
- [ ] Court case law coverage
- [ ] Gaceta Oficial automated amendment tracking
- [ ] Historical statute versions
- [ ] Regulatory decree coverage

---

## Citation

If you use this MCP server in academic research:

```bibtex
@software{cuban_law_mcp_2026,
  author = {Ansvar Systems AB},
  title = {Cuban Law MCP Server: AI-Powered Legal Research Tool},
  year = {2026},
  url = {https://github.com/Ansvar-Systems/Cuban-law-mcp},
  note = {54 Cuban statutes with 8,948 provisions and international law alignment}
}
```

---

## License

Apache License 2.0. See [LICENSE](./LICENSE) for details.

### Data Licenses

- **Statutes & Legislation:** Cuban Government -- Gaceta Oficial de Cuba (public domain via official sources)
- **International Metadata:** UN/ILO public domain

---

## About Ansvar Systems

We build AI-accelerated compliance and legal research tools for the global market. This MCP server is part of our Latin American and Caribbean legal coverage expansion -- because making Cuban law accessible for research and compliance shouldn't require navigating slow government portals.

**[ansvar.eu](https://ansvar.eu)** -- Stockholm, Sweden

---

<p align="center">
  <sub>Built with care in Stockholm, Sweden</sub>
</p>
