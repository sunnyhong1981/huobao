<template>
  <section v-for="group in groups" :key="group.kind" class="episode-project-assets">
    <header class="reference-group-head">
      <h3>{{ group.label }}</h3>
      <button type="button" class="btn btn-sm" @click="emit('select', group.kind)"><Link2 :size="12" />从项目选择</button>
    </header>
    <div v-if="!group.items.length" class="reference-group-empty">本集尚未引用{{ group.label }}</div>
    <div v-else class="project-reference-grid">
      <article v-for="asset in group.items" :key="asset.id" class="project-reference-item">
        <button type="button" class="reference-remove btn btn-icon btn-sm" title="移出本集" aria-label="移出本集" @click="emit('remove', group.kind, asset)"><X :size="13" /></button>
        <button type="button" class="reference-preview" :disabled="!imageSource(asset)" :aria-label="`预览${asset.name || asset.location}`" @click="emit('preview', imageSource(asset), asset.name || asset.location)">
          <img v-if="imageSource(asset)" :src="imageSource(asset)" :alt="asset.name || asset.location" loading="lazy" />
          <Image v-else :size="24" />
        </button>
        <div class="reference-info">
          <div class="reference-title"><strong>{{ asset.name || asset.location }}</strong><span class="reference-type">{{ asset.role || asset.type || asset.time || group.label }}</span></div>
          <span class="reference-state" :class="ready(asset, group.kind) ? 'available' : 'missing'">{{ stateLabel(asset, group.kind) }}</span>
          <p v-if="description(asset, group.kind)" class="reference-description">{{ description(asset, group.kind) }}</p>
          <button type="button" class="btn btn-ghost btn-sm reference-manage" @click="emit('manage', group.kind, asset)"><ArrowUpRight :size="12" />管理项目素材</button>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { Link2, X, Image, ArrowUpRight } from 'lucide-vue-next'
const props = defineProps({ characters: { type: Array, default: () => [] }, scenes: { type: Array, default: () => [] }, props: { type: Array, default: () => [] }, mediaUrl: { type: Function, required: true } })
const emit = defineEmits(['select', 'remove', 'preview', 'manage'])
const groups = computed(() => [
  { kind: 'character', label: '角色', items: props.characters },
  { kind: 'scene', label: '场景', items: props.scenes },
  { kind: 'prop', label: '道具', items: props.props },
])
function imageSource(asset) {
  const url = asset.image_url || asset.imageUrl || asset.local_path || asset.localPath
  return url ? props.mediaUrl(url) : ''
}
function ready(asset, kind) {
  if (kind !== 'character') return !!imageSource(asset)
  const status = asset.asset_library_status || asset.assetLibraryStatus
  return status === 'available' || (!status && /^asset:\/\//i.test(asset.seedance_asset_url || asset.seedanceAssetUrl || ''))
}
function stateLabel(asset, kind) {
  if (ready(asset, kind)) return '项目素材可用'
  if (kind !== 'character') return '项目素材缺少图片'
  const status = asset.asset_library_status || asset.assetLibraryStatus
  return status === 'processing' ? '项目素材处理中' : status === 'unknown' ? '项目素材状态待核验' : '项目素材未就绪'
}
function description(asset, kind) {
  if (kind === 'character') return [asset.appearance || asset.description, asset.styling].filter(Boolean).join(' · ')
  return asset.prompt || asset.description || ''
}
</script>

<style scoped>
.episode-project-assets { margin-bottom: 20px; }
.reference-group-head { display: flex; align-items: center; gap: 12px; padding: 8px 0 12px; }
.reference-group-head h3 { margin: 0; font-size: 13px; font-weight: 650; }
.reference-group-empty { font-size: 12px; color: var(--text-3); padding: 14px 0; }
.project-reference-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px; }
.project-reference-item { position: relative; min-width: 0; border: 1px solid var(--surface-outline); border-radius: 8px; overflow: hidden; background: var(--surface-raised); }
.reference-preview { display: flex; align-items: center; justify-content: center; width: 100%; aspect-ratio: 16/9; padding: 0; border: 0; border-bottom: 1px solid var(--border); background: var(--bg-2); color: var(--text-3); cursor: zoom-in; }
.reference-preview img { width: 100%; height: 100%; object-fit: contain; }
.reference-preview:disabled { cursor: default; }
.reference-remove { position: absolute; top: 7px; right: 7px; z-index: 1; width: 26px; height: 26px; background: var(--surface-raised); }
.reference-info { display: flex; flex-direction: column; gap: 8px; padding: 12px; }
.reference-title { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 7px; }
.reference-title strong { font-size: 13px; overflow-wrap: anywhere; }
.reference-type { font-size: 11px; color: var(--text-3); }
.reference-state { font-size: 11px; }
.reference-state.available { color: var(--success); }
.reference-state.missing { color: var(--error); }
.reference-description { margin: 0; font-size: 11px; line-height: 1.6; color: var(--text-3); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.reference-manage { align-self: flex-start; }
@media(max-width:540px) { .project-reference-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
