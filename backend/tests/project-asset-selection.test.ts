import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

test('project selection reuses valid assets, uploads a missing asset once, and links only ready assets', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'huobao-asset-selection-'))
  process.env.SQLITE_PATH = path.join(temp, 'db.sqlite3')
  process.env.NEW_API_ASSET_BASE_URL = 'https://assets.example.test'
  process.env.NEW_API_ASSET_TOKEN = 'test'
  process.env.NEW_API_ASSET_GROUP_ID = '107'
  process.env.NEW_API_ASSET_MODE = 'byteplus'
  const { db, schema } = await import('../src/db/index.js')
  const { selectProjectAsset } = await import('../src/services/project-assets.js')
  const { eq } = await import('drizzle-orm')
  const ts = new Date().toISOString()
  const [first, second] = await db.insert(schema.episodes).values([
    { dramaId: 5, episodeNumber: 1, title: 'a', createdAt: ts, updatedAt: ts },
    { dramaId: 5, episodeNumber: 2, title: 'b', createdAt: ts, updatedAt: ts },
  ]).returning()
  const makeCharacter = async (image: string, uri: string | null, dramaId=5) => (await db.insert(schema.characters).values({ dramaId, name: 'test', imageUrl: image, seedanceAssetUrl: uri, createdAt: ts, updatedAt: ts }).returning())[0]
  const valid = await makeCharacter('https://image.example/valid.jpg', 'asset://valid')
  const missing = await makeCharacter('https://image.example/missing.jpg', 'asset://deleted')
  const processing = await makeCharacter('https://image.example/pending.jpg', null)
  const foreign = await makeCharacter('https://image.example/foreign.jpg', null, 6)
  const failed = await makeCharacter('https://image.example/failed.jpg', null)
  const originalFetch = globalThis.fetch
  let uploads = 0, failUpload = false
  const registry = [{ id: 1, uri: 'asset://valid', status: 'Active', upstream_id: 'valid' }]
  globalThis.fetch = (async (_url, options) => {
    if (!options?.method || options.method === 'GET') return Response.json({ success: true, data: { total: registry.length, items: registry } })
    assert.equal(options.method, 'POST')
    if (failUpload) return Response.json({ success: false, message: 'upload rejected' }, { status: 400 })
    uploads++
    const request = JSON.parse(String(options.body))
    const item = { id: uploads+1, uri: `asset://new-${uploads}`, upstream_id: `new-${uploads}`, status: request.url.includes('pending') ? 'Processing' : 'Active' }
    registry.push(item)
    return Response.json({ success: true, data: item })
  }) as typeof fetch
  try {
    const reused = await selectProjectAsset(first.id, 'character', valid.id)
    assert.equal(reused.asset_url, 'asset://valid')
    assert.equal(reused.reused, true)
    assert.equal(uploads, 0)
    const prepared = await selectProjectAsset(first.id, 'character', missing.id)
    assert.equal(prepared.asset_url, 'asset://new-1')
    assert.equal(uploads, 1)
    const otherEpisode = await selectProjectAsset(second.id, 'character', missing.id)
    assert.equal(otherEpisode.asset_url, prepared.asset_url)
    assert.equal(otherEpisode.reused, true)
    assert.equal(uploads, 1)
    await assert.rejects(selectProjectAsset(first.id, 'character', foreign.id), /当前项目/)
    assert.equal(uploads, 1, 'ownership checked before upload')
    await assert.rejects(selectProjectAsset(first.id, 'character', processing.id), /尚未就绪/)
    assert.equal((await db.select().from(schema.episodeCharacters).where(eq(schema.episodeCharacters.characterId, processing.id))).length, 0)
    await assert.rejects(selectProjectAsset(first.id, 'character', processing.id), /正在处理/)
    assert.equal(uploads, 2, 'processing retry never uploads again')
    registry[2].status = 'Active'
    const ready = await selectProjectAsset(first.id, 'character', processing.id)
    assert.equal(ready.reused, true)
    assert.equal(uploads, 2)
    failUpload = true
    await assert.rejects(selectProjectAsset(first.id, 'character', failed.id), /upload rejected/)
    assert.equal((await db.select().from(schema.episodeCharacters).where(eq(schema.episodeCharacters.characterId, failed.id))).length, 0)
  } finally {
    globalThis.fetch = originalFetch
    fs.rmSync(temp, { recursive: true, force: true })
  }
})
