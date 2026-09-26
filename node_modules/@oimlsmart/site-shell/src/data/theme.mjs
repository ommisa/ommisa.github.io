/**
 * The theme runtime's constants — a plain-.mjs leaf so that non-bundler
 * consumers (the render gate runs under plain node) can import the
 * storage key and class without pulling the .astro re-exports in the
 * package root. The runtime itself (bootstrap, composable) lives in
 * src/composables/useTheme.ts and re-exports these.
 */
export const THEME_STORAGE_KEY = 'oiml-theme'
export const THEME_CLASS = 'dark'
