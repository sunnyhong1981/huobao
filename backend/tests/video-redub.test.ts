import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

test('redubbing keeps the video stream and original main version, pads audio, and validates inputs', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'huobao-redub-'))
  const require = createRequire(import.meta.url)
  const ffmpegBin = process.env.FFMPEG_BIN || require('ffmpeg-static')
  const ffprobeBin = process.env.FFPROBE_BIN || require('ffprobe-static').path
  process.env.SQLITE_PATH = path.join(temp, 'db.sqlite3')
  process.env.HUOBAO_DATA_DIR = temp
  process.env.FFMPEG_BIN = ffmpegBin
  process.env.FFPROBE_BIN = ffprobeBin
  delete process.env.STORAGE_PATH
  const run = (args: string[]) => {
    const result = spawnSync(ffmpegBin, ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const videoRel = 'static/videos/original.mp4'
  const audioRel = 'static/uploads/new-voice.wav'
  const videoPath = path.join(temp, videoRel)
  const audioPath = path.join(temp, audioRel)
  fs.mkdirSync(path.dirname(videoPath), { recursive: true })
  fs.mkdirSync(path.dirname(audioPath), { recursive: true })
  run(['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'mpeg4', '-c:a', 'aac', '-y', videoPath])
  run(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.5', '-y', audioPath])
  const originalHash = createHash('sha256').update(fs.readFileSync(videoPath)).digest('hex')
  const { db, schema } = await import('../src/db/index.js')
  const { eq } = await import('drizzle-orm')
  const { default: route } = await import('../src/routes/storyboards.js')
  const { probeRedubMedia, validateRedubOptions, resolveRedubAudio } = await import('../src/services/redub-media.js')
  const timestamp = new Date().toISOString()
  const drama = await db.insert(schema.dramas).values({ title: 'test', createdAt: timestamp, updatedAt: timestamp }).returning()
  const episode = await db.insert(schema.episodes).values({ dramaId: drama[0].id, episodeNumber: 1, title: 'test episode', createdAt: timestamp, updatedAt: timestamp }).returning()
  const storyboard = await db.insert(schema.storyboards).values({ episodeId: episode[0].id, storyboardNumber: 1, videoUrl: videoRel, createdAt: timestamp, updatedAt: timestamp }).returning()
  await db.insert(schema.sysTask).values({ type: 'video', storyboardId: storyboard[0].id, status: 'completed', localPath: videoRel, createdAt: timestamp, updatedAt: timestamp })
  const endpoint = `/${storyboard[0].id}/redub`
  const request = (body: unknown) => route.request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  assert.throws(() => validateRedubOptions(-1), /起始/)
  assert.throws(() => validateRedubOptions(0, 3), /音量/)
  assert.throws(() => resolveRedubAudio('static/uploads/../../secret.wav'), /上传有效/)
  assert.equal((await request({ audio_url: audioRel, source_video_url: 'https://unrelated.example/video.mp4' })).status, 400)
  const response = await request({ audio_url: audioRel, source_video_url: videoRel, offset_seconds: 0.25, volume: 0.8 })
  assert.equal(response.status, 201)
  const taskId = (await response.json() as any).data.task_id
  assert.equal((await request({ audio_url: audioRel })).status, 400)
  let task
  for (let attempt = 0; attempt < 300; attempt++) {
    ;[task] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, taskId))
    if (task.status !== 'processing') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(task?.status, 'completed', task?.errorMsg || '')
  const outputPath = path.join(temp, task!.localPath!)
  const videoHash = (file: string) => run(['-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'hash', '-'])
  assert.equal(videoHash(outputPath), videoHash(videoPath), 'encoded video packets must be identical')
  const audioHash = (file: string) => run(['-i', file, '-map', '0:a:0', '-f', 'hash', '-'])
  assert.notEqual(audioHash(outputPath), audioHash(videoPath))
  const metadata = await probeRedubMedia(outputPath)
  assert.ok(Math.abs(Number(metadata.format.duration) - 2) < 0.1)
  assert.ok(Number(metadata.streams.find(stream => stream.codec_type === 'audio')?.duration) >= 1.95)
  const [unchanged] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboard[0].id))
  assert.equal(unchanged.videoUrl, videoRel)
  assert.equal(createHash('sha256').update(fs.readFileSync(videoPath)).digest('hex'), originalHash)

  const badOffset = await request({ audio_url: audioRel, offset_seconds: 10 })
  const badId = (await badOffset.json() as any).data.task_id
  let failed
  for (let attempt = 0; attempt < 100; attempt++) {
    ;[failed] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, badId))
    if (failed.status !== 'processing') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(failed?.status, 'failed')
  assert.match(failed?.errorMsg || '', /早于视频结束/)
  fs.rmSync(temp, { recursive: true, force: true })
})
