#!/usr/bin/env node
// roll-changelog — fold changelog/unreleased/ fragments into CHANGELOG.md (#222).
//
// Lanes never edit CHANGELOG.md's [Unreleased] body; each lane adds ONE
// fragment at changelog/unreleased/<issue>-<slug>.md (house format below).
// A release lane runs this script to compile every fragment — stable order:
// ascending issue number (the filename's numeric prefix), filename as
// tiebreak — into the new version section and delete the fragments.
//
// Fragment house format (see changelog/README.md):
//   ### Added | Changed | Fixed | Removed
//   - one bullet, multi-line continuations indented
// Usually one section per fragment; multiple section blocks are legal.
//
// Usage:
//   node scripts/roll-changelog.mjs --dry-run
//     Print the compiled [Unreleased] body to stdout. No writes. Exit 0
//     even when there are no fragments (CI runs this twice and diffs the
//     outputs — the compile must be deterministic).
//   node scripts/roll-changelog.mjs --version X.Y.Z [--date YYYY-MM-DD]
//     Insert `## [X.Y.Z] - <date>` (date defaults to today, local time)
//     with the compiled body directly under the [Unreleased] stub in
//     CHANGELOG.md, then delete the fragment files. Refuses when there are
//     no fragments.

import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FRAGMENTS_DIR = join(REPO_ROOT, 'changelog', 'unreleased')
const CHANGELOG = join(REPO_ROOT, 'CHANGELOG.md')

const SECTIONS = ['Added', 'Changed', 'Fixed', 'Removed']
const FRAGMENT_NAME = /^(\d+)-[a-z0-9][a-z0-9-]*\.md$/

function fail(msg) {
  console.error(`roll-changelog: ${msg}`)
  process.exit(1)
}

// List fragment files in stable order: ascending issue number, then filename.
function listFragments() {
  let names
  try {
    names = readdirSync(FRAGMENTS_DIR)
  } catch {
    return []
  }
  return names
    .filter((n) => n.endsWith('.md'))
    .map((n) => {
      const m = n.match(FRAGMENT_NAME)
      if (!m) fail(`${n} does not match <issue>-<slug>.md`)
      return { name: n, issue: Number(m[1]) }
    })
    .sort((a, b) => a.issue - b.issue || (a.name < b.name ? -1 : 1))
}

// Parse one fragment into { Section: bulletBlock } — bullet blocks verbatim.
function parseFragment(name) {
  const raw = readFileSync(join(FRAGMENTS_DIR, name), 'utf8')
  const lines = raw.split('\n')
  const bySection = {}
  let current = null
  for (const [i, line] of lines.entries()) {
    const heading = line.match(/^### (\S+)\s*$/)
    if (heading) {
      current = heading[1]
      if (!SECTIONS.includes(current)) {
        fail(`${name}:${i + 1} unknown section "### ${current}" (allowed: ${SECTIONS.join(', ')})`)
      }
      if (current in bySection) fail(`${name}:${i + 1} duplicate section "### ${current}"`)
      bySection[current] = []
      continue
    }
    if (line.trim() === '' && current === null) continue
    if (current === null) fail(`${name}:${i + 1} content before any "### Section" heading`)
    bySection[current].push(line)
  }
  if (current === null) fail(`${name} has no "### Section" heading`)
  const out = {}
  for (const [section, body] of Object.entries(bySection)) {
    // Trim blank edges; require the block to be a bullet list.
    while (body.length && body[0].trim() === '') body.shift()
    while (body.length && body[body.length - 1].trim() === '') body.pop()
    if (!body.length) fail(`${name} section "### ${section}" is empty`)
    if (!body[0].startsWith('- ')) {
      fail(`${name} section "### ${section}" must start with a "- " bullet`)
    }
    out[section] = body.join('\n')
  }
  return out
}

// Compile every fragment into the canonical body: sections in fixed order,
// fragments within a section in listFragments() order. Pure function of the
// fragment files — running it twice must produce identical bytes.
function compile(fragments) {
  const grouped = new Map(SECTIONS.map((s) => [s, []]))
  for (const f of fragments) {
    const parsed = parseFragment(f.name)
    for (const [section, block] of Object.entries(parsed)) grouped.get(section).push(block)
  }
  const parts = []
  for (const section of SECTIONS) {
    const blocks = grouped.get(section)
    if (blocks.length) parts.push(`### ${section}\n${blocks.join('\n')}`)
  }
  return parts.join('\n\n')
}

function roll(version, date) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`--version "${version}" is not X.Y.Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`--date "${date}" is not YYYY-MM-DD`)
  const fragments = listFragments()
  if (!fragments.length) fail('no fragments under changelog/unreleased/ — nothing to roll')
  const body = compile(fragments)

  const changelog = readFileSync(CHANGELOG, 'utf8')
  const lines = changelog.split('\n')
  const unreleasedAt = lines.findIndex((l) => l === '## [Unreleased]')
  if (unreleasedAt === -1) fail('CHANGELOG.md has no "## [Unreleased]" heading')
  let insertAt = lines.length
  for (let i = unreleasedAt + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## [')) {
      insertAt = i
      break
    }
  }
  const section = [`## [${version}] - ${date}`, '', body, '']
  lines.splice(insertAt, 0, ...section)
  writeFileSync(CHANGELOG, lines.join('\n'))
  for (const f of fragments) unlinkSync(join(FRAGMENTS_DIR, f.name))
  console.error(
    `roll-changelog: rolled ${fragments.length} fragment(s) into [${version}] - ${date} and deleted them`,
  )
}

const args = process.argv.slice(2)
function argValue(flag) {
  const i = args.indexOf(flag)
  return i === -1 ? null : (args[i + 1] ?? fail(`${flag} needs a value`))
}

if (args.includes('--dry-run')) {
  const body = compile(listFragments())
  if (body) process.stdout.write(body + '\n')
} else if (argValue('--version')) {
  roll(argValue('--version'), argValue('--date') ?? new Date().toISOString().slice(0, 10))
} else {
  fail('usage: roll-changelog.mjs --dry-run | --version X.Y.Z [--date YYYY-MM-DD]')
}
