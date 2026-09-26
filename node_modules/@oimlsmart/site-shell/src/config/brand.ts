/**
 * The brand config — the identity a consuming site injects. The package
 * ships no brand of its own: there are no defaults to fall back to. An
 * absent `brand` renders no brand block (and Base renders no header);
 * an absent `signInHref` renders no sign-in link; an absent `themeColor`
 * renders no theme-color meta.
 */
export interface BrandConfig {
  /** The wordmark rendered beside the logos. */
  readonly brandName: string
  /** The light-scheme logo URL. */
  readonly logoLight: string
  /** The dark-scheme logo URL. */
  readonly logoDark: string
  /** Where the brand mark links — the site's front door. */
  readonly homeHref: string
  /** The sign-in link's target. Absent means the site has none: no
   *  sign-in link renders in the header or the mobile overlay. */
  readonly signInHref?: string
  /** The `<meta name="theme-color">` value. Absent means the site
   *  publishes none. */
  readonly themeColor?: string
}
