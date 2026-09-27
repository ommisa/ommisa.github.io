/** The Ommisa site's injected chrome config — the house shell
 *  (@oimlsmart/site-shell) is machinery-only; every value here is this
 *  site's own content, per the shell's typed contract. The logos are
 *  the branding repository's SMART wordmark (oiml-logo_smart-new),
 *  served from this origin; tokens live only in the shell. */
import type { BrandConfig } from '@oimlsmart/site-shell/config'
import type { NavModel } from '@oimlsmart/site-shell/config'
import type { FooterConfig } from '@oimlsmart/site-shell/config'

export const SITE = {
  url: 'https://www.ommisa.org',
  title: 'Ommisa',
  description: 'OIML Métrologie Machine Intelligence SMART Assistante — grounded answers from the OIML corpus of International Recommendations, Documents, Guides and Vocabularies, on the web, at the command line, and over an API.',
}

export const BRAND: BrandConfig = {
  brandName: 'Ommisa',
  logoLight: '/smart-logo-light.svg',
  logoDark: '/smart-logo-dark.svg',
  homeHref: '/',
  signInHref: 'https://ai.oimlsmart.org/auth/login',
  themeColor: '#004996',
}

export const NAV: NavModel = {
  origin: SITE.url,
  items: [
    { type: 'link', label: 'CLI', href: '/cli/', matchPrefix: '/cli' },
    { type: 'link', label: 'Confidence', href: '/confidence/', matchPrefix: '/confidence' },
    { type: 'link', label: 'Developers', href: '/developers/', matchPrefix: '/developers' },
  ],
  productCta: { label: 'Open the app', href: 'https://ai.oimlsmart.org/', external: true },
}

export const FOOTER: FooterConfig = {
  origin: SITE.url,
  description: 'Ommisa is the OIML Metrology Machine Intelligence Standards Assistant — part of the OIML SMART programme, a public pilot. Answers are for information only; the official OIML publications govern.',
  hosts: [
    { label: 'OIML SMART', href: 'https://www.oimlsmart.org', external: true },
    { label: 'Ommisa (the app)', href: 'https://ai.oimlsmart.org', external: true },
  ],
  attribution: [
    'Ommisa is part of the ',
    { label: 'OIML SMART programme', href: 'https://www.oimlsmart.org', external: true },
    '. ',
    { label: 'GitHub', href: 'https://github.com/ommisa', external: true, icon: 'github' },
  ],
}

export const SERVICES = {
  status: 'https://status.oimlsmart.org',
  ai: 'https://ai.oimlsmart.org',
}
