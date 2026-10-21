import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { downloadFile } from '../utils/storage.js'
import { STORAGE_ROOT } from '../utils/paths.js'
import { extractVideoPoster } from '../utils/video-poster.js'
import { replaceVideoAudio, resolveRedubAudio, validateRedubOptions } from './redub-media.js'

const activeRedubs = new Set<number>()

function localVideoPath(videoUrl: string): string {
  const relative = videoUrl.replace(/^\//, '')
  if (!relative.startsWith('static/')) throw new Error('原视频地址无效')
  const videoPath = path.resolve(STORAGE_ROOT, relative.slice('static/'.length))
  if (!videoPath.startsWith(path.resolve(STORAGE_ROOT) + path.sep) || !fs.existsSync(videoPath)) {
    throw new Error('原视频文件不存在，请重新生成视频')
  }
  if (!fs.realpathSync(videoPath).startsWith(fs.realpathSync(STORAGE_ROOT) + path.sep)) {
    throw new Error('原视频文件路径无效')
  }
  return videoPath
}

export async function createVideoRedub(storyboardId: number, body: Record<string, unknown>): Promise<number> {
  if (!Number.isInteger(storyboardId) || storyboardId <= 0) throw new Error('镜头 ID 无效')
  if (activeRedubs.has(storyboardId)) throw new Error('该镜头正在重新配音，请等待完成')
  const options = validateRedubOptions(body.offset_seconds ?? 0, body.volume ?? 1)
  const audioPath = resolveRedubAudio(body.audio_url)
  activeRedubs.add(storyboardId)
  try {
    const [storyboard] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId))
    if (!storyboard || storyboard.deletedAt) throw new Error('镜头不存在')
    const [episode] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, storyboard.episodeId))
    if (!episode || episode.deletedAt) throw new Error('剧集不存在')
    const histories = await db.select().from(schema.sysTask).where(and(
      eq(schema.sysTask.storyboardId, storyboardId), eq(schema.sysTask.type, 'video'), eq(schema.sysTask.status, 'completed'),
    ))
    const mainVideo = storyboard.videoUrl || storyboard.composedVideoUrl || ''
    const sourceVideo = typeof body.source_video_url === 'string' ? body.source_video_url : mainVideo
    const sourceHistory = histories.find(task => task.localPath === sourceVideo || task.resultUrl === sourceVideo)
    if (!sourceVideo || (sourceVideo !== mainVideo && !sourceHistory)) throw new Error('请选择该镜头已生成的视频')
    // Prefer the cached video when the selected history entry still uses a temporary URL.
    const source = sourceHistory?.localPath || sourceVideo
    if (!/^https?:\/\//i.test(source)) localVideoPath(source)
    const timestamp = now()
    const result = await db.insert(schema.sysTask).values({
      type: 'video', storyboardId, dramaId: episode.dramaId,
      provider: 'ffmpeg', model: 'audio-replacement', prompt: '重新配音',
      params: JSON.stringify({ operation: 'redub', sourceVideoUrl: source, audioUrl: body.audio_url, ...options }),
      status: 'processing', createdAt: timestamp, updatedAt: timestamp,
    })
    const taskId = getInsertId(result)
    void processRedub(taskId, source, audioPath, options)
      .catch(error => console.error(`[Redub] Could not persist task ${taskId}:`, error))
      .finally(() => activeRedubs.delete(storyboardId))
    return taskId
  } catch (error) {
    activeRedubs.delete(storyboardId)
    throw error
  }
}

async function processRedub(taskId: number, source: string, audioPath: string, options: ReturnType<typeof validateRedubOptions>) {
  let downloadedSource: string | undefined
  let outputPath: string | undefined
  try {
    if (/^https?:\/\//i.test(source)) downloadedSource = await downloadFile(source, 'redub-temp', 120_000)
    const videoPath = localVideoPath(downloadedSource || source)
    const outputUrl = `static/videos/${randomUUID()}.mp4`
    outputPath = path.join(STORAGE_ROOT, 'videos', path.basename(outputUrl))
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    await replaceVideoAudio(videoPath, audioPath, outputPath, options)
    await extractVideoPoster(outputUrl)
    // The main storyboard URL changes only after the user selects this version.
    await db.update(schema.sysTask).set({
      status: 'completed', resultUrl: outputUrl, localPath: outputUrl,
      completedAt: now(), updatedAt: now(),
    }).where(eq(schema.sysTask.id, taskId))
  } catch (error) {
    if (outputPath) fs.rmSync(outputPath, { force: true })
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`[Redub] Task ${taskId} failed:`, detail)
    const message = /[\u4e00-\u9fff]/.test(detail) && detail.length < 100
      ? detail : '配音处理失败，请检查视频和音频文件是否可播放'
    await db.update(schema.sysTask).set({ status: 'failed', errorMsg: message, updatedAt: now() })
      .where(eq(schema.sysTask.id, taskId))
  } finally {
    if (downloadedSource) fs.rmSync(path.join(STORAGE_ROOT, 'redub-temp', path.basename(downloadedSource)), { force: true })
  }
}
