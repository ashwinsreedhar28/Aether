// Wire shapes for the research Mixer node. These ARE the mesh contract —
// the JSON the surfaces return — so the shell app and voice tool mirror
// them locally rather than importing this file (CLAUDE.md §2: no runtime
// coupling between mesh nodes / surfaces).

// One paper as surfaced by research.{search,brief}. Lifted (trimmed) from
// Pulse's ResearchPaper: paperId is the stable Semantic Scholar id and the
// citation key in a brief; url/pdfUrl are pre-resolved (openAccessPdf →
// arXiv → DOI → S2 page) so the renderer never reconstructs links. arxivId
// / doi from the upstream shape are folded into url/pdfUrl and dropped here.
export interface ResearchPaper {
  paperId: string
  title: string
  abstract: string | null
  year: number | null
  /** Up to 5 author display names, in S2 order. */
  authors: string[]
  venue: string | null
  citationCount: number
  influentialCitationCount: number
  url: string
  pdfUrl: string | null
}

// One section of a synthesized brief. `body` is prose (1-3 sentences);
// `citations` are paperIds that index into the brief's `papers` list — the
// renderer turns each into an inline chip linking to that paper card.
export interface ResearchBriefSection {
  heading: string
  body: string
  citations: string[]
}

// The full brief contract returned by research.brief and recalled by
// research.recent. `citations` inside sections reference entries in
// `papers` by paperId. generatedAt is ISO-8601.
export interface ResearchBrief {
  query: string
  sections: ResearchBriefSection[]
  papers: ResearchPaper[]
  generatedAt: string
}
