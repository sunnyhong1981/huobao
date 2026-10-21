import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { resolveRedubAudio } from './redub-media.js'

async function requireProject(id: number) {
  if (!Number.isInteger(id) || id <= 0) throw new Error('项目 ID 无效')
  const [project] = await db.select().from(schema.dramas).where(and(eq(schema.dramas.id, id), isNull(schema.dramas.deletedAt)))
  if (!project) throw new Error('项目不存在')
}

export function parseAudioUrls(raw: string | null) {
  try { const value = JSON.parse(raw || '[]'); return Array.isArray(value) ? value.filter((url): url is string => typeof url === 'string' && !!url.trim()) : [] } catch { return [] }
}

async function projectShots(projectId: number) {
  return db.select({ id: schema.storyboards.id, urls: schema.storyboards.referenceAudioUrls })
    .from(schema.storyboards).innerJoin(schema.episodes, eq(schema.storyboards.episodeId, schema.episodes.id))
    .where(and(eq(schema.episodes.dramaId, projectId), isNull(schema.episodes.deletedAt), isNull(schema.storyboards.deletedAt)))
}

const registrationLocks = new Map<number, Promise<void>>()

export async function registerProjectAudio(projectId: number, input: { name?: unknown; path?: unknown }) {
  await requireProject(projectId)
  const file = resolveRedubAudio(input.path)
  const name = String(input.name || path.basename(file)).trim()
  if (!name || name.length > 120) throw new Error('音频名称需为 1 至 120 个字符')
  const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const previous = registrationLocks.get(projectId)
  let release!: () => void
  const finished = new Promise<void>(resolve => { release = resolve })
  registrationLocks.set(projectId, finished)
  await previous
  try {
    const existing = await db.select().from(schema.assets).where(and(eq(schema.assets.dramaId, projectId), eq(schema.assets.type, 'audio'), isNull(schema.assets.deletedAt)))
    for (const asset of existing) {
      try {
        const previousFile = resolveRedubAudio(asset.url || asset.localPath)
        if (createHash('sha256').update(fs.readFileSync(previousFile)).digest('hex') === digest) return { ...asset, reused: true }
      } catch {}
    }
    const relative = String(input.path).replace(/^\//, '')
    const timestamp = now()
    const result = await db.insert(schema.assets).values({ dramaId: projectId, name, type: 'audio', category: 'reference_audio', url: relative, localPath: relative, fileSize: fs.statSync(file).size, format: path.extname(file).slice(1), createdAt: timestamp, updatedAt: timestamp })
    const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, getInsertId(result)))
    return { ...asset, reused: false }
  } finally {
    release()
    if (registrationLocks.get(projectId) === finished) registrationLocks.delete(projectId)
  }
}

export async function listProjectAudio(projectId: number) {
  await requireProject(projectId)
  const shots = await projectShots(projectId)
  // Older uploads already belong to the project through a storyboard reference.
  const legacyUrls = [...new Set(shots.flatMap(shot => parseAudioUrls(shot.urls)))]
  const existing = await db.select().from(schema.assets).where(and(eq(schema.assets.dramaId, projectId), eq(schema.assets.type, 'audio'), isNull(schema.assets.deletedAt)))
  const known = new Set(existing.map(asset => asset.url))
  for (const url of legacyUrls) {
    if (known.has(url)) continue
    try {
      const asset = await registerProjectAudio(projectId, { path: url, name: path.basename(url) })
      if (asset.url && asset.url !== url) {
        for (const shot of shots) {
          const refs = parseAudioUrls(shot.urls)
          if (!refs.includes(url)) continue
          shot.urls = JSON.stringify([...new Set(refs.map(ref => ref === url ? asset.url! : ref))])
          await db.update(schema.storyboards).set({ referenceAudioUrls: shot.urls, updatedAt: now() }).where(eq(schema.storyboards.id, shot.id))
        }
      }
    } catch { /* Preserve legacy references even if their file is unavailable. */ }
  }
  const assets = await db.select().from(schema.assets).where(and(eq(schema.assets.dramaId, projectId), eq(schema.assets.type, 'audio'), isNull(schema.assets.deletedAt)))
  return assets.map(asset => {
    let available = true
    try { resolveRedubAudio(asset.url || asset.localPath) } catch { available = false }
    return { ...asset, available, referenceCount: shots.filter(shot => parseAudioUrls(shot.urls).includes(asset.url || '')).length }
  })
}

export async function updateProjectAudio(projectId: number, id: number, name?: unknown, remove = false) {
  await requireProject(projectId)
  const [asset] = await db.select().from(schema.assets).where(and(eq(schema.assets.id, id), eq(schema.assets.dramaId, projectId), eq(schema.assets.type, 'audio'), isNull(schema.assets.deletedAt)))
  if (!asset) throw new Error('音频素材不存在')
  if (remove) {
    if ((await projectShots(projectId)).some(shot => parseAudioUrls(shot.urls).includes(asset.url || ''))) throw new Error('音频仍被镜头引用，请先移除镜头引用')
    await db.update(schema.assets).set({ deletedAt: now(), updatedAt: now() }).where(eq(schema.assets.id, id))
  } else {
    const normalized = String(name || '').trim()
    if (!normalized || normalized.length > 120) throw new Error('音频名称需为 1 至 120 个字符')
    await db.update(schema.assets).set({ name: normalized, updatedAt: now() }).where(eq(schema.assets.id, id))
  }
}

export async function setStoryboardProjectAudio(storyboardId: number, ids: unknown) {
  if (!Array.isArray(ids) || ids.length > 3 || ids.some(id => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) throw new Error('每个镜头最多选择 3 条不同的参考音频')
  const [shot] = await db.select({ id: schema.storyboards.id, projectId: schema.episodes.dramaId })
    .from(schema.storyboards).innerJoin(schema.episodes, eq(schema.storyboards.episodeId, schema.episodes.id))
    .where(and(eq(schema.storyboards.id, storyboardId), isNull(schema.storyboards.deletedAt), isNull(schema.episodes.deletedAt)))
  if (!shot) throw new Error('镜头不存在')
  const assets = await listProjectAudio(shot.projectId)
  const selected = ids.map(id => assets.find(asset => asset.id === id && asset.available))
  if (selected.some(asset => !asset)) throw new Error('请选择当前项目的有效音频')
  const urls = selected.map(asset => asset!.url!)
  await db.update(schema.storyboards).set({ referenceAudioUrls: JSON.stringify(urls), updatedAt: now() }).where(eq(schema.storyboards.id, storyboardId))
  return { reference_audio_urls: urls }
}
