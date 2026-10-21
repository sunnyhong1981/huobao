import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('episodes reuse project asset IDs, preserve shared edits, and remove only their own links', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'huobao-project-assets-'))
  process.env.SQLITE_PATH = path.join(temp, 'test.sqlite3')
  const { db, schema } = await import('../src/db/index.js')
  const { eq, and } = await import('drizzle-orm')
  const { associateProjectAsset } = await import('../src/services/project-assets.js')
  const ts = new Date().toISOString()
  const [first, second] = await db.insert(schema.episodes).values([
    { dramaId: 5, episodeNumber: 1, title: 'a', createdAt: ts, updatedAt: ts },
    { dramaId: 5, episodeNumber: 2, title: 'b', createdAt: ts, updatedAt: ts },
  ]).returning()
  const [scene] = await db.insert(schema.scenes).values({ dramaId: 5, location: '大厅', prompt: '金色舞台', time: '上午', imageUrl: 'static/hall.jpg', createdAt: ts, updatedAt: ts }).returning()
  const [character] = await db.insert(schema.characters).values({ dramaId: 5, name: '角色', createdAt: ts, updatedAt: ts }).returning()
  const [prop] = await db.insert(schema.props).values({ dramaId: 5, name: 'PPT', createdAt: ts, updatedAt: ts }).returning()
  for (const ep of [first, second]) for (const [kind, asset] of [['scene', scene], ['character', character], ['prop', prop]] as const) {
    associateProjectAsset(ep.id, kind, asset.id)
    associateProjectAsset(ep.id, kind, asset.id)
  }
  assert.equal((await db.select().from(schema.scenes)).length, 1)
  assert.equal((await db.select().from(schema.characters)).length, 1)
  assert.equal((await db.select().from(schema.props)).length, 1)
  assert.equal((await db.select().from(schema.episodeScenes)).length, 2, 'repeated linking is idempotent')
  await db.update(schema.scenes).set({ imageUrl: 'static/new-hall.jpg' }).where(eq(schema.scenes.id, scene.id))
  const linked = await db.select({ image: schema.scenes.imageUrl }).from(schema.episodeScenes).innerJoin(schema.scenes, eq(schema.episodeScenes.sceneId, schema.scenes.id))
  assert.deepEqual(linked.map(row => row.image), ['static/new-hall.jpg', 'static/new-hall.jpg'])

  const [shot] = await db.insert(schema.storyboards).values({ episodeId: first.id, storyboardNumber: 1, sceneId: scene.id, createdAt: ts, updatedAt: ts }).returning()
  await db.insert(schema.storyboardCharacters).values({ storyboardId: shot.id, characterId: character.id })
  await db.insert(schema.storyboardProps).values({ storyboardId: shot.id, propId: prop.id })
  for (const [kind, asset] of [['scene', scene], ['character', character], ['prop', prop]] as const) {
    assert.throws(() => associateProjectAsset(first.id, kind, asset.id, true), /镜头中使用/)
    associateProjectAsset(second.id, kind, asset.id, true)
  }
  assert.equal((await db.select().from(schema.episodeScenes)).length, 1)
  assert.equal((await db.select().from(schema.episodeCharacters)).length, 1)
  assert.equal((await db.select().from(schema.episodeProps)).length, 1)
  assert.equal((await db.select().from(schema.scenes).where(and(eq(schema.scenes.id, scene.id), eq(schema.scenes.imageUrl, 'static/new-hall.jpg')))).length, 1)
  const [foreign] = await db.insert(schema.characters).values({ dramaId: 6, name: 'foreign', createdAt: ts, updatedAt: ts }).returning()
  assert.throws(() => associateProjectAsset(first.id, 'character', foreign.id), /当前项目/)
  await db.update(schema.characters).set({ deletedAt: ts }).where(eq(schema.characters.id, foreign.id))
  assert.throws(() => associateProjectAsset(first.id, 'character', foreign.id), /有效素材/)
  assert.throws(() => associateProjectAsset(first.id, 'audio', 1), /类型无效/)
  fs.rmSync(temp, { recursive: true, force: true })
})
