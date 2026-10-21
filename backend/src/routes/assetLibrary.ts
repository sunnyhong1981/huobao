import { Hono } from 'hono'
import { badRequest, success } from '../utils/response.js'
import { ensureCharacterAssetUploaded } from '../services/character-asset-upload.js'
import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { reconcileCharacterAssets } from '../services/character-asset-references.js'
import { toSnakeCaseArray } from '../utils/transform.js'
import { listProjectAudio, registerProjectAudio, setStoryboardProjectAudio, updateProjectAudio } from '../services/project-audio.js'
import { toSnakeCase } from '../utils/transform.js'

const app = new Hono()

app.get('/projects/:id/audio', async c => {
  try { return success(c, toSnakeCaseArray(await listProjectAudio(Number(c.req.param('id'))))) }
  catch (error) { return badRequest(c, error instanceof Error ? error.message : '音频加载失败') }
})
app.post('/projects/:id/audio', async c => {
  try { return success(c, toSnakeCase(await registerProjectAudio(Number(c.req.param('id')), await c.req.json()))) }
  catch (error) { return badRequest(c, error instanceof Error ? error.message : '音频保存失败') }
})
app.put('/projects/:id/audio/:assetId', async c => {
  try { const body = await c.req.json(); await updateProjectAudio(Number(c.req.param('id')), Number(c.req.param('assetId')), body.name); return success(c) }
  catch (error) { return badRequest(c, error instanceof Error ? error.message : '音频更新失败') }
})
app.delete('/projects/:id/audio/:assetId', async c => {
  try { await updateProjectAudio(Number(c.req.param('id')), Number(c.req.param('assetId')), undefined, true); return success(c) }
  catch (error) { return badRequest(c, error instanceof Error ? error.message : '音频删除失败') }
})
app.put('/storyboards/:id/audio', async c => {
  try { const body = await c.req.json(); return success(c, await setStoryboardProjectAudio(Number(c.req.param('id')), body.asset_ids)) }
  catch (error) { return badRequest(c, error instanceof Error ? error.message : '音频引用保存失败') }
})

app.get('/projects/:id/characters', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return badRequest(c, '项目 ID 无效')
  const characters = await db.select().from(schema.characters)
    .where(and(eq(schema.characters.dramaId, id), isNull(schema.characters.deletedAt)))
  try {
    return success(c, toSnakeCaseArray(await reconcileCharacterAssets(characters, false)))
  } catch (error) {
    console.warn('Could not verify project asset status:', error instanceof Error ? error.message : error)
    return success(c, toSnakeCaseArray(characters.map(character => ({ ...character, assetLibraryStatus: 'unknown' }))))
  }
})

app.post('/characters/:id/upload', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return badRequest(c, '角色 ID 无效')
  try {
    return success(c, await ensureCharacterAssetUploaded(id))
  } catch (error) {
    return badRequest(c, error instanceof Error ? error.message : '素材库上传失败')
  }
})

export default app
