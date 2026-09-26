// @oimlsmart/site-shell/chrome/astro (also the package root) — the
// Astro chrome barrel. The package ships machinery only: components,
// theme runtime, and the injected-config contract. Site content (nav,
// brand, services, footer copy) is injected via that contract; the
// reference preset lives in the repo's presets/www/ and does not ship.
export { default as Base } from './components/Base.astro'
export { default as SiteHeader } from './components/SiteHeader.astro'
export { default as SiteFooter } from './components/SiteFooter.astro'
export { default as MinisiteNav } from './components/MinisiteNav.astro'
export { default as PageHero } from './components/PageHero.astro'
export { default as DocsSidebar } from './components/DocsSidebar.astro'
export { default as InternalBanner } from './components/InternalBanner.astro'
export { default as TierToggle } from './components/TierToggle.astro'
export { default as ComponentLogo } from './components/ComponentLogo.astro'
// The AI assistant bubble (TODO.ai-platform/01) — flag-gated per
// property via Base/SiteHeader's `aiAssistant` prop; the standalone
// mount (a property with its own chrome) imports this component
// directly with mode="standalone" and its own apiBase.
export { default as AiBubble } from './components/AiBubble.vue'

// The theme runtime — the one owner of dark-mode state (theme contract, README).
export {
  THEME_STORAGE_KEY,
  THEME_CLASS,
  THEME_BOOTSTRAP,
  resolveInitialTheme,
  isDarkPreferred,
  useTheme,
} from './composables/useTheme'

// The injected-config contract — the types the shell accepts
// (NavModel, BrandConfig, ServicesRegistry, FooterConfig) and the
// nav predicates. The one place a consumer learns the shapes.
export {
  isLinkActive,
  isDropdownActive,
  resolveNavHref,
} from './config'
export type {
  NavBadge,
  NavLink,
  NavDropdownConfig,
  NavStandaloneLink,
  NavItem,
  NavProductCta,
  NavModel,
  BrandConfig,
  ServicesRegistry,
  FooterLink,
  FooterColumn,
  FooterAttributionSegment,
  FooterConfig,
} from './config'
