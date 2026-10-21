<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="close">
      <section class="dialog redub-dialog" role="dialog" aria-modal="true" aria-labelledby="redub-title">
        <header class="redub-head">
          <h2 id="redub-title">重新配音</h2>
          <button type="button" class="btn btn-icon" :disabled="busy" title="关闭" aria-label="关闭" @click="close"><X :size="16" /></button>
        </header>
        <div class="redub-body">
          <video :key="resultUrl || sourceVideoUrl" :src="mediaUrl(resultUrl || sourceVideoUrl)" controls playsinline preload="metadata" @loadedmetadata="videoDuration = $event.target.duration" />
          <p class="redub-note">新配音将替换原视频的全部声音，包括背景音乐和环境声。画面和原视频保留，口型不作调整。</p>
          <div class="redub-upload">
            <button type="button" class="btn" :disabled="busy || uploading" @click="fileInput?.click()">
              <Loader2 v-if="uploading" :size="14" class="animate-spin" /><Upload v-else :size="14" />
              {{ audioUrl ? '更换配音' : '上传配音' }}
            </button>
            <span>MP3 / WAV / M4A / AAC · 最大 20MB</span>
            <input ref="fileInput" type="file" accept=".mp3,.wav,.m4a,.aac" hidden @change="uploadAudio" />
          </div>
          <div v-if="audioUrl" class="redub-audio">
            <span class="redub-filename" :title="audioName">{{ audioName }}</span>
            <audio :src="mediaUrl(audioUrl)" controls preload="metadata" @loadedmetadata="audioDuration = $event.target.duration" />
          </div>
          <div class="redub-options">
            <label class="field">
              <span class="field-label">配音起始时间（秒）</span>
              <input v-model.number="offsetSeconds" class="input" type="number" min="0" :max="Math.max(0, videoDuration - 0.01)" step="0.1" :disabled="busy" />
            </label>
            <label class="field">
              <span class="field-label">音量 {{ volume }}%</span>
              <input v-model.number="volume" type="range" min="0" max="200" step="5" :disabled="busy" />
            </label>
          </div>
          <p v-if="durationNote" class="redub-note">{{ durationNote }}</p>
          <p v-if="error" class="redub-error" role="alert">{{ error }}</p>
          <p v-if="busy" class="redub-note" role="status"><Loader2 :size="14" class="animate-spin" /> 正在处理配音…</p>
          <p v-if="resultUrl" class="redub-success" role="status">新版本已保存到历史视频，可试听后设为主视频。</p>
        </div>
        <footer class="redub-foot">
          <button type="button" class="btn" :disabled="busy" @click="close">关闭</button>
          <a v-if="resultUrl" :href="mediaUrl(resultUrl)" class="btn" download><Download :size="14" />下载新版本</a>
          <button type="button" class="btn btn-primary" :disabled="!audioUrl || uploading || busy" @click="start">
            <Mic :size="14" />{{ resultUrl ? '再次导出' : '导出配音版本' }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { X, Upload, Loader2, Download, Mic } from 'lucide-vue-next'
import { storyboardAPI, taskAPI, uploadAPI } from '~/composables/useApi'

const props = defineProps({
  open: Boolean,
  storyboardId: Number,
  sourceVideoUrl: { type: String, default: '' },
  mediaUrl: { type: Function, required: true },
})
const emit = defineEmits(['close', 'completed'])
const fileInput = ref(null)
const audioUrl = ref(''), audioName = ref(''), resultUrl = ref(''), error = ref('')
const uploading = ref(false), busy = ref(false)
const offsetSeconds = ref(0), volume = ref(100)
const videoDuration = ref(0), audioDuration = ref(0)
let pollTimer
let disposed = false

const durationNote = computed(() => {
  if (!audioDuration.value || !videoDuration.value) return ''
  const available = videoDuration.value - Number(offsetSeconds.value || 0)
  return audioDuration.value > available
    ? '配音超过视频长度，超出片尾的部分会截去。'
    : '配音结束后，剩余画面会补静音。'
})

watch(() => props.open, (open) => {
  if (!open) return
  audioUrl.value = ''; audioName.value = ''; resultUrl.value = ''; error.value = ''
  videoDuration.value = 0; audioDuration.value = 0
  offsetSeconds.value = 0; volume.value = 100
})

function close() {
  if (!busy.value && !uploading.value) emit('close')
}
function onKeydown(event) {
  if (props.open && event.key === 'Escape') close()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  disposed = true
  clearTimeout(pollTimer)
  window.removeEventListener('keydown', onKeydown)
})

