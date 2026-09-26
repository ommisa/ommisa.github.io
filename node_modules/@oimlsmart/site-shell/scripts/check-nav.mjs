#!/usr/bin/env node
/**
 * check-nav — the nav completeness gate a consumer runs in CI.
 *
 *   node scripts/check-nav.mjs <nav-model.(json|mjs|ts)> [options]
 *
 * Options:
 *   --dist <dir>       check internal hrefs against a built site tree
 *                      (each HTML file becomes a route; the served page
 *                      is also what the stub/placeholder checks read)
 *   --routes <file>    check internal hrefs against a route list
 *                      instead (one path per line, or a JSON array)
 *   --origin <url>     resolve root-relative hrefs before external
 *                      fetching (the origin a bare model lacks)
 *   --offline          skip the network legs entirely (external hrefs
 *                      are reported as skipped, never fetched)
 *   --min-words <n>    the main-element word threshold for the
 *                      placeholder check (default 20)
 *   --stub-bytes <n>   the byte threshold under which a page carrying
 *                      meta-refresh counts as a redirect stub
 *                      (default 2048)
 *   --timeout <ms>     per-request fetch timeout (default 10000)
 *
 * The model is the package's NavModel (its `items`, each dropdown's
 * `links`, and the optional `productCta`). A JSON file is parsed
 * directly; a `.ts` model is loaded through a stripped-types child
 * process (node >= 22.6). A model that exports `NAV_MODEL`, `nav`, or
 * a default is accepted, as is a bare model object.
 *
 * Every entry must resolve to a real page:
 * - internal hrefs (root-relative) must be served by the --dist tree
 *   or appear in the --routes list; against a dist tree the served
 *   page must not be a redirect stub (under --stub-bytes carrying
 *   meta-refresh) nor a placeholder (a coming-soon marker, or a
 *   main element under --min-words words);
 * - external hrefs are fetched: any non-2xx fails, and the same
 *   stub/placeholder checks run on the response body.
 *
 * Exit 0 prints a one-line summary; exit 1 lists each failing entry.
 * Node stdlib only — no dependencies.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const USAGE = 'usage: check-nav.mjs <nav-model.(json|mjs|ts)> [--dist <dir>] [--routes <file>] [--origin <url>] [--offline] [--min-words <n>] [--stub-bytes <n>] [--timeout <ms>]'

function fail(message) {
  console.error(`check-nav: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--offline') args.offline = true
    else if (a === '--dist' || a === '--routes' || a === '--origin') args[a.slice(2)] = argv[++i]
    else if (a === '--min-words' || a === '--stub-bytes' || a === '--timeout') args[a.slice(2)] = Number(argv[++i])
    else if (!a.startsWith('--')) args._.push(a)
    else fail(`unknown option ${a}\n${USAGE}`)
  }
  return args
}

// --- model loading ---------------------------------------------------------

function unwrapModel(mod) {
  const candidate = mod?.NAV_MODEL ?? mod?.nav ?? mod?.default ?? mod
  if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.items)) {
    fail('the file does not carry a nav model (expected an object with `items`)')
  }
  return candidate
}

async function loadModel(file) {
  const path = resolve(file)
  if (!existsSync(path)) fail(`model file not found: ${file}`)
  const ext = extname(path)
  if (ext === '.json') {
    try {
      return unwrapModel(JSON.parse(readFileSync(path, 'utf8')))
    } catch (e) {
      return fail(`model is not valid JSON: ${e.message}`)
    }
  }
  if (ext === '.ts' || ext === '.mts') {
    // Type stripping needs the flag through node 22; node >= 23.6 strips
    // unflagged but still accepts it. The model must use erasable syntax.
    const specifier = JSON.stringify(pathToFileURL(path).href)
    const code = `import(${specifier}).then(m => { process.stdout.write(JSON.stringify(m.NAV_MODEL ?? m.nav ?? m.default ?? m)) })`
    const run = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code], { encoding: 'utf8' })
    if (run.status !== 0 || !run.stdout) {
      return fail(`could not load the .ts model (node >= 22.6 required): ${(run.stderr || '').trim()}`)
    }
    return unwrapModel(JSON.parse(run.stdout))
  }
  const mod = await import(pathToFileURL(path).href).catch(e => fail(`could not import the model: ${e.message}`))
  return unwrapModel(mod)
}

// --- entry collection ------------------------------------------------------

function collectEntries(model) {
  const entries = []
  for (const item of model.items ?? []) {
    if (item.type === 'dropdown') {
      const config = item.config ?? {}
      for (const link of config.links ?? []) {
        entries.push({ label: `${config.label ?? 'dropdown'} → ${link.label}`, href: link.href, external: link.external })
      }
    } else if (item.type === 'link') {
      entries.push({ label: item.label, href: item.href, external: undefined })
    }
  }
  if (model.productCta) {
    entries.push({ label: `product CTA (${model.productCta.label})`, href: model.productCta.href, external: model.productCta.external })
  }
  return entries
}

// --- routes ----------------------------------------------------------------

const normalizeRoute = (href) => {
  let route = href.split('#')[0].split('?')[0]
  if (!route.startsWith('/')) return null
  if (route.length > 1) route = route.replace(/\/+$/, '') || '/'
  return route === '/' ? '' : route
}

function routesFromDist(dir) {
  const routes = new Map() // route → html file
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.html')) {
        const rel = relative(dir, full).split('\\').join('/')
        const route = rel === 'index.html' ? '' : rel.replace(/index\.html$/, '').replace(/\/$/, '')
        routes.set('/' + route, full)
      }
    }
  }
  walk(dir)
  return routes
}

function routesFromFile(file) {
  const text = readFileSync(file, 'utf8').trim()
  let list
  if (text.startsWith('[')) {
    list = JSON.parse(text)
  } else {
    list = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  }
  const routes = new Map()
  for (const entry of list) routes.set(normalizeRoute(entry) === null ? entry : (normalizeRoute(entry) || '/'), null)
  return routes
}

// --- page quality checks ---------------------------------------------------

function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
}

function wordCount(text) {
  const words = text.match(/[^\s]+/g)
  return words ? words.length : 0
}

function pageProblems(html, label, href, thresholds) {
  const problems = []
  const trimmed = html.trim()
  if (Buffer.byteLength(trimmed) < thresholds.stubBytes && /http-equiv\s*=\s*["']?refresh/i.test(html)) {
    problems.push(`${label} — ${href}: redirect stub (a ${Buffer.byteLength(trimmed)}-byte page carrying meta-refresh)`)
  }
  const text = visibleText(html)
  if (/coming soon|under construction|placeholder page/i.test(text)) {
    problems.push(`${label} — ${href}: placeholder page (a coming-soon marker where the page should be)`)
  }
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)
  const mainText = main ? main[1] : text
  const words = wordCount(visibleText(mainText))
  if (words < thresholds.minWords) {
    problems.push(`${label} — ${href}: placeholder page (the main element carries only ${words} word${words === 1 ? '' : 's'}, under ${thresholds.minWords})`)
  }
  return problems
}

// --- external fetch --------------------------------------------------------

async function checkExternal(entry, origin, thresholds) {
  let target = entry.href
  if (/^\/\//.test(target)) target = 'https:' + target
  if (origin && target.startsWith('/')) target = origin.replace(/\/$/, '') + target
  if (!/^https?:\/\//i.test(target)) {
    return [`${entry.label} — ${entry.href}: external href without an http(s) origin and no --origin to resolve it against`]
  }
  try {
    const res = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(thresholds.timeout) })
    if (!res.ok) return [`${entry.label} — ${entry.href}: HTTP ${res.status} at ${res.url}`]
    const body = await res.text()
    return pageProblems(body, entry.label, entry.href, thresholds)
  } catch (e) {
    return [`${entry.label} — ${entry.href}: unreachable (${e.name === 'TimeoutError' ? `timed out after ${thresholds.timeout}ms` : e.message})`]
  }
}

// --- main ------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2))
if (args._.length !== 1) fail(USAGE + (args._.length === 0 ? ' (no model file given)' : ''))

const model = await loadModel(args._[0])
const entries = collectEntries(model)
if (entries.length === 0) fail('the model carries no entries — nothing to check')

let routes = null
let routesSource = ''
if (args.dist) {
  if (!existsSync(args.dist)) fail(`--dist directory not found: ${args.dist}`)
  routes = routesFromDist(args.dist)
  routesSource = `--dist ${args.dist}`
} else if (args.routes) {
  if (!existsSync(args.routes)) fail(`--routes file not found: ${args.routes}`)
  routes = routesFromFile(args.routes)
  routesSource = `--routes ${args.routes}`
}

const thresholds = {
  minWords: args['min-words'] ?? 20,
  stubBytes: args['stub-bytes'] ?? 2048,
  timeout: args.timeout ?? 10000,
}

const failures = []
let internal = 0
let external = 0
let skipped = 0

for (const entry of entries) {
  if (typeof entry.href !== 'string' || entry.href === '') {
    failures.push(`${entry.label}: the entry carries no href`)
    continue
  }
  if (entry.href.startsWith('#') || /^(mailto|tel):/i.test(entry.href)) {
    skipped++
    continue
  }
  const isExternal = !!entry.external || /^(https?:)?\/\//i.test(entry.href)
  if (isExternal) {
    external++
    if (args.offline) skipped++
    else failures.push(...await checkExternal(entry, args.origin, thresholds))
    continue
  }
  internal++
  if (!entry.href.startsWith('/')) {
    failures.push(`${entry.label} — ${entry.href}: relative href that is neither root-relative nor absolute — use a root-relative path (the origin rides the model or --origin)`)
    continue
  }
  if (!routes) {
    failures.push(`${entry.label} — ${entry.href}: internal href but no --dist or --routes to check it against`)
    continue
  }
  const route = normalizeRoute(entry.href) ?? entry.href
  const key = routes.has(route) ? route : routes.has(route + '/') ? route + '/' : null
  if (key === null) {
    failures.push(`${entry.label} — ${entry.href}: no route serves this path (${routesSource})`)
    continue
  }
  const file = routes.get(key)
  if (file) failures.push(...pageProblems(readFileSync(file, 'utf8'), entry.label, entry.href, thresholds))
}

if (failures.length) {
  console.error(`check-nav FAILED (${failures.length} of ${entries.length} entries):`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
const where = routesSource ? `against ${routesSource}` : '(no routes source given)'
console.log(`check-nav passed: ${entries.length} entries (${internal} internal checked ${where}, ${external} external${args.offline ? ', offline mode' : ''}${skipped ? `, ${skipped} skipped` : ''}) — every checked href resolves to a real page.`)
