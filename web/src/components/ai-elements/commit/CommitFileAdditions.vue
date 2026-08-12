<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { PlusSignIcon } from '@hugeicons/vue'
import { cn } from '@/lib/utils'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  count: number
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <span
    v-if="props.count > 0"
    :class="cn('text-green-600 dark:text-green-400', props.class)"
    v-bind="$attrs"
  >
    <slot>
      <PlusSignIcon class="inline-block size-3" />
      {{ props.count }}
    </slot>
  </span>
</template>
