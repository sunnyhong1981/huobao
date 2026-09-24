import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { badRequest, success, now } from '../utils/response.js'
import { uploadCharacterAsset } from '../services/new-api-assets.js'

const app = new Hono()

app.post('/characters/:id/upload', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return badRequest(c, '角色 ID 无效')
  const [character] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
  if (!character) return badRequest(c, '角色不存在')
  try {
    const uploaded = await uploadCharacterAsset({
      imageUrl: character.imageUrl || character.localPath || '',
      name: character.name,
    })
    await db.update(schema.characters)
      .set({ seedanceAssetUrl: uploaded.assetUrl, updatedAt: now() })
      .where(eq(schema.characters.id, id))
    return success(c, { asset_id: uploaded.assetId, asset_url: uploaded.assetUrl })
  } catch (err: any) {
    return badRequest(c, err.message || '素材库上传失败')
  }
})

export default app
