import { Hono } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest } from '../utils/response.js'
import { generateEpisodeSubtitles, getEpisodeSubtitles, mergeEpisodeVideos, saveEpisodeSubtitles } from '../services/ffmpeg-merge.js'
import { toSnakeCase } from '../utils/transform.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

app.get('/episodes/:id/subtitles', async (c) => {
  return success(c, { content: await getEpisodeSubtitles(Number(c.req.param('id'))) })
})

app.post('/episodes/:id/subtitles/generate', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const [episode] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!episode) return badRequest(c, '剧集不存在')
  try {
    return success(c, { content: await generateEpisodeSubtitles(episodeId, episode.dramaId) })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

app.put('/episodes/:id/subtitles', async (c) => {
  try {
    const body = await c.req.json()
    const path = await saveEpisodeSubtitles(Number(c.req.param('id')), body?.content)
    return success(c, { path })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// POST /episodes/:id/merge — 拼接镜头视频(body.storyboard_ids 可选,只拼所选)
app.post('/episodes/:id/merge', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!ep) return badRequest(c, '剧集不存在')

  let storyboardIds: number[] | undefined
  try {
    const body = await c.req.json()
    if (Array.isArray(body?.storyboard_ids)) {
      storyboardIds = body.storyboard_ids.map(Number).filter(Boolean)
    }
  } catch { /* 无 body 时拼接全部 */ }

  try {
    logTaskStart('MergeAPI', 'episode-merge', { episodeId, dramaId: ep.dramaId, storyboardIds })
    const mergeId = await mergeEpisodeVideos(episodeId, ep.dramaId, storyboardIds)
    logTaskSuccess('MergeAPI', 'episode-merge', { episodeId, mergeId })
    return success(c, { merge_id: mergeId, status: 'processing' })
  } catch (err: any) {
    logTaskError('MergeAPI', 'episode-merge', { episodeId, error: err.message })
    return badRequest(c, err.message)
  }
})

// GET /episodes/:id/merge — 查询最新拼接状态
app.get('/episodes/:id/merge', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const merges = await db.select().from(schema.videoMerges)
    .where(eq(schema.videoMerges.episodeId, episodeId))


  const latest = merges[merges.length - 1]
  if (!latest) return success(c, null)

  return success(c, toSnakeCase(latest))
})

// GET /episodes/:id/merges — 成片列表(全部拼接记录,新的在前)
app.get('/episodes/:id/merges', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const merges = await db.select().from(schema.videoMerges)
    .where(and(eq(schema.videoMerges.episodeId, episodeId), isNull(schema.videoMerges.deletedAt)))
  merges.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  return success(c, merges.slice(0, 30).map(toSnakeCase))
})

export default app
