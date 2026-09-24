import assert from 'node:assert/strict'
import test from 'node:test'

test('uploads a local character image to the configured new-api asset group', async () => {
  const originalFetch = globalThis.fetch
  const originalBaseURL = process.env.NEW_API_ASSET_BASE_URL
  const originalToken = process.env.NEW_API_ASSET_TOKEN
  const originalGroupID = process.env.NEW_API_ASSET_GROUP_ID
  process.env.NEW_API_ASSET_BASE_URL = 'https://assets.example.test/'
  process.env.NEW_API_ASSET_TOKEN = 'test-token'
  process.env.NEW_API_ASSET_GROUP_ID = 'group-123'

  try {
    globalThis.fetch = (async (input, init) => {
      if (String(input) === 'https://source.example.test/character.png') {
        return new Response(Buffer.from('test-image'), {
          headers: { 'Content-Type': 'image/png' },
        })
      }
      assert.equal(String(input), 'https://assets.example.test/api/assets/items/upload')
      assert.equal(init?.method, 'POST')
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-token')
      const form = init?.body as FormData
      assert.equal(form.get('group_id'), 'group-123')
      assert.equal(form.get('asset_type'), 'Image')
      assert.equal(form.get('name'), '测试角色')
      const file = form.get('file') as File
      assert.equal(file.name, 'character.png')
      assert.equal(await file.text(), 'test-image')
      return new Response(JSON.stringify({ success: true, data: { id: 456, upstream_id: 'asset-456', uri: 'asset://asset-456' } }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const { uploadCharacterAsset } = await import('./new-api-assets.js')
    const result = await uploadCharacterAsset({ imageUrl: 'https://source.example.test/character.png', name: '测试角色' })
    assert.deepEqual(result, { assetId: 'asset-456', assetUrl: 'asset://asset-456' })
  } finally {
    globalThis.fetch = originalFetch
    if (originalBaseURL === undefined) delete process.env.NEW_API_ASSET_BASE_URL
    else process.env.NEW_API_ASSET_BASE_URL = originalBaseURL
    if (originalToken === undefined) delete process.env.NEW_API_ASSET_TOKEN
    else process.env.NEW_API_ASSET_TOKEN = originalToken
    if (originalGroupID === undefined) delete process.env.NEW_API_ASSET_GROUP_ID
    else process.env.NEW_API_ASSET_GROUP_ID = originalGroupID
  }
})

test('creates a BytePlus asset from a public image URL', async () => {
  const originalFetch = globalThis.fetch
  const originalBaseURL = process.env.NEW_API_ASSET_BASE_URL
  const originalToken = process.env.NEW_API_ASSET_TOKEN
  const originalGroupID = process.env.NEW_API_ASSET_GROUP_ID
  const originalMode = process.env.NEW_API_ASSET_MODE
  const originalPublicBaseURL = process.env.PUBLIC_BASE_URL
  process.env.NEW_API_ASSET_BASE_URL = 'https://assets.example.test'
  process.env.NEW_API_ASSET_TOKEN = 'test-token'
  process.env.NEW_API_ASSET_GROUP_ID = '123'
  process.env.NEW_API_ASSET_MODE = 'byteplus'
  process.env.PUBLIC_BASE_URL = 'https://drama.example.test/huobao'

  try {
    globalThis.fetch = (async (input, init) => {
      assert.equal(String(input), 'https://assets.example.test/api/assets/items')
      assert.equal(init?.method, 'POST')
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-token')
      assert.deepEqual(JSON.parse(String(init?.body)), {
        group_id: 123,
        url: 'https://drama.example.test/huobao/static/images/character.png',
        asset_type: 'Image',
        name: '测试角色',
      })
      return new Response(JSON.stringify({ success: true, data: { id: 456, upstream_id: 'asset-456', uri: 'asset://asset-456' } }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const { uploadCharacterAsset } = await import('./new-api-assets.js')
    const result = await uploadCharacterAsset({ imageUrl: 'static/images/character.png', name: '测试角色' })
    assert.deepEqual(result, { assetId: 'asset-456', assetUrl: 'asset://asset-456' })
  } finally {
    globalThis.fetch = originalFetch
    for (const [key, value] of Object.entries({
      NEW_API_ASSET_BASE_URL: originalBaseURL,
      NEW_API_ASSET_TOKEN: originalToken,
      NEW_API_ASSET_GROUP_ID: originalGroupID,
      NEW_API_ASSET_MODE: originalMode,
      PUBLIC_BASE_URL: originalPublicBaseURL,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
