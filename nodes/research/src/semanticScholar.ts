// Semantic Scholar Graph API client — paper search + ranking.
//
// Lifted (geography only) from Pulse's researchService.ts: same base URL,
// PAPER_FIELDS projection, fromS2Paper link-resolution, and influence-
// weighted paperScore ranking. Deliberately simplified per CLAUDE.md §11.8:
// the citation-lineage endpoints (citations/references/foundational/bridge)
// are out of scope this lane (the Phase-3 piece), and Pulse's 5s/15s 429
// retry backoff is dropped — a brief runs inside the mesh's 30s invoke
// budget (core invoke_timeout_s), so a single bounded fetch that surfaces a
// rate-limit as a clean failure beats a retry schedule that would blow the
// budget. Callers turn a failure into a MeshDeny.

import type { ResearchPaper } from './types'

const S2_BASE = 'https://api.semanticscholar.org/graph/v1'
// 12s, not Pulse's 20s: the brief surface must finish a search + a Claude
// synthesis inside the 30s mesh invoke budget. 12s is ample for a single
// S2 query on the anonymous tier and leaves the rest of the budget for the
// LLM call.
const FETCH_TIMEOUT_MS = 12_000
const SEARCH_LIMIT = 25
// Pull these fields on every paper request — everything the brief generator
// + the renderer need, nothing more. `authors` (not `authors.name`) is the
// whole-object form the search endpoint accepts; fromS2Paper extracts .name.
const PAPER_FIELDS = [
  'paperId',
  'title',
  'abstract',
  'year',
  'authors',
  'venue',
  'citationCount',
  'influentialCitationCount',
  'url',
  'openAccessPdf',
  'externalIds',
].join(',')

// Identify ourselves to the API operators per S2's guidelines; mailto lets
// them reach us if our traffic pattern looks abusive. No API key — the
// anonymous tier is enough for on-demand single-user queries.
const UA = 'Aether-research/0.1 (mesh node; ashwin.sreedhar2003@gmail.com)'

// Tagged error so the node handler can render a clean MeshDeny reason
// (rate-limited vs upstream-error vs empty) rather than leaking an HTTP code.
export class S2Error extends Error {
  readonly code: 'rate_limited' | 'upstream'
  constructor(code: 'rate_limited' | 'upstream', message: string) {
    super(message)
    this.code = code
  }
}

interface S2Paper {
  paperId?: string
  title?: string
  abstract?: string | null
  year?: number | null
  authors?: Array<{ name?: string }>
  venue?: string | null
  citationCount?: number
  influentialCitationCount?: number
  url?: string | null
  openAccessPdf?: { url?: string } | null
  externalIds?: { ArXiv?: string; DOI?: string }
}

function fromS2Paper(p: S2Paper): ResearchPaper | null {
  if (!p.paperId || !p.title) return null
  const arxivId = p.externalIds?.ArXiv ?? null
  const doi = p.externalIds?.DOI ?? null
  // Prefer openAccessPdf, then arXiv direct PDF, then null.
  const pdfUrl = p.openAccessPdf?.url ?? (arxivId ? `https://arxiv.org/pdf/${arxivId}` : null)
  // Best landing URL: explicit url, then arXiv abs page, then DOI resolver,
  // then the S2 paper page as a guaranteed fallback.
  const url =
    p.url ??
    (arxivId ? `https://arxiv.org/abs/${arxivId}` : null) ??
    (doi ? `https://doi.org/${doi}` : null) ??
    `https://www.semanticscholar.org/paper/${p.paperId}`
  return {
    paperId: p.paperId,
    title: p.title.trim(),
    abstract: typeof p.abstract === 'string' ? p.abstract.trim() : null,
    year: p.year ?? null,
    authors: (p.authors ?? [])
      .map((a) => a.name?.trim() ?? '')
      .filter(Boolean)
      .slice(0, 5),
    venue: p.venue?.trim() || null,
    citationCount: p.citationCount ?? 0,
    influentialCitationCount: p.influentialCitationCount ?? 0,
    url,
    pdfUrl,
  }
}

// "Groundbreaking" score for ranking. Influence-citation count is the
// strongest signal (S2's curated metric of citations that shaped later
// work), with a small recency lift and citation count as a log tiebreaker.
function paperScore(p: ResearchPaper): number {
  const ageYears = Math.max(0, new Date().getFullYear() - (p.year ?? 0))
  const recencyBoost = Math.max(0, 6 - ageYears)
  return (
    p.influentialCitationCount * 5 +
    Math.log10(Math.max(1, p.citationCount)) * 2 +
    recencyBoost
  )
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: controller.signal,
    })
    if (res.status === 429) throw new S2Error('rate_limited', 'Semantic Scholar rate limited')
    if (!res.ok) throw new S2Error('upstream', `Semantic Scholar HTTP ${res.status}`)
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof S2Error) throw err
    const msg = err instanceof Error ? err.message : String(err)
    throw new S2Error('upstream', `Semantic Scholar request failed: ${msg}`)
  } finally {
    clearTimeout(timer)
  }
}

// Search Semantic Scholar for a keyword query, hydrate + influence-rank the
// hits. Throws S2Error on rate-limit / upstream failure (the handler maps it
// to a MeshDeny); an empty result is a normal empty array, not an error.
export async function searchPapers(query: string): Promise<ResearchPaper[]> {
  const q = query.trim()
  if (!q) return []
  const url =
    `${S2_BASE}/paper/search?query=${encodeURIComponent(q)}` +
    `&limit=${SEARCH_LIMIT}&fields=${encodeURIComponent(PAPER_FIELDS)}`
  const response = await fetchJson<{ data?: S2Paper[] }>(url)
  const papers = (response.data ?? [])
    .map(fromS2Paper)
    .filter((p): p is ResearchPaper => p !== null)
  // Re-rank by paperScore — S2's relevance order doesn't always surface the
  // most influential paper first for a multi-faceted query.
  papers.sort((a, b) => paperScore(b) - paperScore(a))
  return papers
}

// Filter to the "groundbreaking / interesting" subset before synthesis.
// Sliding threshold (lifted from Pulse): demand more influence when search
// returns a lot, relax when it returns little. Exported so the synthesizer
// can cap how many papers it feeds Claude.
export function filterToGroundbreaking(papers: ResearchPaper[]): ResearchPaper[] {
  if (papers.length <= 6) return papers
  if (papers.length <= 12) {
    return papers.filter((p) => p.influentialCitationCount >= 1 || p.citationCount >= 10)
  }
  return papers.filter((p) => p.influentialCitationCount >= 3 || p.citationCount >= 30)
}
