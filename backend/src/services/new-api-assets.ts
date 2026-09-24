import fs from 'fs'
import path from 'path'
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
    const publicUrl = toPublicAssetURL(imageUrl, config.publicBaseURL)
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

function toPublicAssetURL(imageUrl: string, publicBaseURL: string) {
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl
  if (!publicBaseURL) throw new Error('BytePlus 素材库需要配置 PUBLIC_BASE_URL')
  const normalized = imageUrl.replace(/^\/+/, '')
  return `${publicBaseURL}/${normalized}`
}

async function parseAssetResponse(response: Response) {
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.message || `素材库上传失败: HTTP ${response.status}`)
  }
  const asset = payload?.data ?? payload
  const upstreamId = String(asset?.upstream_id || asset?.upstreamId || '').trim()
  const assetId = upstreamId || String(asset?.id || asset?.Id || '').trim()
  const assetUrl = String(asset?.uri || asset?.URI || '').trim() || (upstreamId ? `asset://${upstreamId}` : '')
  if (!assetId || !assetUrl) throw new Error('素材库未返回可用的素材 URI')
  return { assetId, assetUrl }
}
