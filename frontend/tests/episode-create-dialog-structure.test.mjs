import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('add episode dialog asks for a title and a fixed video resolution', () => {
  const page = read('app/views/drama/detail.vue')

  // 删除图片/视频服务选择 UI
  assert.doesNotMatch(page, /图片生成服务/)
  assert.doesNotMatch(page, /视频生成服务/)
  assert.doesNotMatch(page, /svc-card/)
  assert.doesNotMatch(page, /svc-pick/)
  assert.doesNotMatch(page, /imageConfigs|videoConfigs/)
  assert.doesNotMatch(page, /配置将锁定/)
  assert.doesNotMatch(page, /创建并锁定配置/)

  // 保留标题输入与提交
  assert.match(page, /v-model="newEpisodeTitle"/)
  assert.match(page, /detail\.epCreate\.titlePlaceholder/)
  assert.match(page, /detail\.epCreate\.titleHint/)
  assert.match(page, /detail\.epCreate\.lockCopy/)
  assert.match(page, /creatingEpisode \? t\('detail\.epCreate\.creating'\) : t\('detail\.epCreate\.create'\)/)

  // 视频分辨率：创建集时固定（480p/720p，默认 480p）
  assert.match(page, /v-model="newEpisodeResolution"/)
  assert.match(page, /const resolutionOptions = computed\(\(\) => \(\[/)
  assert.match(page, /detail\.ep\.res720/)
  assert.match(page, /detail\.ep\.res480/)
  assert.match(page, /newEpisodeResolution = ref\('480p'\)/)
  assert.match(page, /detail\.epCreate\.resolutionHint/)
})

test('addEpisode posts drama_id, title and resolution', () => {
  const page = read('app/views/drama/detail.vue')

  const addEpisodeBody = page.slice(page.indexOf('async function addEpisode'), page.indexOf('onMounted(load)'))
  assert.match(addEpisodeBody, /drama_id: dramaId/)
  assert.match(addEpisodeBody, /title: newEpisodeTitle\.value/)
  assert.match(addEpisodeBody, /resolution: newEpisodeResolution\.value/)
  assert.doesNotMatch(addEpisodeBody, /image_config_id/)
  assert.doesNotMatch(addEpisodeBody, /video_config_id/)
  assert.doesNotMatch(addEpisodeBody, /aiConfigAPI/)
})

test('episode card resolution is editable via a dropdown persisted to episodes.resolution', () => {
  const page = read('app/views/drama/detail.vue')

  // 卡片上的分辨率标签 + 下拉修改
  assert.match(page, /detail\.ep\.resTitle/)
  assert.match(page, /epResMenuId/)
  assert.match(page, /function epResolution\(ep\) \{ return ep\.resolution === '480p' \? '480p' : '720p' \}/)
  assert.match(page, /function setEpisodeResolution/)
  assert.match(page, /episodeAPI\.update\(ep\.id, \{ resolution \}\)/)
})

test('add episode dialog does not preload config lists', () => {
  const page = read('app/views/drama/detail.vue')

  assert.doesNotMatch(page, /loadConfigs/)
  assert.doesNotMatch(page, /aiConfigAPI\.list/)
  assert.doesNotMatch(page, /canCreateEpisode/)
})
