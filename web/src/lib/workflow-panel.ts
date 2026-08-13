import { computed, ref } from 'vue'
import type {
  StartWorkflowRequest,
  WorkflowArtifact,
  WorkflowBackendInfo,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStage,
  WorkflowTask,
  ZuuClient,
} from '@zuu/client'

interface WorkflowStageRow {
  stage: WorkflowStage
  tasks: WorkflowTask[]
}

interface WorkflowPromptContext {
  sessionId?: string
  tools: string[]
  modelLabel?: string
}

interface WorkflowPanelOptions {
  getClient: () => ZuuClient
  currentProjectId: () => string
  promptContext: () => WorkflowPromptContext
  addMessage: (role: 'event', text?: string) => unknown
}

export function useWorkflowPanel(options: WorkflowPanelOptions) {
  const workflows = ref<WorkflowDefinition[]>([])
  const workflowBackend = ref<WorkflowBackendInfo>()
  const workflowRuns = ref<WorkflowRun[]>([])
  const selectedWorkflowId = ref('')
  const selectedWorkflowRunId = ref('')
  const workflowRunStages = ref<WorkflowStage[]>([])
  const workflowRunTasks = ref<WorkflowTask[]>([])
  const workflowRunArtifacts = ref<WorkflowArtifact[]>([])
  const workflowPrompt = ref('Review the current Zuu agent platform slice and produce a workflow artifact.')
  const isLoadingWorkflowRunDetail = ref(false)
  const selectedWorkflow = computed(() => workflows.value.find((workflow) => workflow.id === selectedWorkflowId.value))
  const currentProjectWorkflowRuns = computed(() =>
    workflowRuns.value.filter((run) => run.projectId === options.currentProjectId()),
  )
  const selectedWorkflowRun = computed(() =>
    currentProjectWorkflowRuns.value.find((run) => run.id === selectedWorkflowRunId.value),
  )
  const workflowStageRows = computed<WorkflowStageRow[]>(() =>
    workflowRunStages.value.map((stage) => ({
      stage,
      tasks: workflowRunTasks.value.filter((task) => task.stageId === stage.id),
    })),
  )
  const workflowUnstagedTasks = computed(() => {
    const stageIds = new Set(workflowRunStages.value.map((stage) => stage.id))
    return workflowRunTasks.value.filter((task) => !stageIds.has(task.stageId))
  })

  async function loadWorkflows() {
    const response = await options.getClient().listProjectWorkflows(options.currentProjectId())
    workflows.value = response.workflows
    workflowBackend.value = response.backend
    if (!selectedWorkflowId.value && workflows.value[0]) {
      selectedWorkflowId.value = workflows.value[0].id
    }
  }

  function clearWorkflowRunDetail() {
    selectedWorkflowRunId.value = ''
    workflowRunStages.value = []
    workflowRunTasks.value = []
    workflowRunArtifacts.value = []
  }

  async function loadWorkflowRuns() {
    workflowRuns.value = (await options.getClient().listProjectWorkflowRuns(options.currentProjectId())).runs
    const nextRunId =
      currentProjectWorkflowRuns.value.find((run) => run.id === selectedWorkflowRunId.value)?.id ||
      currentProjectWorkflowRuns.value[0]?.id ||
      ''
    if (!nextRunId) {
      clearWorkflowRunDetail()
      return
    }
    await loadWorkflowRunDetail(nextRunId)
  }

  async function loadWorkflowRunDetail(runId = selectedWorkflowRunId.value) {
    if (!runId) {
      clearWorkflowRunDetail()
      return
    }

    const projectId = options.currentProjectId()
    selectedWorkflowRunId.value = runId
    isLoadingWorkflowRunDetail.value = true
    try {
      const [runResponse, stagesResponse, tasksResponse] = await Promise.all([
        options.getClient().getProjectWorkflowRun(projectId, runId),
        options.getClient().listProjectWorkflowStages(projectId, runId),
        options.getClient().listProjectWorkflowTasks(projectId, runId),
      ])
      const artifacts = await Promise.all(
        runResponse.run.artifacts.slice(0, 8).map(async (artifact) => {
          const response = await options.getClient().getProjectWorkflowArtifact(projectId, artifact.id)
          return response.artifact
        }),
      )
      if (selectedWorkflowRunId.value !== runId || options.currentProjectId() !== projectId) return
      workflowRuns.value = [runResponse.run, ...workflowRuns.value.filter((run) => run.id !== runResponse.run.id)].sort((a, b) =>
        b.startedAt.localeCompare(a.startedAt),
      )
      workflowRunStages.value = stagesResponse.stages
      workflowRunTasks.value = tasksResponse.tasks
      workflowRunArtifacts.value = artifacts
    } finally {
      if (selectedWorkflowRunId.value === runId) {
        isLoadingWorkflowRunDetail.value = false
      }
    }
  }

  async function startWorkflow() {
    if (!selectedWorkflowId.value) return
    const context = options.promptContext()
    const request: StartWorkflowRequest = {
      prompt: workflowPrompt.value.trim() || undefined,
      sessionId: context.sessionId,
      inputs: {
        tools: context.tools,
        model: context.modelLabel,
      },
    }
    const result = await options.getClient().startProjectWorkflow(options.currentProjectId(), selectedWorkflowId.value, request)
    options.addMessage('event', `workflow ${result.run.status}: ${result.run.workflowName} (${result.run.id.slice(0, 8)})`)
    selectedWorkflowRunId.value = result.run.id
    await loadWorkflowRuns()
  }

  async function abortWorkflowRun(runId: string) {
    const result = await options.getClient().abortProjectWorkflowRun(options.currentProjectId(), runId)
    options.addMessage('event', `workflow ${result.run.status}: ${result.run.workflowName}`)
    selectedWorkflowRunId.value = result.run.id
    await loadWorkflowRuns()
  }

  return {
    workflows,
    workflowBackend,
    workflowRuns,
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
    clearWorkflowRunDetail,
    loadWorkflowRuns,
    loadWorkflowRunDetail,
    startWorkflow,
    abortWorkflowRun,
  }
}
