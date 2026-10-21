<template>
  <Teleport to="body">
    <div v-if="open" class="overlay">
      <section class="dialog project-audio-picker" role="dialog" aria-modal="true" aria-label="选择项目参考音频">
        <ProjectAudioLibrary :project-id="projectId" :storyboard-id="storyboardId" :current-urls="currentUrls" :media-url="mediaUrl" select-mode @saved="urls => emit('saved', urls)" @close="emit('close')" />
      </section>
    </div>
  </Teleport>
</template>
<script setup>
defineProps({ open: Boolean, projectId: Number, storyboardId: Number, currentUrls: Array, mediaUrl: Function })
const emit = defineEmits(['close', 'saved'])
</script>
<style scoped>
.project-audio-picker { width: min(650px, calc(100vw - 32px)); max-height: calc(100dvh - 40px); overflow-y: auto; padding: 16px; }
</style>
