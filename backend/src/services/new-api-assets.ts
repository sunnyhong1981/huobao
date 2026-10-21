import fs from 'fs'
import path from 'path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { getAbsolutePath } from '../utils/storage.js'

function getConfig() {
  return {
    baseURL: (process.env.NEW_API_ASSET_BASE_URL || '').replace(/\/+$/, ''),
    token: process.env.NEW_API_ASSET_TOKEN || '',
    groupId: process.env.NEW_API_ASSET_GROUP_ID || '',
    mode: (process.env.NEW_API_ASSET_MODE || 'xrtoken').toLowerCase(),
    publicBaseURL: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  }
}

function assertConfigured(config: ReturnType<typeof getConfig>) {
  if (!config.baseURL || !config.token || !config.groupId) {
    throw new Error('素材库未配置，请设置 NEW_API_ASSET_BASE_URL、NEW_API_ASSET_TOKEN 和 NEW_API_ASSET_GROUP_ID')
  }
}

function contentTypeFor(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return 'image/png'
  }
}

const BYTEPLUS_MIN_ASPECT = 0.4
const BYTEPLUS_MAX_ASPECT = 2.5

/**
 * BytePlus rejects images outside 0.4:1–2.5:1. Keep the complete reference
 * visible by fitting it on a white canvas before publishing a public URL.
 */
async function normalizeByteplusImage(imageUrl: string, publicBaseURL: string) {
  if (/^https?:\/\//i.test(imageUrl)) return toPublicAssetURL(imageUrl, publicBaseURL)
  const relativePath = imageUrl.replace(/^\/+/, '')
  const sourcePath = getAbsolutePath(relativePath)
  if (!fs.existsSync(sourcePath)) return toPublicAssetURL(imageUrl, publicBaseURL)

  const metadata = await sharp(sourcePath).metadata()
  if (!metadata.width || !metadata.height) return toPublicAssetURL(imageUrl, publicBaseURL)
  const aspect = metadata.width / metadata.height
  if (aspect >= BYTEPLUS_MIN_ASPECT && aspect <= BYTEPLUS_MAX_ASPECT) {
    return toPublicAssetURL(imageUrl, publicBaseURL)
  }

  const normalized = await sharp(sourcePath)
    .rotate()
    .resize({ width: 2048, height: 820, fit: 'contain', background: '#ffffff' })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 24)
  const normalizedRelativePath = `static/asset-library-normalized/${digest}.jpg`
  const normalizedPath = getAbsolutePath(normalizedRelativePath)
  fs.mkdirSync(path.dirname(normalizedPath), { recursive: true })
  if (!fs.existsSync(normalizedPath)) fs.writeFileSync(normalizedPath, normalized)
  return toPublicAssetURL(normalizedRelativePath, publicBaseURL)
}

export async function uploadCharacterAsset(params: { imageUrl: string; name: string }) {
  const config = getConfig()
  assertConfigured(config)
  const imageUrl = String(params.imageUrl || '').trim()
  if (!imageUrl) throw new Error('角色尚未生成图片')

  if (config.mode === 'byteplus') {
    const groupId = Number(config.groupId)
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error('BytePlus 素材库需要数值型 NEW_API_ASSET_GROUP_ID')
    }
    const publicUrl = await normalizeByteplusImage(imageUrl, config.publicBaseURL)
    const response = await fetch(`${config.baseURL}/api/assets/items`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        group_id: groupId,
        url: publicUrl,
        asset_type: 'Image',
        name: params.name || 'character',
      }),
      signal: AbortSignal.timeout(120_000),
    })
    return parseAssetResponse(response)
  }

  let bytes: Buffer
  let filename: string
  let contentType: string
  if (/^https?:\/\//i.test(imageUrl)) {
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`下载角色图片失败: HTTP ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
    filename = path.basename(new URL(imageUrl).pathname) || 'character.png'
    contentType = response.headers.get('content-type') || contentTypeFor(filename)
  } else {
    const localPath = getAbsolutePath(imageUrl.replace(/^\//, ''))
    if (!fs.existsSync(localPath)) throw new Error('角色本地图片不存在')
    bytes = fs.readFileSync(localPath)
    filename = path.basename(localPath)
    contentType = contentTypeFor(localPath)
  }

  const form = new FormData()
  form.set('group_id', config.groupId)
  form.set('asset_type', 'Image')
  form.set('name', params.name || filename)
  const fileData = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  form.set('file', new Blob([fileData], { type: contentType }), filename)

  const response = await fetch(`${config.baseURL}/api/assets/items/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  })
  return parseAssetResponse(response)
}

