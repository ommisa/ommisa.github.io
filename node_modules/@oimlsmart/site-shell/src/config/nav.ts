/**
 * The nav model contract — the shape the consuming site injects. The
 * package carries no nav of its own: the header menu, the mobile
 * overlay, and the footer's Explore column render whatever model the
 * consumer passes, and an absent model renders no menu at all.
 *
 * Hrefs stay relative where they are the consumer's own routes;
 * `origin` (the site's public origin — the front door) absolutizes
 * them at render, so the chrome's links resolve from any host
 * (ADR-0003). Links flagged `external` (or carrying their own
 * http(s) origin) render as written.
 */

export type NavBadge = 'internal' | 'new'

export interface NavLink {
  readonly label: string
  readonly href: string
  /** A one-sentence description. The type keeps it for surfaces the
   *  consumer owns; the header dropdown never renders it — menus are
   *  labels only. */
  readonly desc?: string
  readonly badge?: NavBadge
  readonly external?: boolean
}

export interface NavDropdownConfig {
  readonly id: string
  readonly label: string
  /** `internal` marks the amber-accented, divided member-only dropdown. */
  readonly variant: 'default' | 'internal'
  readonly sectionHeader?: string
  readonly links: readonly NavLink[]
}

export interface NavStandaloneLink {
  readonly label: string
  readonly href: string
  /** The path prefix this link is active under. */
  readonly matchPrefix: string
}

export type NavItem =
  | { readonly type: 'dropdown'; readonly config: NavDropdownConfig }
  | { readonly type: 'link'; readonly label: string; readonly href: string; readonly matchPrefix: string }

/** The product CTA — the one emphasized link at the nav's end. */
export type NavProductCta = NavLink

export interface NavModel {
  /** The site's public origin. Relative hrefs in the model resolve
   *  against it at render; without it they render as written. */
  readonly origin?: string
  /** The ordered items — dropdowns and standalone links, interleaved
   *  as the site orders them. */
  readonly items: readonly NavItem[]
  readonly productCta?: NavProductCta
}

/** Is a nav link active for the current path? Root-relative prefix
 *  matching, boundary-safe (`/about` does not match `/about-face`). */
export function isLinkActive(href: string, currentPath: string): boolean {
  const normalized = href.replace(/\/$/, '')
  if (normalized === '') return currentPath === '/'
  return currentPath === href || currentPath.startsWith(href.endsWith('/') ? href : href + '/')
}

export function isDropdownActive(dropdown: NavDropdownConfig, currentPath: string): boolean {
  return dropdown.links.some(link => isLinkActive(link.href, currentPath))
}

/** The header menus' terse view of a link list: the `desc` field is
 *  dropped at the boundary, so a dropdown can never render what it is
 *  never handed. Other surfaces keep the full NavLink. */
export function terseLinks(links: readonly NavLink[]): readonly NavLink[] {
  return links.map(({ desc: _desc, ...link }) => link)
}

/** The nav as the header consumes it: every dropdown's links made
 *  terse. Applied in SiteHeader before any island receives the model. */
export function terseItems(items: readonly NavItem[]): readonly NavItem[] {
  return items.map(item =>
    item.type === 'dropdown'
      ? { ...item, config: { ...item.config, links: terseLinks(item.config.links) } }
      : item
  )
}

/** Render an entry's href: absolute hrefs (and links flagged external)
 *  render as written; relative hrefs resolve against the model's
 *  origin, or as written when the model carries none. */
export function resolveNavHref(href: string, external: boolean | undefined, origin: string | undefined): string {
  if (external || !origin || /^(https?:)?\/\//i.test(href)) return href
  return `${origin}${href}`
}
