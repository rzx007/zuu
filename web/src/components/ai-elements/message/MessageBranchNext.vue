<script setup lang="ts">
import { ArrowRight01Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useMessageBranchContext } from './context'

const { goToNext, totalBranches } = useMessageBranchContext()
</script>

<template>
  <Button
    aria-label="Next branch"
    :disabled="totalBranches <= 1"
    size="icon-sm"
    type="button"
    variant="ghost"
    v-bind="$attrs"
    @click="goToNext"
  >
    <slot>
      <ArrowRight01Icon :size="14" />
    </slot>
  </Button>
</template>
