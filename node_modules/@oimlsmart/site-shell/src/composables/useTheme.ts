/**
 * The theme runtime — the one owner of dark-mode state for every OIML
 * SMART site. `.dark` lives on <html> only: THEME_BOOTSTRAP (injected by
 * Base.astro and the chrome-export page) sets it before first paint,
 * useTheme() toggles it afterwards. Nothing else may touch the storage
 * key or the class (the theme contract, README).
 */
import { ref, onMounted, type Ref } from 'vue'
import { THEME_STORAGE_KEY, THEME_CLASS } from '../data/theme.mjs'

export { THEME_STORAGE_KEY, THEME_CLASS }

/** The pre-hydration FOUC script — the same decision isDarkPreferred()
 *  makes, inlined as a string because it must run before any module
 *  loads. Inject with <script is:inline set:html={THEME_BOOTSTRAP} />. */
export const THEME_BOOTSTRAP = `var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})
var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
if (stored === ${JSON.stringify(THEME_CLASS)} || (!stored && prefersDark)) {
  document.documentElement.classList.add(${JSON.stringify(THEME_CLASS)})
}
document.addEventListener('astro:before-swap', function(e) {
  if (document.documentElement.classList.contains(${JSON.stringify(THEME_CLASS)})) {
    e.newDocument.documentElement.classList.add(${JSON.stringify(THEME_CLASS)})
  }
})
`

export function resolveInitialTheme(stored: string | null, prefersDark: boolean): boolean {
  if (stored) return stored === THEME_CLASS
  return prefersDark
}

export function isDarkPreferred(): boolean {
  if (typeof window === 'undefined') return false
  return resolveInitialTheme(
    localStorage.getItem(THEME_STORAGE_KEY),
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
}

export function useTheme(): {
  isDark: Ref<boolean>
  toggle: () => void
} {
  const isDark = ref(false)

  function apply() {
    document.documentElement.classList.toggle(THEME_CLASS, isDark.value)
  }

  function toggle() {
    isDark.value = !isDark.value
    localStorage.setItem(THEME_STORAGE_KEY, isDark.value ? THEME_CLASS : 'light')
    apply()
  }

  onMounted(() => {
    isDark.value = isDarkPreferred()
    apply()
  })

  return { isDark, toggle }
}
