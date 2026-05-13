export type ArticleUrgency = 'low' | 'medium' | 'high'
export type ArticleCategory = 'tech' | 'finance' | 'sports' | 'world'

export interface Article {
  id: string
  headline: string
  source: string
  summary: string
  publishedAt: string
  urgency: ArticleUrgency
  category: ArticleCategory
}

// Three hardcoded faked articles. No polling, no mesh, no real source yet —
// the news node arrives in a later PR. Timestamps are fixed ISO strings; the
// relative-time labels will drift as the app sits across days. That's fine
// for week 1 — the data is fake by design.
//
// The tech article uses a placeholder organisation ("Northwind Labs") rather
// than naming a real AI lab + specific feature, so a screenshot leaking the
// shell can't be mistaken for a real claim. Finance and sports content is
// generic-realistic, no specific named falsifiable facts.
export const ARTICLES: Article[] = [
  {
    id: 'fed-rate-shift-2026-05-12',
    headline: 'Fed signals shift in rate trajectory after softer inflation print',
    source: 'Bloomberg',
    summary:
      "Officials are signaling growing comfort with a faster path to easing after the latest core CPI print undershot expectations. Markets now price meaningfully higher odds of a near-term cut, and the front end of the curve has rallied on the news.",
    publishedAt: '2026-05-12T16:00:00Z',
    urgency: 'high',
    category: 'finance'
  },
  {
    id: 'northwind-voice-model-2026-05-12',
    headline: 'Northwind Labs ships on-device voice model with 70 ms first-token latency',
    source: 'TechCrunch',
    summary:
      'The 7B-parameter model runs entirely on-device with no cloud handoff, targeting always-on voice assistants and consumer hardware. Northwind says it matches mid-tier cloud quality on speech tasks while keeping audio off remote servers.',
    publishedAt: '2026-05-12T12:00:00Z',
    urgency: 'medium',
    category: 'tech'
  },
  {
    id: 'knicks-division-2026-05-11',
    headline: 'Knicks clinch division with overtime win over Celtics in Boston',
    source: 'ESPN',
    summary:
      'New York wrapped the Atlantic title with a 118-114 overtime win at TD Garden, securing home court through the first two rounds. Brunson finished with 38; Tatum scored 41 in the loss.',
    publishedAt: '2026-05-11T20:00:00Z',
    urgency: 'low',
    category: 'sports'
  }
]
