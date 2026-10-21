<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="!saving && emit('close')">
      <section class="dialog create-project-asset" role="dialog" aria-modal="true" aria-labelledby="project-create-title">
        <header class="create-head"><h2 id="project-create-title">新增项目{{ label }}</h2><button type="button" class="btn btn-icon" :disabled="saving" aria-label="关闭" @click="emit('close')"><X :size="16" /></button></header>
        <div class="create-body">
          <label class="field"><span class="field-label">{{ kind === 'scene' ? '场景名称' : '名称' }}</span><input v-model="draft.name" class="input" :disabled="saving" /></label>
          <template v-if="kind === 'character'">
            <label class="field"><span class="field-label">角色定位</span><input v-model="draft.role" class="input" :disabled="saving" /></label>
            <label class="field"><span class="field-label">样貌</span><textarea v-model="draft.appearance" class="textarea" rows="2" :disabled="saving" /></label>
            <label class="field"><span class="field-label">妆造</span><textarea v-model="draft.styling" class="textarea" rows="2" :disabled="saving" /></label>
          </template>
          <template v-else-if="kind === 'scene'">
            <label class="field"><span class="field-label">时间</span><input v-model="draft.time" class="input" :disabled="saving" /></label>
            <label class="field"><span class="field-label">光影</span><input v-model="draft.lighting" class="input" :disabled="saving" /></label>
          </template>
          <label v-else class="field"><span class="field-label">道具类型</span><input v-model="draft.type" class="input" :disabled="saving" /></label>
          <label class="field"><span class="field-label">描述</span><textarea v-model="draft.description" class="textarea" rows="3" :disabled="saving" /></label>
          <div class="create-upload"><button type="button" class="btn" :disabled="saving" @click="fileInput?.click()"><Upload :size="13" />{{ file ? '更换图片' : '上传图片' }}</button><span>{{ file?.name || '可稍后添加图片' }}</span><input ref="fileInput" hidden type="file" accept=".jpg,.jpeg,.png,.webp" @change="selectFile" /></div>
          <img v-if="preview" :src="preview" class="create-preview" alt="素材预览" />
          <p v-if="error" class="create-error" role="alert">{{ error }}</p>
        </div>
        <footer class="create-foot"><button type="button" class="btn" :disabled="saving" @click="emit('close')">取消</button><button type="button" class="btn btn-primary" :disabled="saving || !draft.name.trim()" @click="save"><Loader2 v-if="saving" :size="13" class="animate-spin" /><Plus v-else :size="13" />保存到项目</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { X, Upload, Loader2, Plus } from 'lucide-vue-next'
import { characterAPI, sceneAPI, propAPI, uploadAPI } from '~/composables/useApi'
const props = defineProps({ open: Boolean, kind: String, dramaId: Number })
const emit = defineEmits(['close', 'saved'])
const label = computed(() => ({ character: '角色', scene: '场景', prop: '道具' }[props.kind] || '素材'))
const draft = ref({ name: '', role: '', appearance: '', styling: '', time: '', lighting: '', type: '', description: '' })
const saving = ref(false), error = ref(''), fileInput = ref(null), file = ref(null), preview = ref('')
let createdId = 0, uploadedPath = ''
function clearPreview() { if (preview.value) URL.revokeObjectURL(preview.value); preview.value = '' }
watch(() => props.open, open => {
  if (!open) { clearPreview(); return }
  draft.value = { name: '', role: '', appearance: '', styling: '', time: '', lighting: '', type: '', description: '' }
  error.value = ''; file.value = null; createdId = 0; uploadedPath = ''
})
function onKeydown(event) { if (props.open && event.key === 'Escape' && !saving.value) emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => { clearPreview(); window.removeEventListener('keydown', onKeydown) })
function selectFile(event) {
  file.value = event.target.files?.[0] || null; event.target.value = ''
  clearPreview(); uploadedPath = ''
  if (file.value) preview.value = URL.createObjectURL(file.value)
}
async function save() {
  if (saving.value || !draft.value.name.trim()) return
  saving.value = true; error.value = ''
  try {
    const api = props.kind === 'character' ? characterAPI : props.kind === 'scene' ? sceneAPI : propAPI
    const d = draft.value
    const body = props.kind === 'character'
      ? { name: d.name.trim(), role: d.role, appearance: d.appearance, styling: d.styling, description: d.description }
      : props.kind === 'scene'
        ? { location: d.name.trim(), time: d.time, prompt: d.description || d.name.trim(), lighting: d.lighting }
        : { name: d.name.trim(), type: d.type, description: d.description }
    if (file.value && !uploadedPath) uploadedPath = (await uploadAPI.image(file.value)).path
    if (!createdId) createdId = (await api.create({ drama_id: props.dramaId, ...body })).id
    if (uploadedPath) await api.update(createdId, { ...body, image_url: uploadedPath, local_path: uploadedPath })
    else await api.update(createdId, body)
    emit('saved'); emit('close')
  } catch (e) { error.value = e.message || '项目素材保存失败' }
  finally { saving.value = false }
}
</script>

<style scoped>
.create-project-asset { width: min(560px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: hidden; }
.create-head, .create-foot { display: flex; align-items: center; gap: 10px; padding: 12px 16px; flex-shrink: 0; }
.create-head { justify-content: space-between; border-bottom: 1px solid var(--border); }
.create-head h2 { font-size: 16px; margin: 0; }
.create-body { display: flex; flex-direction: column; gap: 12px; padding: 16px; overflow-y: auto; }
.create-upload { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.create-upload span { font-size: 11px; color: var(--text-3); overflow-wrap: anywhere; }
.create-preview { width: 100%; max-height: 180px; object-fit: contain; }
.create-error { margin: 0; color: var(--error); font-size: 12px; }
.create-foot { justify-content: flex-end; border-top: 1px solid var(--border); }
</style>
