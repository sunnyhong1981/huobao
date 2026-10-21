<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="!saving && emit('close')">
      <section class="dialog project-picker" role="dialog" aria-modal="true" aria-labelledby="project-picker-title">
        <header class="picker-head">
          <h2 id="project-picker-title">选择项目{{ kindLabel }}</h2>
          <button type="button" class="btn btn-icon" :disabled="saving" aria-label="关闭" @click="emit('close')"><X :size="16" /></button>
        </header>
        <div class="picker-search"><Search :size="15" /><input v-model="search" class="input" placeholder="搜索素材名称" aria-label="搜索素材名称" /></div>
        <div class="picker-list">
          <p v-if="loading" class="picker-message"><Loader2 :size="16" class="animate-spin" />正在加载项目素材…</p>
          <p v-else-if="!filtered.length" class="picker-message">{{ search ? '没有匹配的素材' : '项目中还没有这类素材' }}</p>
          <label v-for="asset in filtered" :key="asset.id" class="picker-row" :class="{ linked: linkedIds.includes(asset.id) }">
            <input v-model="selected" type="checkbox" :value="asset.id" :disabled="saving || linkedIds.includes(asset.id)" :aria-label="asset.name || asset.location" />
            <img v-if="imageUrl(asset)" :src="mediaUrl(imageUrl(asset))" :alt="asset.name || asset.location" loading="lazy" />
            <div v-else class="picker-no-image"><Image :size="22" /></div>
            <span class="picker-copy"><strong>{{ asset.name || asset.location }}</strong><small>{{ asset.appearance || asset.prompt || asset.description || '暂无描述' }}</small></span>
            <span v-if="linkedIds.includes(asset.id)" class="picker-linked">已在本集</span>
          </label>
        </div>
        <p v-if="error" class="picker-error" role="alert">{{ error }}</p>
        <footer class="picker-foot">
          <button type="button" class="btn" :disabled="saving" @click="emit('close')">取消</button>
          <button type="button" class="btn btn-primary" :disabled="saving || !selected.length" @click="save"><Loader2 v-if="saving" :size="13" class="animate-spin" /><Link2 v-else :size="13" />{{ saving ? '正在准备素材…' : `添加到本集（${selected.length}）` }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { X, Search, Image, Loader2, Link2 } from 'lucide-vue-next'
import { dramaAPI, episodeAPI } from '~/composables/useApi'
const props = defineProps({ open: Boolean, kind: String, dramaId: Number, episodeId: Number, linkedIds: { type: Array, default: () => [] }, mediaUrl: Function })
const emit = defineEmits(['close', 'saved'])
const assets = ref([]), selected = ref([]), search = ref(''), error = ref(''), loading = ref(false), saving = ref(false)
const kindLabel = computed(() => ({ character: '角色', scene: '场景', prop: '道具' }[props.kind] || '素材'))
const filtered = computed(() => assets.value.filter(asset => `${asset.name || asset.location || ''} ${asset.appearance || asset.description || ''}`.includes(search.value.trim())))
let loadVersion = 0
function onKeydown(event) { if (props.open && event.key === 'Escape' && !saving.value) emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => { loadVersion++; window.removeEventListener('keydown', onKeydown) })
watch(() => [props.open, props.kind], async ([open]) => {
  const version = ++loadVersion
  if (!open) return
  selected.value = []; search.value = ''; error.value = ''; assets.value = []; loading.value = true
  try {
    const project = await dramaAPI.get(props.dramaId)
    if (version !== loadVersion) return
    const key = { character: 'characters', scene: 'scenes', prop: 'props' }[props.kind]
    assets.value = (project[key] || []).filter(asset => !asset.deleted_at && !asset.deletedAt)
  } catch (e) { if (version === loadVersion) error.value = e.message || '项目素材加载失败' }
  finally { if (version === loadVersion) loading.value = false }
})
function imageUrl(asset) { return asset.image_url || asset.imageUrl || asset.local_path || asset.localPath || '' }
async function save() {
  if (saving.value || !selected.value.length) return
  saving.value = true; error.value = ''
  try {
    for (const id of selected.value) await episodeAPI.linkAsset(props.episodeId, props.kind, id)
    emit('saved'); emit('close')
  } catch (e) { error.value = e.message || '关联素材失败'; emit('saved') }
  finally { saving.value = false }
}
</script>

<style scoped>
.project-picker { width: min(720px, calc(100vw - 32px)); max-height: calc(100dvh - 40px); overflow: hidden; }
.picker-head, .picker-foot { display: flex; align-items: center; gap: 10px; padding: 12px 16px; flex-shrink: 0; }
.picker-head { justify-content: space-between; border-bottom: 1px solid var(--border); }
.picker-head h2 { margin: 0; font-size: 16px; }
.picker-search { display: flex; align-items: center; gap: 8px; padding: 12px 16px; flex-shrink: 0; }
.picker-search .input { flex: 1; min-width: 0; }
.picker-list { overflow-y: auto; min-height: 100px; max-height: 55vh; padding: 0 16px 12px; }
.picker-row { display: grid; grid-template-columns: 16px 72px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); cursor: pointer; }
.picker-row img, .picker-no-image { width: 72px; height: 56px; object-fit: contain; border-radius: 4px; background: var(--bg-2); }
.picker-no-image { display: flex; align-items: center; justify-content: center; color: var(--text-3); }
.picker-copy { display: flex; flex-direction: column; min-width: 0; gap: 5px; }
.picker-copy strong { font-size: 13px; overflow-wrap: anywhere; }
.picker-copy small { font-size: 11px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.picker-linked { color: var(--success); font-size: 11px; white-space: nowrap; }
.picker-message { display: flex; align-items: center; gap: 8px; color: var(--text-3); font-size: 12px; }
.picker-error { margin: 0; padding: 8px 16px; color: var(--error); font-size: 12px; }
.picker-foot { justify-content: flex-end; border-top: 1px solid var(--border); }
@media(max-width:480px) { .picker-row { grid-template-columns: 16px 56px minmax(0, 1fr); } .picker-row img, .picker-no-image { width: 56px; height: 48px; } .picker-linked { grid-column: 3; } }
</style>
