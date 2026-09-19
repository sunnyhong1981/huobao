import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VolcEngineVideoAdapter } from '../src/services/adapters/volcengine-video'

const adapter = new VolcEngineVideoAdapter()

test('Dreamina gateway sends role-aware content for reference images', () => {
  const request = adapter.buildGenerateRequest({
    provider: 'volcengine',
    baseUrl: 'https://gateway.example',
    apiKey: 'test-key',
    model: 'dreamina-seedance-2-0-mini-260615',
  } as any, {
    id: 1,
    model: 'dreamina-seedance-2-0-mini-260615',
    prompt: 'A marching scene',
    referenceImageUrls: JSON.stringify(['https://example.com/reference.png']),
    referenceVideoUrls: null,
    referenceAudioUrls: null,
    duration: 5,
    aspectRatio: '16:9',
    resolution: '720p',
  } as any)

  assert.equal(request.url, 'https://gateway.example/v1/video/generations')
  assert.equal((request.body as any).images, undefined)
  assert.deepEqual((request.body as any).content, [
    { type: 'text', text: 'A marching scene' },
    { type: 'image_url', image_url: { url: 'https://example.com/reference.png' }, role: 'reference_image' },
  ])
})

test('Dreamina gateway polling accepts the OpenAI-compatible task envelope', () => {
  const response = {
    code: 0,
    message: 'success',
    data: {
      task_id: 'task-123',
      status: 'SUCCESS',
      result_url: 'https://example.com/result.mp4',
    },
  }

  assert.deepEqual(adapter.parsePollResponse(response), {
    status: 'completed',
    videoUrl: 'https://example.com/result.mp4',
  })
  assert.equal(adapter.extractVideoUrl(response), 'https://example.com/result.mp4')
})

test('Dreamina gateway polling reports a wrapped terminal failure', () => {
  assert.deepEqual(adapter.parsePollResponse({
    data: { status: 'FAIL', fail_reason: 'content rejected' },
  }), {
    status: 'failed',
    error: 'content rejected',
  })
})
