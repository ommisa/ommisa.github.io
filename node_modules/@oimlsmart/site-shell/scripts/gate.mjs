#!/usr/bin/env node
// The gate — one entry point for "the chrome still works", run over the
// built fixture: the compile checks (the injected header/brand/nav,
// tokens, threaded props, the MobileNav logo regression, the showcase
// components, the a11y legs), the config-less page (no injected
// config → no chrome), the menus-are-labels check, the theme guard,
// the chrome-export pipeline (export → apply → idempotence), the
// pack-contents assertion (no preset, no content files in the tarball),
// and the check-nav completeness helper (a good model passes, a bad
// one fails with named reasons). ci.yml and release.yml run exactly
// this (then gate:render), so the PR proof and the publish proof
// cannot drift apart — they had: at the 0.1.2 tag the release gate was
// missing two legs ci.yml already had.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { runThemeGuard } from './guard.mjs'
// The reference preset — node-safe .mjs data, the same values the
// fixture injects and renders.
import { SITE, BRAND, NAV_MODEL, FOOTER } from '../presets/www/index.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'test/fixture/dist')

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('gate: test/fixture/dist is not built — run the fixture build first (cd test/fixture && npm run build)')
  process.exit(1)
}

const failures = []
const check = (ok, label) => { if (!ok) failures.push(label) }
const read = (...p) => readFileSync(join(DIST, ...p), 'utf8')

const indexHtml = read('index.html')
const showcaseHtml = read('showcase', 'index.html')
const docsHtml = read('docs', 'index.html')
const bareHtml = read('bare', 'index.html')
const assetNames = readdirSync(join(DIST, '_astro'))
const css = assetNames.filter(f => f.endsWith('.css')).map(f => read('_astro', f)).join('\n')
const mobileNav = assetNames.filter(f => /^MobileNav\..*\.js$/.test(f)).map(f => read('_astro', f)).join('\n')

