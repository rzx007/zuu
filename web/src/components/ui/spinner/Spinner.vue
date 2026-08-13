<script setup lang="ts">
import type { HTMLAttributes } from 'vue'

import { Loading03Icon } from '@/components/icons'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <Loading03Icon role="status" aria-label="Loading" :class="cn('size-4 animate-spin', props.class)" />
</template>
