/**
 * Agent 聊天路由 — 非流式版本
 */
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { validAgentTypes } from '../agents/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { mastra } from '../mastra/index.js'
import { db, getInsertId, schema } from '../db/index.js'
import { success, badRequest, now } from '../utils/response.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

// Mastra v1.17 的 ToolCallChunk / ToolResultChunk 结构：
// { type: 'tool-call', payload: { toolCallId, toolName, args } }
// { type: 'tool-result', payload: { toolCallId, toolName, result, isError } }
function normalizeToolName(entry: any) {
  return entry?.payload?.toolName
    || entry?.toolName
    || entry?.tool?.toolName
    || entry?.tool?.id
    || entry?.name
    || entry?.type
    || null
}

function normalizeToolResult(entry: any) {
  const result = entry?.payload?.result ?? entry?.result ?? entry?.payload?.output ?? entry?.output ?? entry?.data ?? null
  return typeof result === 'string' ? result : JSON.stringify(result)
}

function validateAgentRequest(agentType: string, body: any) {
  if (!validAgentTypes.includes(agentType)) {
    return `无效的 Agent 类型：${agentType}`
  }
  if (!body?.episode_id || !body?.drama_id) return '需要 drama_id 与 episode_id'
  if (!mastra.getAgent(agentType)) return 'Agent 不存在'
  return null
}

async function executeAgent(agentType: string, body: any) {
  const { message, drama_id, episode_id } = body
  const agent = mastra.getAgent(agentType)!

  logTaskStart('Agent', agentType, { dramaId: drama_id, episodeId: episode_id, message })
  logTaskPayload('Agent', `${agentType} input`, body)

  const requestContext = buildAgentRequestContext({
    episodeId: episode_id,
    dramaId: drama_id,
    modelOverride: body.model || undefined,
    textConfigId: body.config_id || undefined,
  })

  const startTime = performance.now()

  try {
    const result = await agent.generate(
      [{ role: 'user', content: message }],
      { maxSteps: 20, requestContext },
    )

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
    logTaskSuccess('Agent', agentType, { elapsedSeconds: elapsed })

    // 收集所有 tool calls 和 results
    const toolCalls = result.toolCalls || []
    const toolResults = result.toolResults || []
    const normalizedToolCalls = toolCalls.map((tc: any) => ({
      toolName: normalizeToolName(tc),
      args: tc?.payload?.args ?? tc?.args ?? tc?.input ?? null,
    }))
    const normalizedToolResults = toolResults.map((tr: any) => ({
      toolName: normalizeToolName(tr),
      result: normalizeToolResult(tr),
    }))

    logTaskProgress('Agent', 'tool-summary', {
      agentType,
      toolCalls: normalizedToolCalls.map((tc: any) => tc.toolName),
      toolResults: normalizedToolResults.map((tr: any) => tr.toolName),
    })
    logTaskPayload('Agent', `${agentType} tool-results`, normalizedToolResults)

    return {
      type: 'done',
      text: result.text || '',
      toolCalls: normalizedToolCalls,
      toolResults: normalizedToolResults,
    }
  } catch (err: any) {
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
    logTaskError('Agent', agentType, { elapsedSeconds: elapsed, error: err.message })
    console.error(err.stack || err)
    throw err
  }
}

// POST /agent/:type/start — 将长耗时 Agent 放入后台，前端改为轮询任务状态。
// 目前剧本改写使用此入口，避免浏览器或中间代理断开长达数分钟的 HTTP 请求。
app.post('/:type/start', async (c) => {
  const agentType = c.req.param('type')
  const body = await c.req.json()
  const validationError = validateAgentRequest(agentType, body)
  if (validationError) return badRequest(c, validationError)

  const ts = now()
  const insert = await db.insert(schema.agentTasks).values({
    agentType,
    dramaId: Number(body.drama_id),
    episodeId: Number(body.episode_id),
    status: 'processing',
    createdAt: ts,
    updatedAt: ts,
  })
  const jobId = getInsertId(insert)

  void executeAgent(agentType, body)
    .then(async result => {
      await db.update(schema.agentTasks)
        .set({ status: 'completed', result: JSON.stringify(result), completedAt: now(), updatedAt: now() })
        .where(eq(schema.agentTasks.id, jobId))
    })
    .catch(async (err: any) => {
      await db.update(schema.agentTasks)
        .set({ status: 'failed', errorMsg: err.message || 'Agent 执行失败', updatedAt: now() })
        .where(eq(schema.agentTasks.id, jobId))
    })

  return success(c, { job_id: jobId, status: 'processing' })
})

// GET /agent/:type/jobs/:id — 查询后台 Agent 任务状态。
app.get('/:type/jobs/:id', async (c) => {
  const agentType = c.req.param('type')
  if (!validAgentTypes.includes(agentType)) return badRequest(c, '无效的 Agent 类型')
  const id = Number(c.req.param('id'))
  const [job] = await db.select().from(schema.agentTasks)
    .where(and(eq(schema.agentTasks.id, id), eq(schema.agentTasks.agentType, agentType)))
  return success(c, job || null)
})

// POST /agent/:type/chat — 非流式 Agent 对话（保留给需要同步结果的短操作）
app.post('/:type/chat', async (c) => {
  const agentType = c.req.param('type')
  const body = await c.req.json()
  const validationError = validateAgentRequest(agentType, body)
  if (validationError) return badRequest(c, validationError)

  try {
    return success(c, await executeAgent(agentType, body))
  } catch (err: any) {
    return badRequest(c, err.message || 'Agent 执行失败')
  }
})

// GET /agent/:type/debug
app.get('/:type/debug', async (c) => {
  const agentType = c.req.param('type')
  if (!validAgentTypes.includes(agentType)) return badRequest(c, '无效的 Agent 类型')
  return success(c, { agent_type: agentType, valid: true })
})

export default app
