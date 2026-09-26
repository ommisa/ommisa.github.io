/**
 * The injected-config contract — the ONE home of the types the shell
 * accepts from its consumer. The package ships machinery only: every
 * piece of site content (nav, brand, services, footer copy) arrives as
 * one of these configs, and an absent config renders no chrome of its
 * own. Re-exported from the package root and from ./chrome/astro.
 */
export type {
  NavBadge,
  NavLink,
  NavDropdownConfig,
  NavStandaloneLink,
  NavItem,
  NavProductCta,
  NavModel,
} from './nav'
export { isLinkActive, isDropdownActive, resolveNavHref, terseLinks, terseItems } from './nav'
export type { BrandConfig } from './brand'
export type { ServicesRegistry } from './services'
export type {
  FooterLink,
  FooterColumn,
  FooterAttributionSegment,
  FooterConfig,
} from './footer'
