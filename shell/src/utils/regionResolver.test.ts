// Unit tests for the semantic region grammar (#337) — pure geometry, no React,
// no mesh, no DOM.
//
// Run with Node's built-in runner (Node 22 strips types):
//   node --test shell/src/utils/regionResolver.test.ts
// The relative import carries a .ts extension because the runner resolves it;
// tsconfig sets allowImportingTsExtensions so `tsc --noEmit` accepts it too.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isRegion,
  REGIONS,
  resolveRegion,
  type DisplayBounds,
  type Region,
} from './regionResolver.ts'

const EVEN: DisplayBounds = { width: 1920, height: 1080 }

test('the full grammar resolves to the expected bounds on an even display', () => {
  const expected: Record<Region, { x: number; y: number; width: number; height: number }> = {
    left: { x: 0, y: 0, width: 960, height: 1080 },
    right: { x: 960, y: 0, width: 960, height: 1080 },
    top: { x: 0, y: 0, width: 1920, height: 540 },
    bottom: { x: 0, y: 540, width: 1920, height: 540 },
    'top-left': { x: 0, y: 0, width: 960, height: 540 },
    'top-right': { x: 960, y: 0, width: 960, height: 540 },
    'bottom-left': { x: 0, y: 540, width: 960, height: 540 },
    'bottom-right': { x: 960, y: 540, width: 960, height: 540 },
    'left-third': { x: 0, y: 0, width: 640, height: 1080 },
    'center-third': { x: 640, y: 0, width: 640, height: 1080 },
    'right-third': { x: 1280, y: 0, width: 640, height: 1080 },
    'left-two-thirds': { x: 0, y: 0, width: 1280, height: 1080 },
    'right-two-thirds': { x: 640, y: 0, width: 1280, height: 1080 },
    center: { x: 384, y: 216, width: 1152, height: 648 },
    full: { x: 0, y: 0, width: 1920, height: 1080 },
  }
  for (const region of REGIONS) {
    assert.deepEqual(resolveRegion(region, EVEN), expected[region], region)
  }
})

test('every region stays on-screen with integer bounds, across odd dimensions', () => {
  // Odd widths/heights, prime sizes, a laptop-with-tabs height, and a tiny
  // degenerate display — rounding must never push an edge off-display.
  const displays: DisplayBounds[] = [
    { width: 1367, height: 769 },
    { width: 1013, height: 601 },
    { width: 1512, height: 905 }, // MBP renderer minus workspace tabs
    { width: 101, height: 67 },
    { width: 3, height: 3 },
  ]
  for (const display of displays) {
    for (const region of REGIONS) {
      const b = resolveRegion(region, display)
      for (const v of [b.x, b.y, b.width, b.height]) {
        assert.equal(Number.isInteger(v), true, `${region} non-integer on ${display.width}x${display.height}`)
      }
      assert.equal(b.x >= 0 && b.y >= 0, true, `${region} origin off-display`)
      assert.equal(
        b.x + b.width <= display.width && b.y + b.height <= display.height,
        true,
        `${region} drifts off ${display.width}x${display.height}: ${JSON.stringify(b)}`,
      )
      assert.equal(b.width >= 1 && b.height >= 1, true, `${region} degenerate size`)
    }
  }
})

test('complementary regions abut exactly — no gap, no 1px overlap', () => {
  const displays: DisplayBounds[] = [
    { width: 1367, height: 769 },
    { width: 1013, height: 601 },
    EVEN,
  ]
  for (const d of displays) {
    const left = resolveRegion('left', d)
    const right = resolveRegion('right', d)
    assert.equal(left.x + left.width, right.x, 'left|right seam')
    assert.equal(left.width + right.width, d.width, 'halves partition width')

    const top = resolveRegion('top', d)
    const bottom = resolveRegion('bottom', d)
    assert.equal(top.y + top.height, bottom.y, 'top|bottom seam')
    assert.equal(top.height + bottom.height, d.height, 'halves partition height')

    const lt = resolveRegion('left-third', d)
    const ct = resolveRegion('center-third', d)
    const rt = resolveRegion('right-third', d)
    assert.equal(lt.x + lt.width, ct.x, 'left-third|center-third seam')
    assert.equal(ct.x + ct.width, rt.x, 'center-third|right-third seam')
    assert.equal(lt.width + ct.width + rt.width, d.width, 'thirds partition width')

    // Two-thirds share their inner edge with the opposite third.
    assert.equal(resolveRegion('left-two-thirds', d).width, lt.width + ct.width)
    assert.equal(resolveRegion('right-two-thirds', d).x, lt.width)
  }
})

test('quadrants tile the display exactly', () => {
  const d: DisplayBounds = { width: 1367, height: 769 }
  const tl = resolveRegion('top-left', d)
  const tr = resolveRegion('top-right', d)
  const bl = resolveRegion('bottom-left', d)
  const br = resolveRegion('bottom-right', d)
  assert.equal(tl.width + tr.width, d.width)
  assert.equal(tl.height + bl.height, d.height)
  assert.deepEqual({ x: br.x, y: br.y }, { x: tl.width, y: tl.height })
  assert.equal(br.x + br.width, d.width)
  assert.equal(br.y + br.height, d.height)
})

test('center floats 60% centered; full covers the display verbatim', () => {
  const d: DisplayBounds = { width: 1367, height: 769 }
  const c = resolveRegion('center', d)
  // Centered within 1px on each side (independent-edge rounding).
  assert.equal(Math.abs(c.x - (d.width - (c.x + c.width))) <= 1, true, 'center x-margin symmetry')
  assert.equal(Math.abs(c.y - (d.height - (c.y + c.height))) <= 1, true, 'center y-margin symmetry')
  assert.equal(Math.abs(c.width - d.width * 0.6) <= 1, true, 'center is ~60% wide')
  assert.deepEqual(resolveRegion('full', d), { x: 0, y: 0, width: d.width, height: d.height })
})

test('isRegion accepts the full grammar and nothing else', () => {
  for (const region of REGIONS) assert.equal(isRegion(region), true, region)
  for (const junk of ['middle', 'left half', 'LEFT', 'top_left', '', 'centre']) {
    assert.equal(isRegion(junk), false, junk)
  }
})
