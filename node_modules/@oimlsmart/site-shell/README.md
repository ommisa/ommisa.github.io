# @oimlsmart/site-shell

The OIML SMART house shell — the chrome machinery every OIML SMART site
mounts: the federation header and footer frames, nav rendering, the
component-local minisite nav, the logo hero, the docs layout, the theme
runtime, the design tokens, and the AI assistant island. The package
ships machinery only: it carries no site content of its own. Every site
injects its nav model, brand, services registry, and footer content
through the typed config contract in `src/config/`, and the shell
renders exactly what it is given — with no config it renders no chrome
at all. Domain vocabulary lives in `CONTEXT.md`.

## Consume (an Astro site)

```sh
npm i @oimlsmart/site-shell
```

The package ships raw source — peer dependencies are `astro >= 5` and
`vue >= 3.5`; your bundler compiles the components.

```css
/* src/styles/app.css — import tailwind first, then the tokens, then
   @source the package so the shell's utilities compile into your CSS. */
@import "tailwindcss";
@import "@oimlsmart/site-shell/tokens.css";
@source "../../node_modules/@oimlsmart/site-shell/src/**/*.{astro,vue}";
```

Optional: `@import "@oimlsmart/site-shell/blueprint.css"` for the
editorial page scaffolding (grid, prose, hero polish).

Declare the site's config once (the shapes come from the package):

```ts
// src/site-config.ts
import type { BrandConfig, NavModel, FooterConfig, ServicesRegistry } from '@oimlsmart/site-shell/config'

export const BRAND: BrandConfig = {
  brandName: '…',
  logoLight: '…',
  logoDark: '…',
  homeHref: '…',
  // No signInHref means the site has no sign-in: no sign-in link
  // renders anywhere.
  signInHref: '/login/',
}

export const NAV: NavModel = {
  // Relative hrefs resolve against this origin at render, so the
  // chrome's links work from any host (ADR-0003).
  origin: 'https://…',
  items: [
    { type: 'dropdown', config: { id: 'docs', label: 'Docs', variant: 'default', links: [{ label: 'Guides', href: '/docs/' }] } },
    { type: 'link', label: 'News', href: '/news/', matchPrefix: '/news' },
  ],
  // Optional: the one emphasized link at the nav's end.
  productCta: { label: 'Open the app', href: '/app' },
}

export const SERVICES: ServicesRegistry = { ai: 'https://…', status: 'https://…' }

export const FOOTER: FooterConfig = {
  origin: 'https://…',
  description: '…',
  columns: [{ heading: 'Programme', links: [{ label: 'About', href: '/about' }] }],
  hosts: [{ label: 'Public site', href: 'https://…' }],
  attribution: ['A programme of the ', { label: 'OIML', href: 'https://www.oiml.org', external: true }],
  legal: [{ label: 'Privacy', href: '/privacy' }],
  copyright: '…',
}
```

Mount the shell:

```astro
---
import { Base, MinisiteNav, PageHero } from '@oimlsmart/site-shell'
import { BRAND, NAV, SERVICES, FOOTER } from '../site-config'
import '../styles/app.css'
---

<Base title="…" description="…" brand={BRAND} nav={NAV} services={SERVICES} footer={FOOTER}>
  <MinisiteNav sections={[{ label: 'About', href: '/' }, …]} base="/recs" />
  <PageHero title="…" lede="…" logo={{ name: 'smart-rec', alt: '…', base: 'https://www.oimlsmart.org/img/components' }} />
  <slot />  <!-- your page -->
</Base>
```

### The injection contract

`Base` renders no header when neither `brand` nor `nav` is passed, and
no footer when `footer` is absent; `SiteHeader` and `SiteFooter` omit
any block whose content was not injected. The package defines the
shapes and the render machinery — never the data:

- **`NavModel`** (`nav`) — the ordered items (dropdowns and standalone
  links), the optional product CTA, and the origin that relative hrefs
  resolve against. The header menu, the mobile overlay, and the
  footer's Explore column all render from it; the active-path
  predicates (`isLinkActive`, `isDropdownActive`) ship with the type.
- **`BrandConfig`** (`brand`) — product name, logo pair, home href, an
  optional sign-in href, an optional theme-color. An absent
  `signInHref` renders no sign-in link in the header or the mobile
  overlay; there is no default target.
