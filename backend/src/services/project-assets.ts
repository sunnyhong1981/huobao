import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { isAssetLibraryConfigured, listAssetLibraryItems } from './new-api-assets.js'
import { ensureCharacterAssetUploaded } from './character-asset-upload.js'

export async function selectProjectAsset(episodeId: number, kind: unknown, assetId: number) {
  // Validate ownership before any external upload or linking side effect.
  if (!Number.isInteger(episodeId) || episodeId <= 0 || !Number.isInteger(assetId) || assetId <= 0) throw new Error('素材或剧集 ID 无效')
  if (kind !== 'character' && kind !== 'scene' && kind !== 'prop') throw new Error('素材类型无效')
  const [episode] = await db.select().from(schema.episodes).where(and(eq(schema.episodes.id, episodeId), isNull(schema.episodes.deletedAt)))
  const table = kind === 'character' ? schema.characters : kind === 'scene' ? schema.scenes : schema.props
  const [asset] = await db.select().from(table).where(and(eq(table.id, assetId), isNull(table.deletedAt)))
  if (!episode) throw new Error('剧集不存在')
  if (!asset || asset.dramaId !== episode.dramaId) throw new Error('请选择当前项目的有效素材')
  let uploaded: Awaited<ReturnType<typeof ensureCharacterAssetUploaded>> | undefined
  if (kind === 'character' && isAssetLibraryConfigured() && (asset.imageUrl || asset.localPath)) {
    uploaded = await ensureCharacterAssetUploaded(assetId)
    const item = (await listAssetLibraryItems()).find(item => item.uri === uploaded!.asset_url)
    if (!item || item.status !== 'active') {
      throw new Error('角色素材已提交但尚未就绪，请稍后再次选择，无需重复上传')
    }
  }
  return { ...associateProjectAsset(episodeId, kind, assetId), ...(uploaded ? { asset_url: uploaded.asset_url, reused: uploaded.reused === true } : {}) }
}

export type ProjectAssetKind = 'character' | 'scene' | 'prop'

export function associateProjectAsset(episodeId: number, kind: unknown, assetId: number, remove = false) {
  if (!Number.isInteger(episodeId) || episodeId <= 0 || !Number.isInteger(assetId) || assetId <= 0) throw new Error('素材或剧集 ID 无效')
  if (kind !== 'character' && kind !== 'scene' && kind !== 'prop') throw new Error('素材类型无效')
  return db.transaction(tx => {
    const episode = tx.select().from(schema.episodes).where(and(eq(schema.episodes.id, episodeId), isNull(schema.episodes.deletedAt))).get()
    if (!episode) throw new Error('剧集不存在')
    const table = kind === 'character' ? schema.characters : kind === 'scene' ? schema.scenes : schema.props
    const asset = tx.select().from(table).where(and(eq(table.id, assetId), isNull(table.deletedAt))).get()
    if (!asset || asset.dramaId !== episode.dramaId) throw new Error('请选择当前项目的有效素材')
    const shotIds = tx.select({ id: schema.storyboards.id }).from(schema.storyboards)
      .where(and(eq(schema.storyboards.episodeId, episodeId), isNull(schema.storyboards.deletedAt))).all().map(row => row.id)
    if (remove && shotIds.length) {
      const binding = kind === 'character'
        ? tx.select().from(schema.storyboardCharacters).where(and(inArray(schema.storyboardCharacters.storyboardId, shotIds), eq(schema.storyboardCharacters.characterId, assetId))).get()
        : kind === 'prop'
          ? tx.select().from(schema.storyboardProps).where(and(inArray(schema.storyboardProps.storyboardId, shotIds), eq(schema.storyboardProps.propId, assetId))).get()
          : tx.select().from(schema.storyboards).where(and(inArray(schema.storyboards.id, shotIds), eq(schema.storyboards.sceneId, assetId))).get()
      if (binding) throw new Error('素材正在本集镜头中使用，请先解除镜头绑定')
    }
    const timestamp = now()
    if (kind === 'character') {
      const where = and(eq(schema.episodeCharacters.episodeId, episodeId), eq(schema.episodeCharacters.characterId, assetId))
      if (remove) tx.delete(schema.episodeCharacters).where(where).run()
      else if (!tx.select().from(schema.episodeCharacters).where(where).get()) tx.insert(schema.episodeCharacters).values({ episodeId, characterId: assetId, createdAt: timestamp }).run()
    } else if (kind === 'scene') {
      const where = and(eq(schema.episodeScenes.episodeId, episodeId), eq(schema.episodeScenes.sceneId, assetId))
      if (remove) tx.delete(schema.episodeScenes).where(where).run()
      else if (!tx.select().from(schema.episodeScenes).where(where).get()) tx.insert(schema.episodeScenes).values({ episodeId, sceneId: assetId, createdAt: timestamp }).run()
    } else {
      const where = and(eq(schema.episodeProps.episodeId, episodeId), eq(schema.episodeProps.propId, assetId))
      if (remove) tx.delete(schema.episodeProps).where(where).run()
      else if (!tx.select().from(schema.episodeProps).where(where).get()) tx.insert(schema.episodeProps).values({ episodeId, propId: assetId, createdAt: timestamp }).run()
    }
    return { asset_id: assetId, kind, linked: !remove }
  })
}
