<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import {
  createZuuClient,
  type Approval,
  type ApprovalDecision,
  type AuthStatus,
  type AuditEvent,
  type AuditEventAction,
  type AuditEventOutcome,
  type CreateScheduleRequest,
  type Diagnostics,
  type ModelSmokeResponse,
  type ModelSummary,
  type PackageOperation,
  type PackageSummary,
  type PromptRequest,
  type PromptStreamEvent,
  type ProjectSummary,
  type RunSummary,
  type Schedule,
  type ScheduleAction,
  type ScheduleOverlapPolicy,
  type SessionSummary,
  type SessionTreeEntry,
  type StoredSessionSummary,
  type ThinkingLevel,
  type WorkflowBackendInfo,
  type WorkflowDefinition,
  type WorkflowRun,
} from '@zuu/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type MessageRole = 'user' | 'agent' | 'event' | 'error'
type EventStreamStatus = 'connecting' | 'live' | 'stopped' | 'error'
type EventRefreshTarget = 'runs' | 'storedSessions' | 'sessionTree' | 'approvals' | 'workflowRuns' | 'schedules'

interface MessageItem {
  id: string
  role: MessageRole
  text: string
}

interface FlatTreeEntry {
  entry: SessionTreeEntry
  depth: number
}

interface LiveEventItem {
  id: string
  type: PromptStreamEvent['type']
  runId: string
  createdAt: string
  text: string
}

const tokenKey = 'zuu.apiToken'
const eventCursorKey = 'zuu.lastEventId'
const projectKey = 'zuu.projectId'
let client = createZuuClient({ apiToken: localStorage.getItem(tokenKey) || undefined })
let messageSeq = 0
let packageOperationPollId: number | undefined
let eventStreamController: AbortController | undefined
let eventStreamGeneration = 0
let eventRefreshTimer: number | undefined
const pendingEventRefreshes = new Set<EventRefreshTarget>()
const countedEventIds = new Set<string>()
const countedEventOrder: string[] = []

const apiToken = ref(localStorage.getItem(tokenKey) || '')
const authStatus = ref<AuthStatus>()
const auditEvents = ref<AuditEvent[]>([])
const auditAction = ref<'' | AuditEventAction>('')
const auditOutcome = ref<'' | AuditEventOutcome>('')
const auditTarget = ref('')
const diagnostics = ref<Diagnostics>()
const projects = ref<ProjectSummary[]>([])
const selectedProjectId = ref(localStorage.getItem(projectKey) || '')
const projectName = ref('')
const projectCwd = ref('')
const newProjectName = ref('')
const newProjectCwd = ref('')
const packages = ref<PackageSummary[]>([])
const packageOperations = ref<PackageOperation[]>([])
const packageSource = ref('')
const models = ref<ModelSummary[]>([])
const modelSmoke = ref<ModelSmokeResponse>()
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
const workflows = ref<WorkflowDefinition[]>([])
const workflowBackend = ref<WorkflowBackendInfo>()
const workflowRuns = ref<WorkflowRun[]>([])
const selectedWorkflowId = ref('')
const workflowPrompt = ref('Review the current Zuu agent platform slice and produce a workflow artifact.')
const schedules = ref<Schedule[]>([])
const scheduleName = ref('Scheduled Zuu run')
const scheduleKind = ref<'once' | 'interval' | 'cron'>('once')
const scheduleRunAt = ref(toDatetimeLocal(new Date(Date.now() + 10 * 60_000)))
const scheduleEveryMinutes = ref(30)
const scheduleCron = ref('*/5 * * * *')
const scheduleTimezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
const scheduleActionType = ref<'workflow' | 'prompt'>('workflow')
const scheduleOverlapPolicy = ref<ScheduleOverlapPolicy>('skip')
const scheduleMisfirePolicy = ref<'skip' | 'run_once'>('skip')
const scheduleRetryAttempts = ref(1)
const scheduleRetryBackoffMs = ref(0)
const schedulePrompt = ref('Run a scheduled Zuu status check and summarize the result.')
const editingScheduleId = ref('')
const messages = ref<MessageItem[]>([])
const isRunning = ref(false)
const isRefreshing = ref(false)
const isSmokingModel = ref(false)
const controller = ref<AbortController>()
const runEventCounts = reactive<Record<string, number>>({})
const liveEvents = ref<LiveEventItem[]>([])
const eventStreamStatus = ref<EventStreamStatus>('stopped')
const eventStreamError = ref('')
const lastEventId = ref(localStorage.getItem(eventCursorKey) || '')

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
const canQueueSessionMessage = computed(() => Boolean(currentSession.value?.isStreaming))
const configuredProviders = computed(() => diagnostics.value?.models.configuredProviders.join(', ') || 'none')
const resourceDiagnostics = computed(() => diagnostics.value?.resources.resourceDiagnostics || [])
const blockedPackages = computed(() => diagnostics.value?.resources.blockedPackages || [])
const storeDiagnostics = computed(() => diagnostics.value?.resources.stores || [])
const currentProject = computed(() => projects.value.find((project) => project.id === currentProjectId()))
const currentProjectName = computed(() => currentProject.value?.name || currentProjectId())
const currentProjectCwd = computed(() => currentProject.value?.cwd || '')
const selectedWorkflow = computed(() => workflows.value.find((workflow) => workflow.id === selectedWorkflowId.value))
const currentProjectSchedules = computed(() =>
  schedules.value.filter((schedule) => schedule.action.projectId === currentProjectId()),
)
const currentProjectWorkflowRuns = computed(() =>
  workflowRuns.value.filter((run) => run.projectId === currentProjectId()),
)
const runningPackageOperations = computed(() => packageOperations.value.filter((operation) => operation.status === 'running'))
const eventStatusVariant = computed(() => {
  if (eventStreamStatus.value === 'live') return 'secondary'
  if (eventStreamStatus.value === 'error') return 'destructive'
  return 'outline'
})

function toDatetimeLocal(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}

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

function currentProjectId() {
  return selectedProjectId.value || projects.value[0]?.id || 'default'
}

function syncProjectForm() {
  const project = currentProject.value
  projectName.value = project?.name || ''
  projectCwd.value = project?.cwd || ''
  newProjectCwd.value = project?.cwd || newProjectCwd.value
}

function setActiveSession(session: SessionSummary) {
  if (session.projectId && session.projectId !== currentProjectId()) {
    selectedProjectId.value = session.projectId
    localStorage.setItem(projectKey, session.projectId)
  }
  currentSession.value = session
  sessionName.value = session.name || sessionName.value
}

