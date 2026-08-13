<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import {
  createZuuClient,
  type Approval,
  type ApprovalDecision,
  type Diagnostics,
  type ModelSmokeResponse,
  type ModelSummary,
  type PromptRequest,
  type PromptStreamEvent,
  type ProjectSummary,
  type RunSummary,
  type SessionSummary,
  type SessionTreeEntry,
  type StoredSessionSummary,
  type ThinkingLevel,
} from '@zuu/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import Conversation from '@/components/ai-elements/conversation/Conversation.vue'
import ConversationContent from '@/components/ai-elements/conversation/ConversationContent.vue'
import Message from '@/components/ai-elements/message/Message.vue'
import MessageContent from '@/components/ai-elements/message/MessageContent.vue'
import PromptInput from '@/components/ai-elements/prompt-input/PromptInput.vue'
import PromptInputFooter from '@/components/ai-elements/prompt-input/PromptInputFooter.vue'
import PromptInputTextarea from '@/components/ai-elements/prompt-input/PromptInputTextarea.vue'
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input/types'
import Terminal from '@/components/ai-elements/terminal/Terminal.vue'
import WebPreview from '@/components/ai-elements/web-preview/WebPreview.vue'
import WebPreviewBody from '@/components/ai-elements/web-preview/WebPreviewBody.vue'
import WebPreviewNavigation from '@/components/ai-elements/web-preview/WebPreviewNavigation.vue'
import WebPreviewUrl from '@/components/ai-elements/web-preview/WebPreviewUrl.vue'
import {
  AiBrowserIcon,
  AiChat01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  Settings01Icon,
  WorkflowSquare01Icon,
} from '@/components/icons'
import { createDefaultToolSelection, STORAGE_KEYS, TOOL_CHOICES } from '@/lib/app'
import {
  errorMessage,
  flattenSessionTree,
  isAbortError,
  packageOperationMessage,
  previewText,
  scheduleActionLabel,
  scheduleTriggerLabel,
} from '@/lib/formatting'
import { createRecentIdSet, toLiveEventItem, type LiveEventItem } from '@/lib/events'
import { createPromptModel, formatPromptModel, parseModelSelection } from '@/lib/models'
import { usePackagePanel, useSchedulePanel, useSecurityPanel, useWorkflowPanel } from '@/lib/panels'

type MessageRole = 'user' | 'agent' | 'event' | 'error'
type EventStreamStatus = 'connecting' | 'live' | 'stopped' | 'error'
type EventRefreshTarget = 'runs' | 'storedSessions' | 'sessionTree' | 'approvals' | 'workflowRuns' | 'schedules'

interface MessageItem {
  id: string
  role: MessageRole
  text: string
}

let client = createZuuClient({ apiToken: localStorage.getItem(STORAGE_KEYS.apiToken) || undefined })
let messageSeq = 0
let eventStreamController: AbortController | undefined
let eventStreamGeneration = 0
let eventRefreshTimer: number | undefined
const pendingEventRefreshes = new Set<EventRefreshTarget>()
const countedRunEvents = createRecentIdSet()

const diagnostics = ref<Diagnostics>()
const projects = ref<ProjectSummary[]>([])
const selectedProjectId = ref(localStorage.getItem(STORAGE_KEYS.projectId) || '')
const projectName = ref('')
const projectCwd = ref('')
const newProjectName = ref('')
const newProjectCwd = ref('')
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
const messages = ref<MessageItem[]>([])
const isRunning = ref(false)
const isRefreshing = ref(false)
const isSmokingModel = ref(false)
const controller = ref<AbortController>()
const runEventCounts = reactive<Record<string, number>>({})
const liveEvents = ref<LiveEventItem[]>([])
const eventStreamStatus = ref<EventStreamStatus>('stopped')
const eventStreamError = ref('')
const lastEventId = ref(localStorage.getItem(STORAGE_KEYS.eventCursor) || '')
const leftSidebarCollapsed = ref(localStorage.getItem('zuu:left-sidebar-collapsed') === '1')
const rightPanelCollapsed = ref(localStorage.getItem('zuu:right-panel-collapsed') === '1')
const activeWorkspace = ref<'chat' | 'workflow' | 'schedule'>('chat')
const activeInspectorTab = ref<'resources' | 'tasks' | 'terminal' | 'browser' | 'settings'>('tasks')
const browserUrl = ref('http://localhost:3001/')
const emptySelectValue = '__zuu_empty__'

const toolChoices = TOOL_CHOICES
const selectedTools = reactive(createDefaultToolSelection())
const activeTools = computed(() => toolChoices.filter((tool) => selectedTools[tool]))
const {
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
} = useSecurityPanel({
  getClient: () => client,
  replaceClientToken,
  addMessage,
  refreshAll,
})
const {
  workflows,
  workflowBackend,
  selectedWorkflowId,
  selectedWorkflowRunId,
  workflowRunStages,
  workflowRunTasks,
  workflowRunArtifacts,
  workflowPrompt,
  isLoadingWorkflowRunDetail,
  selectedWorkflow,
  currentProjectWorkflowRuns,
  selectedWorkflowRun,
  workflowStageRows,
  workflowUnstagedTasks,
  loadWorkflows,
  loadWorkflowRuns,
  loadWorkflowRunDetail,
  startWorkflow,
  abortWorkflowRun,
} = useWorkflowPanel({
  getClient: () => client,
  currentProjectId,
  promptContext: () => ({
    sessionId: currentSession.value?.id,
    tools: activeTools.value,
    modelLabel: selectedModelLabel(),
  }),
  addMessage,
})
const {
  selectedScheduleId,
  selectedScheduleRunId,
  scheduleRuns,
  scheduleName,
  scheduleKind,
  scheduleRunAt,
  scheduleEveryMinutes,
  scheduleCron,
  scheduleTimezone,
  scheduleActionType,
  scheduleOverlapPolicy,
  scheduleMisfirePolicy,
  scheduleRetryAttempts,
  scheduleRetryBackoffMs,
  schedulePrompt,
  editingScheduleId,
  isLoadingScheduleRuns,
  currentProjectSchedules,
  selectedSchedule,
  selectedScheduleRun,
  loadSchedules,
  loadScheduleRuns,
  loadScheduleRunDetail,
  createSchedule,
  editSchedule,
  cancelScheduleEdit,
  pauseSchedule,
  resumeSchedule,
  triggerSchedule,
  deleteSchedule,
  abortScheduleRun,
} = useSchedulePanel({
  getClient: () => client,
  currentProjectId,
  selectedWorkflowId,
  promptContext: () => ({
    sessionId: currentSession.value?.id,
    sessionName: sessionName.value.trim() || undefined,
    prompt: prompt.value.trim(),
    thinkingLevel: thinkingLevel.value,
    tools: activeTools.value,
    model: selectedModelRequest(),
    modelLabel: selectedModelLabel(),
  }),
  addMessage,
  loadRuns,
  loadWorkflowRuns,
})
const {
  packages,
  packageOperations,
  packageSource,
  runningPackageOperations,
  loadPackages,
  loadPackageOperations,
  addPackage,
  installPackage,
  removePackage,
  updatePackage,
  trustPackage,
  revokePackageTrust,
  latestPackageOperation,
  isPackageOperating,
  clearPackageOperationPoll,
} = usePackagePanel({
  getClient: () => client,
  addMessage,
  loadAuditEvents,
  loadDiagnostics,
  loadWorkflows,
})