- **`ServicesRegistry`** (`services`) — the service origins the
  consumer defines. The AI assistant reads `services.ai` when its flag
  carries no explicit `apiBase`; enabling the assistant without any
  origin is a build error, never a silent default.
- **`FooterConfig`** (`footer`) — description, link columns, the hosts
  column, the attribution segments, legal links, and the copyright
  line. The Explore column is derived from the nav model; everything
  else is injected.

### Menus are labels only

The header dropdowns and the mobile overlay render each link's label,
its badge, and its external indicator — never the link's `desc`. The
type keeps `desc` for surfaces the consumer owns (index cards, listing
pages), but `SiteHeader` strips it before any island receives the
model, so a description cannot reach the menus even through serialized
props. The render gate proves the built dropdowns carry none.

### What the package exports

| subpath | contents |
|---|---|
| `.` and `./chrome/astro` | the Astro component barrel (`Base`, `SiteHeader`, `SiteFooter`, `MinisiteNav`, `PageHero`, `DocsSidebar`, `InternalBanner`, `TierToggle`, `ComponentLogo`, `AiBubble`), the theme runtime, and the config contract — for Astro consumers |
| `./chrome/astro/*` | each component directly (`…/chrome/astro/SiteHeader.astro`) |
| `./config` | the injected-config contract: `NavModel`, `BrandConfig`, `ServicesRegistry`, `FooterConfig`, and the nav predicates |
| `./brand` | `BrandConfig` alone, for consumers that want the identity type without the rest |
| `./theme` | the theme runtime (`useTheme`, `THEME_BOOTSTRAP`, `THEME_STORAGE_KEY`, …) |
| `./ai`, `./ai/context`, `./ai/drafts`, `./ai/client`, `./ai/markdown`, `./ai/*` | the assistant's API client, the page-context seam, the draft-act seam, the markdown-lite renderer |
| `./tokens.css` / `./blueprint.css` | the design tokens / the editorial scaffolding |
| `./data/theme.mjs`, `./data/chrome.mjs` | the node-safe constant leaves (the render gate and the chrome-export markers) |

The subpath map is stack-honest: a consumer imports only what its
stack compiles. A Vue-only consumer never touches the `.astro` barrel;
a plain-node script imports the `.mjs` leaves. The package root
resolves to the Astro barrel for ergonomic imports — consumers that
care about their compile surface use the explicit subpaths.

### The reference preset (`presets/www/`, not shipped)

The www property's content — its nav model, brand, services, footer
copy, component registry, and host list — lives in the repository at
`presets/www/` as plain `.mjs` data with `.d.mts` type twins. The
directory is NOT package content: nothing in it is exported from the
package entry points, and `files` (`src`, `scripts`) keeps it out of
the published tarball — the pack gate fails if a `presets/` path ever
appears. It exists so the www repo can adopt the files verbatim in its
own migration, and so this repo's test fixture can inject them and
prove the injection surface end to end.

### The AI assistant bubble (opt-in)

The platform's AI assistant (ai.oimlsmart.org) embeds as ONE component —
never a per-app copy. Off by default; a property opts in per page shell:

```astro
<Base title="…" services={SERVICES} aiAssistant />                      <!-- services.ai -->
<Base title="…" aiAssistant={{ apiBase: 'https://…' }} />               <!-- staging override -->
```

The launcher lands in the header's icon row at lg+ and as a floating
button below lg; the panel is a card on desktop and a full sheet on
small screens. Properties with their own chrome (the smart platform)
mount the component directly in standalone mode:

```astro
---
import { AiBubble } from '@oimlsmart/site-shell'
---
<AiBubble client:load mode="standalone" apiBase="https://…" />
```

The `apiBase` prop is required on a direct mount — the package ships no
service origin to default to. The floating launcher shows at every
breakpoint in standalone mode. A host with its own bottom-right
affordance lifts the launcher clear of it: `fabBottom="5rem"` (any CSS
length; default `1rem`).

The contract (the honest postures the component keeps):