function upsertRun(run: RunSummary) {
  if (run.projectId !== currentProjectId()) return
  runs.value = [run, ...runs.value.filter((item) => item.id !== run.id)].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

function upsertApproval(approval: Approval) {
  approvals.value = [approval, ...approvals.value.filter((item) => item.id !== approval.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function rememberCountedEvent(eventId: string) {
  if (countedEventIds.has(eventId)) return false
  countedEventIds.add(eventId)
  countedEventOrder.push(eventId)
  if (countedEventOrder.length > 2048) {
    const expired = countedEventOrder.shift()
    if (expired) countedEventIds.delete(expired)
  }
  return true
}

function countRunEvent(event: PromptStreamEvent) {
  if (!rememberCountedEvent(event.id)) return
  runEventCounts[event.runId] = (runEventCounts[event.runId] ?? 0) + 1
}

function liveEventText(event: PromptStreamEvent) {
  if (event.type === 'session') return event.session?.name || event.session?.id || 'session started'
  if (event.type === 'tool_start') return event.tool ? `tool start: ${event.tool.name}` : 'tool start'
  if (event.type === 'tool_end') return event.tool ? `tool end: ${event.tool.name}${event.tool.isError ? ' (error)' : ''}` : 'tool end'
  if (event.type === 'approval_requested') return event.approval?.title || 'approval requested'
  if (event.type === 'approval_resolved') return event.approval?.title || 'approval resolved'
  if (event.type === 'error') return event.message || 'agent error'
  if (event.type === 'done') return event.run?.status || 'done'
  if (event.type === 'agent_event') return event.eventType || 'agent event'
  return event.delta ? `text ${event.delta.length} chars` : event.type
}

function rememberLiveEvent(event: PromptStreamEvent) {
  if (event.type === 'text_delta') return
  liveEvents.value = [
    {
      id: event.id,
      type: event.type,
      runId: event.runId,
      createdAt: event.createdAt,
      text: liveEventText(event),
    },
    ...liveEvents.value.filter((item) => item.id !== event.id),
  ].slice(0, 40)
}

function scheduleEventRefresh(...targets: EventRefreshTarget[]) {
  targets.forEach((target) => pendingEventRefreshes.add(target))
  if (eventRefreshTimer !== undefined) return
  eventRefreshTimer = window.setTimeout(() => {
    eventRefreshTimer = undefined
    flushEventRefreshes().catch((error) => addMessage('error', errorMessage(error)))
  }, 400)
}

async function flushEventRefreshes() {
  const targets = new Set(pendingEventRefreshes)
  pendingEventRefreshes.clear()
  const tasks: Array<Promise<unknown>> = []
  if (targets.has('runs')) tasks.push(loadRuns())
  if (targets.has('storedSessions')) tasks.push(loadStoredSessions())
  if (targets.has('sessionTree')) tasks.push(loadSessionTree())
  if (targets.has('approvals')) tasks.push(loadApprovals())
  if (targets.has('workflowRuns')) tasks.push(loadWorkflowRuns())
  if (targets.has('schedules')) tasks.push(loadSchedules())
  await Promise.all(tasks)
}

function handleDaemonEvent(event: PromptStreamEvent) {
  lastEventId.value = event.id
  localStorage.setItem(eventCursorKey, event.id)
  countRunEvent(event)
  rememberLiveEvent(event)

  if (
    event.session &&
    event.session.projectId === currentProjectId() &&
    (event.session.isStreaming || currentSession.value?.id === event.session.id)
  ) {
    setActiveSession(event.session)
  }
  if (event.run) upsertRun(event.run)
  if (event.approval) upsertApproval(event.approval)

  if (event.type === 'session') {
    scheduleEventRefresh('runs', 'storedSessions', 'sessionTree')
  } else if (event.type === 'approval_requested' || event.type === 'approval_resolved') {
    scheduleEventRefresh('approvals', 'runs')
  } else if (event.type === 'done' || event.type === 'error') {
    scheduleEventRefresh('runs', 'storedSessions', 'sessionTree', 'approvals', 'schedules', 'workflowRuns')
  }
}

function stopEventStream() {
  eventStreamGeneration += 1
  eventStreamController?.abort()
  eventStreamController = undefined
  eventStreamStatus.value = 'stopped'
}

function startEventStream() {
  stopEventStream()
  const streamGeneration = eventStreamGeneration
  const streamController = new AbortController()
  eventStreamController = streamController
  eventStreamStatus.value = 'connecting'
  eventStreamError.value = ''
  consumeEventStream(streamGeneration, streamController.signal).catch((error) => {
    if (streamController.signal.aborted || streamGeneration !== eventStreamGeneration) return
    eventStreamStatus.value = 'error'
    eventStreamError.value = errorMessage(error)
  })
}

async function consumeEventStream(streamGeneration: number, signal: AbortSignal) {
  for await (const event of client.subscribeEvents({
    afterEventId: lastEventId.value || undefined,
    reconnectDelayMs: 800,
    maxReconnectDelayMs: 8000,
    signal,
    onOpen: () => {
      if (!signal.aborted && streamGeneration === eventStreamGeneration) {
        eventStreamStatus.value = 'live'
        eventStreamError.value = ''
      }
    },
    onReconnect: () => {
      if (!signal.aborted && streamGeneration === eventStreamGeneration) {
        eventStreamStatus.value = 'connecting'
      }
    },
  })) {
    if (signal.aborted || streamGeneration !== eventStreamGeneration) return
    eventStreamStatus.value = 'live'
    eventStreamError.value = ''
    handleDaemonEvent(event)
  }
  if (!signal.aborted && streamGeneration === eventStreamGeneration) {
    eventStreamStatus.value = 'stopped'
  }
}

function flattenTree(entries: SessionTreeEntry[], depth = 0): FlatTreeEntry[] {
  return entries.flatMap((entry) => [{ entry, depth }, ...flattenTree(entry.children || [], depth + 1)])
}

async function loadDiagnostics() {
  diagnostics.value = await client.diagnostics()
}

async function loadAuthStatus() {
  authStatus.value = (await client.authStatus()).auth
}

async function loadAuditEvents() {
  auditEvents.value = (await client.listAuditEvents({
    limit: 50,
    action: auditAction.value || undefined,
    outcome: auditOutcome.value || undefined,
    target: auditTarget.value.trim() || undefined,
  })).events
}

async function loadPackages() {
  const response = await client.listPackages()
  packages.value = response.packages
}

async function loadPackageOperations() {
  const response = await client.listPackageOperations()
  packageOperations.value = response.operations
  if (response.operations.some((operation) => operation.status === 'running')) {
    schedulePackageOperationPoll()
  }
}

async function loadModels() {
  const response = await client.listModels()
  models.value = response.models
}

async function loadProjects() {
  const response = await client.listProjects()
  projects.value = response.projects
  if (!projects.value.some((project) => project.id === selectedProjectId.value)) {
    selectedProjectId.value = projects.value.find((project) => project.id === 'default')?.id || projects.value[0]?.id || 'default'
  }
  localStorage.setItem(projectKey, currentProjectId())
  syncProjectForm()
}

async function loadRuns() {
  runs.value = (await client.listProjectRuns(currentProjectId())).runs
  await Promise.all(
    runs.value.slice(0, 10).map(async (run) => {
      runEventCounts[run.id] = (await client.listProjectRunEvents(currentProjectId(), run.id)).events.length
    }),
  )
}

async function loadStoredSessions() {
  storedSessions.value = (await client.listProjectStoredSessions(currentProjectId())).sessions
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

async function loadWorkflows() {
  const response = await client.listProjectWorkflows(currentProjectId())
  workflows.value = response.workflows
  workflowBackend.value = response.backend
  if (!selectedWorkflowId.value && workflows.value[0]) {
    selectedWorkflowId.value = workflows.value[0].id
  }
}

async function loadWorkflowRuns() {
  workflowRuns.value = (await client.listProjectWorkflowRuns(currentProjectId())).runs
}

async function loadSchedules() {
  schedules.value = (await client.listProjectSchedules(currentProjectId())).schedules
}

async function refreshAll() {
  isRefreshing.value = true
  try {
    await loadProjects()
    await Promise.all([
      loadAuthStatus(),
      loadAuditEvents(),
      loadDiagnostics(),
      loadPackages(),
      loadPackageOperations(),
      loadModels(),
      loadRuns(),
      loadStoredSessions(),
      loadSessionTree(),
      loadApprovals(),
      loadWorkflows(),
      loadWorkflowRuns(),
      loadSchedules(),
    ])
  } finally {
    isRefreshing.value = false
  }
}

function saveToken() {
  const token = apiToken.value.trim()
  if (token) localStorage.setItem(tokenKey, token)
  else localStorage.removeItem(tokenKey)
  stopEventStream()
  client = createZuuClient({ apiToken: token || undefined })
  addMessage('event', token ? 'API token saved.' : 'API token cleared.')
  startEventStream()
  refreshAll().catch((error) => addMessage('error', errorMessage(error)))
}

async function rotateAuthToken() {
  const result = await client.rotateAuthToken()
  apiToken.value = result.apiToken
  localStorage.setItem(tokenKey, result.apiToken)
  stopEventStream()
  client = createZuuClient({ apiToken: result.apiToken })
  authStatus.value = result.auth
  addMessage('event', `API token rotated: ${result.auth.tokenPreview}`)
  startEventStream()
  await refreshAll()
}

function chooseModel() {
  const [nextProvider, nextModel] = selectedModel.value.split('/', 2)
  provider.value = nextProvider || ''
  modelName.value = nextModel || ''
}

function selectedModelRequest() {
  return provider.value && modelName.value ? { provider: provider.value, id: modelName.value } : undefined
}

function selectedModelLabel() {
  const model = selectedModelRequest()
  return model ? `${model.provider}/${model.id}` : undefined
}

async function smokeModel() {
  isSmokingModel.value = true
  modelSmoke.value = undefined
  try {
    const result = await client.smokeModel({
      projectId: currentProjectId(),
      model: selectedModelRequest(),
      thinkingLevel: thinkingLevel.value,
      timeoutMs: 60_000,
    })
    modelSmoke.value = result
    addMessage(
      result.ok ? 'event' : 'error',
      result.ok
        ? `model smoke ok: ${result.runId?.slice(0, 8) || 'no run'}`
        : `model smoke failed: ${result.error || result.status}`,
    )
    await Promise.all([loadRuns(), loadDiagnostics()])
  } finally {
    isSmokingModel.value = false
  }
}

async function switchProject() {
  localStorage.setItem(projectKey, currentProjectId())
  syncProjectForm()
  if (currentSession.value?.projectId !== currentProjectId()) {
    currentSession.value = undefined
    sessionTree.value = []
  }
  runs.value = []
  storedSessions.value = []
  for (const key of Object.keys(runEventCounts)) {
    delete runEventCounts[key]
  }
  await Promise.all([loadRuns(), loadStoredSessions(), loadSessionTree(), loadApprovals(), loadWorkflowRuns(), loadSchedules()])
}

function applySessionTools(session: SessionSummary) {
  for (const tool of toolChoices) {
    selectedTools[tool] = session.activeTools.includes(tool)
  }
}

async function createProject() {
  const cwd = newProjectCwd.value.trim()
  if (!cwd) return
  const response = await client.createProject({
    cwd,
    name: newProjectName.value.trim() || undefined,
  })
  projects.value = [response.project, ...projects.value.filter((project) => project.id !== response.project.id)]
  selectedProjectId.value = response.project.id
  localStorage.setItem(projectKey, response.project.id)
  newProjectName.value = ''
  syncProjectForm()
  addMessage('event', `project created: ${response.project.name}`)
  await switchProject()
}

async function saveCurrentSession() {
  const sessionId = currentSession.value?.id
  if (!sessionId) return
  const response = await client.updateProjectSession(currentProjectId(), sessionId, {
    name: sessionName.value.trim() || undefined,
    tools: activeTools.value,
  })
  setActiveSession(response.session)
  applySessionTools(response.session)
  addMessage('event', `session updated: ${response.session.name || response.session.id.slice(0, 8)}`)
  await Promise.all([loadRuns(), loadSessionTree()])
}

async function closeCurrentSession() {
  const sessionId = currentSession.value?.id
  if (!sessionId) return
  const response = await client.deleteProjectSession(currentProjectId(), sessionId)
  addMessage('event', `session closed: ${response.session.name || response.session.id.slice(0, 8)}`)
  currentSession.value = undefined
  sessionTree.value = []
  await Promise.all([loadRuns(), loadStoredSessions(), loadProjects()])
}

async function updateProject() {
  const projectId = currentProjectId()
  const response = await client.updateProject(projectId, {
    name: projectName.value.trim() || undefined,
    cwd: projectCwd.value.trim() || undefined,
  })
  projects.value = projects.value.map((project) => (project.id === response.project.id ? response.project : project))
  syncProjectForm()
  addMessage('event', `project updated: ${response.project.name}`)
  await Promise.all([loadStoredSessions(), loadRuns(), loadDiagnostics()])
}

async function deleteProject() {
  const project = currentProject.value
  if (!project || project.id === 'default') return
  const response = await client.deleteProject(project.id)
  addMessage('event', `project deleted: ${response.project.name}`)
  selectedProjectId.value = projects.value.find((item) => item.id === 'default')?.id || 'default'
  await loadProjects()
  await switchProject()
}

async function addPackage() {
  const source = packageSource.value.trim()
  if (!source) return
  await client.addPackage({ source })
  packageSource.value = ''
  await Promise.all([loadPackages(), loadDiagnostics()])
  await loadAuditEvents()
}

async function installPackage(source: string) {
  const response = await client.installPackage({ source })
  packages.value = response.packages
  packageOperations.value = [
    response.operation,
    ...packageOperations.value.filter((operation) => operation.id !== response.operation.id),
  ]
  addMessage('event', `package install started: ${source}`)
  schedulePackageOperationPoll()
  await Promise.all([loadPackageOperations(), loadDiagnostics(), loadWorkflows()])
  await loadAuditEvents()
}

async function removePackage(source: string) {
  const response = await client.removePackage({ source })
  packages.value = response.packages
  packageOperations.value = [
    response.operation,
    ...packageOperations.value.filter((operation) => operation.id !== response.operation.id),
  ]
  addMessage('event', `package remove started: ${source}`)
  schedulePackageOperationPoll()
  await Promise.all([loadPackageOperations(), loadDiagnostics(), loadWorkflows()])
  await loadAuditEvents()
}

async function updatePackage(source: string) {
  const response = await client.updatePackage({ source })
  packages.value = response.packages
  packageOperations.value = [
    response.operation,
    ...packageOperations.value.filter((operation) => operation.id !== response.operation.id),
  ]
  addMessage('event', `package update started: ${source}`)
  schedulePackageOperationPoll()
  await Promise.all([loadPackageOperations(), loadDiagnostics(), loadWorkflows()])
  await loadAuditEvents()
}

async function trustPackage(source: string) {
  const response = await client.trustPackage({ source })
  packages.value = response.packages
  addMessage('event', `package trusted: ${source}`)
  await loadDiagnostics()
  await loadAuditEvents()
}

async function revokePackageTrust(source: string) {
  const response = await client.revokePackageTrust({ source })
  packages.value = response.packages
  addMessage('event', `package trust revoked: ${source}`)
  await loadDiagnostics()
  await loadAuditEvents()
}

async function openStoredSession(sessionFile: string) {
  const { session } = await client.openProjectSession(currentProjectId(), { sessionFile })
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
    const { session } = await client.createProjectSession(currentProjectId(), { persist: false, name: 'Import anchor' })
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
  await loadAuditEvents()
}

async function startWorkflow() {
  if (!selectedWorkflowId.value) return
  const result = await client.startProjectWorkflow(currentProjectId(), selectedWorkflowId.value, {
    sessionId: currentSession.value?.id,
    prompt: workflowPrompt.value.trim() || undefined,
    inputs: {
      tools: activeTools.value,
      model: selectedModelLabel(),
    },
  })
  addMessage('event', `workflow ${result.run.status}: ${result.run.workflowName} (${result.run.id.slice(0, 8)})`)
  await loadWorkflowRuns()
}

async function abortWorkflowRun(runId: string) {
  const result = await client.abortProjectWorkflowRun(currentProjectId(), runId)
  addMessage('event', `workflow ${result.run.status}: ${result.run.workflowName}`)
  await loadWorkflowRuns()
}

function scheduleAction(): ScheduleAction | undefined {
  if (scheduleActionType.value === 'workflow') {
    if (!selectedWorkflowId.value) return undefined
    return {
      type: 'workflow',
      workflowId: selectedWorkflowId.value,
      projectId: currentProjectId(),
      sessionId: currentSession.value?.id,
      prompt: schedulePrompt.value.trim() || undefined,
      inputs: {
        tools: activeTools.value,
        model: selectedModelLabel(),
      },
    }
  }

  return {
    type: 'prompt',
    prompt: schedulePrompt.value.trim() || prompt.value.trim(),
    projectId: currentProjectId(),
    sessionId: currentSession.value?.id,
    name: sessionName.value.trim() || undefined,
    thinkingLevel: thinkingLevel.value,
    tools: activeTools.value,
    model: selectedModelRequest(),
  }
}

async function createSchedule() {
  const action = scheduleAction()
  if (!action) return
  const everyMinutes = Math.max(1, Number(scheduleEveryMinutes.value) || 1)
  const trigger = (() => {
    if (scheduleKind.value === 'once') {
      return { kind: 'once' as const, runAt: new Date(scheduleRunAt.value).toISOString() }
    }
    if (scheduleKind.value === 'interval') {
      return { kind: 'interval' as const, everyMs: everyMinutes * 60_000 }
    }
    return {
      kind: 'cron' as const,
      cron: scheduleCron.value.trim() || '*/5 * * * *',
      timezone: scheduleTimezone.value.trim() || 'UTC',
    }
  })()
  const input: CreateScheduleRequest = {
    name: scheduleName.value.trim() || undefined,
    trigger,
    action,
    overlapPolicy: scheduleOverlapPolicy.value,
    misfirePolicy: scheduleMisfirePolicy.value,
    retryPolicy:
      scheduleRetryAttempts.value > 1
        ? {
            maxAttempts: Math.min(5, Math.max(1, Number(scheduleRetryAttempts.value) || 1)),
            backoffMs: Math.min(60_000, Math.max(0, Number(scheduleRetryBackoffMs.value) || 0)),
          }
        : undefined,
  }
  const result = editingScheduleId.value
    ? await client.updateProjectSchedule(currentProjectId(), editingScheduleId.value, input)
    : await client.createProjectSchedule(currentProjectId(), input)
  addMessage('event', `schedule ${editingScheduleId.value ? 'updated' : 'created'}: ${result.schedule.name}`)
  editingScheduleId.value = ''
  await loadSchedules()
}

function editSchedule(schedule: Schedule) {
  editingScheduleId.value = schedule.id
  scheduleName.value = schedule.name
  scheduleKind.value = schedule.trigger.kind
  if (schedule.trigger.kind === 'once') {
    scheduleRunAt.value = toDatetimeLocal(new Date(schedule.trigger.runAt || Date.now()))
  } else if (schedule.trigger.kind === 'interval') {
    scheduleEveryMinutes.value = Math.max(1, Math.round((schedule.trigger.everyMs || 60_000) / 60_000))
  } else {
    scheduleCron.value = schedule.trigger.cron || '*/5 * * * *'
    scheduleTimezone.value = schedule.trigger.timezone || 'UTC'
  }
  scheduleActionType.value = schedule.action.type
  scheduleOverlapPolicy.value = schedule.overlapPolicy
  scheduleMisfirePolicy.value = schedule.misfirePolicy
  scheduleRetryAttempts.value = schedule.retryPolicy?.maxAttempts || 1
  scheduleRetryBackoffMs.value = schedule.retryPolicy?.backoffMs || 0
  if (schedule.action.type === 'workflow') {
    selectedWorkflowId.value = schedule.action.workflowId
    schedulePrompt.value = schedule.action.prompt || ''
  } else {
    schedulePrompt.value = schedule.action.prompt
  }
}

function cancelScheduleEdit() {
  editingScheduleId.value = ''
}

async function pauseSchedule(scheduleId: string) {
  const result = await client.pauseProjectSchedule(currentProjectId(), scheduleId)
  addMessage('event', `schedule paused: ${result.schedule.name}`)
  await loadSchedules()
}

async function resumeSchedule(scheduleId: string) {
  const result = await client.resumeProjectSchedule(currentProjectId(), scheduleId)
  addMessage('event', `schedule active: ${result.schedule.name}`)
  await loadSchedules()
}

async function triggerSchedule(scheduleId: string) {
  const result = await client.triggerProjectSchedule(currentProjectId(), scheduleId)
  addMessage('event', `schedule triggered: ${result.schedule.name}`)
  await Promise.all([loadSchedules(), loadWorkflowRuns(), loadRuns()])
}

async function deleteSchedule(scheduleId: string) {
  const result = await client.deleteProjectSchedule(currentProjectId(), scheduleId)
  addMessage('event', `schedule deleted: ${result.schedule.name}`)
  await loadSchedules()
}

async function abortScheduleRun(runId: string) {
  const result = await client.abortProjectScheduleRun(currentProjectId(), runId)
  addMessage('event', `schedule run ${result.run.status}: ${runId.slice(0, 8)}`)
  await Promise.all([loadSchedules(), loadWorkflowRuns(), loadRuns()])
}

async function replayRunEvents(runId: string) {
  const events = (await client.listProjectRunEvents(currentProjectId(), runId)).events
  addMessage('event', `replayed ${events.length} stored events for run ${runId.slice(0, 8)}`)
  const transcript = events
    .map((event) => {
      if (event.type === 'text_delta') return event.delta || ''
      if (event.type === 'error') return `\n[error] ${event.message || 'Unknown agent error'}`
      return ''
    })
    .join('')
    .trim()
  if (transcript) addMessage('agent', transcript.slice(0, 4000))
}

async function abortRun(runId: string) {
  const result = await client.abortProjectRun(currentProjectId(), runId)
  upsertRun(result.run)
  addMessage('event', `run aborted: ${runId.slice(0, 8)}`)
  await Promise.all([loadRuns(), loadStoredSessions(), loadSessionTree()])
}

function scheduleTriggerLabel(schedule: Schedule) {
  if (schedule.trigger.kind === 'once') return `once at ${schedule.trigger.runAt || 'unset'}`
  if (schedule.trigger.kind === 'interval') return `every ${Math.round((schedule.trigger.everyMs || 0) / 60_000)} min`
  return `${schedule.trigger.cron || 'cron'} / ${schedule.trigger.timezone || 'UTC'}`
}

function scheduleActionLabel(action: ScheduleAction) {
  return action.type === 'workflow' ? `workflow:${action.workflowId}` : 'prompt'
}

function latestPackageOperation(source: string) {
  return packageOperations.value.find((operation) => operation.source === source)
}

function isPackageOperating(source: string) {
  return packageOperations.value.some((operation) => operation.source === source && operation.status === 'running')
}

function packageOperationMessage(operation: PackageOperation | undefined) {
  if (!operation) return ''
  const lastEvent = operation.events[operation.events.length - 1]
  return operation.error || lastEvent?.message || (lastEvent ? `${lastEvent.type} ${lastEvent.action}` : '')
}

function clearPackageOperationPoll() {
  if (packageOperationPollId !== undefined) {
    window.clearTimeout(packageOperationPollId)
    packageOperationPollId = undefined
  }
}

function schedulePackageOperationPoll() {
  if (packageOperationPollId !== undefined) return
  packageOperationPollId = window.setTimeout(async () => {
    packageOperationPollId = undefined
    try {
      await Promise.all([loadPackageOperations(), loadPackages(), loadDiagnostics(), loadWorkflows()])
    } catch (error) {
      addMessage('error', errorMessage(error))
    }
  }, 1500)
}

function createPromptRequest(text: string): PromptRequest {
  return {
    prompt: text,
    projectId: currentProjectId(),
    sessionId: currentSession.value?.id,
    name: sessionName.value.trim() || undefined,
    thinkingLevel: thinkingLevel.value,
    tools: activeTools.value,
    model: selectedModelRequest(),
  }
}

async function consumePromptStream(stream: AsyncGenerator<PromptStreamEvent>, agentMessage: MessageItem) {
  for await (const event of stream) {
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
}

async function sendPrompt() {
  const text = prompt.value.trim()
  if (!text) return

  const request = createPromptRequest(text)
  addMessage('user', text)
  const agentMessage = addMessage('agent')
  isRunning.value = true
  controller.value = new AbortController()

  try {
    await consumePromptStream(client.prompt(request, { signal: controller.value.signal }), agentMessage)
  } catch (error) {
    if (!isAbortError(error)) addMessage('error', errorMessage(error))
  } finally {
    controller.value = undefined
    isRunning.value = false
  }
}

async function queueSessionMessage(behavior: 'steer' | 'followUp') {
  const text = prompt.value.trim()
  const sessionId = currentSession.value?.id
  if (!text || !sessionId) return

  const { sessionId: _sessionId, streamingBehavior: _streamingBehavior, ...request } = createPromptRequest(text)
  addMessage('user', behavior === 'steer' ? `[steer] ${text}` : `[follow-up] ${text}`)
  const agentMessage = addMessage('agent')
  const stream =
    behavior === 'steer'
      ? client.steerSession(sessionId, request)
      : client.followUpSession(sessionId, request)

  try {
    await consumePromptStream(stream, agentMessage)
  } catch (error) {
    if (!isAbortError(error)) addMessage('error', errorMessage(error))
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
  startEventStream()
  refreshAll().catch((error) => addMessage('error', errorMessage(error)))
})

onUnmounted(() => {
  stopEventStream()
  clearPackageOperationPoll()
  if (eventRefreshTimer !== undefined) {
    window.clearTimeout(eventRefreshTimer)
    eventRefreshTimer = undefined
  }
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
            <h2>Project</h2>
            <Badge variant="outline">{{ projects.length }}</Badge>
          </div>
          <label class="field-label">
            Active project
            <select v-model="selectedProjectId" class="field-input" @change="switchProject().catch((error) => addMessage('error', errorMessage(error)))">
              <option v-for="project in projects" :key="project.id" :value="project.id">
                {{ project.name }} / {{ project.status }}
              </option>
            </select>
          </label>
          <p class="empty-text truncate">{{ currentProjectCwd || 'No project loaded.' }}</p>
          <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <input v-model="projectName" class="field-input min-w-0" placeholder="Project name" @keydown.enter="updateProject().catch((error) => addMessage('error', errorMessage(error)))">
            <Button variant="outline" size="sm" @click="updateProject().catch((error) => addMessage('error', errorMessage(error)))">Rename</Button>
          </div>
          <input v-model="projectCwd" class="field-input" placeholder="D:\code\personal-project\zuu">
          <div class="flex gap-2">
            <Button variant="ghost" size="sm" :disabled="currentProject?.id === 'default'" @click="deleteProject().catch((error) => addMessage('error', errorMessage(error)))">Delete</Button>
            <Button variant="outline" size="sm" class="ml-auto" @click="loadProjects().catch((error) => addMessage('error', errorMessage(error)))">Refresh</Button>
          </div>
          <div class="project-create">
            <input v-model="newProjectName" class="field-input min-w-0" placeholder="New project">
            <input v-model="newProjectCwd" class="field-input min-w-0" placeholder="cwd">
            <Button size="sm" @click="createProject().catch((error) => addMessage('error', errorMessage(error)))">Create</Button>
          </div>
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
          <p v-if="resourceDiagnostics.length" class="text-destructive text-xs">{{ resourceDiagnostics.length }} resource diagnostics</p>
          <p v-if="blockedPackages.length" class="text-destructive text-xs">{{ blockedPackages.length }} blocked packages</p>
          <p v-if="storeDiagnostics.some((store) => !store.ok)" class="text-destructive text-xs">Store recovery needs review</p>
          <p v-if="diagnostics?.gaps.length" class="text-destructive text-xs">{{ diagnostics.gaps.join(' / ') }}</p>
          <label class="field-label">
            API token
            <input v-model="apiToken" class="field-input" type="password" placeholder="Optional ZUU_API_TOKEN" @keydown.enter="saveToken">
          </label>
          <div class="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" @click="saveToken">Save token</Button>
            <Button
              variant="outline"
              size="sm"
              :disabled="!authStatus?.canRotate"
              @click="rotateAuthToken().catch((error) => addMessage('error', errorMessage(error)))"
            >
              Rotate
            </Button>
            <Badge v-if="authStatus" variant="outline">{{ authStatus.source }}</Badge>
          </div>
          <p v-if="authStatus" class="empty-text">
            {{ authStatus.tokenPreview }}{{ authStatus.tokenFile ? ` / ${authStatus.tokenFile}` : '' }}
          </p>
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
          <div class="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" :disabled="isSmokingModel" @click="smokeModel().catch((error) => addMessage('error', errorMessage(error)))">
              {{ isSmokingModel ? 'Testing' : 'Smoke test' }}
            </Button>
            <Badge v-if="modelSmoke" :variant="modelSmoke.ok ? 'secondary' : 'destructive'">
              {{ modelSmoke.ok ? 'ok' : modelSmoke.status }}
            </Badge>
          </div>
          <p v-if="modelSmoke" :class="modelSmoke.ok ? 'empty-text' : 'text-destructive text-xs'">
            {{ modelSmoke.ok ? `run ${modelSmoke.runId?.slice(0, 8) || 'n/a'} / ${modelSmoke.durationMs}ms` : modelSmoke.error || 'model smoke failed' }}
          </p>
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
          <div class="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" :disabled="!currentSession" @click="saveCurrentSession().catch((error) => addMessage('error', errorMessage(error)))">Save session</Button>
            <Button variant="ghost" size="sm" :disabled="!currentSession || currentSession.isStreaming" @click="closeCurrentSession().catch((error) => addMessage('error', errorMessage(error)))">Close</Button>
          </div>
        </section>

        <section class="panel-block">
          <div class="section-title">
            <h2>Packages</h2>
            <div class="flex items-center gap-1">
              <Badge v-if="runningPackageOperations.length" variant="secondary">{{ runningPackageOperations.length }} installing</Badge>
              <Badge variant="outline">{{ packages.length }}</Badge>
            </div>
          </div>
          <div v-if="packages.length" class="list-stack">
            <div v-for="item in packages" :key="item.source" class="compact-row">
              <div class="min-w-0">
                <strong>{{ item.source }}</strong>
                <span>{{ item.scope }} / {{ item.status }} / {{ item.trustStatus }}</span>
                <span v-if="item.trustedAt">trusted {{ item.trustedAt }}</span>
                <span v-if="item.installedPath">{{ item.installedPath }}</span>
                <span v-if="latestPackageOperation(item.source)">
                  {{ latestPackageOperation(item.source)?.action }} {{ latestPackageOperation(item.source)?.status }} / {{ packageOperationMessage(latestPackageOperation(item.source)) }}
                </span>
              </div>
              <div class="flex flex-wrap justify-end gap-1">
                <Button v-if="!item.trusted" variant="outline" size="xs" @click="trustPackage(item.source).catch((error) => addMessage('error', errorMessage(error)))">Trust</Button>
                <Button v-else variant="ghost" size="xs" @click="revokePackageTrust(item.source).catch((error) => addMessage('error', errorMessage(error)))">Revoke</Button>
                <Button v-if="item.status === 'installed'" variant="outline" size="xs" :disabled="!item.trusted || isPackageOperating(item.source)" @click="updatePackage(item.source).catch((error) => addMessage('error', errorMessage(error)))">Update</Button>
                <Button v-if="item.status !== 'installed'" variant="outline" size="xs" :disabled="!item.trusted || isPackageOperating(item.source)" @click="installPackage(item.source).catch((error) => addMessage('error', errorMessage(error)))">
                  {{ isPackageOperating(item.source) ? 'Working' : 'Install' }}
                </Button>
                <Button variant="ghost" size="xs" :disabled="isPackageOperating(item.source)" @click="removePackage(item.source).catch((error) => addMessage('error', errorMessage(error)))">Remove</Button>
              </div>
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
            <h2>Workflows</h2>
            <Badge :variant="workflowBackend?.status === 'ready' ? 'secondary' : 'destructive'">
              {{ workflowBackend?.kind || 'loading' }}
            </Badge>
          </div>
          <p class="empty-text">{{ workflowBackend?.message || `${workflows.length} workflow definitions` }}</p>
          <label class="field-label">
            Definition
            <select v-model="selectedWorkflowId" class="field-input">
              <option v-for="workflow in workflows" :key="workflow.id" :value="workflow.id">
                {{ workflow.name }}
              </option>
            </select>
          </label>
          <p v-if="selectedWorkflow" class="empty-text">{{ selectedWorkflow.description }}</p>
          <p v-else-if="!workflows.length" class="empty-text">No workflow definitions available for this backend.</p>
          <Textarea v-model="workflowPrompt" class="min-h-16" />
          <Button size="sm" :disabled="!selectedWorkflowId" @click="startWorkflow().catch((error) => addMessage('error', errorMessage(error)))">Run workflow</Button>
        </section>

        <section class="panel-block">
          <div class="section-title">
            <h2>Schedules</h2>
            <Badge variant="outline">{{ currentProjectSchedules.length }}</Badge>
          </div>
          <label class="field-label">
            Name
            <input v-model="scheduleName" class="field-input">
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="field-label">
              Trigger
              <select v-model="scheduleKind" class="field-input">
                <option value="once">Once</option>
                <option value="interval">Interval</option>
                <option value="cron">Cron</option>
              </select>
            </label>
            <label class="field-label">
              Action
              <select v-model="scheduleActionType" class="field-input">
                <option value="workflow">Workflow</option>
                <option value="prompt">Prompt</option>
              </select>
            </label>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <label class="field-label">
              Overlap
              <select v-model="scheduleOverlapPolicy" class="field-input">
                <option value="skip">Skip</option>
                <option value="queue">Queue</option>
                <option value="parallel">Parallel</option>
              </select>
            </label>
            <label class="field-label">
              Misfire
              <select v-model="scheduleMisfirePolicy" class="field-input">
                <option value="skip">Skip missed</option>
                <option value="run_once">Run once</option>
              </select>
            </label>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <label class="field-label">
              Attempts
              <input v-model.number="scheduleRetryAttempts" class="field-input" type="number" min="1" max="5">
            </label>
            <label class="field-label">
              Backoff ms
              <input v-model.number="scheduleRetryBackoffMs" class="field-input" type="number" min="0" max="60000" step="100">
            </label>
          </div>
          <label v-if="scheduleKind === 'once'" class="field-label">
            Run at
            <input v-model="scheduleRunAt" class="field-input" type="datetime-local">
          </label>
          <label v-else-if="scheduleKind === 'interval'" class="field-label">
            Every minutes
            <input v-model.number="scheduleEveryMinutes" class="field-input" type="number" min="1">
          </label>
          <label v-else class="field-label">
            Cron
            <input v-model="scheduleCron" class="field-input" placeholder="*/5 * * * *">
          </label>
          <label v-if="scheduleKind === 'cron'" class="field-label">
            Timezone
            <input v-model="scheduleTimezone" class="field-input" placeholder="Asia/Shanghai">
          </label>
          <label v-if="scheduleActionType === 'workflow'" class="field-label">
            Workflow
            <select v-model="selectedWorkflowId" class="field-input">
              <option v-for="workflow in workflows" :key="workflow.id" :value="workflow.id">
                {{ workflow.name }}
              </option>
            </select>
          </label>
          <Textarea v-model="schedulePrompt" class="min-h-16" />
          <div class="flex flex-wrap gap-2">
            <Button size="sm" :disabled="scheduleActionType === 'workflow' && !selectedWorkflowId" @click="createSchedule().catch((error) => addMessage('error', errorMessage(error)))">{{ editingScheduleId ? 'Save schedule' : 'Create schedule' }}</Button>
            <Button v-if="editingScheduleId" variant="ghost" size="sm" @click="cancelScheduleEdit">Cancel</Button>
          </div>
          <div v-if="currentProjectSchedules.length" class="list-stack max-h-56 overflow-auto">
            <div v-for="schedule in currentProjectSchedules.slice(0, 6)" :key="schedule.id" class="compact-row">
              <div class="min-w-0">
                <strong>{{ schedule.name }}</strong>
                <span>{{ schedule.status }} / {{ scheduleTriggerLabel(schedule) }}</span>
                <span>overlap {{ schedule.overlapPolicy }}</span>
                <span>misfire {{ schedule.misfirePolicy }}</span>
                <span v-if="schedule.retryPolicy">retry {{ schedule.retryPolicy.maxAttempts }}x</span>
                <span>{{ scheduleActionLabel(schedule.action) }}</span>
                <span v-if="schedule.nextRunAt">next {{ schedule.nextRunAt }}</span>
              </div>
              <div class="flex flex-wrap justify-end gap-1">
                <Button variant="outline" size="xs" @click="editSchedule(schedule)">Edit</Button>
                <Button variant="outline" size="xs" @click="triggerSchedule(schedule.id).catch((error) => addMessage('error', errorMessage(error)))">Run</Button>
                <Button v-if="schedule.status === 'active'" variant="ghost" size="xs" @click="pauseSchedule(schedule.id).catch((error) => addMessage('error', errorMessage(error)))">Pause</Button>
                <Button v-else variant="ghost" size="xs" @click="resumeSchedule(schedule.id).catch((error) => addMessage('error', errorMessage(error)))">Resume</Button>
                <Button variant="ghost" size="xs" @click="deleteSchedule(schedule.id).catch((error) => addMessage('error', errorMessage(error)))">Delete</Button>
              </div>
            </div>
          </div>
          <p v-else class="empty-text">No schedules yet.</p>
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
            <p class="text-muted-foreground truncate text-xs">{{ currentProjectName }} / {{ currentSession?.model || currentSession?.sessionFile || 'Ask the agent to inspect this project.' }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <Badge v-if="pendingApprovals.length" variant="destructive">{{ pendingApprovals.length }} pending approval</Badge>
            <Badge :variant="eventStatusVariant">events {{ eventStreamStatus }}</Badge>
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

          <aside class="border-border bg-muted/20 flex min-h-0 flex-col gap-3 overflow-auto border-l p-4 max-xl:border-l-0 max-xl:border-t">
            <section class="side-panel">
              <div class="section-title">
                <h2>Event Stream</h2>
                <Badge :variant="eventStatusVariant">{{ eventStreamStatus }}</Badge>
              </div>
              <p v-if="eventStreamError" class="text-destructive text-xs">{{ eventStreamError }}</p>
              <p v-else class="empty-text">cursor {{ lastEventId ? lastEventId.slice(0, 18) : 'none' }}</p>
              <div v-if="liveEvents.length" class="list-stack overflow-auto">
                <div v-for="event in liveEvents.slice(0, 10)" :key="event.id" class="workflow-row">
                  <div class="flex items-center justify-between gap-2">
                    <strong>{{ event.type }}</strong>
                    <Badge variant="outline">{{ event.runId.slice(0, 8) }}</Badge>
                  </div>
                  <p>{{ event.text }}</p>
                  <span>{{ event.createdAt }}</span>
                </div>
              </div>
              <p v-else class="empty-text">Waiting for daemon events.</p>
            </section>

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
                <h2>Resources</h2>
                <Button variant="ghost" size="xs" @click="loadDiagnostics">Refresh</Button>
              </div>
              <div v-if="resourceDiagnostics.length" class="list-stack overflow-auto">
                <div v-for="diagnostic in resourceDiagnostics.slice(0, 10)" :key="`${diagnostic.type}-${diagnostic.path || diagnostic.message}`" class="workflow-row">
                  <div class="flex items-center justify-between gap-2">
                    <strong>{{ diagnostic.collision?.name || diagnostic.type }}</strong>
                    <Badge :variant="diagnostic.type === 'error' || diagnostic.type === 'collision' ? 'destructive' : 'outline'">{{ diagnostic.type }}</Badge>
                  </div>
                  <p>{{ diagnostic.message }}</p>
                  <span v-if="diagnostic.path">{{ diagnostic.path }}</span>
                  <span v-if="diagnostic.collision">winner {{ diagnostic.collision.winnerPath }}</span>
                  <span v-if="diagnostic.collision">loser {{ diagnostic.collision.loserPath }}</span>
                </div>
              </div>
              <p v-else class="empty-text">No resource diagnostics.</p>
              <div v-if="storeDiagnostics.length" class="list-stack overflow-auto">
                <div v-for="store in storeDiagnostics" :key="store.path" class="workflow-row">
                  <div class="flex items-center justify-between gap-2">
                    <strong>{{ store.name }}</strong>
                    <Badge :variant="store.ok ? 'secondary' : 'destructive'">{{ store.ok ? 'ok' : 'review' }}</Badge>
                  </div>
                  <span>{{ store.recordCount }} records / {{ store.exists ? 'exists' : 'missing' }}</span>
                  <span>{{ store.path }}</span>
                  <p v-if="store.recovered">recovered from corrupt JSON</p>
                  <span v-if="store.backupPath">backup {{ store.backupPath }}</span>
                  <p v-if="store.error">{{ store.error }}</p>
                </div>
              </div>
            </section>

            <section class="side-panel">
              <div class="section-title">
                <h2>Audit</h2>
                <Button variant="ghost" size="xs" @click="loadAuditEvents">Refresh</Button>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <select v-model="auditAction" class="field-input">
                  <option value="">Any action</option>
                  <option value="api.read">api.read</option>
                  <option value="api.mutate">api.mutate</option>
                  <option value="auth.rotate">auth.rotate</option>
                  <option value="approval.resolve">approval.resolve</option>
                  <option value="package.add">package.add</option>
                  <option value="package.install">package.install</option>
                  <option value="package.update">package.update</option>
                  <option value="package.remove">package.remove</option>
                  <option value="package.trust">package.trust</option>
                  <option value="package.revoke_trust">package.revoke_trust</option>
                </select>
                <select v-model="auditOutcome" class="field-input">
                  <option value="">Any outcome</option>
                  <option value="success">success</option>
                  <option value="failure">failure</option>
                </select>
              </div>
              <input v-model="auditTarget" class="field-input" placeholder="Target contains" @keydown.enter="loadAuditEvents">
              <div v-if="auditEvents.length" class="list-stack overflow-auto">
                <div v-for="event in auditEvents.slice(0, 10)" :key="event.id" class="workflow-row">
                  <div class="flex items-center justify-between gap-2">
                    <strong>{{ event.action }}</strong>
                    <Badge :variant="event.outcome === 'success' ? 'secondary' : 'destructive'">{{ event.outcome }}</Badge>
                  </div>
                  <span>{{ event.createdAt }}</span>
                  <p v-if="event.target">{{ event.target }}</p>
                </div>
              </div>
              <p v-else class="empty-text">No audit events yet.</p>
            </section>

            <section class="side-panel">
              <div class="section-title">
                <h2>Package Ops</h2>
                <Button variant="ghost" size="xs" @click="loadPackageOperations">Refresh</Button>
              </div>
              <div v-if="packageOperations.length" class="list-stack overflow-auto">
                <div v-for="operation in packageOperations.slice(0, 8)" :key="operation.id" class="workflow-row">
                  <div class="flex items-center justify-between gap-2">
                    <strong>{{ operation.source }}</strong>
                    <Badge :variant="operation.status === 'done' ? 'secondary' : operation.status === 'error' ? 'destructive' : 'outline'">{{ operation.status }}</Badge>
                  </div>
                  <span>{{ operation.action }} / {{ operation.startedAt }}</span>
                  <div class="workflow-progress">
                    <span>{{ operation.events.length }} events</span>
                    <span v-if="operation.endedAt">ended {{ operation.endedAt }}</span>
                  </div>
                  <p v-if="packageOperationMessage(operation)">{{ packageOperationMessage(operation) }}</p>
                </div>
              </div>
              <p v-else class="empty-text">No package operations yet.</p>
            </section>

            <section class="side-panel">
              <div class="section-title">
                <h2>Schedule Runs</h2>
                <Button variant="ghost" size="xs" @click="loadSchedules">Refresh</Button>
              </div>
              <div v-if="currentProjectSchedules.length" class="list-stack overflow-auto">
                <div v-for="schedule in currentProjectSchedules.slice(0, 8)" :key="schedule.id" class="workflow-row">
                  <div class="flex items-center justify-between gap-2">
                    <strong>{{ schedule.name }}</strong>
                    <Badge :variant="schedule.status === 'active' ? 'secondary' : 'outline'">{{ schedule.status }}</Badge>
                  </div>
                  <span>{{ scheduleTriggerLabel(schedule) }}</span>
                  <span>overlap {{ schedule.overlapPolicy }}</span>
                  <span>misfire {{ schedule.misfirePolicy }}</span>
                  <span v-if="schedule.retryPolicy">retry {{ schedule.retryPolicy.maxAttempts }}x / {{ schedule.retryPolicy.backoffMs }}ms</span>
                  <span v-if="schedule.nextRunAt">next {{ schedule.nextRunAt }}</span>
                  <div v-if="schedule.runs[0]" class="workflow-progress">
                    <span>{{ schedule.runs[0].status }}</span>
                    <span v-if="schedule.runs[0].attempts">attempts {{ schedule.runs[0].attempts }}</span>
                    <span>scheduled {{ schedule.runs[0].scheduledFor }}</span>
                    <span v-if="schedule.runs[0].finishedAt">finished {{ schedule.runs[0].finishedAt }}</span>
                    <span v-if="schedule.runs[0].reason">reason {{ schedule.runs[0].reason }}</span>
                    <span v-if="schedule.runs[0].workflowRunId">workflow {{ schedule.runs[0].workflowRunId.slice(0, 8) }}</span>
                    <span v-if="schedule.runs[0].agentRunId">agent {{ schedule.runs[0].agentRunId.slice(0, 8) }}</span>
                  </div>
                  <Button v-if="schedule.runs[0].status === 'queued' || schedule.runs[0].status === 'running'" variant="outline" size="xs" @click="abortScheduleRun(schedule.runs[0].id).catch((error) => addMessage('error', errorMessage(error)))">Abort</Button>
                  <p v-if="schedule.runs[0]?.error">{{ schedule.runs[0].error }}</p>
                </div>
              </div>
              <p v-else class="empty-text">No schedule runs yet.</p>
            </section>

            <section class="side-panel">
              <div class="section-title">
                <h2>Workflow Runs</h2>
                <Button variant="ghost" size="xs" @click="loadWorkflowRuns">Refresh</Button>
              </div>
              <div v-if="currentProjectWorkflowRuns.length" class="list-stack overflow-auto">
                <div v-for="run in currentProjectWorkflowRuns.slice(0, 8)" :key="run.id" class="workflow-row">
                  <div class="flex items-center justify-between gap-2">
                    <strong>{{ run.workflowName }}</strong>
                    <Badge :variant="run.status === 'completed' ? 'secondary' : run.status === 'failed' || run.status === 'aborted' ? 'destructive' : 'outline'">{{ run.status }}</Badge>
                  </div>
                  <span>{{ run.id.slice(0, 8) }} · {{ run.startedAt }}</span>
                  <span v-if="run.finishedAt">finished {{ run.finishedAt }}</span>
                  <div class="workflow-progress">
                    <span>{{ run.stages.length }} stages</span>
                    <span>{{ run.tasks.length }} tasks</span>
                    <span>{{ run.artifacts.length }} artifacts</span>
                  </div>
                  <p v-if="run.artifacts[0]?.content">{{ String(run.artifacts[0].content).slice(0, 180) }}</p>
                  <Button v-if="run.status === 'queued' || run.status === 'running'" variant="outline" size="xs" @click="abortWorkflowRun(run.id).catch((error) => addMessage('error', errorMessage(error)))">Abort</Button>
                </div>
              </div>
              <p v-else class="empty-text">No workflow runs yet.</p>
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
                    <span>{{ runEventCounts[run.id] ?? 0 }} events</span>
                    <span>{{ run.prompt }}</span>
                  </div>
                  <div class="flex flex-wrap justify-end gap-1">
                    <Button v-if="run.status === 'running' || run.status === 'waiting_approval'" variant="outline" size="xs" @click="abortRun(run.id).catch((error) => addMessage('error', errorMessage(error)))">Abort</Button>
                    <Button variant="outline" size="xs" @click="replayRunEvents(run.id).catch((error) => addMessage('error', errorMessage(error)))">Replay</Button>
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
              <Button variant="outline" :disabled="!canQueueSessionMessage" @click="queueSessionMessage('steer')">Steer</Button>
              <Button variant="outline" :disabled="!canQueueSessionMessage" @click="queueSessionMessage('followUp')">Follow up</Button>
              <Button :disabled="isRunning" @click="sendPrompt">Send</Button>
            </div>
          </div>
        </footer>
      </main>
    </div>
  </div>
</template>
