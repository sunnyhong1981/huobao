import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

test('project audio is shared by shots, deduplicated, ownership checked and protected while referenced', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'huobao-project-audio-'))
  process.env.SQLITE_PATH = path.join(temp, 'db.sqlite3')
  process.env.STORAGE_PATH = path.join(temp, 'static')
  fs.mkdirSync(path.join(temp, 'static/uploads'), { recursive: true })
  fs.writeFileSync(path.join(temp, 'static/uploads/a.wav'), Buffer.from('audio bytes'))
  fs.writeFileSync(path.join(temp, 'static/uploads/b.wav'), Buffer.from('audio bytes'))
  const { db, schema } = await import('../src/db/index.js')
  const { eq } = await import('drizzle-orm')
  const { registerProjectAudio, listProjectAudio, setStoryboardProjectAudio, updateProjectAudio } = await import('../src/services/project-audio.js')
  const ts = new Date().toISOString()
  const [project, foreign] = await db.insert(schema.dramas).values([{ title: 'a', createdAt: ts, updatedAt: ts }, { title: 'b', createdAt: ts, updatedAt: ts }]).returning()
  const [ep] = await db.insert(schema.episodes).values({ dramaId: project.id, episodeNumber: 1, title: 'episode', createdAt: ts, updatedAt: ts }).returning()
  const [first, second] = await db.insert(schema.storyboards).values([
    { episodeId: ep.id, storyboardNumber: 1, createdAt: ts, updatedAt: ts },
    { episodeId: ep.id, storyboardNumber: 2, referenceAudioUrls: JSON.stringify(['static/uploads/b.wav']), createdAt: ts, updatedAt: ts },
  ]).returning()
  const [audio, duplicate] = await Promise.all([
    registerProjectAudio(project.id, { name: '配音', path: 'static/uploads/a.wav' }),
    registerProjectAudio(project.id, { name: '重复', path: 'static/uploads/b.wav' }),
  ])
  assert.equal(audio.id, duplicate.id)
  assert.equal(duplicate.reused, true)
  const imported = await listProjectAudio(project.id)
  assert.equal(imported.length, 1)
  assert.equal(imported[0].referenceCount, 1)
  const [legacy] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, second.id))
  assert.deepEqual(JSON.parse(legacy.referenceAudioUrls!), ['static/uploads/a.wav'])
  await setStoryboardProjectAudio(first.id, [audio.id])
  assert.equal((await listProjectAudio(project.id))[0].referenceCount, 2)
  const otherAudio = await registerProjectAudio(foreign.id, { name: 'foreign', path: 'static/uploads/a.wav' })
  await assert.rejects(setStoryboardProjectAudio(first.id, [otherAudio.id]), /当前项目/)
  await assert.rejects(setStoryboardProjectAudio(first.id, [audio.id, audio.id]), /3 条不同/)
  await assert.rejects(updateProjectAudio(project.id, audio.id, undefined, true), /仍被镜头引用/)
  await updateProjectAudio(project.id, audio.id, '新名称')
  assert.equal((await listProjectAudio(project.id))[0].name, '新名称')
  await setStoryboardProjectAudio(first.id, [])
  await setStoryboardProjectAudio(second.id, [])
  await updateProjectAudio(project.id, audio.id, undefined, true)
  assert.equal((await listProjectAudio(project.id)).length, 0)
  assert.ok(fs.existsSync(path.join(temp, 'static/uploads/a.wav')), 'original audio files remain for task history')
  await assert.rejects(registerProjectAudio(project.id, { path: 'static/uploads/../../secret.wav' }), /有效/)
  fs.rmSync(temp, { recursive: true, force: true })
})
