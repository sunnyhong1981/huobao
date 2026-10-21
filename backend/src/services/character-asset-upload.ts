import { and, eq, inArray, ne, or } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { deleteAssetLibraryItem, findAssetLibraryItemId, uploadCharacterAsset } from './new-api-assets.js'
import { reconcileCharacterAssets, withCharacterAssetUpload } from './character-asset-references.js'

/**
 * A character can be bound to many storyboards. Keep queued and retryable video
 * tasks aligned with its latest asset-library URI, while leaving completed task
 * history and already-rendered videos untouched.
 */
async function syncCharacterVideoReferences(character: typeof schema.characters.$inferSelect, assetUrl: string) {
  const bindings = await db.select({ storyboardId: schema.storyboardCharacters.storyboardId })
    .from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.characterId, character.id))
  const storyboardIds = [...new Set(bindings.map(row => row.storyboardId))]
  if (!storyboardIds.length) return { storyboardCount: 0, taskCount: 0 }

  const tasks = await db.select().from(schema.sysTask)
    .where(and(
      eq(schema.sysTask.type, 'video'),
      inArray(schema.sysTask.storyboardId, storyboardIds),
      inArray(schema.sysTask.status, ['pending', 'processing', 'failed']),
    ))

  let previousReferences: string[] = []
  try {
    const parsed = JSON.parse(character.seedancePreviousReferences || '[]')
    if (Array.isArray(parsed)) previousReferences = parsed.map(value => String(value || '').trim()).filter(Boolean)
  } catch {}
  const previousValues = new Set([
    character.seedanceAssetUrl,
    character.seedancePreviousAssetUrl,
    character.imageUrl,
    character.localPath,
    ...previousReferences,
  ].map(value => String(value || '').trim()).filter(Boolean))
  let taskCount = 0
  const timestamp = now()

  for (const task of tasks) {
    let params: Record<string, any>
    try { params = task.params ? JSON.parse(task.params) : {} } catch { continue }
    const refs = Array.isArray(params.referenceImageUrls) ? params.referenceImageUrls : null
    if (!refs) continue

    let changed = false
    params.referenceImageUrls = refs.map((value: unknown) => {
      const ref = String(value || '').trim()
      if (!previousValues.has(ref)) return value
      changed = true
      return assetUrl
    })
    if (!changed) continue

    await db.update(schema.sysTask)
      .set({ params: JSON.stringify(params), updatedAt: timestamp })
      .where(eq(schema.sysTask.id, task.id))
    taskCount++
  }

  return { storyboardCount: storyboardIds.length, taskCount }
}

async function uploadCharacter(id: number) {
  const [character] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
  if (!character) throw new Error('角色不存在')
  const [verified] = await reconcileCharacterAssets([character])
  if (verified.assetLibraryStatus === 'processing') throw new Error('角色素材正在处理，请稍后重试')
  const existingAssetUrl = String(verified.seedanceAssetUrl || '').trim()
  if (/^asset:\/\//i.test(existingAssetUrl)) {
    const sync = await syncCharacterVideoReferences(character, existingAssetUrl)
    return {
      asset_id: existingAssetUrl.replace(/^asset:\/\//i, ''),
      asset_url: existingAssetUrl,
      reused: true,
      synced_storyboard_count: sync.storyboardCount,
      synced_task_count: sync.taskCount,
    }
  }
  const previousAssetUrl = String(character.seedancePreviousAssetUrl || character.seedanceAssetUrl || '').trim()
  let previousLibraryAssetId = ''
  // Characters saved before the item-ID migration only have an asset URI.
  // Resolve its matching item exactly; never use the mutable character name.
  if (previousAssetUrl) {
    previousLibraryAssetId = (await findAssetLibraryItemId(previousAssetUrl)) || ''
  }
  const uploaded = await uploadCharacterAsset({
    imageUrl: character.imageUrl || character.localPath || '',
    name: character.name,
  })
  // better-sqlite3 transactions are synchronous. Keep the upload durable even
  // when syncing historical task references encounters a recoverable issue.
  const saved = await db.update(schema.characters)
    .set({
      seedanceAssetUrl: uploaded.assetUrl,
      seedanceLibraryAssetId: uploaded.libraryAssetId,
      seedancePreviousAssetUrl: null,
      seedancePreviousReferences: null,
      updatedAt: now(),
    })
    .where(and(eq(schema.characters.id, id), eq(schema.characters.updatedAt, character.updatedAt)))
  if (!saved.changes) {
    if (uploaded.libraryAssetId) await deleteAssetLibraryItem(uploaded.libraryAssetId)
    throw new Error('角色图片已变更，请重新上传素材')
  }
  let sync = { storyboardCount: 0, taskCount: 0 }
  let synced = true
  try {
    sync = await syncCharacterVideoReferences(character, uploaded.assetUrl)
  } catch (error) {
    synced = false
    console.warn(`Could not sync asset references for character ${id}:`, error)
  }
  let cleanupWarning = ''
  const sharedReferences = previousLibraryAssetId ? await db.select({ id: schema.characters.id })
    .from(schema.characters)
    .where(and(
      ne(schema.characters.id, id),
      or(
        eq(schema.characters.seedanceLibraryAssetId, previousLibraryAssetId),
        eq(schema.characters.seedanceAssetUrl, previousAssetUrl),
        eq(schema.characters.seedancePreviousAssetUrl, previousAssetUrl),
      ),
    )) : []
  const canDeleteOldAsset = synced && !!previousLibraryAssetId && previousLibraryAssetId !== uploaded.libraryAssetId && !sharedReferences.length
  if (canDeleteOldAsset) {
    try {
      await deleteAssetLibraryItem(previousLibraryAssetId)
    } catch (error) {
      cleanupWarning = error instanceof Error ? error.message : '删除旧素材失败'
      console.warn(`Could not delete replaced asset ${previousLibraryAssetId} for character ${id}:`, error)
    }
  }
  return {
    asset_id: uploaded.assetId,
    asset_url: uploaded.assetUrl,
    synced_storyboard_count: sync.storyboardCount,
    synced_task_count: sync.taskCount,
    old_asset_deleted: canDeleteOldAsset && !cleanupWarning,
    cleanup_warning: cleanupWarning || undefined,
  }
}
export function ensureCharacterAssetUploaded(id: number) {
  return withCharacterAssetUpload(id, () => uploadCharacter(id))
}
