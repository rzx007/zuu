<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { TerminalIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <div
    :class="cn('flex items-center gap-2 text-sm text-zinc-400', props.class)"
    v-bind="$attrs"
  >
    <TerminalIcon :size="16" />
    <slot>Terminal</slot>
  </div>
</template>