const selectedModelOption = computed({
  get: () => selectedModel.value || emptySelectValue,
  set: (value) => {
    selectedModel.value = value === emptySelectValue ? '' : String(value)
    chooseModel()
  },
})
const auditActionOption = computed({
  get: () => auditAction.value || emptySelectValue,
  set: (value) => {
    auditAction.value = (value === emptySelectValue ? '' : String(value)) as typeof auditAction.value
  },
})
const auditOutcomeOption = computed({
  get: () => auditOutcome.value || emptySelectValue,
  set: (value) => {
    auditOutcome.value = (value === emptySelectValue ? '' : String(value)) as typeof auditOutcome.value
  },
})
const auditAuthScopeOption = computed({
  get: () => auditAuthScope.value || emptySelectValue,
  set: (value) => {
    auditAuthScope.value = (value === emptySelectValue ? '' : String(value)) as typeof auditAuthScope.value
  },
})

const pendingApprovals = computed(() => approvals.value.filter((approval) => approval.status === 'pending'))
const flatTree = computed(() => flattenSessionTree(sessionTree.value))
const statusText = computed(() => (isRunning.value ? 'running' : 'ready'))
const canQueueSessionMessage = computed(() => Boolean(currentSession.value?.isStreaming))
const configuredProviders = computed(() => diagnostics.value?.models.configuredProviders.join(', ') || 'none')
const resourceDiagnostics = computed(() => diagnostics.value?.resources.resourceDiagnostics || [])
const blockedPackages = computed(() => diagnostics.value?.resources.blockedPackages || [])
const storeDiagnostics = computed(() => diagnostics.value?.resources.stores || [])
const currentProject = computed(() => projects.value.find((project) => project.id === currentProjectId()))
const currentProjectName = computed(() => currentProject.value?.name || currentProjectId())
const currentProjectCwd = computed(() => currentProject.value?.cwd || '')
const eventStatusVariant = computed(() => {
  if (eventStreamStatus.value === 'live') return 'secondary'
  if (eventStreamStatus.value === 'error') return 'destructive'
  return 'outline'
})
const terminalOutput = computed(() => {
  const lines = liveEvents.value.slice(0, 30).map((event) =>
    `[${event.createdAt}] ${event.type} ${event.runId.slice(0, 8)} ${event.text}`,
  )
  return lines.length ? lines.join('\n') : 'No daemon events captured yet.'
})

function nextId() {
  messageSeq += 1
  return `${Date.now()}-${messageSeq}`
}

function messageFrom(role: MessageRole) {
  return role === 'user' ? 'user' : 'assistant'
}

function toggleLeftSidebar() {
  leftSidebarCollapsed.value = !leftSidebarCollapsed.value
  localStorage.setItem('zuu:left-sidebar-collapsed', leftSidebarCollapsed.value ? '1' : '0')
}