async function uploadAudio(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (file.size > 20 * 1024 * 1024) { error.value = '配音文件不能超过 20MB'; return }
  uploading.value = true; error.value = ''
  try {
    const uploaded = await uploadAPI.audio(file)
    audioUrl.value = uploaded.path; audioName.value = file.name
    audioDuration.value = 0; resultUrl.value = ''
  } catch (e) { error.value = e.message || '配音上传失败' }
  finally { uploading.value = false }
}

async function start() {
  if (busy.value || uploading.value || !audioUrl.value) return
  const offset = Number(offsetSeconds.value)
  if (!Number.isFinite(offset) || offset < 0 || offset > 300 || (videoDuration.value && offset >= videoDuration.value)) {
    error.value = '配音起始时间必须在视频时长范围内'; return
  }
  busy.value = true; error.value = ''; resultUrl.value = ''
  const storyboardId = props.storyboardId
  try {
    const task = await storyboardAPI.redub(storyboardId, {
      source_video_url: props.sourceVideoUrl, audio_url: audioUrl.value,
      offset_seconds: offset, volume: Number(volume.value) / 100,
    })
    poll(task.task_id, storyboardId, Date.now())
  } catch (e) {
    busy.value = false; error.value = e.message || '重新配音失败'
  }
}

async function poll(taskId, storyboardId, startedAt) {
  if (disposed) return
  try {
    const task = await taskAPI.get(taskId)
    if (disposed) return
    if (task?.status === 'completed') {
      resultUrl.value = task.localPath || task.local_path || task.resultUrl || task.result_url || ''
      busy.value = false
      emit('completed', { storyboardId, url: resultUrl.value })
      return
    }
    if (task?.status === 'failed') {
      error.value = task.errorMsg || task.error_msg || '重新配音失败'; busy.value = false; return
    }
  } catch (e) {
    if (Date.now() - startedAt >= 360_000) {
      error.value = '状态查询失败，请在历史视频或任务列表中查看处理结果'; busy.value = false; return
    }
  }
  if (Date.now() - startedAt >= 360_000) {
    error.value = '处理时间较长，请在任务列表中查看状态'; busy.value = false; return
  }
  pollTimer = setTimeout(() => poll(taskId, storyboardId, startedAt), 1500)
}
</script>

<style scoped>
.redub-dialog { width: min(620px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: hidden; }
.redub-head, .redub-foot { display: flex; align-items: center; gap: 10px; padding: 12px 16px; flex-shrink: 0; }
.redub-head { justify-content: space-between; border-bottom: 1px solid var(--border); }
.redub-head h2 { margin: 0; font-size: 16px; }
.redub-body { padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.redub-body > video { width: 100%; aspect-ratio: 16/9; background: #111; object-fit: contain; max-height: 32vh; }
.redub-note { color: var(--text-3); font-size: 12px; line-height: 1.5; margin: 0; display: flex; gap: 6px; }
.redub-upload { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.redub-upload > span { color: var(--text-3); font-size: 11px; }
.redub-audio { display: flex; flex-direction: column; gap: 6px; }
.redub-audio audio { width: 100%; height: 36px; }
.redub-filename { font-size: 12px; overflow-wrap: anywhere; color: var(--text-2); }
.redub-options { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.redub-options .input, .redub-options input[type=range] { width: 100%; min-width: 0; }
.redub-error { margin: 0; color: var(--error); font-size: 12px; overflow-wrap: anywhere; }
.redub-success { margin: 0; color: var(--success); font-size: 12px; }
.redub-foot { justify-content: flex-end; border-top: 1px solid var(--border); flex-wrap: wrap; }
@media (max-width: 480px) { .redub-options { grid-template-columns: minmax(0, 1fr); gap: 10px; } }
</style>
