<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { resolveNavHref, type NavItem, type NavProductCta } from '../config/nav'
import { useTheme } from '../composables/useTheme'

// The mobile overlay renders the injected nav items and brand — no
// package-side defaults exist. The overlay's logo rides the SAME brand
// the desktop header passes down (SiteHeader threads its brand props):
// absolute URLs — a relative logo path would 404 on any other host
// (2026-08-24: the hamburger overlay's logo was missing on the identity
// service for exactly that), and the light/dark display rules live in
// THIS component's own styles (the header's scoped rules never reach a
// Vue island).
interface Props {
  /** The injected nav items, in the site's order. */
  items?: readonly NavItem[]
  /** The injected product CTA, rendered above the bottom row. */
  productCta?: NavProductCta
  /** The origin relative hrefs resolve against (the nav model's). */
  origin?: string
  brandName?: string
  logoLight?: string
  logoDark?: string
  homeHref?: string
  signInHref?: string
  /** False when the consumer mounted an account chip in the header's
   *  signin slot — a logged-in user must not be offered "Sign in". */
  showSignIn?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  // withDefaults, never `props.showSignIn ?? true`: a type-only boolean
  // prop compiles to Vue's Boolean casting, so the ABSENT prop reads
  // false (not undefined) and the `??` fallback never fires — the
  // overlay lost its "Sign in" on every bare mount (the www suite
  // caught it, TODO.ai-platform/01's mount drill).
  showSignIn: true,
})

const isOpen = ref(false)
const expandedSection = ref<string | null>(null)
const { isDark, toggle: toggleTheme } = useTheme()
const triggerButton = ref<HTMLButtonElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)

function toggleMenu() {
  isOpen.value = !isOpen.value
  document.body.style.overflow = isOpen.value ? 'hidden' : ''
  // The overlay is a dialog: focus moves into it on open and back to
  // the trigger on close (Esc included).
  if (isOpen.value) nextTick(() => closeButton.value?.focus())
  else triggerButton.value?.focus()
}

function toggleSection(id: string) {
  expandedSection.value = expandedSection.value === id ? null : id
}
</script>

