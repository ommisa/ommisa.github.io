#!/usr/bin/env node
/**
 * export-chrome.mjs — extracts the federation chrome (header, footer,
 * the head's asset tags, the theme-init script) from the fixture's
 * chrome-export page into dist-chrome/, for injection into
 * foreign-built sites (TODO.fix/07). Run AFTER the fixture build:
 *
 *   node scripts/export-chrome.mjs [fixtureDist] [outDir]
 *
 * Defaults: test/fixture/dist → dist-chrome (both relative to the
 * site-shell package root, resolved from this script's location).
 *
 * Emits:
 *   dist-chrome/header.html   the <header> markup (astro-islands incl.)
 *   dist-chrome/footer.html   the <footer> markup
 *   dist-chrome/head.html     the <link>/<script> asset tags + theme init
 *   dist-chrome/_astro/**     the hashed assets the tags reference
 *   dist-chrome/manifest.json the file list + the build's commit
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { CHROME_MARKERS } from '../src/data/chrome.mjs'

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_DIST = process.argv[2] ?? join(PKG, 'test/fixture/dist')
const OUT = process.argv[3] ?? join(PKG, 'dist-chrome')

const page = readFileSync(join(FIXTURE_DIST, 'chrome-export/index.html'), 'utf8')

function markerRange(text, name) {
  const marker = CHROME_MARKERS[name]
  const start = text.indexOf(`<!-- ${marker.start} -->`)
  const end = text.indexOf(`<!-- ${marker.end} -->`)
  if (start < 0 || end < 0) throw new Error(`chrome-${name} markers not found`)
  return [start, end]
}

function between(text, name) {
  const [start, end] = markerRange(text, name)
  return text.slice(start, end).replace(`<!-- ${CHROME_MARKERS[name].start} -->`, '').trim()
}

// The head's stylesheet links plus the inline <script> blocks that
// belong to the document (the island runtime, the hydration bootstrap,
// the theme init). Scripts that fall inside the header/footer marker
// ranges stay with their fragments — collecting them here too would
// duplicate the island runtime on injection.
const headerRange = markerRange(page, 'header')
const footerRange = markerRange(page, 'footer')
const inside = (idx, [a, b]) => idx >= a && idx <= b

const head = page.slice(page.indexOf('<head>'), page.indexOf('</head>'))
const styleTags = [...head.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)].map(m => m[0])
const inlineScripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .filter(m => !inside(m.index, headerRange) && !inside(m.index, footerRange))
  .map(m => m[0])
if (inlineScripts.length === 0) throw new Error('no inline scripts found (island runtime missing)')

const header = between(page, 'header')
const footer = between(page, 'footer')

// Asset URLs in the fragments are emitted root-relative (the fixture
// builds with base '/'); consumers rewrite them to their own base.
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'header.html'), header + '\n')
writeFileSync(join(OUT, 'footer.html'), footer + '\n')
writeFileSync(join(OUT, 'head.html'), [...styleTags, ...inlineScripts].join('\n') + '\n')

const astroAssets = join(FIXTURE_DIST, '_astro')
if (existsSync(astroAssets)) {
  mkdirSync(join(OUT, '_astro'), { recursive: true })
  cpSync(astroAssets, join(OUT, '_astro'), { recursive: true })
}

let commit = 'unknown'
try { commit = execSync('git rev-parse --short HEAD', { cwd: PKG }).toString().trim() } catch {}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
  generated: new Date().toISOString(),
  commit,
  files: ['header.html', 'footer.html', 'head.html', '_astro/'],
}, null, 2) + '\n')

console.log(`chrome exported to ${OUT} (commit ${commit})`)
