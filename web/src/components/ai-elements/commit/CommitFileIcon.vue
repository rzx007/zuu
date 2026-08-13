<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { File01Icon } from '@/components/icons'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <File01Icon :class="cn('size-3.5 shrink-0 text-muted-foreground', props.class)" v-bind="$attrs" />
</template>
