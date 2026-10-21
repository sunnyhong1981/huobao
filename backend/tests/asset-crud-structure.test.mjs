import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('characters route supports manual create and soft delete', () => {
  const route = read('src/routes/characters.ts')

  assert.match(route, /app\.post\('\/'/)
  assert.match(route, /name required/)
  // 传入 episode_id 时关联到该集
  assert.match(route, /insert\(schema\.episodeCharacters\)/)
  // 软删除
  assert.match(route, /app\.delete\('\/:id'/)
  assert.match(route, /deletedAt: now\(\)/)
  assert.doesNotMatch(route, /db\.delete\(schema\.characters\)/)
})

test('scenes route links new scenes to episode and soft deletes', () => {
  const route = read('src/routes/scenes.ts')

  assert.match(route, /app\.post\('\/'/)
  assert.match(route, /location required/)
  assert.match(route, /insert\(schema\.episodeScenes\)/)
  // 软删除（原为硬删，保留历史生成记录）
  assert.match(route, /app\.delete\('\/:id'/)
  assert.match(route, /deletedAt: now\(\)/)
  assert.doesNotMatch(route, /db\.delete\(schema\.scenes\)/)
})

test('props route supports manual create and soft delete', () => {
  const route = read('src/routes/props.ts')

  assert.match(route, /app\.post\('\/'/)
  assert.match(route, /name required/)
  assert.match(route, /insert\(schema\.episodeProps\)/)
  assert.match(route, /app\.delete\('\/:id'/)
  assert.match(route, /deletedAt: now\(\)/)
  assert.doesNotMatch(route, /db\.delete\(schema\.props\)/)
})

test('asset-library uploads do not use an async SQLite transaction', () => {
  const route = read('src/services/character-asset-upload.ts')

  assert.doesNotMatch(route, /db\.transaction\(async/)
  assert.match(route, /seedanceAssetUrl: uploaded\.assetUrl/)
  assert.match(route, /await syncCharacterVideoReferences\(character, uploaded\.assetUrl\)/)
  assert.match(route, /const existingAssetUrl/)
  assert.match(route, /reused: true/)
  assert.match(route, /deleteAssetLibraryItem\(previousLibraryAssetId\)/)
  assert.match(route, /seedanceLibraryAssetId: uploaded\.libraryAssetId/)
  assert.match(route, /seedancePreviousReferences: null/)
})