- **Auth**: anonymous visitors get the public corpus tier, marked
  "Anonymous — public corpus"; their conversations stay on the device
  (localStorage), never synced. Sign-in rides the service's bubble
  bridge (`/auth/login?mode=bubble&origin=…` on the AI service — the
  OIDC round-trip, then a confirm page hands the service's session token
  to this origin by postMessage; the platform bans shared cookies, so
  the token rides as `Authorization: Bearer`, held in sessionStorage).
  Signed-in members get their synced conversation list — the same
  sessions ai.oimlsmart.org shows.
- **Answers** stream from `POST /api/ask` (SSE citations → tokens →
  done) and render markdown-lite — an escape-first renderer; model
  output can never inject markup. Citations render as cards linking the
  source publication; a superseded source is marked.
- **Theming**: every color rides an `--ai-*` custom property that
  prefers the shell token and falls back to the house value, so the
  component is dark-correct on hosts without tokens.css (the platform's
  own palette). Layout is the component's own plain CSS — the host's
  Tailwind scan is never required.
- The chrome-export artifact (foreign sites) does NOT carry the bubble —
  it is static HTML; the assistant is an island.

#### The context chips (TODO.ai-platform/02)

Opt-in per property (`aiAssistant={{ contextChips: true }}` — or the
`contextChips` prop on a direct `AiBubble` mount), and opt-in per
message INSIDE the panel: the chips above the composer present what is
available — **This page** (the route's plain name), **This entity**
(only when the page carries one; the chip names it), **A document…**
(a small picker for a corpus reference), **None** (the default; the
panel opens there). Tap includes, tap drops, changeable per message
mid-session; nothing the user didn't pick ever rides a message. Every
answer carries the honest context line ("context: this certificate
R60/2021-A-EX1-26.01" / "context: none (general corpus)"), computed from
the service's `context_applied` echo — never from what the panel wished
to send.

**The page-context seam** — how a host page tells the panel what it is
and what it carries — is `src/ai/context.ts`
(`@oimlsmart/site-shell/ai/context` — the extensionless subpath, an
explicit `exports` entry: strict TypeScript consumers resolve it, and
the `.ts`-suffixed wildcard form breaks them):

```ts
import { publishAiContext } from '@oimlsmart/site-shell/ai/context'

// on mount + whenever the route or the loaded entity changes:
publishAiContext({
  page: 'the IA console',                    // the route's plain name
  entity: {                                  // only when the page carries one
    kind: 'certificate',                     // display kind
    label: 'R60/2021-A-EX1-26.01',           // the display label
    id: '…',                                 // the platform's entity id
    doc: 'urn:oiml:pub:r:60-1:2021',         // the governing publication, when known
    edition: '2021',
  },
})
publishAiContext(null)                       // nothing to say (clears)
```

The helper mirrors the payload onto `<html data-ai-context="…">` (the
current truth a late-hydrating panel reads) AND dispatches the
`oimlsmart:ai-context` window event (live updates to a mounted panel).
A page that publishes nothing offers This page (named from the document
title) + A document… + None — no entity in view, no entity chip.

The wire shape the panel sends (`context` on `POST /api/ask`) and the
echo it renders (`context_applied`) are the AI service's contract — the
rag repo's `docs/API.md` §2.1.1. The entity's OWN DATA never rides the
declaration: the grounding is the governing publication's clauses (the
live-data exchange is wave 03).

The gate covers it: the flagged fixture page proves the launcher
compiles, the flagless pages prove the default is off, and the render
gate drives the panel against a stubbed service (the streamed answer,
the citation card, an XSS payload staying inert, the bridge sign-in, the
member conversation list, the mobile sheet, the 44px floor, Esc — and
the chips: the availability rules, the per-message declaration on the
ask body, the honest context line across a mid-session change, the
not-in-corpus degradation, the entity chip leaving when the page stops
carrying the entity).

#### The draft acts (TODO.ai-platform/04)

Opt-in per property (`aiAssistant={{ draftActs: true }}` — or the
`draftActs` prop on a direct `AiBubble` mount). The service can PREPARE
an act (the application prefill is the pilot); the panel renders the
draft card — honestly marked AI-prepared, the fields it carries, the
values it dropped and why — and the user's click hands the draft to the
HOST's real form. **The panel never holds a write credential: the draft
rides the DOM seam, never an API; the commit is the user's own click in
the form.** The draft is ephemeral on the message (a resumed session
keeps the words, never a stale draft).

**The draft seam** — how the panel hands a prepared act to the host —
is `src/ai/drafts.ts` (`@oimlsmart/site-shell/ai/drafts`, an explicit
`exports` entry like `ai/context`):

- The panel dispatches `oimlsmart:ai-draft` (a window `CustomEvent`)
  with the service-validated draft payload (the wire shape is the AI
  service's contract — the rag repo's `docs/API.md` §2.1.3).
- A host that serves the act (the SMART platform's wizard) listens,
  **re-validates the payload itself** (the panel's validator is a
  convenience, never a boundary), stores it for the form, answers with
  `oimlsmart:ai-draft-ack` (`{ accepted: true }`), and opens the form.
  A refusal answers `{ accepted: false, reason }`; a host without the
  seam answers nothing and the panel reports the no-host honestly.
- The card's honesty is the wave's: "nothing is submitted until you
  review and confirm it there yourself" — the form's own write path (its
  validation, its gates, its audit, which marks the act AI-prepared) is
  the only commit.

### Identity and slots

The brand renders exactly what the consumer injected, in one place:
pass the same `brand` object to every `Base` mount and the header, the
mobile overlay, and the footer render one identity. A consumer may
replace the header's default sign-in link with an account chip in
`Base`'s `signin` slot; the chip renders **beside** the nav, never
inside it, so it stays visible at every breakpoint — keep chips compact
and mark them `shrink-0`. When a chip is mounted, the mobile overlay
drops its own "Sign in" link. When the brand declares no `signInHref`,
no sign-in link renders at all.
`MinisiteNav` exposes a right-aligned slot for nav-local utilities.

### Tiered pages (SMART / SMART+)

```astro
<TierToggle />
<div data-tier="smart">…type-approval scope…</div>
<div data-tier="smartplus">…full instance lifecycle…</div>
```

### Theme-aware scripts

If your page needs the current scheme, use the theme runtime — never
read `localStorage` or `.dark` yourself:

```ts
import { useTheme, isDarkPreferred } from '@oimlsmart/site-shell/theme'
```

## Consume (a foreign-built site)

Sites that cannot mount Astro components (full-document generators)
inject the exported chrome instead. Build the fixture, export, apply:

```sh
node scripts/export-chrome.mjs   # fixture dist → dist-chrome/ (header.html, footer.html, head.html, _astro/**, manifest.json)
node scripts/apply-chrome.mjs --dist <your-dist> [--base /your-base] [--skip <prefix>]
```

The exported chrome is the FIXTURE's — today the fixture injects the
www preset, so the artifact carries the www header and footer. The
scripts ship in the npm tarball (`files: src, scripts`), so an
installed consumer runs them from
`node_modules/@oimlsmart/site-shell/scripts/`. `apply-chrome.mjs`
rewrites the asset URLs to your base and injects the fragments into
your built pages; `--skip` leaves matched paths unchromed. The marker
contract between the export page and the exporter lives in
`src/data/chrome.mjs`.

## Docs layout

`DocsSidebar` mounts your `docs` content collection (entries with
optional `title`, `shortTitle`, and numeric `order`; sections are id
prefixes like `guides/…`). Declare the collection in your
`src/content.config.ts` and pass `order`/`labels`/`hrefBase` to match
your layout. `SearchBox` takes an optional `base` prop if your
pagefind index is not at the site root (GitHub Pages project sites).

## Theme contract

`.dark` is reserved. `Base.astro`'s FOUC bootstrap (THEME_BOOTSTRAP from
the theme runtime) and `useTheme` put `class="dark"` on `<html>` —
never on a child, never as a free-floating class on an arbitrary
element. Components that need a light/dark difference key off the
ancestor:

