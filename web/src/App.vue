<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  createZuuClient,
  type Approval,
  type ApprovalDecision,
  type Diagnostics,
  type ModelSummary,
  type PromptRequest,
  type RunSummary,
  type SessionSummary,
  type SessionTreeEntry,
  type StoredSessionSummary,
  type ThinkingLevel,
} from '@zuu/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type MessageRole = 'user' | 'agent' | 'event' | 'error'

interface MessageItem {
  id: string
  role: MessageRole
  text: string
}

interface FlatTreeEntry {
  entry: SessionTreeEntry
  depth: number
}

const tokenKey = 'zuu.apiToken'
let client = createZuuClient({ apiToken: localStorage.getItem(tokenKey) || undefined })
let messageSeq = 0

const apiToken = ref(localStorage.getItem(tokenKey) || '')
const diagnostics = ref<Diagnostics>()
const packages = ref<string[]>([])
const packageSource = ref('')
const models = ref<ModelSummary[]>([])
const selectedModel = ref('')
const provider = ref('')
const modelName = ref('')
const thinkingLevel = ref<ThinkingLevel>('medium')
const sessionName = ref('Zuu demo')
const prompt = ref('Use the zuu_status tool, then explain whether this app has workflow and scheduler support installed.')
const currentSession = ref<SessionSummary>()
const storedSessions = ref<StoredSessionSummary[]>([])
const sessionTree = ref<SessionTreeEntry[]>([])
const importPath = ref('')
const runs = ref<RunSummary[]>([])
const approvals = ref<Approval[]>([])
const messages = ref<MessageItem[]>([])
const isRunning = ref(false)
const isRefreshing = ref(false)
const controller = ref<AbortController>()

const toolChoices = ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write', 'zuu_status']
const selectedTools = reactive<Record<string, boolean>>({
  read: true,
  grep: true,
  find: true,
  ls: true,
  bash: false,
  edit: false,
  write: false,
  zuu_status: true,
})

const activeTools = computed(() => toolChoices.filter((tool) => selectedTools[tool]))
const pendingApprovals = computed(() => approvals.value.filter((approval) => approval.status === 'pending'))
const flatTree = computed(() => flattenTree(sessionTree.value))
const statusText = computed(() => (isRunning.value ? 'running' : 'ready'))
const configuredProviders = computed(() => diagnostics.value?.models.configuredProviders.join(', ') || 'none')

