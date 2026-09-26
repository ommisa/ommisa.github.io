<script setup lang="ts">
import { ref, onMounted } from 'vue'

// pagefind's base — GitHub Pages project sites serve the index under
// /<repo>/pagefind/, so the root-relative default is overridable.
interface Props {
  base?: string
}
const { base = '/pagefind' } = defineProps<Props>()

const loaded = ref(false)
const results = ref<any[]>([])
const query = ref('')
const showResults = ref(false)

let pagefindUI: any = null

async function ensureLoaded() {
  if (loaded.value) return
  loaded.value = true

  const css = document.createElement('link')
  css.rel = 'stylesheet'
  css.href = `${base}/pagefind-ui.css`
  document.head.appendChild(css)

  await new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = `${base}/pagefind-ui.js`
    s.onload = resolve
    document.head.appendChild(s)
  })

  if (typeof window !== 'undefined' && (window as any).PagefindUI) {
    const el = document.getElementById('pagefind-search')
    if (el) {
      pagefindUI = new (window as any).PagefindUI({
        element: '#pagefind-search',
        showImages: false,
        pageSize: 5,
      })
    }
  }
}

function onFocus() {
  ensureLoaded()
  showResults.value = true
}
</script>

<template>
  <div class="relative min-w-[120px]" data-testid="search-box" @focusin="onFocus">
    <div id="pagefind-search"></div>
  </div>
</template>