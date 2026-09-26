/**
 * The footer config — the content a consuming site injects into the
 * shared footer frame. The package ships no footer content: absent
 * fields omit their block, and Base renders no footer at all when the
 * whole config is absent. Relative hrefs resolve against `origin`
 * (the site's public origin), falling back to the injected nav
 * model's origin.
 */
import type { NavLink } from './nav'

export interface FooterLink {
  readonly label: string
  readonly href: string
  readonly external?: boolean
  /** The one built-in icon the footer can draw beside a link. */
  readonly icon?: 'github'
}

export interface FooterColumn {
  readonly heading: string
  readonly links: readonly FooterLink[]
}

/** One attribution line segment: plain text or an inline link. */
export type FooterAttributionSegment = string | FooterLink

export interface FooterConfig {
  /** The site's public origin; relative hrefs in this config resolve
   *  against it. Defaults to the injected nav model's origin. */
  readonly origin?: string
  /** The blurb under the brand block. */
  readonly description?: string
  /** The consumer's link columns, rendered between the Explore
   *  column (derived from the nav model) and The sites column. */
  readonly columns?: readonly FooterColumn[]
  /** "The sites" column — the properties the federation publishes.
   *  Absent, the column does not render. */
  readonly hosts?: readonly FooterLink[]
  /** The bottom-bar attribution line, segments rendered in order. */
  readonly attribution?: readonly FooterAttributionSegment[]
  /** The legal nav (Privacy, Terms, …). */
  readonly legal?: readonly FooterLink[]
  /** The copyright line, rendered right of the legal nav. */
  readonly copyright?: string
}
