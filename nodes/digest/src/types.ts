// One ordered slice of a composed briefing. Each section is independently
// rendered (voice tool concatenates section.summary into a spoken
// monologue; a future Digest UI app can render items[] structurally).
//
// summary is prose, voice-readable as-is — 2–3 sentences, no bullet
// lists. items is optional structured payload for any future renderer;
// the voice path never touches it.
//
// "available: false" sections still ship in the response so the consumer
// sees the placement (and Gemini can mention the gap as part of the
// briefing) instead of silently omitting the section. Pattern matches
// the finance_history insufficient-history shape — a structured
// negative is louder than missing keys.
export interface BriefingSection {
  title: string
  summary: string
  available: boolean
  items?: unknown[]
}

export interface BriefingResult {
  briefing: BriefingSection[]
  generated_at: string
  time_of_day: 'morning' | 'evening'
}

export type TimeOfDay = 'morning' | 'evening'
