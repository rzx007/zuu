import { computed, ref, type Ref } from 'vue'
import type {
  CreateScheduleRequest,
  PromptRequest,
  Schedule,
  ScheduleAction,
  ScheduleOverlapPolicy,
  ScheduleRun,
  ThinkingLevel,
  ZuuClient,
} from '@zuu/client'
import { toDatetimeLocal } from '@/lib/formatting'

interface SchedulePromptContext {
  sessionId?: string
  sessionName?: string
  prompt: string
  thinkingLevel: ThinkingLevel
  tools: string[]
  model?: PromptRequest['model']
  modelLabel?: string
}

interface SchedulePanelOptions {
  getClient: () => ZuuClient
  currentProjectId: () => string
  selectedWorkflowId: Ref<string>
  promptContext: () => SchedulePromptContext
  addMessage: (role: 'event' | 'error', text?: string) => unknown
  loadRuns: () => Promise<unknown>
  loadWorkflowRuns: () => Promise<unknown>
}

export function useSchedulePanel(options: SchedulePanelOptions) {
  const schedules = ref<Schedule[]>([])
  const selectedScheduleId = ref('')
  const selectedScheduleRunId = ref('')
  const scheduleRuns = ref<ScheduleRun[]>([])
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
  const isLoadingScheduleRuns = ref(false)
  const currentProjectSchedules = computed(() =>
    schedules.value.filter((schedule) => schedule.action.projectId === options.currentProjectId()),
  )
  const selectedSchedule = computed(() =>
    currentProjectSchedules.value.find((schedule) => schedule.id === selectedScheduleId.value),
  )
  const selectedScheduleRun = computed(() =>
    scheduleRuns.value.find((run) => run.id === selectedScheduleRunId.value),
  )

  async function loadSchedules() {
    schedules.value = (await options.getClient().listProjectSchedules(options.currentProjectId())).schedules
    const nextScheduleId =
      currentProjectSchedules.value.find((schedule) => schedule.id === selectedScheduleId.value)?.id ||
      currentProjectSchedules.value[0]?.id ||
      ''
    if (!nextScheduleId) {
      clearScheduleRunDetail()
      return
    }
    await loadScheduleRuns(nextScheduleId)
  }

  function clearScheduleRunDetail() {
    selectedScheduleId.value = ''
    selectedScheduleRunId.value = ''
    scheduleRuns.value = []
  }

  async function loadScheduleRuns(scheduleId = selectedScheduleId.value) {
    if (!scheduleId) {
      clearScheduleRunDetail()
      return
    }

    const projectId = options.currentProjectId()
    selectedScheduleId.value = scheduleId
    isLoadingScheduleRuns.value = true
    try {
      const response = await options.getClient().listProjectScheduleRuns(projectId, scheduleId)
      if (selectedScheduleId.value !== scheduleId || options.currentProjectId() !== projectId) return
      scheduleRuns.value = response.runs
      const nextRunId = response.runs.find((run) => run.id === selectedScheduleRunId.value)?.id || response.runs[0]?.id || ''
      selectedScheduleRunId.value = nextRunId
      if (nextRunId) {
        await loadScheduleRunDetail(nextRunId)
      }
    } finally {
      if (selectedScheduleId.value === scheduleId) {
        isLoadingScheduleRuns.value = false
      }
    }
  }

  async function loadScheduleRunDetail(runId = selectedScheduleRunId.value) {
    if (!runId) {
      selectedScheduleRunId.value = ''
      return
    }
    const projectId = options.currentProjectId()
    selectedScheduleRunId.value = runId
    const response = await options.getClient().getProjectScheduleRun(projectId, runId)
    if (selectedScheduleRunId.value !== runId || options.currentProjectId() !== projectId) return
    scheduleRuns.value = [response.run, ...scheduleRuns.value.filter((run) => run.id !== response.run.id)].sort((a, b) =>
      (b.startedAt || b.scheduledFor).localeCompare(a.startedAt || a.scheduledFor),
    )
  }

  function scheduleAction(): ScheduleAction | undefined {
    const context = options.promptContext()
    if (scheduleActionType.value === 'workflow') {
      if (!options.selectedWorkflowId.value) return undefined
      return {
        type: 'workflow',
        workflowId: options.selectedWorkflowId.value,
        projectId: options.currentProjectId(),
        sessionId: context.sessionId,
        prompt: schedulePrompt.value.trim() || undefined,
        inputs: {
          tools: context.tools,
          model: context.modelLabel,
        },
      }
    }

    return {
      type: 'prompt',
      prompt: schedulePrompt.value.trim() || context.prompt,
      projectId: options.currentProjectId(),
      sessionId: context.sessionId,
      name: context.sessionName,
      thinkingLevel: context.thinkingLevel,
      tools: context.tools,
      model: context.model,
    }
  }

  async function createSchedule() {
    const action = scheduleAction()
    if (!action) return
    const everyMinutes = Math.max(1, Number(scheduleEveryMinutes.value) || 1)
    const cronTimezone = scheduleTimezone.value.trim()
    if (scheduleKind.value === 'cron' && !cronTimezone) {
      options.addMessage('error', 'cron schedule timezone is required')
      return
    }
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
        timezone: cronTimezone,
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
      ? await options.getClient().updateProjectSchedule(options.currentProjectId(), editingScheduleId.value, input)
      : await options.getClient().createProjectSchedule(options.currentProjectId(), input)
    options.addMessage('event', `schedule ${editingScheduleId.value ? 'updated' : 'created'}: ${result.schedule.name}`)
    selectedScheduleId.value = result.schedule.id
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
      scheduleCron.value = schedule.trigger.cron
      scheduleTimezone.value = schedule.trigger.timezone
    }
    scheduleActionType.value = schedule.action.type
    scheduleOverlapPolicy.value = schedule.overlapPolicy
    scheduleMisfirePolicy.value = schedule.misfirePolicy
    scheduleRetryAttempts.value = schedule.retryPolicy?.maxAttempts || 1
    scheduleRetryBackoffMs.value = schedule.retryPolicy?.backoffMs || 0
    if (schedule.action.type === 'workflow') {
      options.selectedWorkflowId.value = schedule.action.workflowId
      schedulePrompt.value = schedule.action.prompt || ''
    } else {
      schedulePrompt.value = schedule.action.prompt
    }
  }

  function cancelScheduleEdit() {
    editingScheduleId.value = ''
  }

  async function pauseSchedule(scheduleId: string) {
    const result = await options.getClient().pauseProjectSchedule(options.currentProjectId(), scheduleId)
    options.addMessage('event', `schedule paused: ${result.schedule.name}`)
    await loadSchedules()
  }

  async function resumeSchedule(scheduleId: string) {
    const result = await options.getClient().resumeProjectSchedule(options.currentProjectId(), scheduleId)
    options.addMessage('event', `schedule active: ${result.schedule.name}`)
    await loadSchedules()
  }

  async function triggerSchedule(scheduleId: string) {
    const result = await options.getClient().triggerProjectSchedule(options.currentProjectId(), scheduleId)
    options.addMessage('event', `schedule triggered: ${result.schedule.name}`)
    selectedScheduleId.value = result.schedule.id
    selectedScheduleRunId.value = result.schedule.runs[0]?.id || ''
    await Promise.all([loadSchedules(), options.loadWorkflowRuns(), options.loadRuns()])
  }

  async function deleteSchedule(scheduleId: string) {
    const result = await options.getClient().deleteProjectSchedule(options.currentProjectId(), scheduleId)
    options.addMessage('event', `schedule deleted: ${result.schedule.name}`)
    if (selectedScheduleId.value === result.schedule.id) {
      clearScheduleRunDetail()
    }
    await loadSchedules()
  }

  async function abortScheduleRun(runId: string) {
    const result = await options.getClient().abortProjectScheduleRun(options.currentProjectId(), runId)
    options.addMessage('event', `schedule run ${result.run.status}: ${runId.slice(0, 8)}`)
    selectedScheduleId.value = result.run.scheduleId
    selectedScheduleRunId.value = result.run.id
    await Promise.all([loadSchedules(), options.loadWorkflowRuns(), options.loadRuns()])
  }

  return {
    schedules,
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
  }
}