```css
/* correct — the theme class is on <html>, so the selector reaches it */
html.dark .my-thing { … }

/* wrong — a bare .dark rule applies TO the <html> element itself */
.dark { display: none; }          /* blanks the whole page */
```

In a Vue SFC, never write `:global(.dark)` (or any `:global(`) inside a
`<style scoped>` block. Vue only supports `:global` wrapping a whole
rule; used in prefix position (`:global(.dark) .x`), the compiler
silently drops the rest of the selector and emits a bare `.dark { … }`
rule — exactly the page-blanking bug that shipped in 0.1.2. Global rules
belong in a separate unscoped `<style>` block. (Astro's scoped styles
do support `:global()`; the ban is Vue-only.)

## Rules

- The package ships machinery only. A nav model, component registry,
  brand literal, service origin, or default sign-in href belongs to the
  consumer (or to `presets/<site>/` in this repository) — never to
  `src/`. The pack gate enforces this on every run.
- Logos are NOT shipped: consumers reference their canonical URLs (www's
  component-logo copy lives under
  `https://www.oimlsmart.org/img/components/`, injected as
  `ComponentLogo`'s `base`). The `base` prop has no default.
- Colors and type live ONLY in `src/styles/tokens.css` (+ blueprint.css).
  A token change ships as one package release consumed by every site.
- The internal-draft banner is opt-in (`<Base internal>`) — minisites are
  public. Its programme link is injected too (relative hrefs resolve
  against the nav model's origin).

## The completeness gate (check-nav)

`scripts/check-nav.mjs` is the nav completeness check a consumer runs
in CI against its own nav model:

```sh
node scripts/check-nav.mjs src/site-config.nav.json --dist dist
node scripts/check-nav.mjs src/site-config.ts --routes routes.txt --offline
```

The model is the package's `NavModel` (JSON, `.mjs`, or a `.ts` module
through node's type stripping). Internal hrefs must be served by the
`--dist` tree or appear in the `--routes` list; external hrefs are
fetched (any non-2xx fails) unless `--offline` skips the network. A
served page fails when it is a redirect stub (under the byte threshold
carrying meta-refresh) or a placeholder (a coming-soon marker, or a
main element under the word threshold). The tool is dependency-free
(node stdlib) and exits non-zero with every failing entry named.

## The gate

`npm run gate` and `npm run gate:render` (after building the fixture in
`test/fixture/`) are the package's proof, and exactly what CI and the
release workflow run — one definition, no drift:

- **gate** — the fixture injects the reference preset and the chrome
  compiles in (header, brand, nav links, footer columns, threaded
  sign-in override); the config-less page proves the inverse (no
  header, no footer, no sign-in link — the shell invents nothing); the
  built dropdowns carry labels only (no `desc` reaches any page, not
  even serialized props); the showcase components mount; the a11y legs
  hold (skip link, labelled landmarks); the theme guard is clean; the
  chrome-export pipeline is proven (export → apply to a foreign page →
  asset rewrite → idempotence); `npm pack --dry-run` carries no preset
  and no content module; and `check-nav` passes a good model against
  the fixture dist while failing a bad one by name (missing route,
  coming-soon placeholder, meta-refresh redirect stub, and the
  routes-list mode).
- **gate:render** — Playwright loads each fixture page in **both**
  color schemes and asserts layout geometry (not computed colors — a
  blank page still greps clean and passes color probes); the chrome
  pages carry the header and the swapping logo pair, the config-less
  pages carry none; a rendered dropdown is opened and proven to contain
  labels only; the mobile dialog opens and Esc-closes; the AI bubble
  answers against a stubbed service; screenshots land in `artifacts/`.

Federation links (header nav, footer columns, the internal banner)
render front-door absolute — relative hrefs resolve against the nav
model's / footer config's origin at render, so the chrome's links
resolve from any minisite origin (ADR-0003, as amended by ADR-0005).

## Releases — trusted publishing only

npm publishes happen **only** through GitHub Actions OIDC trusted
publishing; no npm token exists anywhere and `npm publish` is never run
locally. A release is:

1. changes land on `main` via PR (the gate runs on every PR);
2. the version bump PR merges (`package.json` version = the release);
3. someone pushes the matching tag — `git tag v0.2.1 && git push origin v0.2.1`;
4. `release.yml` verifies tag ↔ version, runs the same gate, then
   publishes with a provenance attestation bound to this repo;
5. verify: `npm view @oimlsmart/site-shell version`.

The tag push is the release trigger — treat it accordingly. Superseded
broken versions are deprecated on the registry (`npm deprecate
@oimlsmart/site-shell@0.1.2 "…"`) once the fix is live, never yanked.
