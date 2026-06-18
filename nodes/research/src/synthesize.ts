// Claude synthesis — the Mixer half of the research vertical. ONE Anthropic
// call per query turns the ranked paper set into a sectioned brief with
// inline citations. This is the first Aether node that calls an LLM directly
// (Sensors only read; this node synthesizes); the pattern — node-as-LLM-
// caller, key from env, failure → tagged error the handler maps to MeshDeny
// — is recorded in decisions/2026-06-17-research-mixer-anthropic-caller.md.
//
// Key sourcing: ANTHROPIC_API_KEY from the environment (the Anthropic SDK's
// default), flowed to the node via the shell's ...process.env spawn + the
// repo-root .env.local. Model: AETHER_RESEARCH_MODEL env override, else the
// house default below. Per CLAUDE.md the default tracks the latest capable
// Claude model; override it without touching code.

import Anthropic from '@anthropic-ai/sdk'
import { filterToGroundbreaking } from './semanticScholar'
import type { ResearchBriefSection, ResearchPaper } from './types'

// House default model. Overridable via AETHER_RESEARCH_MODEL (config, not a
// code edit) — but unlike the Rung-1.5 composer, this node ships a default so
// the vertical works out of the box once the API key is set. The key is the
// real gate; the model is a quality knob with a safe default.
const DEFAULT_MODEL = 'claude-opus-4-8'
// Bounded output — a brief is a handful of short sections, not an essay.
// Small max_tokens keeps the call well inside the 30s mesh invoke budget.
const MAX_TOKENS = 4096
// Cap how many papers Claude sees: signal over survey, and a bounded prompt.
const SYNTHESIS_PAPER_CAP = 12
const ABSTRACT_CHARS = 1500

export class SynthesisError extends Error {
  readonly code: 'no_api_key' | 'no_papers' | 'failed'
  constructor(code: 'no_api_key' | 'no_papers' | 'failed', message: string) {
    super(message)
    this.code = code
  }
}

function resolveModel(): string {
  const m = process.env.AETHER_RESEARCH_MODEL?.trim()
  return m && m.length > 0 ? m : DEFAULT_MODEL
}

function buildSystemPrompt(): string {
  return (
    'You synthesize a multi-paper research brief from the academic papers ' +
    'below. Cover only the GROUNDBREAKING / INTERESTING work — the user wants ' +
    'signal, not survey. Output STRICT JSON, no prose, no markdown fences:\n\n' +
    '{\n' +
    '  "sections": [\n' +
    '    {\n' +
    '      "heading": "Short display title for this section",\n' +
    '      "body": "1-3 factual sentences. No marketing, no hedging.",\n' +
    '      "citations": ["P1", "P3"]   // refs from the [P#] tags below\n' +
    '    }\n' +
    '  ]\n' +
    '}\n\n' +
    'Pick 3-6 sections that best characterize THIS query — do not reuse a ' +
    'fixed template; different topics deserve different framings. Always ' +
    'include a final section that names 3-5 specific papers worth opening ' +
    '(one clause each), since that is the highest-leverage thing the user can ' +
    'do with the brief. Cite every claim with the [P#] tag(s) for the ' +
    'paper(s) it rests on; if you cannot cite a claim, drop it. Use ' +
    'vocabulary from the abstracts; name papers, techniques, and results ' +
    'rather than vague "researchers are exploring" / "growing interest" ' +
    'phrasing. State substance, not vibes.'
  )
}

function buildUserPrompt(query: string, papers: ResearchPaper[]): string {
  const refList = papers
    .map(
      (p, i) =>
        `[P${i + 1}] ${p.title} (${p.year ?? '—'})${p.venue ? ` — ${p.venue}` : ''}\n` +
        `       Authors: ${p.authors.slice(0, 3).join(', ')}${p.authors.length > 3 ? ' et al.' : ''}\n` +
        `       Citations: ${p.citationCount} (influential ${p.influentialCitationCount})\n` +
        `       Abstract: ${p.abstract?.slice(0, ABSTRACT_CHARS) ?? '—'}`,
    )
    .join('\n\n')
  return `Query: ${query}\n\nPapers (${papers.length} retrieved):\n\n${refList}`
}

// Resolve the model's [P#] citation tags back to paperIds in `subset`,
// keeping only refs that point at a real paper. Citations index into the
// brief's full `papers` list by paperId (the wire contract), so we emit
// paperIds, not [P#] tags.
function resolveCitations(raw: unknown, subset: ResearchPaper[]): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const ref of raw) {
    if (typeof ref !== 'string') continue
    const m = /^P(\d+)$/.exec(ref.trim())
    if (!m) continue
    const idx = Number(m[1]) - 1
    const paper = subset[idx]
    if (paper && !out.includes(paper.paperId)) out.push(paper.paperId)
  }
  return out
}

// Run the single synthesis call. Returns the sectioned brief body; throws
// SynthesisError (no_api_key / no_papers / failed) for the handler to map to
// a clean MeshDeny — never a half-rendered brief.
export async function synthesizeBrief(
  query: string,
  papers: ResearchPaper[],
): Promise<ResearchBriefSection[]> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new SynthesisError(
      'no_api_key',
      'ANTHROPIC_API_KEY not set — the research Mixer cannot synthesize a brief',
    )
  }
  const subset = filterToGroundbreaking(papers).slice(0, SYNTHESIS_PAPER_CAP)
  if (subset.length === 0) {
    throw new SynthesisError('no_papers', 'no papers passed the influence filter for synthesis')
  }

  const client = new Anthropic()
  let raw: string
  try {
    const response = await client.messages.create({
      model: resolveModel(),
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: buildUserPrompt(query, subset) }],
    })
    raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new SynthesisError('failed', `Claude synthesis call failed: ${msg}`)
  }

  // Tolerate fences / stray prose around the JSON object.
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < 0) {
    throw new SynthesisError('failed', 'Claude synthesis returned no JSON object')
  }
  let parsed: { sections?: Array<{ heading?: string; body?: string; citations?: unknown }> }
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new SynthesisError('failed', `Claude synthesis JSON parse failed: ${msg}`)
  }

  const sections: ResearchBriefSection[] = []
  for (const s of parsed.sections ?? []) {
    const heading = typeof s.heading === 'string' ? s.heading.trim() : ''
    const body = typeof s.body === 'string' ? s.body.trim() : ''
    if (!heading || !body) continue
    sections.push({ heading, body, citations: resolveCitations(s.citations, subset) })
  }
  if (sections.length === 0) {
    throw new SynthesisError('failed', 'Claude synthesis produced no usable sections')
  }
  return sections
}
