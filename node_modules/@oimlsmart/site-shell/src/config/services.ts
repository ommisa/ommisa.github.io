/**
 * The services registry — the map of service origins a consuming site
 * injects. The AI assistant reads `ai` when its mount relies on the
 * registry (`aiAssistant` on Base/SiteHeader with no explicit
 * `apiBase`); `status` and any further keys are the consumer's to
 * define and render. The package ships no service origins.
 */
export interface ServicesRegistry {
  /** The AI assistant's service origin. */
  readonly ai?: string
  /** The status page origin. */
  readonly status?: string
  readonly [key: string]: string | undefined
}
