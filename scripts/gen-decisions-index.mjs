#!/usr/bin/env node
// gen-decisions-index — regenerate DECISIONS.md from decisions/*.md (#222).
//
// ADRs live one per file under decisions/, named <date>-<slug>.md, each
// opening with the canonical header line `## [YYYY-MM-DD] <Title>`.
// DECISIONS.md is a GENERATED index of those files — never hand-edited.
// The append-only law survives the split trivially: a new decision is a new
// file; a supersession flips one old file's Status line and adds one new
// file. Regenerate the index in the same PR as any decisions/ change.
//
// Usage:
//   node scripts/gen-decisions-index.mjs           # rewrite DECISIONS.md
//   node scripts/gen-decisions-index.mjs --check   # exit 1 if DECISIONS.md
//                                                  # differs from generated
//
// Index order: dates descending; within a date, filename ascending
// (deterministic; intra-date order is presentation only — each ADR's date
// lives in its header, recency within a day carries no law).

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DECISIONS_DIR = join(REPO_ROOT, 'decisions')
const INDEX = join(REPO_ROOT, 'DECISIONS.md')

const FILE_NAME = /^(\d{4}-\d{2}-\d{2})-[a-z0-9][a-z0-9-]*\.md$/
const HEADER = /^## \[(\d{4}-\d{2}-\d{2})\] (.+)$/

function fail(msg) {
  console.error(`gen-decisions-index: ${msg}`)
  process.exit(1)
}

function generate() {
  let names
  try {
    names = readdirSync(DECISIONS_DIR).filter((n) => n.endsWith('.md'))
  } catch {
    fail('decisions/ directory not found')
  }
  const entries = names.map((name) => {
    if (!FILE_NAME.test(name)) fail(`${name} does not match <YYYY-MM-DD>-<slug>.md`)
    const firstLine = readFileSync(join(DECISIONS_DIR, name), 'utf8').split('\n', 1)[0]
    const m = firstLine.match(HEADER)
    if (!m) fail(`${name} does not open with "## [YYYY-MM-DD] <Title>" (got: ${firstLine})`)
    if (!name.startsWith(m[1])) fail(`${name} filename date differs from header date ${m[1]}`)
    return { name, date: m[1], title: m[2] }
  })
  entries.sort((a, b) => (a.date === b.date ? (a.name < b.name ? -1 : 1) : a.date < b.date ? 1 : -1))

  const lines = entries.map((e) => `- **[${e.date}]** [${e.title}](decisions/${e.name})`)
  return `# Decisions

Append-only Architecture Decision Records for Aether (working name
homeOS through v0.3.x). Format and rules per CLAUDE.md §8.

**This file is a GENERATED index — do not hand-edit.** ADRs live one per
file under [\`decisions/\`](decisions/), named \`<date>-<slug>.md\`. Never
edit a past ADR file — supersede with a new file and flip the old file's
\`Status:\` to \`superseded by [link]\`. Regenerate this index with
\`node scripts/gen-decisions-index.mjs\` in the same PR as any decisions/
change. Entries dated before the rename PR refer to the project by its
working name; they are preserved verbatim as historical record.

${lines.join('\n')}
`
}

const generated = generate()
if (process.argv.includes('--check')) {
  let current = null
  try {
    current = readFileSync(INDEX, 'utf8')
  } catch {
    fail('DECISIONS.md missing — run without --check to generate it')
  }
  if (current !== generated) {
    fail('DECISIONS.md is out of date — run `node scripts/gen-decisions-index.mjs`')
  }
  console.error('gen-decisions-index: DECISIONS.md matches decisions/')
} else {
  writeFileSync(INDEX, generated)
  console.error('gen-decisions-index: DECISIONS.md regenerated')
}