/**
 * The asset-console item ID is distinct from the upstream ID embedded in an
 * `asset://` URI. It is the only identifier accepted by the delete endpoint.
 */
export interface AssetLibraryItem {
  id: string
  uri: string
  status: string
}

export function isAssetLibraryConfigured() {
  const config = getConfig()
  return !!(config.baseURL && config.token && config.groupId)
}

let listCache: { key: string; expires: number; items: AssetLibraryItem[] } | undefined

export async function listAssetLibraryItems(fresh = true): Promise<AssetLibraryItem[]> {
  const config = getConfig()
  assertConfigured(config)
  const key = JSON.stringify([config.baseURL, config.groupId, config.token])
  if (!fresh && listCache?.key === key && listCache.expires > Date.now()) return listCache.items
  const items: AssetLibraryItem[] = []
  for (let page = 1; page <= 1000; page++) {
    const query = new URLSearchParams({ group_id: config.groupId, page_size: '100', p: String(page) })
    const response = await fetch(`${config.baseURL}/api/assets/items?${query}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(30_000),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || payload?.success === false || !Array.isArray(payload?.data?.items)) {
      throw new Error('无法核验素材库状态，请稍后重试')
    }
    const batch = payload.data.items
    if (page > 1 && batch.some((item: any) => items.some(existing => existing.id === String(item.id)))) {
      throw new Error('素材库分页结果异常，请稍后重试')
    }
    items.push(...batch.map((item: any) => ({
      id: String(item.id),
      uri: String(item.uri || (item.upstream_id ? `asset://${item.upstream_id}` : '')).trim(),
      status: String(item.status || '').toLowerCase(),
    })))
    const total = Number(payload.data.total)
    if ((Number.isFinite(total) && total >= 0 && items.length >= total) || (!Number.isFinite(total) && batch.length < 100)) {
      listCache = { key, items, expires: Date.now() + 10_000 }
      return items
    }
    if (!batch.length) throw new Error('素材库分页结果不完整，请稍后重试')
  }
  throw new Error('素材库数据过多，无法完成核验')
}

export async function findAssetLibraryItemId(assetUrl: string) {
  const uri = String(assetUrl || '').trim()
  if (!/^asset:\/\//i.test(uri)) return null
  return (await listAssetLibraryItems()).find(item => item.uri === uri)?.id || null
}

export async function deleteAssetLibraryItem(itemId: string) {
  listCache = undefined
  const config = getConfig()
  assertConfigured(config)
  const normalizedId = String(itemId || '').trim()
  if (!normalizedId) return

  const response = await fetch(`${config.baseURL}/api/assets/items/${encodeURIComponent(normalizedId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(60_000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.message || `删除旧素材失败: HTTP ${response.status}`)
  }
}

function toPublicAssetURL(imageUrl: string, publicBaseURL: string) {
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl
  if (!publicBaseURL) throw new Error('BytePlus 素材库需要配置 PUBLIC_BASE_URL')
  const normalized = imageUrl.replace(/^\/+/, '')
  return `${publicBaseURL}/${normalized}`
}

async function parseAssetResponse(response: Response) {
  listCache = undefined
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.message || `素材库上传失败: HTTP ${response.status}`)
  }
  const asset = payload?.data ?? payload
  const upstreamId = String(asset?.upstream_id || asset?.upstreamId || '').trim()
  const assetId = upstreamId || String(asset?.id || asset?.Id || '').trim()
  const assetUrl = String(asset?.uri || asset?.URI || '').trim() || (upstreamId ? `asset://${upstreamId}` : '')
  const libraryAssetId = String(asset?.id || asset?.Id || '').trim()
  if (!assetId || !assetUrl) throw new Error('素材库未返回可用的素材 URI')
  return { assetId, assetUrl, libraryAssetId: libraryAssetId || null }
}
