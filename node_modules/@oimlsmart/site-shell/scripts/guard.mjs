#!/usr/bin/env node
// The theme guard. Two failure modes from the 2026-08-28 incident, both
// banned:
//
// 1. A rule that sets display:none on a bare theme class (.dark lives on
//    <html>), which blanks every page in that color scheme. Checked in
//    component style blocks, source stylesheets, and the built CSS.
// 2. :global( inside a Vue SFC <style scoped> block. Vue only supports
//    :global wrapping a whole rule; used in prefix position
//    (":global(.dark) .x") compiler-sfc silently drops the rest of the
//    selector and emits a bare global rule — exactly failure mode 1, with
//    no compile error. Astro components are exempt: Astro's scoped styles
//    do support :global().
//
// Exported for scripts/gate.mjs; runs as a CLI standalone.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, relative } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const THEME_CLASSES = new Set(['.dark', 'html.dark'])

function walk(dir, predicate, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === 'node_modules' || name.name === '.git' || name.name === '.astro') continue
    const full = join(dir, name.name)
    if (name.isDirectory()) walk(full, predicate, out)
    else if (predicate(full)) out.push(full)
  }
  return out
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length

function styleBlocks(text) {
  const blocks = []
  const re = /<style\b([^>]*)>([\s\S]*?)<\/style>/g
  let m
  while ((m = re.exec(text))) blocks.push({ attrs: m[1], css: m[2], index: m.index })
  return blocks
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

// --- CSS rule walker: string/comment/brace aware, recurses into at-rule
// --- containers (@media, @layer, @supports), ignores blockless at-rules.
function findClose(css, open) {
  let depth = 0
  for (let i = open; i < css.length; i++) {
    const c = css[i]
    if (c === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); i = e === -1 ? css.length : e - 1; continue }
    if (c === '"' || c === "'") { i++; while (i < css.length && css[i] !== c) { if (css[i] === '\\') i++; i++ } continue }
    if (c === '{') depth++
    if (c === '}') { depth--; if (depth === 0) return i }
  }
  return css.length
}

function hasNestedBlock(body) {
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '/' && body[i + 1] === '*') { const e = body.indexOf('*/', i + 2); i = e === -1 ? body.length : e - 1; continue }
    if (c === '"' || c === "'") { i++; while (i < body.length && body[i] !== c) { if (body[i] === '\\') i++; i++ } continue }
    if (c === '{') return true
  }
  return false
}

function forEachRule(css, cb) {
  let sel = ''
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (c === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); i = e === -1 ? css.length : e - 1; continue }
    if (c === '"' || c === "'") { i++; while (i < css.length && css[i] !== c) { if (css[i] === '\\') i++; i++ } sel += c; continue }
    if (c === ';') { sel = ''; continue }
    if (c === '{') {
      const close = findClose(css, i)
      const body = css.slice(i + 1, close)
      if (hasNestedBlock(body)) forEachRule(body, cb)
      else cb(sel.trim(), body)
      sel = ''
      i = close
      continue
    }
    sel += c
  }
}

function splitSelectors(list) {
  const parts = []
  let cur = ''
  let depth = 0
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (c === '"' || c === "'") { let j = i + 1; while (j < list.length && list[j] !== c) { if (list[j] === '\\') j++; j++ } cur += list.slice(i, j + 1); i = j; continue }
    if (c === '(' || c === '[') depth++
    if (c === ')' || c === ']') depth--
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

// display:none, but never a custom property like --foo-display:none
const HIDES = /(^|[^-\w])display\s*:\s*none\b/

function checkCss(css, where, failures) {
  forEachRule(stripComments(css), (selector, decls) => {
    if (!HIDES.test(decls)) return
    for (const s of splitSelectors(selector)) {
      if (THEME_CLASSES.has(s))
        failures.push(`${where}: "${selector}" sets display:none on the bare theme class ${s} — the whole page goes blank in that scheme (the 0.1.2 bug)`)
    }
  })
}

export function runThemeGuard(distDir) {
  const failures = []

  // leg 1: :global( in .vue <style scoped>
  for (const file of walk(join(ROOT, 'src'), (f) => f.endsWith('.vue'))) {
    const text = readFileSync(file, 'utf8')
    for (const block of styleBlocks(text)) {
      if (!/\bscoped\b/.test(block.attrs)) continue
      const clean = stripComments(block.css)
      if (/:global\s*\(/.test(clean))
        failures.push(`${relative(ROOT, file)}:${lineAt(text, block.index)}: :global( inside <style scoped> — Vue compiles prefix-position :global into a bare global selector with no error. Move the rule to an unscoped <style> block.`)
    }
  }

  // leg 2: bare-theme display:none in component style blocks + stylesheets
  for (const file of walk(join(ROOT, 'src'), (f) => /\.(vue|astro|css)$/.test(f))) {
    const text = readFileSync(file, 'utf8')
    const rel = relative(ROOT, file)
    if (file.endsWith('.css')) checkCss(text, rel, failures)
    for (const block of styleBlocks(text)) checkCss(block.css, `${rel}:<style${block.attrs.trim() ? ' ' + block.attrs.trim() : ''}>`, failures)
  }

  // leg 3: the built CSS (run after the fixture build)
  if (distDir && existsSync(distDir)) {
    for (const file of walk(distDir, (f) => f.endsWith('.css')))
      checkCss(readFileSync(file, 'utf8'), relative(ROOT, file), failures)
  } else if (distDir) {
    console.log(`theme guard: ${distDir} not built yet — checking sources only`)
  }

  return failures
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  const args = process.argv.slice(2)
  const distFlag = args.indexOf('--dist')
  const distDir = distFlag !== -1 ? args[distFlag + 1] : join('test', 'fixture', 'dist')
  const failures = runThemeGuard(distDir)
  if (failures.length) {
    console.error(`theme guard FAILED (${failures.length}):`)
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log('theme guard: clean — no bare theme-class display rules, no :global( in Vue scoped styles')
}
