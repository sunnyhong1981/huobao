import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('recover cross-episode same-image assets, reject deleted references, and serialize duplicate uploads', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'huobao-asset-recovery-'))
  process.env.SQLITE_PATH = path.join(temp, 'db.sqlite3')
  process.env.STORAGE_PATH = path.join(temp, 'static')
  process.env.NEW_API_ASSET_BASE_URL = 'https://assets.example.test'
  process.env.NEW_API_ASSET_TOKEN = 'test-token'
  process.env.NEW_API_ASSET_GROUP_ID = '107'
  process.env.NEW_API_ASSET_MODE = 'byteplus'
  process.env.PUBLIC_BASE_URL = 'https://drama.example.test'
  fs.mkdirSync(path.join(temp, 'static/uploads'), { recursive: true })
  for (const name of ['a.jpg', 'b.jpg', 'other.jpg']) fs.writeFileSync(path.join(temp, 'static/uploads', name), name === 'other.jpg' ? 'different image' : 'same image bytes')
  const { db, schema } = await import('../src/db/index.js')
  const { eq } = await import('drizzle-orm')
  const { reconcileCharacterAssets } = await import('../src/services/character-asset-references.js')
  const { default: route } = await import('../src/routes/assetLibrary.js')
  const ts = new Date().toISOString()
  const create = async (name: string, image: string, uri: string | null, dramaId = 5) => {
    const [row] = await db.insert(schema.characters).values({ dramaId, name, imageUrl: `static/uploads/${image}`, seedanceAssetUrl: uri, createdAt: ts, updatedAt: ts }).returning()
    return row
  }
  const original = await create('same role', 'a.jpg', 'asset://active')
  const stale = await create('different name', 'b.jpg', 'asset://deleted')
  const different = await create('same role', 'other.jpg', 'asset://deleted-other')
  const unrelated = await create('same role', 'b.jpg', 'asset://foreign-deleted', 6)
  const registry = new Map([['1', { id: 1, uri: 'asset://active', status: 'Active' }]])
  const oldFetch = globalThis.fetch
  let uploads = 0
  const videoRequests: any[] = []
  globalThis.fetch = (async (input, options) => {
    if (String(input).endsWith('/v1/video/generations')) {
      videoRequests.push(JSON.parse(String(options?.body)))
      return Response.json({ message: 'test stops after inspecting the actual request' }, { status: 400 })
    }
    if (!options?.method || options.method === 'GET') return Response.json({ success: true, data: { items: [...registry.values()], total: registry.size } })
    assert.equal(options.method, 'POST')
    uploads++
    await new Promise(resolve => setTimeout(resolve, 20))
    const id = registry.size + 10
    const item = { id, uri: `asset://uploaded-${id}`, status: 'Active', upstream_id: `uploaded-${id}` }
    registry.set(String(id), item)
    return Response.json({ success: true, data: item })
  }) as typeof fetch
  try {
    const rows = await reconcileCharacterAssets([stale, different, unrelated])
    assert.equal(rows[0].seedanceAssetUrl, original.seedanceAssetUrl)
    assert.equal(rows[0].seedanceLibraryAssetId, '1')
    assert.equal(rows[0].assetLibraryStatus, 'available')
    assert.equal(rows[1].seedanceAssetUrl, null)
    assert.equal(rows[1].assetLibraryStatus, 'missing')
    assert.equal(rows[2].assetLibraryStatus, 'missing', 'do not share assets across projects')
    const [persisted] = await db.select().from(schema.characters).where(eq(schema.characters.id, stale.id))
    assert.equal(persisted.seedanceAssetUrl, 'asset://active')
    const reused = await route.request(`/characters/${stale.id}/upload`, { method: 'POST' })
    assert.equal((await reused.json() as any).data.reused, true)
    assert.equal(uploads, 0)

    registry.clear()
    const [latest] = await db.select().from(schema.characters).where(eq(schema.characters.id, stale.id))
    assert.equal((await reconcileCharacterAssets([latest]))[0].assetLibraryStatus, 'missing')
    const both = await Promise.all([
      route.request(`/characters/${original.id}/upload`, { method: 'POST' }),
      route.request(`/characters/${stale.id}/upload`, { method: 'POST' }),
    ])
    assert.deepEqual(both.map(response => response.status), [200, 200])
    const results = await Promise.all(both.map(response => response.json() as any))
    assert.equal(results[0].data.asset_url, results[1].data.asset_url)
    assert.equal(results[1].data.reused, true)
    assert.equal(uploads, 1, 'concurrent same-image uploads create one upstream item')

    await db.insert(schema.aiServiceConfigs).values({ name: 'test video', serviceType: 'video', provider: 'volcengine', baseUrl: 'https://video.example.test', apiKey: 'test', model: JSON.stringify(['dreamina-seedance-2-0-mini-260615']), isActive: true, createdAt: ts, updatedAt: ts })
    const [episode] = await db.insert(schema.episodes).values({ dramaId: 5, episodeNumber: 1, title: 'test', createdAt: ts, updatedAt: ts }).returning()
    const [shot] = await db.insert(schema.storyboards).values({ episodeId: episode.id, storyboardNumber: 1, createdAt: ts, updatedAt: ts }).returning()
    await db.insert(schema.storyboardCharacters).values({ storyboardId: shot.id, characterId: stale.id })
    await db.update(schema.characters).set({ seedanceAssetUrl: 'asset://deleted', seedanceLibraryAssetId: null }).where(eq(schema.characters.id, stale.id))
    const { generateVideo } = await import('../src/services/generation.js')
    const waitForTask = async (id: number) => {
      for (let i = 0; i < 200; i++) {
        const [task] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
        if (task.status !== 'processing') return task
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      throw new Error('Test task did not finish')
    }
    const id = await generateVideo({ storyboardId: shot.id, dramaId: 5, prompt: 'test', referenceImageUrls: ['asset://deleted'] })
    const recoveredTask = await waitForTask(id)
    assert.equal(videoRequests.length, 1)
    const newUri = results[0].data.asset_url
    assert.equal(videoRequests[0].content.find((item: any) => item.type === 'image_url').image_url.url, newUri)
    assert.deepEqual(JSON.parse(recoveredTask.params!).referenceImageUrls, [newUri])

    await db.delete(schema.storyboardCharacters).where(eq(schema.storyboardCharacters.storyboardId, shot.id))
    await db.insert(schema.storyboardCharacters).values({ storyboardId: shot.id, characterId: different.id })
    const blocked = await waitForTask(await generateVideo({ storyboardId: shot.id, dramaId: 5, prompt: 'test', referenceImageUrls: ['asset://deleted-other'] }))
    assert.equal(blocked.status, 'failed')
    assert.match(blocked.errorMsg || '', /请先上传到素材库/)
    assert.equal(videoRequests.length, 1, 'missing assets never reach the video provider')
  } finally {
    globalThis.fetch = oldFetch
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

test('asset lookup checks later pages and fails on incomplete responses', async () => {
  process.env.NEW_API_ASSET_BASE_URL = 'https://assets.example.test'
  process.env.NEW_API_ASSET_TOKEN = 'test-token'
  process.env.NEW_API_ASSET_GROUP_ID = '107'
  const oldFetch = globalThis.fetch
  const { findAssetLibraryItemId, listAssetLibraryItems } = await import('../src/services/new-api-assets.js')
  const pages: number[] = []
  globalThis.fetch = (async (input) => {
    const page = Number(new URL(String(input)).searchParams.get('p'))
    pages.push(page)
    const items = page === 1 ? Array.from({ length: 100 }, (_, i) => ({ id: i + 1, uri: `asset://first-${i}`, status: 'Active' })) : [{ id: 101, uri: 'asset://later', status: 'Active' }]
    return Response.json({ success: true, data: { items, total: 101 } })
  }) as typeof fetch
  try {
    assert.equal(await findAssetLibraryItemId('asset://later'), '101')
    assert.deepEqual(pages, [1, 2])
    globalThis.fetch = (async () => Response.json({ success: true, data: { items: [], total: 1 } })) as typeof fetch
    await assert.rejects(listAssetLibraryItems(), /不完整/)
  } finally { globalThis.fetch = oldFetch }
})
