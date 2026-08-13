import type { PromptRequest } from '@zuu/client'

export type PromptModelSelection = PromptRequest['model']

export function parseModelSelection(value: string) {
  const [provider, id] = value.split('/', 2)
  return {
    provider: provider || '',
    id: id || '',
  }
}

export function createPromptModel(provider: string, id: string): PromptModelSelection {
  return provider && id ? { provider, id } : undefined
}

export function formatPromptModel(model: PromptModelSelection) {
  return model ? `${model.provider}/${model.id}` : undefined
}