<template>
  <!-- Hamburger trigger button -->
  <button
    ref="triggerButton"
    class="lg:hidden flex flex-col items-center justify-center gap-[5px] w-11 h-11 rounded-lg border border-rule cursor-pointer shrink-0 transition-colors hover:border-accent bg-transparent touch-manipulation"
    @click="toggleMenu"
    aria-label="Open menu"
    :aria-expanded="isOpen"
  >
    <span class="block w-5 h-0.5 rounded-full bg-ink transition-[transform,opacity] duration-200 motion-reduce:transition-none" :class="{ 'translate-y-[7px] rotate-45': isOpen }"></span>
    <span class="block w-5 h-0.5 rounded-full bg-ink transition-[transform,opacity] duration-200 motion-reduce:transition-none" :class="{ 'opacity-0': isOpen }"></span>
    <span class="block w-5 h-0.5 rounded-full bg-ink transition-[transform,opacity] duration-200 motion-reduce:transition-none" :class="{ '-translate-y-[7px] -rotate-45': isOpen }"></span>
  </button>

  <!-- Full-screen mobile nav overlay -->
  <Transition name="mobile-nav">
      <div v-if="isOpen" role="dialog" aria-modal="true" aria-label="Menu" @keydown.escape="toggleMenu" class="fixed inset-0 z-[300] bg-paper flex flex-col lg:hidden">
      <!-- Panel header with logo + close -->
      <div class="flex items-center justify-between h-14 px-6 border-b border-rule shrink-0">
        <a v-if="homeHref" :href="homeHref" class="flex items-center gap-2 no-underline text-ink" @click="toggleMenu">
          <img v-if="logoLight" :src="logoLight" alt="" class="logo-light h-7 w-auto shrink-0" />
          <img v-if="logoDark" :src="logoDark" alt="" class="logo-dark h-7 w-auto shrink-0" />
          <span v-if="brandName" class="font-serif text-base font-semibold tracking-tight">{{ brandName }}</span>
        </a>
        <button
          ref="closeButton"
          class="flex items-center justify-center w-11 h-11 rounded-lg border border-rule cursor-pointer shrink-0 transition-colors hover:border-accent bg-transparent touch-manipulation ml-auto"
          @click="toggleMenu"
          aria-label="Close menu"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="text-ink">
            <path d="M5 5 L15 15 M15 5 L5 15" />
          </svg>
        </button>
      </div>

      <!-- Nav items in the injected order -->
      <div class="flex-1 overflow-y-auto overscroll-contain px-6 py-4 flex flex-col gap-1">
        <template v-for="(item, i) in items" :key="i">
          <!-- Dropdown section -->
          <div v-if="item.type === 'dropdown'">
            <button
              class="w-full flex items-center justify-between py-3 px-3 text-sm font-medium text-ink-soft hover:text-accent transition-colors text-left rounded"
              @click="toggleSection(item.config.id)"
            >
              <span class="flex items-center gap-2">
                <span v-if="item.config.variant === 'internal'" class="inline-block w-1.5 h-1.5 rounded-full bg-amber-warm shrink-0"></span>
                {{ item.config.label }}
              </span>
              <span class="text-xs text-ink-muted transition-transform" :class="{ 'rotate-180': expandedSection === item.config.id }">▾</span>
            </button>
            <Transition name="expand">
              <div v-if="expandedSection === item.config.id" class="flex flex-col gap-0 pb-2">
                <div v-if="item.config.sectionHeader" class="px-3 py-2 text-[0.625rem] font-mono uppercase tracking-wider text-amber-deep">
                  {{ item.config.sectionHeader }}
                </div>
                <!-- Labels only: the overlay never renders a link's desc -->
                <a
                  v-for="link in item.config.links"
                  :key="link.href"
                  :href="resolveNavHref(link.href, link.external, origin)"
                  class="py-2.5 px-6 text-sm text-ink-soft hover:text-accent transition-colors rounded flex items-center gap-1.5"
                >
                  {{ link.label }}
                  <span v-if="link.badge === 'internal'" class="text-[0.5625rem] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-amber-warm/10 text-amber-deep border border-amber-warm/20">internal</span>
                  <svg v-if="link.external" class="w-3 h-3 text-ink-muted shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg>
                </a>
              </div>
            </Transition>
            <div v-if="item.config.id === 'about'" class="h-px bg-rule my-2"></div>
          </div>

          <!-- Standalone link -->
          <a
            v-else
            :href="resolveNavHref(item.href, undefined, origin)"
            class="py-3 px-3 text-sm font-medium text-ink-soft hover:text-accent transition-colors rounded"
          >{{ item.label }}</a>
        </template>

        <!-- The injected product CTA -->
        <a
          v-if="productCta"
          :href="resolveNavHref(productCta.href, productCta.external, origin)"
          class="mt-3 text-center text-sm font-semibold text-paper bg-accent rounded px-3 py-2.5 no-underline"
        >{{ productCta.label }}</a>

        <!-- Bottom: theme toggle icon + sign in -->
        <div class="mt-auto pt-4 border-t border-rule flex items-center justify-between">
          <button
            class="flex items-center justify-center w-11 h-11 rounded-lg border border-rule cursor-pointer text-lg transition-colors hover:border-accent bg-transparent touch-manipulation"
            @click="toggleTheme"
            :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
          >
            <span v-if="!isDark">☀</span>
            <span v-else>☾</span>
          </button>
          <a v-if="showSignIn && signInHref" :href="signInHref" class="shell-signin text-sm font-semibold text-accent">Sign in ↗</a>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.mobile-nav-enter-active,
.mobile-nav-leave-active {
  transition: transform 0.25s ease;
}
.mobile-nav-enter-from,
.mobile-nav-leave-to {
  transform: translateX(100%);
}

.expand-enter-active,
.expand-leave-active {
  transition: opacity 0.2s ease, max-height 0.2s ease;
  overflow: hidden;
}
.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}
.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 500px;
}

@media (prefers-reduced-motion: reduce) {
  .mobile-nav-enter-active,
  .mobile-nav-leave-active,
  .expand-enter-active,
  .expand-leave-active {
    transition: none;
  }
}
</style>