function toggleRightPanel() {
  rightPanelCollapsed.value = !rightPanelCollapsed.value
  localStorage.setItem('zuu:right-panel-collapsed', rightPanelCollapsed.value ? '1' : '0')
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
    localStorage.setItem(STORAGE_KEYS.projectId, session.projectId)
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

function countRunEvent(event: PromptStreamEvent) {
  if (!countedRunEvents.remember(event.id)) return
  runEventCounts[event.runId] = (runEventCounts[event.runId] ?? 0) + 1
}

function rememberLiveEvent(event: PromptStreamEvent) {
  if (event.type === 'text_delta') return
  liveEvents.value = [
    toLiveEventItem(event),
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
  localStorage.setItem(STORAGE_KEYS.eventCursor, event.id)
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

async function loadDiagnostics() {
  diagnostics.value = await client.diagnostics()
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
  localStorage.setItem(STORAGE_KEYS.projectId, currentProjectId())
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

function replaceClientToken(token: string | undefined) {
  stopEventStream()
  client = createZuuClient({ apiToken: token })
  startEventStream()
}

function chooseModel() {
  const nextModel = parseModelSelection(selectedModel.value)
  provider.value = nextModel.provider
  modelName.value = nextModel.id
}

function selectedModelRequest() {
  return createPromptModel(provider.value, modelName.value)
}

function selectedModelLabel() {
  return formatPromptModel(selectedModelRequest())
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
  localStorage.setItem(STORAGE_KEYS.projectId, currentProjectId())
  syncProjectForm()
  if (currentSession.value?.projectId !== currentProjectId()) {
    currentSession.value = undefined
    sessionTree.value = []
  }
  runs.value = []
  storedSessions.value = []
  countedRunEvents.clear()
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
  localStorage.setItem(STORAGE_KEYS.projectId, response.project.id)
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

async function sendPrompt(inputText = prompt.value) {
  const text = inputText.trim()
  if (!text) return

  prompt.value = text
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

async function submitPromptInput(message: PromptInputMessage) {
  await sendPrompt(message.text)
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
  <div
    class="workbench-shell"
    :class="{
      'is-left-collapsed': leftSidebarCollapsed,
      'is-right-collapsed': rightPanelCollapsed,
    }"
  >
    <aside class="workbench-sidebar">
      <div class="workbench-rail">
        <div class="rail-brand">Z</div>
        <Button variant="ghost" size="icon-sm" aria-label="Toggle left sidebar" @click="toggleLeftSidebar">
          <component :is="leftSidebarCollapsed ? ArrowRight01Icon : ArrowLeft01Icon" :size="16" />
        </Button>
        <Button variant="ghost" size="icon-sm" :aria-pressed="activeWorkspace === 'chat'" aria-label="Chat workspace" @click="activeWorkspace = 'chat'">
          <AiChat01Icon :size="16" />
        </Button>
        <Button variant="ghost" size="icon-sm" :aria-pressed="activeWorkspace === 'workflow'" aria-label="Workflow workspace" @click="activeWorkspace = 'workflow'; activeInspectorTab = 'tasks'">
          <WorkflowSquare01Icon :size="16" />
        </Button>
        <Button variant="ghost" size="icon-sm" :aria-pressed="activeWorkspace === 'schedule'" aria-label="Schedule workspace" @click="activeWorkspace = 'schedule'; activeInspectorTab = 'tasks'">
          <Calendar03Icon :size="16" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Settings" @click="activeInspectorTab = 'settings'; rightPanelCollapsed = false">
          <Settings01Icon :size="16" />
        </Button>
      </div>

      <div v-if="!leftSidebarCollapsed" class="sidebar-content">
        <header class="sidebar-header">
          <div class="min-w-0">
            <h1>Zuu Agent</h1>
            <p>{{ currentProjectName }}</p>
          </div>
          <Badge :variant="eventStatusVariant">{{ statusText }}</Badge>
        </header>

        <section class="sidebar-section">
          <div class="section-title">
            <h2>Project</h2>
            <Button variant="ghost" size="xs" :disabled="isRefreshing" @click="refreshAll">Refresh</Button>
          </div>
          <label class="field-label">
            Active project
            <Select v-model="selectedProjectId" @update:model-value="switchProject().catch((error) => addMessage('error', errorMessage(error)))">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Active project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="project in projects" :key="project.id" :value="project.id">
                  {{ project.name }} / {{ project.status }}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <p class="empty-text truncate">{{ currentProjectCwd || 'No project loaded.' }}</p>
        </section>

        <section class="sidebar-section min-h-0">
          <div class="section-title">
            <h2>Session history</h2>
            <Badge variant="outline">{{ storedSessions.length }}</Badge>
          </div>
          <div v-if="storedSessions.length" class="list-stack min-h-0 overflow-auto">
            <button
              v-for="session in storedSessions.slice(0, 14)"
              :key="session.path"
              class="history-row"
              :disabled="session.isActive"
              @click="openStoredSession(session.path).catch((error) => addMessage('error', errorMessage(error)))"
            >
              <strong>{{ session.name || session.id.slice(0, 8) }}</strong>
              <span>{{ session.messageCount }} messages / {{ session.updatedAt }}</span>
            </button>
          </div>
          <p v-else class="empty-text">No stored sessions yet.</p>
        </section>

        <section class="sidebar-section min-h-0">
          <div class="section-title">
            <h2>Recent runs</h2>
            <Button variant="ghost" size="xs" @click="loadRuns">Refresh</Button>
          </div>
          <div v-if="runs.length" class="list-stack min-h-0 overflow-auto">
            <div v-for="run in runs.slice(0, 8)" :key="run.id" class="history-row">
              <strong>{{ run.id.slice(0, 8) }} / {{ run.status }}</strong>
              <span>{{ runEventCounts[run.id] ?? 0 }} events</span>
              <span>{{ previewText(run.prompt, 80) }}</span>
              <div class="row-actions">
                <Button v-if="run.status === 'running' || run.status === 'waiting_approval'" variant="outline" size="xs" @click="abortRun(run.id).catch((error) => addMessage('error', errorMessage(error)))">Abort</Button>
                <Button variant="outline" size="xs" @click="replayRunEvents(run.id).catch((error) => addMessage('error', errorMessage(error)))">Replay</Button>
              </div>
            </div>
          </div>
          <p v-else class="empty-text">No runs yet.</p>
        </section>
      </div>
    </aside>

    <main class="conversation-pane">
      <header class="conversation-header">
        <div class="min-w-0">
          <h2>{{ currentSession?.name || 'New session' }}</h2>
          <p>{{ currentProjectName }} / {{ currentSession?.model || currentSession?.sessionFile || selectedModelLabel() || 'ready' }}</p>
        </div>
        <div class="header-actions">
          <Badge v-if="pendingApprovals.length" variant="destructive">{{ pendingApprovals.length }} approvals</Badge>
          <Badge :variant="eventStatusVariant">events {{ eventStreamStatus }}</Badge>
          <Badge variant="outline">{{ activeTools.length }} tools</Badge>
          <Button variant="outline" size="icon-sm" aria-label="Toggle right panel" @click="toggleRightPanel">
            {{ rightPanelCollapsed ? '<' : '>' }}
          </Button>
        </div>
      </header>

      <Conversation v-if="activeWorkspace === 'chat'" data-message-list class="message-list">
        <ConversationContent class="message-list-content">
          <div v-if="!messages.length" class="empty-surface">
            <h2>Ready for a run</h2>
            <p>Choose a model, enable tools, then send a prompt.</p>
          </div>
          <Message
            v-for="message in messages"
            :key="message.id"
            :from="messageFrom(message.role)"
            :class="message.role === 'event' || message.role === 'error' ? 'max-w-none' : undefined"
          >
            <MessageContent class="message-bubble" :class="`message-${message.role}`">
              {{ message.text || '...' }}
            </MessageContent>
          </Message>
        </ConversationContent>
      </Conversation>

      <section v-else-if="activeWorkspace === 'workflow'" class="workspace-canvas">
        <div class="workspace-header">
          <div>
            <h2>Workflow</h2>
            <p>{{ workflowBackend?.message || `${workflows.length} workflow definitions` }}</p>
          </div>
          <Badge :variant="workflowBackend?.status === 'ready' ? 'secondary' : 'destructive'">{{ workflowBackend?.kind || 'loading' }}</Badge>
        </div>
        <div class="action-form">
          <label class="field-label">
            Definition
            <Select v-model="selectedWorkflowId">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Workflow definition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="workflow in workflows" :key="workflow.id" :value="workflow.id">{{ workflow.name }}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <p v-if="selectedWorkflow" class="empty-text">{{ selectedWorkflow.description }}</p>
          <Textarea v-model="workflowPrompt" class="min-h-28" />
          <Button class="w-fit" :disabled="!selectedWorkflowId" @click="startWorkflow().catch((error) => addMessage('error', errorMessage(error)))">Run workflow</Button>
        </div>
      </section>

      <section v-else class="workspace-canvas">
        <div class="workspace-header">
          <div>
            <h2>Schedule</h2>
            <p>{{ currentProjectSchedules.length }} schedules in {{ currentProjectName }}</p>
          </div>
          <Badge variant="outline">{{ currentProjectSchedules.length }}</Badge>
        </div>
        <div class="action-form">
          <label class="field-label">
            Name
            <Input v-model="scheduleName" />
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="field-label">
              Trigger
              <Select v-model="scheduleKind">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="Trigger" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="once">Once</SelectItem>
                  <SelectItem value="interval">Interval</SelectItem>
                  <SelectItem value="cron">Cron</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label class="field-label">
              Action
              <Select v-model="scheduleActionType">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="workflow">Workflow</SelectItem>
                  <SelectItem value="prompt">Prompt</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <label class="field-label">
              Overlap
              <Select v-model="scheduleOverlapPolicy">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="Overlap" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">Skip</SelectItem>
                  <SelectItem value="queue">Queue</SelectItem>
                  <SelectItem value="parallel">Parallel</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label class="field-label">
              Misfire
              <Select v-model="scheduleMisfirePolicy">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="Misfire" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">Skip missed</SelectItem>
                  <SelectItem value="run_once">Run once</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <label class="field-label">
              Attempts
              <Input v-model.number="scheduleRetryAttempts" type="number" min="1" max="5" />
            </label>
            <label class="field-label">
              Backoff ms
              <Input v-model.number="scheduleRetryBackoffMs" type="number" min="0" max="60000" step="100" />
            </label>
          </div>
          <label v-if="scheduleKind === 'once'" class="field-label">
            Run at
            <Input v-model="scheduleRunAt" type="datetime-local" />
          </label>
          <label v-else-if="scheduleKind === 'interval'" class="field-label">
            Every minutes
            <Input v-model.number="scheduleEveryMinutes" type="number" min="1" />
          </label>
          <label v-else class="field-label">
            Cron
            <Input v-model="scheduleCron" placeholder="*/5 * * * *" />
          </label>
          <label v-if="scheduleKind === 'cron'" class="field-label">
            Timezone
            <Input v-model="scheduleTimezone" placeholder="Asia/Shanghai" />
          </label>
          <label v-if="scheduleActionType === 'workflow'" class="field-label">
            Workflow
            <Select v-model="selectedWorkflowId">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Workflow" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="workflow in workflows" :key="workflow.id" :value="workflow.id">{{ workflow.name }}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <Textarea v-model="schedulePrompt" class="min-h-28" />
          <div class="flex flex-wrap gap-2">
            <Button :disabled="scheduleActionType === 'workflow' && !selectedWorkflowId" @click="createSchedule().catch((error) => addMessage('error', errorMessage(error)))">{{ editingScheduleId ? 'Save schedule' : 'Create schedule' }}</Button>
            <Button v-if="editingScheduleId" variant="ghost" @click="cancelScheduleEdit">Cancel</Button>
          </div>
        </div>
      </section>

      <footer class="composer">
        <PromptInput class="composer-input" :initial-input="prompt" @submit="submitPromptInput" @error="(error) => addMessage('error', error.message)">
          <PromptInputTextarea class="min-h-24 resize-y" />
          <PromptInputFooter>
            <div class="empty-text">{{ activeTools.length }} tools / {{ selectedModelLabel() }}</div>
            <div class="composer-actions">
              <Button type="button" variant="outline" :disabled="!isRunning" @click="abortPrompt">Abort</Button>
              <Button type="button" variant="outline" :disabled="!canQueueSessionMessage" @click="queueSessionMessage('steer')">Steer</Button>
              <Button type="button" variant="outline" :disabled="!canQueueSessionMessage" @click="queueSessionMessage('followUp')">Follow up</Button>
              <Button type="submit" :disabled="isRunning">Send</Button>
            </div>
          </PromptInputFooter>
        </PromptInput>
      </footer>
    </main>

    <aside v-if="!rightPanelCollapsed" class="inspector-pane">
      <Tabs v-model="activeInspectorTab" class="h-full min-h-0">
        <div class="inspector-header">
          <TabsList class="w-full">
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="resources">Resources</TabsTrigger>
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
            <TabsTrigger value="browser">Browser</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="tasks" class="inspector-content">
          <section class="side-panel">
            <div class="section-title">
              <h2>Workflow runs</h2>
              <Button variant="ghost" size="xs" @click="loadWorkflowRuns">Refresh</Button>
            </div>
            <div v-if="currentProjectWorkflowRuns.length" class="list-stack">
              <div
                v-for="run in currentProjectWorkflowRuns.slice(0, 8)"
                :key="run.id"
                class="workflow-row cursor-pointer"
                :class="run.id === selectedWorkflowRunId ? 'border-primary/50 bg-primary/5' : ''"
                @click="loadWorkflowRunDetail(run.id).catch((error) => addMessage('error', errorMessage(error)))"
              >
                <div class="flex items-center justify-between gap-2">
                  <strong>{{ run.workflowName }}</strong>
                  <Badge :variant="run.status === 'completed' ? 'secondary' : run.status === 'failed' || run.status === 'aborted' ? 'destructive' : 'outline'">{{ run.status }}</Badge>
                </div>
                <span>{{ run.id.slice(0, 8) }} / {{ run.startedAt }}</span>
                <div class="workflow-progress">
                  <span>{{ run.tasks.length }} tasks</span>
                  <span>{{ run.artifacts.length }} artifacts</span>
                  <span v-if="run.linkedRunIds?.length">{{ run.linkedRunIds.length }} agents</span>
                </div>
                <Button v-if="run.status === 'queued' || run.status === 'running'" variant="outline" size="xs" @click.stop="abortWorkflowRun(run.id).catch((error) => addMessage('error', errorMessage(error)))">Abort</Button>
              </div>
            </div>
            <p v-else class="empty-text">No workflow runs yet.</p>
          </section>

          <section class="side-panel">
            <div class="section-title">
              <h2>Workflow detail</h2>
              <Badge v-if="selectedWorkflowRun" :variant="selectedWorkflowRun.status === 'completed' ? 'secondary' : selectedWorkflowRun.status === 'failed' || selectedWorkflowRun.status === 'aborted' ? 'destructive' : 'outline'">{{ selectedWorkflowRun.status }}</Badge>
            </div>
            <div v-if="selectedWorkflowRun" class="list-stack">
              <div class="workflow-row">
                <strong>{{ selectedWorkflowRun.workflowName }}</strong>
                <span>{{ selectedWorkflowRun.id }}</span>
                <span v-if="isLoadingWorkflowRunDetail">Loading...</span>
                <p v-if="selectedWorkflowRun.error">{{ selectedWorkflowRun.error }}</p>
              </div>
              <div v-if="workflowStageRows.length" class="workflow-row">
                <div class="section-title">
                  <strong>Stages</strong>
                  <span>{{ workflowRunStages.length }}</span>
                </div>
                <div v-for="row in workflowStageRows" :key="row.stage.id" class="compact-row">
                  <div class="min-w-0">
                    <strong>{{ row.stage.name }}</strong>
                    <span>{{ row.stage.summary || row.stage.id }}</span>
                    <span>{{ row.tasks.length }} tasks</span>
                  </div>
                  <Badge :variant="row.stage.status === 'completed' ? 'secondary' : row.stage.status === 'failed' || row.stage.status === 'aborted' ? 'destructive' : 'outline'">{{ row.stage.status }}</Badge>
                </div>
              </div>
              <div v-for="task in workflowRunTasks" :key="task.id" class="compact-row">
                <div class="min-w-0">
                  <strong>{{ task.name }}</strong>
                  <span v-if="task.dependsOn?.length">depends {{ task.dependsOn.join(', ') }}</span>
                  <span v-if="task.agentRunId">agent {{ task.agentRunId.slice(0, 8) }}</span>
                  <span v-if="task.attempts">attempts {{ task.attempts }}</span>
                  <p v-if="previewText(task.output ?? task.input, 120)">{{ previewText(task.output ?? task.input, 120) }}</p>
                </div>
                <Badge :variant="task.status === 'completed' ? 'secondary' : task.status === 'failed' || task.status === 'aborted' ? 'destructive' : 'outline'">{{ task.status }}</Badge>
              </div>
              <div v-if="workflowRunArtifacts.length" class="workflow-row">
                <div class="section-title">
                  <strong>Artifacts</strong>
                  <span>{{ workflowRunArtifacts.length }}</span>
                </div>
                <div v-for="artifact in workflowRunArtifacts" :key="artifact.id" class="artifact-preview">
                  <strong>{{ artifact.name }}</strong>
                  <span v-if="artifact.taskId">task {{ artifact.taskId.slice(0, 12) }}</span>
                  <pre v-if="artifact.content !== undefined">{{ previewText(artifact.content, 900) }}</pre>
                </div>
              </div>
              <p v-if="workflowUnstagedTasks.length" class="empty-text">{{ workflowUnstagedTasks.length }} unstaged tasks.</p>
            </div>
            <p v-else class="empty-text">No workflow run selected.</p>
          </section>

          <section class="side-panel">
            <div class="section-title">
              <h2>Schedule runs</h2>
              <Button variant="ghost" size="xs" @click="loadSchedules">Refresh</Button>
            </div>
            <div v-if="currentProjectSchedules.length" class="list-stack">
              <div
                v-for="schedule in currentProjectSchedules.slice(0, 8)"
                :key="schedule.id"
                class="workflow-row cursor-pointer"
                :class="schedule.id === selectedScheduleId ? 'border-primary/50 bg-primary/5' : ''"
                @click="loadScheduleRuns(schedule.id).catch((error) => addMessage('error', errorMessage(error)))"
              >
                <div class="flex items-center justify-between gap-2">
                  <strong>{{ schedule.name }}</strong>
                  <Badge :variant="schedule.status === 'active' ? 'secondary' : 'outline'">{{ schedule.status }}</Badge>
                </div>
                <span>{{ scheduleTriggerLabel(schedule) }}</span>
                <span>{{ scheduleActionLabel(schedule.action) }}</span>
                <span v-if="schedule.nextRunAt">next {{ schedule.nextRunAt }}</span>
                <div class="row-actions">
                  <Button variant="outline" size="xs" @click.stop="editSchedule(schedule); activeWorkspace = 'schedule'">Edit</Button>
                  <Button variant="outline" size="xs" @click.stop="triggerSchedule(schedule.id).catch((error) => addMessage('error', errorMessage(error)))">Run</Button>
                  <Button v-if="schedule.status === 'active'" variant="ghost" size="xs" @click.stop="pauseSchedule(schedule.id).catch((error) => addMessage('error', errorMessage(error)))">Pause</Button>
                  <Button v-else variant="ghost" size="xs" @click.stop="resumeSchedule(schedule.id).catch((error) => addMessage('error', errorMessage(error)))">Resume</Button>
                  <Button variant="ghost" size="xs" @click.stop="deleteSchedule(schedule.id).catch((error) => addMessage('error', errorMessage(error)))">Delete</Button>
                </div>
              </div>
            </div>
            <p v-else class="empty-text">No schedules yet.</p>
          </section>

          <section class="side-panel">
            <div class="section-title">
              <h2>Schedule detail</h2>
              <Badge v-if="selectedSchedule" :variant="selectedSchedule.status === 'active' ? 'secondary' : 'outline'">{{ selectedSchedule.status }}</Badge>
            </div>
            <div v-if="selectedSchedule" class="list-stack">
              <div class="workflow-row">
                <strong>{{ selectedSchedule.name }}</strong>
                <span>{{ scheduleTriggerLabel(selectedSchedule) }}</span>
                <span>{{ scheduleActionLabel(selectedSchedule.action) }}</span>
                <span v-if="selectedSchedule.nextRunAt">next {{ selectedSchedule.nextRunAt }}</span>
                <span v-if="isLoadingScheduleRuns">Loading...</span>
              </div>
              <div v-if="scheduleRuns.length" class="list-stack">
                <div
                  v-for="run in scheduleRuns.slice(0, 8)"
                  :key="run.id"
                  class="compact-row cursor-pointer"
                  :class="run.id === selectedScheduleRunId ? 'border-primary/50 bg-primary/5' : ''"
                  @click="loadScheduleRunDetail(run.id).catch((error) => addMessage('error', errorMessage(error)))"
                >
                  <div class="min-w-0">
                    <strong>{{ run.id.slice(0, 8) }} / {{ run.status }}</strong>
                    <span>scheduled {{ run.scheduledFor }}</span>
                    <span v-if="run.attempts">attempts {{ run.attempts }}</span>
                    <span v-if="run.reason">reason {{ run.reason }}</span>
                  </div>
                  <Button v-if="run.status === 'queued' || run.status === 'running'" variant="outline" size="xs" @click.stop="abortScheduleRun(run.id).catch((error) => addMessage('error', errorMessage(error)))">Abort</Button>
                </div>
              </div>
              <div v-if="selectedScheduleRun" class="workflow-row">
                <div class="section-title">
                  <strong>Selected run</strong>
                  <Badge :variant="selectedScheduleRun.status === 'completed' ? 'secondary' : selectedScheduleRun.status === 'failed' || selectedScheduleRun.status === 'aborted' ? 'destructive' : 'outline'">{{ selectedScheduleRun.status }}</Badge>
                </div>
                <span>{{ selectedScheduleRun.id }}</span>
                <span>scheduled {{ selectedScheduleRun.scheduledFor }}</span>
                <span v-if="selectedScheduleRun.workflowRunId">workflow {{ selectedScheduleRun.workflowRunId }}</span>
                <span v-if="selectedScheduleRun.agentRunId">agent {{ selectedScheduleRun.agentRunId }}</span>
                <p v-if="selectedScheduleRun.error">{{ selectedScheduleRun.error }}</p>
              </div>
            </div>
            <p v-else class="empty-text">No schedule selected.</p>
          </section>
        </TabsContent>

        <TabsContent value="resources" class="inspector-content">
          <section class="side-panel">
            <div class="section-title">
              <h2>Runtime resources</h2>
              <Button variant="ghost" size="xs" @click="loadDiagnostics">Refresh</Button>
            </div>
            <dl class="meta-grid">
              <div><dt>SDK</dt><dd>{{ diagnostics?.sdk.version || 'loading' }}</dd></div>
              <div><dt>Models</dt><dd>{{ diagnostics?.models.availableCount ?? 0 }}</dd></div>
              <div><dt>Providers</dt><dd>{{ configuredProviders }}</dd></div>
              <div><dt>Skills</dt><dd>{{ diagnostics?.resources.skills ?? 0 }}</dd></div>
            </dl>
            <p v-if="diagnostics?.gaps.length" class="text-destructive text-xs">{{ diagnostics.gaps.join(' / ') }}</p>
          </section>

          <section class="side-panel">
            <div class="section-title">
              <h2>Resource diagnostics</h2>
              <Badge variant="outline">{{ resourceDiagnostics.length }}</Badge>
            </div>
            <div v-if="resourceDiagnostics.length" class="list-stack">
              <div v-for="diagnostic in resourceDiagnostics.slice(0, 12)" :key="`${diagnostic.type}-${diagnostic.path || diagnostic.message}`" class="workflow-row">
                <div class="flex items-center justify-between gap-2">
                  <strong>{{ diagnostic.collision?.name || diagnostic.type }}</strong>
                  <Badge :variant="diagnostic.type === 'error' || diagnostic.type === 'collision' ? 'destructive' : 'outline'">{{ diagnostic.type }}</Badge>
                </div>
                <p>{{ diagnostic.message }}</p>
                <span v-if="diagnostic.path">{{ diagnostic.path }}</span>
              </div>
            </div>
            <p v-else class="empty-text">No resource diagnostics.</p>
          </section>

          <section class="side-panel">
            <div class="section-title">
              <h2>Session tree</h2>
              <Button variant="ghost" size="xs" @click="loadSessionTree">Refresh</Button>
            </div>
            <div v-if="flatTree.length" class="list-stack">
              <div v-for="{ entry, depth } in flatTree.slice(0, 24)" :key="entry.id" class="tree-row" :style="{ paddingLeft: `${8 + Math.min(depth * 12, 48)}px` }">
                <strong>{{ entry.role || entry.type }} / {{ entry.id.slice(0, 8) }}</strong>
                <span>{{ (entry.text || entry.timestamp || '').slice(0, 110) }}</span>
                <div class="row-actions">
                  <Button variant="outline" size="xs" @click="forkFromEntry(entry.id, 'before').catch((error) => addMessage('error', errorMessage(error)))">Before</Button>
                  <Button variant="outline" size="xs" @click="forkFromEntry(entry.id, 'at').catch((error) => addMessage('error', errorMessage(error)))">At</Button>
                </div>
              </div>
            </div>
            <p v-else class="empty-text">Open a session first.</p>
            <div class="flex gap-2">
              <Input v-model="importPath" class="min-w-0" placeholder="D:\\path\\session.jsonl" @keydown.enter="importSession().catch((error) => addMessage('error', errorMessage(error)))" />
              <Button variant="outline" size="sm" @click="importSession().catch((error) => addMessage('error', errorMessage(error)))">Import</Button>
            </div>
          </section>

          <section class="side-panel">
            <div class="section-title">
              <h2>Stores</h2>
              <Badge variant="outline">{{ storeDiagnostics.length }}</Badge>
            </div>
            <div v-if="storeDiagnostics.length" class="list-stack">
              <div v-for="store in storeDiagnostics" :key="store.path" class="workflow-row">
                <div class="flex items-center justify-between gap-2">
                  <strong>{{ store.name }}</strong>
                  <Badge :variant="store.ok ? 'secondary' : 'destructive'">{{ store.ok ? 'ok' : 'review' }}</Badge>
                </div>
                <span>{{ store.recordCount }} records / {{ store.exists ? 'exists' : 'missing' }}</span>
                <span>{{ store.path }}</span>
                <p v-if="store.error">{{ store.error }}</p>
              </div>
            </div>
          </section>

          <section v-if="blockedPackages.length" class="side-panel">
            <div class="section-title">
              <h2>Blocked packages</h2>
              <Badge variant="destructive">{{ blockedPackages.length }}</Badge>
            </div>
            <div v-for="source in blockedPackages.slice(0, 8)" :key="source" class="workflow-row">
              <strong>{{ source }}</strong>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="terminal" class="inspector-content">
          <Terminal
            class="min-h-80"
            :output="terminalOutput"
            :is-streaming="eventStreamStatus === 'live'"
            @clear="liveEvents = []"
          />
          <section class="side-panel">
            <div class="section-title">
              <h2>Approvals</h2>
              <Button variant="ghost" size="xs" @click="loadApprovals">Refresh</Button>
            </div>
            <div v-if="approvals.length" class="list-stack">
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
        </TabsContent>

        <TabsContent value="browser" class="inspector-content">
          <WebPreview
            class="min-h-[520px] overflow-hidden"
            :default-url="browserUrl"
            @update:url="browserUrl = $event"
          >
            <WebPreviewNavigation>
              <AiBrowserIcon :size="16" class="mx-2 shrink-0 text-muted-foreground" />
              <WebPreviewUrl aria-label="Browser URL" />
            </WebPreviewNavigation>
            <WebPreviewBody />
          </WebPreview>
        </TabsContent>

        <TabsContent value="settings" class="inspector-content">
          <section class="side-panel">
            <div class="section-title">
              <h2>Auth</h2>
              <Badge v-if="authStatus" variant="outline">{{ authStatus.source }}</Badge>
            </div>
            <label class="field-label">
              API token
              <Input v-model="apiToken" type="password" placeholder="Optional ZUU_API_TOKEN" @keydown.enter="saveToken" />
            </label>
            <div class="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" @click="saveToken">Save token</Button>
              <Button variant="outline" size="sm" :disabled="!authStatus?.canRotate" @click="rotateAuthToken().catch((error) => addMessage('error', errorMessage(error)))">Rotate</Button>
            </div>
            <p v-if="authStatus" class="empty-text">{{ authStatus.tokenPreview }}{{ authStatus.tokenFile ? ` / ${authStatus.tokenFile}` : '' }}</p>
            <div v-if="authStatus?.canRotate" class="project-create">
              <Input v-model="newAuthTokenActor" class="min-w-0" placeholder="actor" />
              <Select v-model="newAuthTokenScope">
                <SelectTrigger class="min-w-0">
                  <SelectValue placeholder="scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">read</SelectItem>
                  <SelectItem value="admin">admin</SelectItem>
                </SelectContent>
              </Select>
              <Input v-model="newAuthTokenExpiresAt" class="min-w-0" type="datetime-local" aria-label="Token expires at" />
              <Button size="sm" @click="createAuthToken().catch((error) => addMessage('error', errorMessage(error)))">Create</Button>
            </div>
            <div v-if="authStatus?.tokens.length" class="list-stack">
              <div v-for="token in authStatus.tokens" :key="token.id" class="workflow-row">
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{{ token.scope }}</Badge>
                      <Badge v-if="token.expired" variant="destructive">expired</Badge>
                      <span>{{ token.actor }}</span>
                    </div>
                    <p class="empty-text">{{ token.tokenPreview }} / {{ token.id }}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    :disabled="token.scope === 'admin' && authAdminTokenCount <= 1"
                    @click="revokeAuthToken(token.id).catch((error) => addMessage('error', errorMessage(error)))"
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <section class="side-panel">
            <div class="section-title">
              <h2>Session settings</h2>
              <Badge variant="secondary">{{ currentSession?.messageCount ?? 0 }} messages</Badge>
            </div>
            <label class="field-label">
              Session name
              <Input v-model="sessionName" />
            </label>
            <label class="field-label">
              Available model
              <Select v-model="selectedModelOption">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="Use manual model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="emptySelectValue">Use manual model</SelectItem>
                  <SelectItem v-for="model in models" :key="`${model.provider}/${model.id}`" :value="`${model.provider}/${model.id}`">{{ model.provider }} / {{ model.label || model.id }}</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <div class="grid grid-cols-2 gap-2">
              <label class="field-label">
                Provider
                <Input v-model="provider" placeholder="deepseek" />
              </label>
              <label class="field-label">
                Model
                <Input v-model="modelName" placeholder="deepseek-chat" />
              </label>
            </div>
            <label class="field-label">
              Thinking
              <Select v-model="thinkingLevel">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="Thinking" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">off</SelectItem>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <div class="tool-grid">
              <label v-for="tool in toolChoices" :key="tool" class="tool-toggle">
                <Switch v-model="selectedTools[tool]" size="sm" />
                <span>{{ tool }}</span>
              </label>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" :disabled="!currentSession" @click="saveCurrentSession().catch((error) => addMessage('error', errorMessage(error)))">Save session</Button>
              <Button variant="ghost" size="sm" :disabled="!currentSession || currentSession.isStreaming" @click="closeCurrentSession().catch((error) => addMessage('error', errorMessage(error)))">Close</Button>
              <Button variant="outline" size="sm" :disabled="isSmokingModel" @click="smokeModel().catch((error) => addMessage('error', errorMessage(error)))">{{ isSmokingModel ? 'Testing' : 'Smoke test' }}</Button>
            </div>
            <p v-if="modelSmoke" :class="modelSmoke.ok ? 'empty-text' : 'text-destructive text-xs'">
              {{ modelSmoke.ok ? `run ${modelSmoke.runId?.slice(0, 8) || 'n/a'} / ${modelSmoke.durationMs}ms` : modelSmoke.error || 'model smoke failed' }}
            </p>
          </section>

          <section class="side-panel">
            <div class="section-title">
              <h2>Project settings</h2>
              <Badge variant="outline">{{ projects.length }}</Badge>
            </div>
            <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input v-model="projectName" class="min-w-0" placeholder="Project name" @keydown.enter="updateProject().catch((error) => addMessage('error', errorMessage(error)))" />
              <Button variant="outline" size="sm" @click="updateProject().catch((error) => addMessage('error', errorMessage(error)))">Save</Button>
            </div>
            <Input v-model="projectCwd" placeholder="D:\code\personal-project\zuu" />
            <Button variant="ghost" size="sm" class="w-fit" :disabled="currentProject?.id === 'default'" @click="deleteProject().catch((error) => addMessage('error', errorMessage(error)))">Delete project</Button>
            <div class="project-create">
              <Input v-model="newProjectName" class="min-w-0" placeholder="New project" />
              <Input v-model="newProjectCwd" class="min-w-0" placeholder="cwd" />
              <Button size="sm" @click="createProject().catch((error) => addMessage('error', errorMessage(error)))">Create</Button>
            </div>
          </section>

          <section class="side-panel">
            <div class="section-title">
              <h2>Packages</h2>
              <Badge variant="outline">{{ packages.length }}</Badge>
            </div>
            <div v-if="packages.length" class="list-stack">
              <div v-for="item in packages" :key="item.source" class="compact-row">
                <div class="min-w-0">
                  <strong>{{ item.source }}</strong>
                  <span>{{ item.scope }} / {{ item.status }} / {{ item.trustStatus }}</span>
                </div>
                <div class="row-actions">
                  <Button v-if="!item.trusted" variant="outline" size="xs" @click="trustPackage(item.source).catch((error) => addMessage('error', errorMessage(error)))">Trust</Button>
                  <Button v-else variant="ghost" size="xs" @click="revokePackageTrust(item.source).catch((error) => addMessage('error', errorMessage(error)))">Revoke</Button>
                  <Button v-if="item.status === 'installed'" variant="outline" size="xs" :disabled="!item.trusted || isPackageOperating(item.source)" @click="updatePackage(item.source).catch((error) => addMessage('error', errorMessage(error)))">Update</Button>
                  <Button v-if="item.status !== 'installed'" variant="outline" size="xs" :disabled="!item.trusted || isPackageOperating(item.source)" @click="installPackage(item.source).catch((error) => addMessage('error', errorMessage(error)))">Install</Button>
                  <Button variant="ghost" size="xs" :disabled="isPackageOperating(item.source)" @click="removePackage(item.source).catch((error) => addMessage('error', errorMessage(error)))">Remove</Button>
                </div>
              </div>
            </div>
            <p v-else class="empty-text">No packages configured.</p>
            <div class="flex gap-2">
              <Input v-model="packageSource" class="min-w-0" placeholder="npm:@agwab/pi-workflow@0.84.1" @keydown.enter="addPackage().catch((error) => addMessage('error', errorMessage(error)))" />
              <Button variant="outline" size="sm" @click="addPackage().catch((error) => addMessage('error', errorMessage(error)))">Add</Button>
            </div>
          </section>

          <section class="side-panel">
            <div class="section-title">
              <h2>Package ops</h2>
              <Badge v-if="runningPackageOperations.length" variant="secondary">{{ runningPackageOperations.length }} running</Badge>
            </div>
            <div v-if="packageOperations.length" class="list-stack">
              <div v-for="operation in packageOperations.slice(0, 8)" :key="operation.id" class="workflow-row">
                <div class="flex items-center justify-between gap-2">
                  <strong>{{ operation.source }}</strong>
                  <Badge :variant="operation.status === 'done' ? 'secondary' : operation.status === 'error' ? 'destructive' : 'outline'">{{ operation.status }}</Badge>
                </div>
                <span>{{ operation.action }} / {{ operation.startedAt }}</span>
                <p v-if="packageOperationMessage(operation)">{{ packageOperationMessage(operation) }}</p>
                <span v-if="latestPackageOperation(operation.source)">latest {{ latestPackageOperation(operation.source)?.status }}</span>
              </div>
            </div>
            <p v-else class="empty-text">No package operations yet.</p>
          </section>

          <section class="side-panel">
            <div class="section-title">
              <h2>Audit</h2>
              <Button variant="ghost" size="xs" @click="loadAuditEvents">Refresh</Button>
            </div>
            <div class="grid grid-cols-3 gap-2">
              <Select v-model="auditActionOption">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="Any action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="emptySelectValue">Any action</SelectItem>
                  <SelectItem value="api.read">api.read</SelectItem>
                  <SelectItem value="api.mutate">api.mutate</SelectItem>
                  <SelectItem value="auth.rotate">auth.rotate</SelectItem>
                  <SelectItem value="auth.token_create">auth.token_create</SelectItem>
                  <SelectItem value="auth.token_revoke">auth.token_revoke</SelectItem>
                  <SelectItem value="approval.resolve">approval.resolve</SelectItem>
                  <SelectItem value="package.add">package.add</SelectItem>
                  <SelectItem value="package.install">package.install</SelectItem>
                  <SelectItem value="package.update">package.update</SelectItem>
                  <SelectItem value="package.remove">package.remove</SelectItem>
                  <SelectItem value="package.trust">package.trust</SelectItem>
                  <SelectItem value="package.revoke_trust">package.revoke_trust</SelectItem>
                </SelectContent>
              </Select>
              <Select v-model="auditOutcomeOption">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="Any outcome" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="emptySelectValue">Any outcome</SelectItem>
                  <SelectItem value="success">success</SelectItem>
                  <SelectItem value="failure">failure</SelectItem>
                </SelectContent>
              </Select>
              <Select v-model="auditAuthScopeOption">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="Any scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="emptySelectValue">Any scope</SelectItem>
                  <SelectItem value="admin">admin</SelectItem>
                  <SelectItem value="read">read</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input v-model="auditTarget" placeholder="Target contains" @keydown.enter="loadAuditEvents" />
            <div class="grid grid-cols-2 gap-2">
              <Input v-model="auditAuthActor" placeholder="Auth actor" @keydown.enter="loadAuditEvents" />
              <Input v-model="auditAuthTokenId" placeholder="Auth token id" @keydown.enter="loadAuditEvents" />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <Input v-model="auditSince" type="datetime-local" aria-label="Audit since" @keydown.enter="loadAuditEvents" />
              <Input v-model="auditUntil" type="datetime-local" aria-label="Audit until" @keydown.enter="loadAuditEvents" />
            </div>
            <div v-if="auditEvents.length" class="list-stack">
              <div v-for="event in auditEvents.slice(0, 8)" :key="event.id" class="workflow-row">
                <div class="flex items-center justify-between gap-2">
                  <strong>{{ event.action }}</strong>
                  <Badge :variant="event.outcome === 'success' ? 'secondary' : 'destructive'">{{ event.outcome }}</Badge>
                </div>
                <span>{{ event.createdAt }}</span>
                <span v-if="event.details?.authScope">{{ event.details.authScope }}</span>
                <span v-if="event.details?.authActor">{{ event.details.authActor }}</span>
                <span v-if="event.details?.authTokenId">{{ event.details.authTokenId }}</span>
                <p v-if="event.target">{{ event.target }}</p>
              </div>
            </div>
            <p v-else class="empty-text">No audit events yet.</p>
          </section>
        </TabsContent>
      </Tabs>
    </aside>
  </div>
</template>
