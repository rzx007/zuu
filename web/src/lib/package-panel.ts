import { computed, ref } from 'vue'
import type {
  PackageOperation,
  PackageOperationStartResponse,
  PackageSummary,
  ZuuClient,
} from '@zuu/client'
import { errorMessage } from '@/lib/format'

interface PackagePanelOptions {
  getClient: () => ZuuClient
  addMessage: (role: 'event' | 'error', text?: string) => unknown
  loadAuditEvents: () => Promise<unknown>
  loadDiagnostics: () => Promise<unknown>
  loadWorkflows: () => Promise<unknown>
}

export function usePackagePanel(options: PackagePanelOptions) {
  const packages = ref<PackageSummary[]>([])
  const packageOperations = ref<PackageOperation[]>([])
  const packageSource = ref('')
  const runningPackageOperations = computed(() => packageOperations.value.filter((operation) => operation.status === 'running'))
  let packageOperationPollId: number | undefined

  async function loadPackages() {
    const response = await options.getClient().listPackages()
    packages.value = response.packages
  }

  async function loadPackageOperations() {
    const response = await options.getClient().listPackageOperations()
    packageOperations.value = response.operations
    if (response.operations.some((operation) => operation.status === 'running')) {
      schedulePackageOperationPoll()
    }
  }

  async function addPackage() {
    const source = packageSource.value.trim()
    if (!source) return
    await options.getClient().addPackage({ source })
    packageSource.value = ''
    await Promise.all([loadPackages(), options.loadDiagnostics()])
    await options.loadAuditEvents()
  }

  async function installPackage(source: string) {
    await startPackageOperation(source, 'install', () => options.getClient().installPackage({ source }))
  }

  async function removePackage(source: string) {
    await startPackageOperation(source, 'remove', () => options.getClient().removePackage({ source }))
  }

  async function updatePackage(source: string) {
    await startPackageOperation(source, 'update', () => options.getClient().updatePackage({ source }))
  }

  async function trustPackage(source: string) {
    const response = await options.getClient().trustPackage({ source })
    packages.value = response.packages
    options.addMessage('event', `package trusted: ${source}`)
    await options.loadDiagnostics()
    await options.loadAuditEvents()
  }

  async function revokePackageTrust(source: string) {
    const response = await options.getClient().revokePackageTrust({ source })
    packages.value = response.packages
    options.addMessage('event', `package trust revoked: ${source}`)
    await options.loadDiagnostics()
    await options.loadAuditEvents()
  }

  function latestPackageOperation(source: string) {
    return packageOperations.value.find((operation) => operation.source === source)
  }

  function isPackageOperating(source: string) {
    return packageOperations.value.some((operation) => operation.source === source && operation.status === 'running')
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
        await Promise.all([loadPackageOperations(), loadPackages(), options.loadDiagnostics(), options.loadWorkflows()])
      } catch (error) {
        options.addMessage('error', errorMessage(error))
      }
    }, 1500)
  }

  async function startPackageOperation(
    source: string,
    action: PackageOperation['action'],
    start: () => Promise<PackageOperationStartResponse>,
  ) {
    const response = await start()
    packages.value = response.packages
    packageOperations.value = [
      response.operation,
      ...packageOperations.value.filter((operation) => operation.id !== response.operation.id),
    ]
    options.addMessage('event', `package ${action} started: ${source}`)
    schedulePackageOperationPoll()
    await Promise.all([loadPackageOperations(), options.loadDiagnostics(), options.loadWorkflows()])
    await options.loadAuditEvents()
  }

  return {
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
  }
}
