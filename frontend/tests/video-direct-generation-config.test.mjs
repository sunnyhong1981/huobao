import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const settingsPage = readFileSync(new URL('../app/pages/settings.vue', import.meta.url), 'utf8')
const episodePage = readFileSync(new URL('../app/views/drama/episode.vue', import.meta.url), 'utf8')
const aiConfigRoute = readFileSync(new URL('../../backend/src/routes/aiConfigs.ts', import.meta.url), 'utf8')
const volcengineAdapter = readFileSync(new URL('../../backend/src/services/adapters/volcengine-video.ts', import.meta.url), 'utf8')

test('video presets default to direct Seedance 2.0 generation', () => {
  const combined = `${settingsPage}\n${aiConfigRoute}\n${volcengineAdapter}`
  assert.doesNotMatch(combined, /doubao-seedance-1-5-pro-251215/)
  assert.match(settingsPage, /Seedance 2\.0/)
  assert.match(settingsPage, /doubao-seedance-2-0-260128/)
  assert.match(settingsPage, /doubao-seedance-2-0-fast-260128/)
  assert.match(settingsPage, /doubao-seedance-2-0-mini-260615/)
})

test('video presets use official provider endpoints', () => {
  const presetsStart = settingsPage.indexOf('const providerPresets = {')
  const quickStart = settingsPage.indexOf('const huobaoQuickConfigs = [')
  const providerPresets = settingsPage.slice(presetsStart, quickStart)
  assert.doesNotMatch(providerPresets, /api\.firemux\.com/)
  assert.match(settingsPage, /https:\/\/ark\.cn-beijing\.volces\.com/)
  assert.match(providerPresets, /https:\/\/\{WorkspaceId\}\.cn-beijing\.maas\.aliyuncs\.com/)
  assert.doesNotMatch(settingsPage, /https:\/\/dashscope\.aliyuncs\.com/)
  assert.doesNotMatch(settingsPage, /https:\/\/api\.vidu\.com/)
})

test('Wan 3.0 quick preset targets the Qwen gateway namespace', () => {
  const quickStart = settingsPage.indexOf('const huobaoQuickConfigs = [')
  const quickConfigs = settingsPage.slice(quickStart)
  assert.match(quickConfigs, /provider:\s*'aliyun'.*base_url:\s*'https:\/\/api\.firemux\.com\/qwen'.*wan3\.0-video-prime.*wan3\.0-video/s)
})

test('video task errors expose unavailable reference asset guidance', () => {
  assert.match(episodePage, /asset reference is unavailable or not owned by the current user/i)
  assert.match(episodePage, /episode\.vid\.referenceAssetUnavailable/)
  assert.match(episodePage, /videoFailureMessage\(task\.error\)/)
  assert.match(episodePage, /row\.kind === 'video' \? videoFailureMessage\(row\.errorMsg\)/)
})

test('Seedance requests replace stale role asset URIs on the backend', () => {
  assert.match(volcengineAdapter, /video\/generations/)
  const generationService = readFileSync(new URL('../../backend/src/services/generation.ts', import.meta.url), 'utf8')
  assert.match(generationService, /missingCharacterAssets/)
  assert.match(generationService, /A stale page can submit the previous asset URI directly/)
  assert.match(generationService, /currentCharacterAssetUrls\.includes\(value\)/)
})

test('video inspector saves and submits per-shot reference audio', () => {
  assert.match(episodePage, /REFERENCE_AUDIO_LIMIT = 3/)
  assert.match(episodePage, /function storyboardReferenceAudioUrls/)
  assert.match(episodePage, /uploadStoryboardReferenceAudio/)
  assert.match(episodePage, /reference_audio_urls: referenceAudioUrls/)
  assert.match(episodePage, /<ProjectAudioPicker/)
})

test('episode references centralize image management in the project library', () => {
  const template = episodePage.slice(0, episodePage.indexOf('<script setup>'))
  const references = readFileSync(new URL('../app/components/EpisodeProjectAssets.vue', import.meta.url), 'utf8')
  assert.match(template, /<EpisodeProjectAssets/)
  assert.doesNotMatch(template, /uploadAssetImage|uploadCharacterToAssetLibrary|genCharImg|genSceneImg|genPropImg|batchCharImages|batchSceneImages|batchPropImages/)
  assert.match(references, /管理项目素材/)
  assert.doesNotMatch(references, /上传|重绘/)
})
