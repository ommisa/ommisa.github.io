/**
 * The chrome-export contract. The fixture's chrome-export page emits
 * these comment markers; scripts/export-chrome.mjs slices the built page
 * on them. One home for the strings so the two sides cannot drift —
 * they used to be literals on both ends, and changing one broke the
 * other at runtime, not at build.
 */
export const CHROME_MARKERS = {
  header: { start: 'chrome-header:start', end: 'chrome-header:end' },
  footer: { start: 'chrome-footer:start', end: 'chrome-footer:end' },
}