function nextId() {
  messageSeq += 1
  return `${Date.now()}-${messageSeq}`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function addMessage(role: MessageRole, text = '') {
  const message: MessageItem = { id: nextId(), role, text }
  messages.value.push(message)
  requestAnimationFrame(() => {
    document.querySelector('[data-message-list]')?.scrollTo({ top: 100000, behavior: 'smooth' })
  })
  return message
}

function setActiveSession(session: SessionSummary) {
  currentSession.value = session
  sessionName.value = session.name || sessionName.value
}

function flattenTree(entries: SessionTreeEntry[], depth = 0): FlatTreeEntry[] {
  return entries.flatMap((entry) => [{ entry, depth }, ...flattenTree(entry.children || [], depth + 1)])
}

async function loadDiagnostics() {
  diagnostics.value = await client.diagnostics()
}

async function loadPackages() {
  packages.value = (await client.listPackages()).packages
}

async function loadModels() {
  const response = await client.listModels()
  models.value = response.models
}

async function loadRuns() {
  runs.value = (await client.listRuns(currentSession.value?.id)).runs
}

async function loadStoredSessions() {
  storedSessions.value = (await client.listStoredSessions()).sessions
}

async function loadSessionTree() {
  if (!currentSession.value) {
    sessionTree.value = []
    return
  }
  sessionTree.value = (await client.getSessionTree(currentSession.value.id)).tree
}

async function loadApprovals() {
  approvals.value = (await client.listApprovals()).approvals
}

async function refreshAll() {
  isRefreshing.value = true
  try {
    await Promise.all([
      loadDiagnostics(),
      loadPackages(),
      loadModels(),
      loadRuns(),
      loadStoredSessions(),
      loadSessionTree(),
      loadApprovals(),
    ])
  } finally {
    isRefreshing.value = false
  }
}

function saveToken() {
  const token = apiToken.value.trim()
  if (token) localStorage.setItem(tokenKey, token)
  else localStorage.removeItem(tokenKey)
  client = createZuuClient({ apiToken: token || undefined })
  addMessage('event', token ? 'API token saved.' : 'API token cleared.')
  refreshAll().catch((error) => addMessage('error', errorMessage(error)))
}

function chooseModel() {
  const [nextProvider, nextModel] = selectedModel.value.split('/', 2)
  provider.value = nextProvider || ''
  modelName.value = nextModel || ''
}

async function addPackage() {
  const source = packageSource.value.trim()
  if (!source) return
  await client.addPackage({ source })
  packageSource.value = ''
  await Promise.all([loadPackages(), loadDiagnostics()])
}

async function removePackage(source: string) {
  await client.removePackage({ source })
  await Promise.all([loadPackages(), loadDiagnostics()])
}

async function openStoredSession(sessionFile: string) {
  const { session } = await client.openSession({ sessionFile })
  setActiveSession(session)
  addMessage('event', `opened session: ${session.id}`)
  await Promise.all([loadRuns(), loadStoredSessions(), loadSessionTree(), loadApprovals()])
}

async function forkFromEntry(entryId: string, position: 'before' | 'at') {
  if (!currentSession.value) return
  const result = await client.forkSession(currentSession.value.id, { entryId, position })
  if (!result.cancelled) {
    setActiveSession(result.session)
    addMessage('event', `forked session: ${result.session.id}`)
    await Promise.all([loadRuns(), loadStoredSessions(), loadSessionTree()])
  }
}

async function importSession() {
  const path = importPath.value.trim()
  if (!path) return
  if (!currentSession.value) {
    const { session } = await client.createSession({ persist: false, name: 'Import anchor' })
    setActiveSession(session)
  }
  const sessionId = currentSession.value?.id
  if (!sessionId) return
  const result = await client.importSession(sessionId, { path })
  if (!result.cancelled) {
    setActiveSession(result.session)
    importPath.value = ''
    addMessage('event', `imported session: ${result.session.id}`)
    await Promise.all([loadRuns(), loadStoredSessions(), loadSessionTree()])
  }
}

async function resolveApproval(approval: Approval, decision: ApprovalDecision) {
  const result = await client.resolveApproval(approval.id, { decision })
  addMessage('event', `${decision}: ${result.approval.title}`)
  await Promise.all([loadApprovals(), loadRuns()])
}

async function sendPrompt() {
  const text = prompt.value.trim()
  if (!text) return

  const request: PromptRequest = {
    prompt: text,
    sessionId: currentSession.value?.id,
    name: sessionName.value.trim() || undefined,
    thinkingLevel: thinkingLevel.value,
    tools: activeTools.value,
    model: provider.value && modelName.value ? { provider: provider.value, id: modelName.value } : undefined,
  }

  addMessage('user', text)
  const agentMessage = addMessage('agent')
  isRunning.value = true
  controller.value = new AbortController()

  try {
    for await (const event of client.prompt(request, { signal: controller.value.signal })) {
      if (event.type === 'session' && event.session) {
        setActiveSession(event.session)
        addMessage('event', `run start: ${event.runId}`)
        await Promise.all([loadRuns(), loadStoredSessions(), loadSessionTree()])
      } else if (event.type === 'text_delta') {
        agentMessage.text += event.delta || ''
      } else if (event.type === 'tool_start' && event.tool) {
        addMessage('event', `tool start: ${event.tool.name}`)
      } else if (event.type === 'tool_end' && event.tool) {
        addMessage('event', `tool end: ${event.tool.name}${event.tool.isError ? ' (error)' : ''}`)
      } else if (event.type === 'approval_requested' && event.approval) {
        addMessage('event', `approval required: ${event.approval.title}`)
        await Promise.all([loadApprovals(), loadRuns()])
      } else if (event.type === 'approval_resolved' && event.approval) {
        addMessage('event', `approval granted: ${event.approval.title}`)
        await loadApprovals()
      } else if (event.type === 'error') {
        addMessage('error', event.message || 'Unknown agent error')
        await loadRuns()
      } else if (event.type === 'done') {
        await Promise.all([loadRuns(), loadStoredSessions(), loadSessionTree(), loadApprovals()])
      }
    }
  } catch (error) {
    if (!isAbortError(error)) addMessage('error', errorMessage(error))
  } finally {
    controller.value = undefined
    isRunning.value = false
  }
}

async function abortPrompt() {
  controller.value?.abort()
  if (currentSession.value) {
    await client.abort(currentSession.value.id).catch(() => undefined)
    await Promise.all([loadRuns(), loadStoredSessions(), loadSessionTree()])
  }
  isRunning.value = false
}

onMounted(() => {
  refreshAll().catch((error) => addMessage('error', errorMessage(error)))
})
</script>

<template>
  <div class="min-h-svh bg-background text-foreground">
    <div class="grid min-h-svh grid-cols-[320px_minmax(0,1fr)] max-lg:grid-cols-1">
      <aside class="border-border bg-sidebar/70 flex flex-col gap-3 border-r p-4 max-lg:border-r-0 max-lg:border-b">
        <section class="space-y-1">
          <div class="flex items-center justify-between gap-3">
            <h1 class="text-lg font-semibold">Zuu Agent</h1>
            <Badge variant="outline">{{ statusText }}</Badge>
          </div>
          <p class="text-muted-foreground text-xs">Pi SDK daemon, session runtime, tool approvals and package diagnostics.</p>
        </section>

        <section class="panel-block">
          <div class="section-title">
            <h2>Runtime</h2>
            <Button variant="ghost" size="xs" :disabled="isRefreshing" @click="refreshAll">Refresh</Button>
          </div>
          <dl class="meta-grid">
            <div><dt>SDK</dt><dd>{{ diagnostics?.sdk.version || 'loading' }}</dd></div>
            <div><dt>Models</dt><dd>{{ diagnostics?.models.availableCount ?? 0 }}</dd></div>
            <div><dt>Providers</dt><dd>{{ configuredProviders }}</dd></div>
            <div><dt>Skills</dt><dd>{{ diagnostics?.resources.skills ?? 0 }}</dd></div>
          </dl>
          <p v-if="diagnostics?.gaps.length" class="text-destructive text-xs">{{ diagnostics.gaps.join(' / ') }}</p>
          <label class="field-label">
            API token
            <input v-model="apiToken" class="field-input" type="password" placeholder="Optional ZUU_API_TOKEN" @keydown.enter="saveToken">
          </label>
          <Button variant="outline" size="sm" @click="saveToken">Save token</Button>
        </section>

        <section class="panel-block">
          <div class="section-title">
            <h2>Session</h2>
            <Badge variant="secondary">{{ currentSession?.messageCount ?? 0 }} messages</Badge>
          </div>
          <label class="field-label">
            Session name
            <input v-model="sessionName" class="field-input">
          </label>
          <label class="field-label">
            Available model
            <select v-model="selectedModel" class="field-input" @change="chooseModel">
              <option value="">Use manual model</option>
              <option v-for="model in models" :key="`${model.provider}/${model.id}`" :value="`${model.provider}/${model.id}`">
                {{ model.provider }} / {{ model.label || model.id }}
              </option>
            </select>
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="field-label">
              Provider
              <input v-model="provider" class="field-input" placeholder="deepseek">
            </label>
            <label class="field-label">
              Model
              <input v-model="modelName" class="field-input" placeholder="deepseek-chat">
            </label>
          </div>
          <label class="field-label">
            Thinking
            <select v-model="thinkingLevel" class="field-input">
              <option value="off">off</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
          <div class="tool-grid">
            <label v-for="tool in toolChoices" :key="tool" class="tool-toggle">
              <input v-model="selectedTools[tool]" type="checkbox">
              <span>{{ tool }}</span>
            </label>
          </div>
        </section>

        <section class="panel-block">
          <div class="section-title">
            <h2>Packages</h2>
            <Badge variant="outline">{{ packages.length }}</Badge>
          </div>
          <div v-if="packages.length" class="list-stack">
            <div v-for="source in packages" :key="source" class="compact-row">
              <span>{{ source }}</span>
              <Button variant="ghost" size="xs" @click="removePackage(source).catch((error) => addMessage('error', errorMessage(error)))">Remove</Button>
            </div>
          </div>
          <p v-else class="empty-text">No packages configured.</p>
          <div class="flex gap-2">
            <input v-model="packageSource" class="field-input min-w-0" placeholder="npm:@agwab/pi-workflow" @keydown.enter="addPackage().catch((error) => addMessage('error', errorMessage(error)))">
            <Button variant="outline" size="sm" @click="addPackage().catch((error) => addMessage('error', errorMessage(error)))">Add</Button>
          </div>
        </section>

        <section class="panel-block">
          <div class="section-title">
            <h2>Stored Sessions</h2>
            <Badge variant="outline">{{ storedSessions.length }}</Badge>
          </div>
          <div v-if="storedSessions.length" class="list-stack max-h-52 overflow-auto">
            <div v-for="session in storedSessions.slice(0, 8)" :key="session.path" class="compact-row">
              <div class="min-w-0">
                <strong>{{ session.name || session.id.slice(0, 8) }}</strong>
                <span>{{ session.messageCount }} messages · {{ session.updatedAt }}</span>
              </div>
              <Button variant="outline" size="xs" :disabled="session.isActive" @click="openStoredSession(session.path).catch((error) => addMessage('error', errorMessage(error)))">Open</Button>
            </div>
          </div>
          <p v-else class="empty-text">No stored sessions yet.</p>
        </section>
      </aside>

      <main class="grid min-h-svh grid-rows-[auto_minmax(0,1fr)_auto]">
        <header class="border-border bg-background flex items-center justify-between gap-3 border-b px-5 py-4 max-md:flex-col max-md:items-start">
          <div class="min-w-0">
            <h2 class="truncate text-base font-semibold">{{ currentSession?.name || 'New session' }}</h2>
            <p class="text-muted-foreground truncate text-xs">{{ currentSession?.model || currentSession?.sessionFile || 'Ask the agent to inspect this project.' }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <Badge v-if="pendingApprovals.length" variant="destructive">{{ pendingApprovals.length }} pending approval</Badge>
            <Badge variant="outline">{{ activeTools.length }} tools</Badge>
          </div>
        </header>

        <div class="grid min-h-0 grid-cols-[minmax(0,1fr)_360px] max-xl:grid-cols-1">
          <section data-message-list class="flex min-h-0 flex-col gap-3 overflow-auto p-5">
            <div v-if="!messages.length" class="empty-surface">
              <h2>Ready for a run</h2>
              <p>Choose a model, enable tools, then send a prompt.</p>
            </div>
            <article v-for="message in messages" :key="message.id" class="message-bubble" :class="`message-${message.role}`">
              {{ message.text || '...' }}
            </article>
          </section>

          <aside class="border-border bg-muted/20 grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-l p-4 max-xl:border-l-0 max-xl:border-t">
            <section class="side-panel">
              <div class="section-title">
                <h2>Approvals</h2>
                <Button variant="ghost" size="xs" @click="loadApprovals">Refresh</Button>
              </div>
              <div v-if="approvals.length" class="list-stack overflow-auto">
                <div v-for="approval in approvals.slice(0, 8)" :key="approval.id" class="approval-row">
                  <div class="flex items-center justify-between gap-2">
                    <strong>{{ approval.title }}</strong>
                    <Badge :variant="approval.status === 'pending' ? 'destructive' : 'outline'">{{ approval.status }}</Badge>
                  </div>
                  <p>{{ approval.description }}</p>
                  <div v-if="approval.status === 'pending'" class="flex flex-wrap gap-2">
                    <Button size="xs" @click="resolveApproval(approval, 'allow_once').catch((error) => addMessage('error', errorMessage(error)))">Allow once</Button>
                    <Button variant="outline" size="xs" @click="resolveApproval(approval, 'allow_session').catch((error) => addMessage('error', errorMessage(error)))">Allow session</Button>
                    <Button variant="destructive" size="xs" @click="resolveApproval(approval, 'deny').catch((error) => addMessage('error', errorMessage(error)))">Deny</Button>
                  </div>
                </div>
              </div>
              <p v-else class="empty-text">No approvals yet.</p>
            </section>

            <section class="side-panel">
              <div class="section-title">
                <h2>Recent Runs</h2>
                <Button variant="ghost" size="xs" @click="loadRuns">Refresh</Button>
              </div>
              <div v-if="runs.length" class="list-stack overflow-auto">
                <div v-for="run in runs.slice(0, 10)" :key="run.id" class="compact-row">
                  <div class="min-w-0">
                    <strong>{{ run.id.slice(0, 8) }} · {{ run.status }}</strong>
                    <span>{{ run.prompt }}</span>
                  </div>
                </div>
              </div>
              <p v-else class="empty-text">No runs yet.</p>
            </section>

            <section class="side-panel">
              <div class="section-title">
                <h2>Session Tree</h2>
                <Button variant="ghost" size="xs" @click="loadSessionTree">Refresh</Button>
              </div>
              <div v-if="flatTree.length" class="list-stack overflow-auto">
                <div v-for="{ entry, depth } in flatTree.slice(0, 30)" :key="entry.id" class="tree-row" :style="{ paddingLeft: `${8 + Math.min(depth * 12, 48)}px` }">
                  <strong>{{ entry.role || entry.type }} · {{ entry.id.slice(0, 8) }}</strong>
                  <span>{{ (entry.text || entry.timestamp || '').slice(0, 110) }}</span>
                  <div class="flex gap-2">
                    <Button variant="outline" size="xs" @click="forkFromEntry(entry.id, 'before').catch((error) => addMessage('error', errorMessage(error)))">Before</Button>
                    <Button variant="outline" size="xs" @click="forkFromEntry(entry.id, 'at').catch((error) => addMessage('error', errorMessage(error)))">At</Button>
                  </div>
                </div>
              </div>
              <p v-else class="empty-text">Open a session first.</p>
              <div class="mt-2 flex gap-2">
                <input v-model="importPath" class="field-input min-w-0" placeholder="D:\\path\\session.jsonl" @keydown.enter="importSession().catch((error) => addMessage('error', errorMessage(error)))">
                <Button variant="outline" size="sm" @click="importSession().catch((error) => addMessage('error', errorMessage(error)))">Import</Button>
              </div>
            </section>
          </aside>
        </div>

        <footer class="border-border bg-background border-t p-4">
          <div class="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)_auto] gap-3 max-md:grid-cols-1">
            <Textarea v-model="prompt" class="min-h-24 resize-y" @keydown.ctrl.enter.prevent="sendPrompt" @keydown.meta.enter.prevent="sendPrompt" />
            <div class="flex items-end gap-2">
              <Button variant="outline" :disabled="!isRunning" @click="abortPrompt">Abort</Button>
              <Button :disabled="isRunning" @click="sendPrompt">Send</Button>
            </div>
          </div>
        </footer>
      </main>
    </div>
  </div>
</template>
