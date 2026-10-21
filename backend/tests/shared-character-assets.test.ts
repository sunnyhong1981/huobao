import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('replacing one character retains a shared asset and deletes an unshared asset', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'huobao-shared-asset-'))
  process.env.SQLITE_PATH = path.join(temp, 'test.sqlite3')
  process.env.NEW_API_ASSET_BASE_URL = 'https://assets.example.test'
  process.env.NEW_API_ASSET_TOKEN = 'test-token'
  process.env.NEW_API_ASSET_GROUP_ID = '107'
  process.env.NEW_API_ASSET_MODE = 'byteplus'
  const { db, schema } = await import('../src/db/index.js')
  const { default: route } = await import('../src/routes/assetLibrary.js')
  const timestamp = new Date().toISOString()
  const values = { dramaId: 5, name: 'test', imageUrl: 'https://image.example.test/role.jpg', createdAt: timestamp, updatedAt: timestamp }
  const [replacement] = await db.insert(schema.characters).values({ ...values, imageUrl: 'https://image.example.test/replacement.jpg', seedancePreviousAssetUrl: 'asset://old', seedanceLibraryAssetId: '100' }).returning()
  const [shared] = await db.insert(schema.characters).values({ ...values, seedanceAssetUrl: 'asset://old', seedanceLibraryAssetId: '100' }).returning()
  const originalFetch = globalThis.fetch
  const deleted: string[] = []
  const active = new Map([['100', { id: 100, uri: 'asset://old', status: 'Active' }]])
  globalThis.fetch = (async (input, init) => {
    if (!init?.method || init.method === 'GET') return Response.json({ success: true, data: { items: [...active.values()], total: active.size } })
    if (init?.method === 'DELETE') {
      deleted.push(String(input))
      active.delete(String(input).split('/').pop()!)
      return Response.json({ success: true })
    }
    active.set('200', { id: 200, uri: 'asset://new', status: 'Active' })
    return Response.json({ success: true, data: { id: 200, upstream_id: 'new', uri: 'asset://new' } })
  }) as typeof fetch
  try {
    const first = await route.request(`/characters/${replacement.id}/upload`, { method: 'POST' })
    assert.equal(first.status, 200)
    assert.equal((await first.json() as any).data.old_asset_deleted, false)
    assert.deepEqual(deleted, [])
    const { eq } = await import('drizzle-orm')
    await db.update(schema.characters).set({ seedanceAssetUrl: null, seedancePreviousAssetUrl: 'asset://old', imageUrl: 'https://image.example.test/changed.jpg' }).where(eq(schema.characters.id, shared.id))
    const second = await route.request(`/characters/${shared.id}/upload`, { method: 'POST' })
    assert.equal(second.status, 200)
    assert.equal((await second.json() as any).data.old_asset_deleted, true)
    assert.deepEqual(deleted, ['https://assets.example.test/api/assets/items/100'])
  } finally {
    globalThis.fetch = originalFetch
    fs.rmSync(temp, { recursive: true, force: true })
  }
})
