/**
 * useClickOutside — detect clicks outside a referenced element.
 *
 * Used by NavDropdown.vue. Calls the handler when the user
 * clicks anywhere outside the root element.
 */
import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'

export function useClickOutside<T extends HTMLElement = HTMLElement>(): {
  root: Ref<T | null>
  isOpen: Ref<boolean>
  toggle: () => void
  close: () => void
} {
  const root = ref<T | null>(null)
  const isOpen = ref(false)

  function toggle() {
    isOpen.value = !isOpen.value
  }

  function close() {
    isOpen.value = false
  }

  function handler(e: MouseEvent) {
    if (root.value && !root.value.contains(e.target as Node)) {
      isOpen.value = false
    }
  }

  onMounted(() => document.addEventListener('click', handler))
  onBeforeUnmount(() => document.removeEventListener('click', handler))

  return { root, isOpen, toggle, close }
}