<script setup lang="ts">
import { useTheme } from '../composables/useTheme'
const { isDark, toggle } = useTheme()
</script>

<template>
  <button
    class="bg-transparent border border-rule rounded w-8 h-8 cursor-pointer flex items-center justify-center text-sm text-inherit transition-[border-color] duration-150 hover:border-accent"
    @click="toggle" data-testid="theme-toggle"
    :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
  >
    <span v-show="!isDark" class="icon-sun">☀</span>
    <span v-show="isDark" class="icon-moon">☾</span>
  </button>
</template>