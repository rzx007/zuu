import { computed, ref } from 'vue'
import type {
  AuditEvent,
  AuditEventAction,
  AuditEventOutcome,
  AuthScope,
  AuthStatus,
  ZuuClient,
} from '@zuu/client'
import { STORAGE_KEYS } from '@/lib/app-state'
import { errorMessage, optionalDatetimeIso } from '@/lib/format'

interface SecurityPanelOptions {
  getClient: () => ZuuClient
  replaceClientToken: (token: string | undefined) => void
  addMessage: (role: 'event' | 'error', text?: string) => unknown
  refreshAll: () => Promise<unknown>
}

export function useSecurityPanel(options: SecurityPanelOptions) {
  const apiToken = ref(localStorage.getItem(STORAGE_KEYS.apiToken) || '')
  const authStatus = ref<AuthStatus>()
  const newAuthTokenActor = ref('webui')
  const newAuthTokenScope = ref<AuthScope>('read')
  const newAuthTokenExpiresAt = ref('')
  const auditEvents = ref<AuditEvent[]>([])
  const auditAction = ref<'' | AuditEventAction>('')
  const auditOutcome = ref<'' | AuditEventOutcome>('')
  const auditAuthScope = ref<'' | AuthScope>('')
  const auditAuthActor = ref('')
  const auditAuthTokenId = ref('')
  const auditTarget = ref('')
  const auditSince = ref('')
  const auditUntil = ref('')
  const authAdminTokenCount = computed(() => authStatus.value?.tokens.filter((token) => token.scope === 'admin').length ?? 0)

  async function loadAuthStatus() {
    authStatus.value = (await options.getClient().authStatus()).auth
  }

  async function loadAuditEvents() {
    auditEvents.value = (await options.getClient().listAuditEvents({
      limit: 50,
      action: auditAction.value || undefined,
      outcome: auditOutcome.value || undefined,
      authScope: auditAuthScope.value || undefined,
      authActor: auditAuthActor.value.trim() || undefined,
      authTokenId: auditAuthTokenId.value.trim() || undefined,
      target: auditTarget.value.trim() || undefined,
      since: optionalDatetimeIso(auditSince.value),
      until: optionalDatetimeIso(auditUntil.value),
    })).events
  }

  function saveToken() {
    const token = apiToken.value.trim()
    persistClientToken(token || undefined)
    options.addMessage('event', token ? 'API token saved.' : 'API token cleared.')
    options.refreshAll().catch((error) => options.addMessage('error', errorMessage(error)))
  }

  async function rotateAuthToken() {
    const result = await options.getClient().rotateAuthToken()
    apiToken.value = result.apiToken
    persistClientToken(result.apiToken)
    authStatus.value = result.auth
    options.addMessage('event', `API token rotated: ${result.auth.tokenPreview}`)
    await options.refreshAll()
  }

  async function createAuthToken() {
    const result = await options.getClient().createAuthToken({
      actor: newAuthTokenActor.value.trim() || undefined,
      scope: newAuthTokenScope.value,
      expiresAt: optionalDatetimeIso(newAuthTokenExpiresAt.value),
    })
    authStatus.value = result.auth
    await loadAuditEvents()
    options.addMessage('event', `API token created for ${result.token.actor}: ${result.apiToken}`)
  }

  async function revokeAuthToken(tokenId: string) {
    const result = await options.getClient().revokeAuthToken(tokenId)
    authStatus.value = result.auth
    await loadAuditEvents()
    options.addMessage('event', `API token revoked: ${result.revoked.actor} / ${result.revoked.scope}`)
  }

  function persistClientToken(token: string | undefined) {
    if (token) localStorage.setItem(STORAGE_KEYS.apiToken, token)
    else localStorage.removeItem(STORAGE_KEYS.apiToken)
    options.replaceClientToken(token)
  }

  return {
    apiToken,
    authStatus,
    newAuthTokenActor,
    newAuthTokenScope,
    newAuthTokenExpiresAt,
    auditEvents,
    auditAction,
    auditOutcome,
    auditAuthScope,
    auditAuthActor,
    auditAuthTokenId,
    auditTarget,
    auditSince,
    auditUntil,
    authAdminTokenCount,
    loadAuthStatus,
    loadAuditEvents,
    saveToken,
    rotateAuthToken,
    createAuthToken,
    revokeAuthToken,
  }
}
