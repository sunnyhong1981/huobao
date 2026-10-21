import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { STORAGE_ROOT } from '../utils/paths.js'
import { isAssetLibraryConfigured, listAssetLibraryItems } from './new-api-assets.js'

type Character = typeof schema.characters.$inferSelect
export type VerifiedCharacter = Character & { assetLibraryStatus: 'available' | 'missing' | 'processing' | 'unknown' }

function imageIdentity(character: Character): string | null {
  const source = String(character.imageUrl || character.localPath || '').trim()
  if (/^https?:\/\//i.test(source)) return `url:${source}`
  const relative = source.replace(/^\//, '')
  if (!relative.startsWith('static/')) return null
  const file = path.resolve(STORAGE_ROOT, relative.slice(7))
  const root = path.resolve(STORAGE_ROOT)
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return null
  if (!fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep) || !fs.statSync(file).isFile()) return null
  return `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`
}

/** Reuse an asset only when both the project and the actual image match. */
export async function reconcileCharacterAssets(characters: Character[], fresh = true): Promise<VerifiedCharacter[]> {
  if (!characters.length || !isAssetLibraryConfigured()) return characters.map(c => ({ ...c, assetLibraryStatus: 'unknown' }))
  const items = await listAssetLibraryItems(fresh)
  const registry = new Map(items.map(item => [item.uri, item]))
  const candidates = await db.select().from(schema.characters).where(and(
    inArray(schema.characters.dramaId, [...new Set(characters.map(c => c.dramaId))]),
    isNull(schema.characters.deletedAt),
  ))
  const reusable = new Map<string, typeof items[number]>()
  for (const candidate of candidates) {
    const item = registry.get(candidate.seedanceAssetUrl || '')
    if (!item || item.status !== 'active') continue
    const identity = imageIdentity(candidate)
    if (identity) reusable.set(`${candidate.dramaId}:${identity}`, item)
  }
  const verified: VerifiedCharacter[] = []
  for (const character of characters) {
    let item = registry.get(character.seedanceAssetUrl || '')
    if (item?.status !== 'active') {
      const identity = imageIdentity(character)
      if (identity) item = reusable.get(`${character.dramaId}:${identity}`) || item
    }
    if (item?.status === 'active') {
      const updates = { seedanceAssetUrl: item.uri, seedanceLibraryAssetId: item.id, updatedAt: character.updatedAt }
      if (character.seedanceAssetUrl !== item.uri || character.seedanceLibraryAssetId !== item.id) {
        updates.updatedAt = now()
        const result = await db.update(schema.characters).set(updates).where(and(
          eq(schema.characters.id, character.id),
          character.imageUrl === null ? isNull(schema.characters.imageUrl) : eq(schema.characters.imageUrl, character.imageUrl),
          character.localPath === null ? isNull(schema.characters.localPath) : eq(schema.characters.localPath, character.localPath),
        ))
        if (!result.changes) throw new Error('角色图片已变更，请刷新后重试')
      }
      verified.push({ ...character, ...updates, assetLibraryStatus: 'available' })
    } else {
      // Clear the URI in the response, but keep it in storage as provenance for
      // a later upload/reference repair. Availability is checked again on use.
      verified.push({ ...character, seedanceAssetUrl: null, assetLibraryStatus: item?.status === 'processing' ? 'processing' : 'missing' })
    }
  }
  return verified
}

const imageUploadLocks = new Map<string, Promise<void>>()

export async function withCharacterAssetUpload<T>(id: number, run: () => Promise<T>): Promise<T> {
  const [character] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
  if (!character || character.deletedAt) throw new Error('角色不存在')
  const key = `${character.dramaId}:${imageIdentity(character) || `character:${id}`}`
  const previous = imageUploadLocks.get(key)
  let release!: () => void
  const finished = new Promise<void>(resolve => { release = resolve })
  imageUploadLocks.set(key, finished)
  await previous
  try { return await run() }
  finally {
    release()
    if (imageUploadLocks.get(key) === finished) imageUploadLocks.delete(key)
  }
}
