<template>
  <section class="project-audio-library">
    <header class="audio-library-head">
      <h3>{{ selectMode ? '选择项目参考音频' : '参考音频' }}</h3>
      <button v-if="!selectMode" type="button" class="btn btn-sm" :disabled="busy" @click="fileInput?.click()"><Loader2 v-if="busy" :size="13" class="animate-spin" /><Upload v-else :size="13" />上传音频</button>
      <button v-else type="button" class="btn btn-sm" :disabled="busy" @click="navigateTo({ path: `/drama/${projectId}`, query: { tab: 'assets', asset_kind: 'audio' } })"><FolderKanban :size="13" />项目音频库</button>
      <input ref="fileInput" hidden type="file" accept=".mp3,.wav,.m4a,.aac" @change="upload" />
    </header>
    <input v-model="search" class="input audio-search" placeholder="搜索音频名称" aria-label="搜索音频名称" />
    <p v-if="loading" class="audio-message">正在加载音频…</p>
    <p v-else-if="!filtered.length" class="audio-message">{{ search ? '没有匹配的音频' : '项目中暂无参考音频' }}</p>
    <div class="project-audio-list">
      <article v-for="asset in filtered" :key="asset.id" class="project-audio-row">
        <input v-if="selectMode" v-model="selected" type="checkbox" :value="asset.id" :aria-label="asset.name" :disabled="busy || !asset.available || (!selected.includes(asset.id) && selected.length >= 3)" />
        <Music2 v-else :size="18" />
        <div class="project-audio-main">
          <div class="project-audio-title">
            <input v-if="editingId === asset.id" v-model="editName" class="input" aria-label="音频名称" maxlength="120" @keydown.enter.prevent="rename(asset)" />
            <strong v-else>{{ asset.name }}</strong>
            <span>{{ asset.available ? `${asset.reference_count || 0} 个镜头引用` : '文件不可用' }}</span>
          </div>
          <audio v-if="asset.available" :src="mediaUrl(asset.url)" controls preload="metadata" />
        </div>
        <div v-if="!selectMode" class="project-audio-actions">
          <button v-if="editingId === asset.id" type="button" class="btn btn-icon btn-sm" title="保存名称" aria-label="保存名称" :disabled="busy" @click="rename(asset)"><Check :size="14" /></button>
          <button v-else type="button" class="btn btn-icon btn-sm" title="重命名" aria-label="重命名" :disabled="busy" @click="editingId = asset.id; editName = asset.name"><Pencil :size="14" /></button>
          <button type="button" class="btn btn-icon btn-sm" title="从项目移除音频" aria-label="从项目移除音频" :disabled="busy || asset.reference_count > 0" @click="deleteTarget = asset"><Trash2 :size="14" /></button>
        </div>
      </article>
    </div>
    <p v-if="error" class="audio-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="audio-notice" role="status">{{ notice }}</p>
    <footer v-if="selectMode" class="audio-selection-foot">
      <span>{{ selected.length }}/3 已选</span>
      <button type="button" class="btn" :disabled="busy" @click="emit('close')">取消</button>
      <button type="button" class="btn btn-primary" :disabled="busy || loading" @click="saveSelection"><Loader2 v-if="busy" :size="13" class="animate-spin" /><Link2 v-else :size="13" />保存引用</button>
    </footer>
    <ConfirmDialog :open="!!deleteTarget" title="移除项目音频" :message="`确定从项目移除「${deleteTarget?.name || ''}」？原始文件和历史任务保留。`" :loading="busy" @cancel="deleteTarget = null" @confirm="remove" />
  </section>
</template>

<script setup>
import { Music2, Upload, Loader2, Pencil, Trash2, Check, Link2, FolderKanban } from 'lucide-vue-next'
import { assetLibraryAPI, uploadAPI } from '~/composables/useApi'
const props = defineProps({ projectId: Number, mediaUrl: Function, selectMode: Boolean, storyboardId: Number, currentUrls: { type: Array, default: () => [] } })
const emit = defineEmits(['saved', 'close', 'changed'])
const assets = ref([]), selected = ref([]), search = ref(''), error = ref(''), notice = ref('')
const loading = ref(false), busy = ref(false), fileInput = ref(null), editingId = ref(0), editName = ref(''), deleteTarget = ref(null)
const filtered = computed(() => assets.value.filter(asset => String(asset.name || '').toLowerCase().includes(search.value.trim().toLowerCase())))
async function load() {
  loading.value = true
  try {
    assets.value = await assetLibraryAPI.audio(props.projectId)
    if (props.selectMode) selected.value = assets.value.filter(asset => props.currentUrls.includes(asset.url)).map(asset => asset.id)
  } catch (e) { error.value = e.message || '音频加载失败' }
  finally { loading.value = false }
}
onMounted(load)
watch(() => props.projectId, load)
async function upload(event) {
  const file = event.target.files?.[0]; event.target.value = ''
  if (!file || busy.value) return
  if (file.size > 20 * 1024 * 1024) { error.value = '音频文件不能超过 20MB'; return }
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const uploaded = await uploadAPI.audio(file)
    const asset = await assetLibraryAPI.addAudio(props.projectId, { name: file.name, path: uploaded.path })
    notice.value = asset.reused ? '已复用项目中相同的音频' : '音频已保存到项目，各镜头可引用'
    await load(); emit('changed')
  } catch (e) { error.value = e.message || '上传音频失败' }
  finally { busy.value = false }
}
async function rename(asset) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await assetLibraryAPI.renameAudio(props.projectId, asset.id, editName.value); editingId.value = 0; await load() }
  catch (e) { error.value = e.message || '重命名失败' }
  finally { busy.value = false }
}
async function remove() {
  if (!deleteTarget.value || busy.value) return
  busy.value = true; error.value = ''
  try { await assetLibraryAPI.deleteAudio(props.projectId, deleteTarget.value.id); deleteTarget.value = null; await load(); emit('changed') }
  catch (e) { error.value = e.message || '移除失败'; deleteTarget.value = null }
  finally { busy.value = false }
}
async function saveSelection() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { const result = await assetLibraryAPI.setShotAudio(props.storyboardId, selected.value); emit('saved', result.reference_audio_urls); emit('close') }
  catch (e) { error.value = e.message || '保存音频引用失败' }
  finally { busy.value = false }
}
</script>

<style scoped>
.project-audio-library { min-width: 0; }
.audio-library-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.audio-library-head h3 { margin: 0 auto 0 0; font-size: 14px; }
.audio-search { width: 100%; margin-bottom: 12px; }
.audio-message { font-size: 12px; color: var(--text-3); }
.project-audio-list { display: flex; flex-direction: column; }
.project-audio-row { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.project-audio-main { min-width: 0; }
.project-audio-title { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-bottom: 6px; align-items: center; }
.project-audio-title strong { font-size: 12px; overflow-wrap: anywhere; }
.project-audio-title span { font-size: 11px; color: var(--text-3); }
.project-audio-title .input { width: 100%; }
.project-audio-main audio { width: min(100%, 440px); height: 34px; }
.project-audio-actions { display: flex; gap: 4px; }
.audio-error { color: var(--error); font-size: 12px; overflow-wrap: anywhere; }
.audio-notice { color: var(--success); font-size: 12px; }
.audio-selection-foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding-top: 14px; }
.audio-selection-foot > span { margin-right: auto; color: var(--text-3); font-size: 12px; }
@media(max-width:480px) { .project-audio-row { grid-template-columns: 20px minmax(0, 1fr); } .project-audio-actions { grid-column: 2; } }
</style>
