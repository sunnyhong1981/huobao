import fs from 'node:fs'
import path from 'node:path'
import { ffmpeg, checkFfmpegSuite } from '../utils/ffmpeg.js'
import { STORAGE_ROOT } from '../utils/paths.js'

export interface RedubOptions {
  offsetSeconds: number
  volume: number
}

export function validateRedubOptions(offset: unknown = 0, volume: unknown = 1): RedubOptions {
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0 || offset > 300) {
    throw new Error('配音起始时间必须为 0 至 300 秒')
  }
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 2) {
    throw new Error('配音音量必须为 0 至 200%')
  }
  return { offsetSeconds: offset, volume }
}

export function resolveRedubAudio(audioUrl: unknown): string {
  if (typeof audioUrl !== 'string' || !/^\/?static\/uploads\/[^/\\]+\.(mp3|wav|m4a|aac)$/i.test(audioUrl)) {
    throw new Error('请先上传有效的配音文件')
  }
  const uploadsDir = path.resolve(STORAGE_ROOT, 'uploads')
  const audioPath = path.join(uploadsDir, path.basename(audioUrl))
  if (!fs.existsSync(audioPath)) throw new Error('配音文件不存在，请重新上传')
  if (path.dirname(fs.realpathSync(audioPath)) !== fs.realpathSync(uploadsDir)) {
    throw new Error('配音文件路径无效')
  }
  const stat = fs.statSync(audioPath)
  if (!stat.isFile() || stat.size === 0 || stat.size > 20 * 1024 * 1024) {
    throw new Error('配音文件需为非空文件且不超过 20MB')
  }
  return audioPath
}

export function probeRedubMedia(filePath: string): Promise<import('fluent-ffmpeg').FfprobeData> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (error, metadata) => error ? reject(error) : resolve(metadata))
  })
}

export async function replaceVideoAudio(videoPath: string, audioPath: string, outputPath: string, options: RedubOptions) {
  const suite = await checkFfmpegSuite()
  if (!suite.ffmpeg || !suite.ffprobe) throw new Error('视频处理工具不可用，请联系管理员')
  const [video, audio] = await Promise.all([probeRedubMedia(videoPath), probeRedubMedia(audioPath)])
  const videoStream = video.streams.find(stream => stream.codec_type === 'video')
  if (!videoStream) throw new Error('原文件中没有可用的视频画面')
  const duration = Number(videoStream.duration || video.format.duration)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取原视频时长')
  if (!audio.streams.some(stream => stream.codec_type === 'audio')) throw new Error('配音文件中没有可用的音轨')
  if (options.offsetSeconds >= duration) throw new Error('配音起始时间必须早于视频结束时间')

  const delayMs = Math.round(options.offsetSeconds * 1000)
  const filters = [
    'asetpts=PTS-STARTPTS',
    `volume=${options.volume}`,
    `adelay=${delayMs}:all=1`,
    'apad',
    `atrim=duration=${duration}`,
  ]
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg({ timeout: 180 })
        .input(videoPath)
        .input(audioPath)
        .outputOptions(['-map 0:v:0', '-map 1:a:0', '-c:v copy', '-c:a aac', '-b:a 192k', '-ar 48000', '-ac 2', '-movflags +faststart'])
        .audioFilters(filters)
        .duration(duration)
        .on('end', () => resolve())
        .on('error', reject)
        .save(outputPath)
    })
  } catch (error) {
    fs.rmSync(outputPath, { force: true })
    throw error
  }
  return duration
}
