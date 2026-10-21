import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { compressImageAsDataUrl, fetchImageAsCompressedDataUrl } from '../src/utils/storage.js'

const options = { minWidth: 300, minHeight: 300, maxWidth: 768, maxHeight: 768 }
const image = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#c02030' } }).png().toBuffer()
const dimensions = async (url: string) => {
  const data = Buffer.from(url.split(',')[1], 'base64')
  const metadata = await sharp(data).metadata()
  return { width: metadata.width!, height: metadata.height! }
}

test('small video references meet minimum dimensions without changing the source', async () => {
  const input = await image(296, 360)
  const result = await dimensions(await compressImageAsDataUrl(input, options))
  assert.equal(result.width, 300)
  assert.ok(Math.abs(result.width / result.height - 296 / 360) < 0.01)
  assert.deepEqual(await sharp(input).metadata().then(m => ({ width: m.width, height: m.height })), { width: 296, height: 360 })
  assert.deepEqual(await dimensions(await compressImageAsDataUrl(input)), { width: 296, height: 360 }, 'ordinary image compression remains unchanged')
})

test('portrait, landscape and extreme references fit both minimum and maximum dimensions', async () => {
  for (const [width, height] of [[360, 296], [20, 20], [4000, 100], [100, 4000], [600, 700]]) {
    const result = await dimensions(await compressImageAsDataUrl(await image(width, height), options))
    assert.ok(result.width >= 300 && result.height >= 300, JSON.stringify(result))
    assert.ok(result.width <= 768 && result.height <= 768, JSON.stringify(result))
  }
})

test('EXIF orientation and downloaded image dimensions are normalized too', async () => {
  const rotated = await sharp(await image(296, 360)).jpeg().withMetadata({ orientation: 6 }).toBuffer()
  const result = await dimensions(await compressImageAsDataUrl(rotated, options))
  assert.ok(result.width > result.height)
  assert.ok(result.height >= 300)
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response(await image(296, 360))) as typeof fetch
  try {
    const remote = await dimensions(await fetchImageAsCompressedDataUrl('https://image.example/test.jpg', options))
    assert.equal(remote.width, 300)
  } finally { globalThis.fetch = original }
})
