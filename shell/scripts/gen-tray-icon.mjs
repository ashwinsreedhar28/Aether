// Generator for the macOS tray (menu-bar) template icons AND the coloured
// dock/app icon. Renders a "radiating dot" — core disc + two fading concentric
// rings — directly into PNG bytes via a hand-rolled writer (no canvas/sharp
// dependency). Produces:
//   resources/icons/trayTemplate.png       (22×22, template / black-on-alpha)
//   resources/icons/trayTemplate@2x.png    (44×44, template / black-on-alpha)
//   resources/icons/appIcon.png            (1024×1024, colour, dock/app)
//
// Adapted from _ingest/Pulse/scripts/gen-tray-icon.mjs (same dot motif, holo
// accent colour swapped in). Run via `pnpm gen:icons` to regenerate.
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------- PNG plumbing ----------
const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c
}
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const u32 = (n) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0)
  return b
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const crc = u32(crc32(Buffer.concat([t, data])))
  return Buffer.concat([u32(data.length), t, data, crc])
}
function encodePng(pixels, size) {
  const stride = size * 4
  const raw = Buffer.alloc(size * (stride + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.concat([u32(size), u32(size), Buffer.from([8, 6, 0, 0, 0])])
  const idat = deflateSync(raw)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const aa = (d) => Math.max(0, Math.min(1, 0.5 - d))
function disc(px, py, cx, cy, r) {
  return aa(Math.hypot(px - cx, py - cy) - r)
}
function roundedSquare(px, py, cx, cy, h, cr) {
  const dx = Math.max(Math.abs(px - cx) - (h - cr), 0)
  const dy = Math.max(Math.abs(py - cy) - (h - cr), 0)
  return aa(Math.hypot(dx, dy) - cr)
}

function over(dstR, dstG, dstB, dstA, sr, sg, sb, sa) {
  const sA = sa / 255
  const dA = dstA / 255
  const outA = sA + dA * (1 - sA)
  if (outA <= 0) return [0, 0, 0, 0]
  const r = (sr * sA + dstR * dA * (1 - sA)) / outA
  const g = (sg * sA + dstG * dA * (1 - sA)) / outA
  const b = (sb * sA + dstB * dA * (1 - sA)) / outA
  return [Math.round(r), Math.round(g), Math.round(b), Math.round(outA * 255)]
}

// ---------- Tray template (radiating dot, black-on-alpha) ----------
// macOS tints template PNGs based on menu-bar appearance — so colour is
// irrelevant; only the alpha shape matters.
function renderTray(size) {
  const px = Buffer.alloc(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  const largeR = size * 0.45
  const largeAlpha = 0.22
  const midR = size * 0.3
  const midAlpha = 0.5
  const coreR = size * 0.16
  const coreAlpha = 1.0

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = x + 0.5
      const q = y + 0.5
      const large = disc(p, q, cx, cy, largeR) * largeAlpha
      const mid = disc(p, q, cx, cy, midR) * midAlpha
      const core = disc(p, q, cx, cy, coreR) * coreAlpha
      const a = Math.min(1, Math.max(large, mid, core))
      const i = (y * size + x) * 4
      px[i] = 0
      px[i + 1] = 0
      px[i + 2] = 0
      px[i + 3] = Math.round(a * 255)
    }
  }
  return encodePng(px, size)
}

// ---------- Dock/app icon (coloured, holo-accent palette) ----------
const BG_EDGE = [0x08, 0x09, 0x0d]
const BG_CENTER = [0x14, 0x16, 0x1c]
const EDGE_LIGHT = [0xff, 0xff, 0xff]
// VIEWER's --holo-accent = #4a9eff (74,158,255). Use it as the dot colour so
// the dock icon reads as "the same brand" as the welcome window.
const DOT_COLOR = [0x4a, 0x9e, 0xff]

function renderAppIcon(size) {
  const px = Buffer.alloc(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  const h = size * 0.48
  const cr = size * 0.225
  const largeR = size * 0.23
  const largeAlpha = 0.22
  const midR = size * 0.16
  const midAlpha = 0.5
  const coreR = size * 0.09
  const coreAlpha = 1.0
  const maxCorner = Math.hypot(h, h)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = x + 0.5
      const q = y + 0.5
      const tileA = roundedSquare(p, q, cx, cy, h, cr)
      if (tileA <= 0) {
        const i = (y * size + x) * 4
        px[i] = 0
        px[i + 1] = 0
        px[i + 2] = 0
        px[i + 3] = 0
        continue
      }
      const distFromCenter = Math.hypot(p - cx, q - cy)
      const t = Math.min(1, distFromCenter / maxCorner)
      const g = Math.pow(t, 1.6)
      const bgR = Math.round(BG_CENTER[0] + (BG_EDGE[0] - BG_CENTER[0]) * g)
      const bgG = Math.round(BG_CENTER[1] + (BG_EDGE[1] - BG_CENTER[1]) * g)
      const bgB = Math.round(BG_CENTER[2] + (BG_EDGE[2] - BG_CENTER[2]) * g)
      let [r, gC, b, A] = [bgR, bgG, bgB, Math.round(tileA * 255)]

      const edgeBand =
        tileA * Math.max(0, 1 - Math.max(Math.abs(p - cx) / h, Math.abs(q - cy) / h))
      const topBias = Math.max(0, 1 - (q - (cy - h)) / (size * 0.08))
      const edgeAlpha = Math.min(0.08, edgeBand * 0.04 + topBias * 0.04)
      if (edgeAlpha > 0) {
        ;[r, gC, b, A] = over(
          r, gC, b, A,
          EDGE_LIGHT[0], EDGE_LIGHT[1], EDGE_LIGHT[2],
          Math.round(edgeAlpha * 255)
        )
      }
      const largeA = disc(p, q, cx, cy, largeR) * largeAlpha
      if (largeA > 0) {
        ;[r, gC, b, A] = over(
          r, gC, b, A,
          DOT_COLOR[0], DOT_COLOR[1], DOT_COLOR[2],
          Math.round(largeA * 255)
        )
      }
      const midA = disc(p, q, cx, cy, midR) * midAlpha
      if (midA > 0) {
        ;[r, gC, b, A] = over(
          r, gC, b, A,
          DOT_COLOR[0], DOT_COLOR[1], DOT_COLOR[2],
          Math.round(midA * 255)
        )
      }
      const coreA = disc(p, q, cx, cy, coreR) * coreAlpha
      if (coreA > 0) {
        ;[r, gC, b, A] = over(
          r, gC, b, A,
          DOT_COLOR[0], DOT_COLOR[1], DOT_COLOR[2],
          Math.round(coreA * 255)
        )
      }
      const i = (y * size + x) * 4
      px[i] = r
      px[i + 1] = gC
      px[i + 2] = b
      px[i + 3] = A
    }
  }
  return encodePng(px, size)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(root, 'resources/icons')
mkdirSync(dir, { recursive: true })
writeFileSync(resolve(dir, 'trayTemplate.png'), renderTray(22))
writeFileSync(resolve(dir, 'trayTemplate@2x.png'), renderTray(44))
writeFileSync(resolve(dir, 'appIcon.png'), renderAppIcon(1024))
console.log('[gen-tray-icon] wrote trayTemplate.png, trayTemplate@2x.png, appIcon.png to', dir)