// The origin the preset resolves relative hrefs against (front-door
// absolute at render — ADR-0003).
const abs = (href) => (/^https?:\/\//i.test(href) ? href : SITE.url + href)

// --- the injected chrome compiles in (the fixture injects the preset) ---
check(indexHtml.includes('site-nav'), 'the federation header (site-nav) compiled into the page')
check(indexHtml.includes(BRAND.brandName), 'the injected brand compiled into the page')
check(css.includes('color-brand'), 'the design tokens compiled into the output')
check(indexHtml.includes('href="/auth/login"'), 'the consumer\'s signInHref override compiled into the page (threading proven)')
check(indexHtml.includes('Skip to content') && /href="#main"/.test(indexHtml), 'the skip-to-content link present')
check(/<main[^>]*id="main"/.test(indexHtml), 'main carries id="main" (the skip link target)')
check(/aria-label="Primary"/.test(indexHtml), 'the federation nav landmark labelled')
check(/aria-label="Sections"/.test(indexHtml), 'the minisite nav landmark labelled')
check(docsHtml.includes('aria-label="Documentation"'), 'the docs nav landmark labelled')
for (const legal of FOOTER.legal ?? []) {
  check(indexHtml.includes(`href="${abs(legal.href)}"`), `the footer legal link "${legal.label}" compiled into the page (from the injected footer config)`)
}
const firstDropdownLink = NAV_MODEL.items.find(i => i.type === 'dropdown')?.config?.links?.[0]
check(!!firstDropdownLink && indexHtml.includes(`href="${abs(firstDropdownLink.href)}"`), 'federation nav links are front-door absolute (resolve from any origin)')
const firstStandalone = NAV_MODEL.items.find(i => i.type === 'link')
check(!!firstStandalone && indexHtml.includes(`href="${abs(firstStandalone.href)}"`), 'standalone nav links are front-door absolute')
check(indexHtml.includes('nav-product-cta') && indexHtml.includes(`href="${abs('/platform')}"`), 'the nav model\'s product CTA renders, front-door absolute')
for (const column of FOOTER.columns ?? []) {
  for (const link of column.links) {
    check(indexHtml.includes(`href="${abs(link.href)}"`), `the footer column "${column.heading}" link "${link.label}" compiled into the page (from the injected footer config)`)
  }
}
for (const host of FOOTER.hosts ?? []) {
  check(indexHtml.includes(`href="${abs(host.href)}"`), `the footer carries the injected host link for ${host.label} (footer config)`)
}
check(showcaseHtml.includes(`href="${SITE.url}/pilot"`), 'the internal banner link is front-door absolute')
check(/MobileNav\.[A-Za-z0-9_-]+\.js/.test(indexHtml) && indexHtml.includes(`${SITE.url}/smart-logo-light.svg`), 'the mobile nav island rides the absolute brand logo URLs (serialized props)')
check(!/src:"\/smart-logo/.test(mobileNav), 'the mobile nav carries no relative logo paths (the 2026-08-24 regression)')
check(showcaseHtml.includes('tier-toggle'), 'TierToggle mounted on the showcase page')
check(showcaseHtml.includes('component-logo'), 'ComponentLogo mounted on the showcase page')
check(showcaseHtml.includes('DRAFT'), 'the internal banner mounted on the showcase page (<Base internal>)')
check(showcaseHtml.includes('account-chip') && showcaseHtml.includes('account-avatar'), 'the signin slot threads the account chip into the header')

// --- the config-less page: no injected config, no chrome ---
check(!bareHtml.includes('site-nav'), 'the config-less page renders NO header (the shell invents no chrome)')
check(!bareHtml.includes('<footer'), 'the config-less page renders NO footer')
check(!bareHtml.includes('shell-signin'), 'the config-less page renders no sign-in link (no default href exists)')
check(/<main[^>]*id="main"/.test(bareHtml), 'the config-less page keeps its main landmark (the page machinery stays)')

// --- menus are labels only: no nav desc sentence reaches any page ---
const navDescs = NAV_MODEL.items
  .flatMap(item => item.type === 'dropdown' ? item.config.links : [])
  .map(link => link.desc)
  .filter(Boolean)
check(navDescs.length > 0, 'the preset nav carries desc strings for this check to guard')
for (const desc of navDescs) {
  check(!indexHtml.includes(desc), `the header dropdowns render no descriptions ("${desc}" absent from the page)`)
  check(!bareHtml.includes(desc), `no nav description leaks onto the config-less page ("${desc}")`)
}

{
  // The AI bubble (TODO.ai-platform/01): flag-gated per property. The
  // bubble fixture mounts it against the stub origin read from the
  // injected services registry; every other fixture page is flagless
  // and must NOT carry it.
  const bubbleHtml = read('bubble', 'index.html')
  check(bubbleHtml.includes('aria-label="Open the OIML SMART AI assistant"'), 'the AI launcher compiled into the bubble fixture page')
  check(bubbleHtml.includes('ai-stub.invalid'), 'the bubble serialized the injected service origin (services.ai read)')
  check(!indexHtml.includes('aria-label="Open the OIML SMART AI assistant"'), 'the AI launcher stays OFF by default (the flagless index page)')
  check(!docsHtml.includes('aria-label="Open the OIML SMART AI assistant"'), 'the AI launcher stays OFF on the flagless docs page')
  const standaloneHtml = read('bubble-standalone', 'index.html')
  // the direct mount chunks into a shared index.*.js — the island's opts
  // (name: AiBubble) + the serialized origin are the stable markers
  check(/name&quot;:&quot;AiBubble/.test(standaloneHtml), 'the standalone AI island compiled into its fixture page')
  check(standaloneHtml.includes('ai-stub.invalid'), 'the standalone mount serialized the configured service origin')
}
{
  const first = docsHtml.indexOf('guides/first')
  const second = docsHtml.indexOf('guides/second')
  const third = docsHtml.indexOf('guides/third')
  check(first >= 0 && second > first && third > second, 'DocsSidebar mounts the docs collection with docs-sort ordering applied')
}

failures.push(...runThemeGuard(DIST))

// --- the chrome-export pipeline: export → apply → idempotence. The
// --- scripts ship in the tarball; this is their proof.
{
  const run = (script, ...args) =>
    spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { encoding: 'utf8' })

  const exported = run('export-chrome.mjs', DIST)
  if (exported.status !== 0) {
    failures.push(`chrome export failed: ${(exported.stderr || exported.stdout || '').trim()}`)
  } else {
    // A minimal foreign page — no chrome of its own, like the sites
    // apply-chrome exists for (the glossarist/Jekyll pipelines).
    const scratch = mkdtempSync(join(tmpdir(), 'chrome-smoke-'))
    const siteDist = join(scratch, 'site')
    mkdirSync(siteDist)
    writeFileSync(join(siteDist, 'index.html'),
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>foreign</title></head><body><h1>a foreign page</h1></body></html>')

    const applied = run('apply-chrome.mjs', ROOT, siteDist, '/smoke')
    if (applied.status !== 0) {
      failures.push(`chrome apply failed: ${(applied.stderr || applied.stdout || '').trim()}`)
    } else {
      const page = readFileSync(join(siteDist, 'index.html'), 'utf8')
      check(page.includes('site-nav'), 'chrome pipeline: the header fragment injected into the foreign page')
      check(page.includes('href="/smoke/_astro/'), 'chrome pipeline: asset URLs rewritten to the apply base')
      check(readdirSync(join(siteDist, '_astro')).some(f => /^app-media\..*\.css$/.test(f)), 'chrome pipeline: the split responsive-variant stylesheet landed')
      const again = run('apply-chrome.mjs', ROOT, siteDist, '/smoke')
      check(again.status === 0 && /applied to 0 pages/.test(again.stdout), 'chrome pipeline: apply is idempotent (second run injects nothing)')
    }
  }
}

// --- the pack-contents assertion: the tarball carries machinery only.
// --- presets/ must not ship; neither may any site-content module under
// --- src/data (nav models, component registries, brand literals).
{
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8' })
  if (packed.status !== 0) {
    failures.push(`pack contents: npm pack --dry-run failed: ${(packed.stderr || packed.stdout || '').trim()}`)
  } else {
    let manifest
    try {
      manifest = JSON.parse(packed.stdout)[0]
    } catch (e) {
      manifest = null
      failures.push(`pack contents: could not parse npm pack output: ${e.message}`)
    }
    if (manifest) {
      const paths = (manifest.files ?? []).map(f => f.path)
      const contentPatterns = [
        [/^presets\//, 'the reference preset'],
        [/^src\/data\/(site|site-meta|nav-config|components|host-registry)/, 'a baked site-content module'],
      ]
      const offenders = []
      for (const p of paths) {
        for (const [pattern, why] of contentPatterns) {
          if (pattern.test(p)) offenders.push(`${p} (${why})`)
        }
      }
      check(offenders.length === 0, `pack contents: content in the tarball — ${offenders.join(', ')}`)
      check(paths.some(p => p.startsWith('src/config/')), 'pack contents: the injected-config contract ships')
      check(paths.includes('scripts/check-nav.mjs'), 'pack contents: the completeness gate ships')
    }
  }
}

// --- the check-nav completeness helper: a good model passes, a bad one
// --- fails with named reasons. Offline everywhere — the gate never
// --- touches the network.
{
  const runNav = (model, ...args) =>
    spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-nav.mjs'), model, '--offline', ...args], { encoding: 'utf8' })

  // 1. the fixture model against the built fixture dist: every internal
  //    href is served, no page is a stub or a placeholder.
  const good = runNav(join(ROOT, 'test/fixture/nav-check/nav.good.json'), '--dist', DIST, '--min-words', '5')
  check(good.status === 0, `check-nav: the good model passes against the fixture dist (${(good.stderr || good.stdout || '').trim()})`)

  // 2. a crafted bad dist: a coming-soon placeholder, a meta-refresh
  //    redirect stub, and an href no route serves — all must fail, by
  //    name; the clean route in the same tree must pass.
  const scratch = mkdtempSync(join(tmpdir(), 'nav-check-'))
  const badDist = join(scratch, 'dist')
  const page = (dir, html) => { mkdirSync(join(badDist, dir), { recursive: true }); writeFileSync(join(badDist, dir, 'index.html'), html) }
  page('ok', '<!DOCTYPE html><html><head><title>ok</title></head><body><main><p>The one route in this tree that genuinely serves its content, with enough words to clear the placeholder threshold and prove the happy path.</p></main></body></html>')
  page('placehold', '<!DOCTYPE html><html><head><title>tbd</title></head><body><main>Coming soon</main></body></html>')
  page('stub', '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/elsewhere"></head><body></body></html>')
  const bad = runNav(join(ROOT, 'test/fixture/nav-check/nav.bad.json'), '--dist', badDist)
  check(bad.status !== 0, 'check-nav: the bad model fails')
  const badReport = `${bad.stderr || ''}${bad.stdout || ''}`
  check(badReport.includes('no route serves this path'), 'check-nav: an href no route serves is named')
  check(badReport.includes('coming-soon marker'), 'check-nav: a coming-soon placeholder is named')
  check(badReport.includes('redirect stub'), 'check-nav: a meta-refresh redirect stub is named')
  check(!/Fine — .*placeholder/.test(badReport), 'check-nav: the clean route in the same tree passes')
  const ok = runNav(join(ROOT, 'test/fixture/nav-check/nav.ok.json'), '--dist', badDist)
  check(ok.status === 0, `check-nav: the clean model passes the same tree (${(ok.stderr || ok.stdout || '').trim()})`)

  // 3. the routes-list mode: the consumer-supplied route list instead
  //    of a dist tree.
  const routesFile = join(scratch, 'routes.txt')
  writeFileSync(routesFile, '# one route per line\n/ok/\n')
  const listed = runNav(join(ROOT, 'test/fixture/nav-check/nav.ok.json'), '--routes', routesFile)
  check(listed.status === 0, `check-nav: the routes-list mode passes (${(listed.stderr || listed.stdout || '').trim()})`)
  const unlisted = runNav(join(ROOT, 'test/fixture/nav-check/nav.bad.json'), '--routes', routesFile)
  check(unlisted.status !== 0, 'check-nav: the routes-list mode still fails an unserved href')
}

if (failures.length) {
  console.error(`gate FAILED (${failures.length}):`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('gate passed: injected chrome + showcase compiled, config-less page stays bare, menus carry labels only, brand threaded, theme guard clean, chrome pipeline proven, tarball carries machinery only, check-nav proven both ways')
