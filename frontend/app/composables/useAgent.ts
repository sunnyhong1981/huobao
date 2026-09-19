import { toast } from 'vue-sonner'
import { api } from './useApi'
import { toastError } from './useToast'
import { i18n } from './i18n'

export function useAgent() {
  const running = ref(false)
  const runningType = ref<string | null>(null)

  async function run(type: string, msg: string, dramaId: number, episodeId: number, onDone?: () => void, model?: string, configId?: number) {
    if (running.value) { toast.warning(i18n.global.t('composables.agent.busy')); return }
    running.value = true
    runningType.value = type
    try {
      const data = await api.post<any>(`/agent/${type}/chat`, {
        message: msg,
        drama_id: dramaId,
        episode_id: episodeId,
        model: model || undefined,
        config_id: configId || undefined,
      })
      toast.success(i18n.global.t('composables.agent.done'))
      onDone?.()
    } catch (err: any) {
      toastError(err)
    } finally {
      running.value = false
      runningType.value = null
    }
  }

  async function runInBackground(type: string, msg: string, dramaId: number, episodeId: number, onDone?: () => void | Promise<void>, model?: string, configId?: number) {
    if (running.value) { toast.warning(i18n.global.t('composables.agent.busy')); return }
    running.value = true
    runningType.value = type
    try {
      const job = await api.post<any>(`/agent/${type}/start`, {
        message: msg,
        drama_id: dramaId,
        episode_id: episodeId,
        model: model || undefined,
        config_id: configId || undefined,
      })
      if (!job?.job_id) throw new Error('Agent task was not created')
      toast.info(i18n.global.t('composables.agent.started'))

      for (let i = 0; i < 360; i++) {
        await new Promise(resolve => setTimeout(resolve, 2500))
        let status: any
        try {
          status = await api.get<any>(`/agent/${type}/jobs/${job.job_id}`)
        } catch {
          // 轮询自身的短暂网络失败不影响已在服务端运行的 Agent 任务。
          continue
        }
        if (status?.status === 'completed') {
          await onDone?.()
          toast.success(i18n.global.t('composables.agent.done'))
          return
        }
        if (status?.status === 'failed') {
          throw new Error(status.error_msg || status.errorMsg || 'Agent execution failed')
        }
      }
      toast.error(i18n.global.t('composables.agent.timeout'))
    } catch (err: any) {
      toastError(err)
    } finally {
      running.value = false
      runningType.value = null
    }
  }

  return { running, runningType, run, runInBackground }
}
