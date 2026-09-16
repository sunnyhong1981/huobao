import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VolcEngineVideoAdapter } from '../src/services/adapters/volcengine-video'

const adapter = new VolcEngineVideoAdapter()

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
