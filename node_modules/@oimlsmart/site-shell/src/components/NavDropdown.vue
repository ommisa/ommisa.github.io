<script setup lang="ts">
/**
 * NavDropdown — the generic navigation dropdown, driven entirely by the
 * injected NavDropdownConfig. It renders LABELS ONLY: the NavLink type
 * keeps `desc` for surfaces the consumer owns, but this menu never
 * prints it — menus are terse by contract.
 *
 * Variants:
 *   - default: standard nav styling
 *   - internal: amber accent, visual divider, "internal use" section header
 */
import { computed } from 'vue'
import { useClickOutside } from '../composables/useClickOutside'
import { isDropdownActive, resolveNavHref, type NavDropdownConfig } from '../config/nav'

const props = defineProps<{
  config: NavDropdownConfig
  currentPath: string
  /** The origin relative hrefs resolve against (the nav model's). */
  origin?: string
}>()

const { root, isOpen, toggle, close } = useClickOutside()

const isInternal = computed(() => props.config.variant === 'internal')
const isActive = computed(() => isDropdownActive(props.config, props.currentPath))

// Build a flat list of items: dividers + links. A divider is rendered
// before the first external link in a group to visually separate
// "leaves this site" destinations from internal routes.
type DropdownItem =
  | { kind: 'divider'; label: string }
  | { kind: 'link'; href: string; label: string; badge?: string; external?: boolean }

const items = computed<DropdownItem[]>(() => {
  const out: DropdownItem[] = []
  const links = props.config.links
  for (let i = 0; i < links.length; i++) {
    const link = links[i]
    const prev = links[i - 1]
    if (link.external && (!prev || !prev.external)) {
      out.push({ kind: 'divider', label: 'External sites' })
    }
    out.push({
      kind: 'link',
      href: resolveNavHref(link.href, link.external, props.origin),
      label: link.label,
      badge: link.badge,
      external: link.external,
    })
  }
  return out
})

let closeTimer: ReturnType<typeof setTimeout> | null = null

function onEnter() {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
  isOpen.value = true
}

function onLeave() {
  closeTimer = setTimeout(() => { isOpen.value = false }, 150)
}
</script>

<template>
  <div ref="root" class="nav-dropdown relative flex items-center" @mouseenter="onEnter" @mouseleave="onLeave" @keydown.escape="close">
    <div v-if="isInternal" class="hidden sm:block w-px h-5 bg-rule mr-3" aria-hidden="true" />
    <button
      class="inline-flex items-center gap-1.5 text-sm font-medium transition-colors whitespace-nowrap"
      :class="isActive ? 'text-accent font-semibold' : 'text-ink-soft hover:text-accent'"
      @click="toggle"
      :data-testid="`nav-dropdown-${config.id}`"
      :aria-label="config.label"
      :aria-expanded="isOpen"
    >
      <span v-if="isInternal" class="inline-block w-1.5 h-1.5 rounded-full bg-amber-warm" aria-hidden="true" />
      <span>{{ config.label }}</span>
      <span class="text-[0.625rem] text-ink-muted">▾</span>
    </button>
    <div
      class="absolute top-full mt-2 min-w-[240px] bg-paper-soft border border-rule rounded-lg p-1.5 shadow-lg flex-col gap-0.5 z-[200] transition-[opacity,transform,visibility] duration-150 motion-reduce:transition-none"
      :class="[
        isInternal ? 'right-0' : 'left-0',
        isOpen ? 'flex opacity-100 visible translate-y-0' : 'hidden opacity-0 invisible',
      ]"
    >
      <div
        v-if="config.sectionHeader"
        class="px-3 py-1.5 text-[0.625rem] font-mono uppercase tracking-wider text-amber-deep border-b border-rule-soft mb-1"
      >
        {{ config.sectionHeader }}
      </div>
      <template v-for="(item, i) in items" :key="i">
        <!-- External section divider -->
        <div v-if="item.kind === 'divider'" class="flex items-center gap-1.5 px-3 pt-2 pb-1 mt-1 border-t border-rule">
          <svg class="w-3 h-3 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg>
          <span class="font-mono text-[0.5625rem] uppercase tracking-[0.12em] text-ink-muted">{{ item.label }}</span>
          <span class="font-mono text-[0.5rem] text-ink-muted/60">· leaves this site</span>
        </div>
        <!-- Link: the label only — the dropdown never renders a link's desc -->
        <a
          v-else
          :href="item.href"
          class="flex items-center gap-2 px-3 py-2 text-sm text-ink-soft hover:bg-paper-raised hover:text-accent rounded no-underline transition-colors"
        >
          <span class="whitespace-nowrap">{{ item.label }}</span>
          <span
            v-if="item.badge === 'internal'"
            class="shrink-0 inline-flex items-center text-[0.5625rem] font-mono font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-amber-warm/10 text-amber-deep border border-amber-warm/20"
          >internal</span>
          <svg v-if="item.external" class="shrink-0 w-3 h-3 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg>
        </a>
      </template>
    </div>
  </div>
</template>
