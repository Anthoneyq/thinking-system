import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fastGroups, startsTicked, batchAnswers } from '../shared/library-questions.js'

const dir = mkdtempSync(join(tmpdir(), 'thinking-batch-'))
const cfg = join(dir, 'config.json')
writeFileSync(cfg, JSON.stringify({ libraries: [{ id: 'test', name: 'Test business', dir, sources: [] }] }))
process.env.THINK_CONFIG = cfg
const lib = await import('../server/library/library.js')
const s = lib.load('test')
s.tree.branches = [{ id: 'field', name: 'Field app' }]
const topic = (id, extra = {}) => [id, { id, title: `Topic ${id}`, branch: 'field', status: 'open', items: [], summary: 'x', question: { q: `Who does ${id}?`, options: ['Staff 1', 'Principal 1'] }, ...extra }]
s.threads = Object.fromEntries([topic('a'), topic('b'), topic('c', { decision: 'An earlier rule' }), topic('d')])

test('groups narrow to what is in view and unsorted questions fall under their subject', () => {
  const qs = [{ id: 't:a', kind: 'thread', where: 'One › Two › Three' }, { id: 't:b', kind: 'thread', where: 'One › Two' }, { id: 'spot', kind: 'spot' }]
  const g = fastGroups(qs, [{ name: 'Owners', kind: 'owner', answers: ['Staff 1'], ids: ['t:a', 't:gone'] }])
  assert.deepEqual(g.map(x => [x.name, x.kind, x.questions.map(q => q.id)]), [['Owners', 'owner', ['t:a']], ['One › Two', 'subject', ['t:b']]])
  assert.equal(fastGroups(qs, []).length, 1)
})

test('a bulk answer skips decided topics by default and never reaches a claimed one', () => {
  assert.equal(startsTicked({}), true)
  assert.equal(startsTicked({ decided: 'x' }), false)
  assert.equal(startsTicked({ claimedBy: 'someone' }), false)
  const qs = [{ id: 't:a' }, { id: 't:b', claimedBy: 'someone' }, { id: 't:c' }, { id: 't:d' }]
  assert.deepEqual(batchAnswers(qs, { 't:a': ' Staff 1 ', 't:b': 'Staff 1', 't:d': '   ' }, new Set(['t:a', 't:b', 't:d'])), [{ qid: 't:a', text: 'Staff 1' }])
})

test('questions carry any existing decision', () => {
  const qs = lib.questions('test')
  assert.equal(qs.find(q => q.id === 't:c').decided, 'An earlier rule')
  assert.equal(qs.find(q => q.id === 't:a').decided, '')
})

test('a batch saves as one change and undoes as one, keeping what was there', () => {
  const r = lib.change('test', { kind: 'answers', group: 'Owners', answers: [{ qid: 't:a', text: 'Staff 1' }, { qid: 't:c', text: 'Principal 1' }, { qid: 't:missing', text: 'x' }, { qid: 't:b', text: '  ' }] })
  assert.equal(r.saved, 2)
  const st = lib.load('test')
  assert.equal(st.threads.a.status, 'decided')
  assert.equal(st.threads.c.decision, 'Principal 1')
  assert.equal(st.threads.b.status, 'open')
  const entry = st.log.find(e => e.id === r.batch)
  assert.equal(entry.what, 'Decided 2 in one go: Owners')
  assert.match(entry.before, /An earlier rule/)
  assert.equal(st.outbox.at(-1).kind, 'answers')
  assert.equal(lib.questions('test').some(q => q.id === 't:a'), false)

  lib.change('test', { kind: 'editThread', thread: 'a', decision: 'Edited by hand' })
  const u = lib.change('test', { kind: 'undoAnswers', batch: r.batch })
  assert.equal(u.restored, 2)
  assert.equal(st.threads.a.status, 'open')
  assert.equal(st.threads.a.decision, undefined)
  assert.equal(st.threads.c.decision, 'An earlier rule')
  assert.equal(st.threads.c.answeredBy, undefined)
  assert.equal(st.answers.length, 0)
  assert.equal(lib.change('test', { kind: 'undoAnswers', batch: r.batch }).restored, 0)
})

test('undo leaves a topic answered again after the batch', async () => {
  const r = lib.change('test', { kind: 'answers', answers: [{ qid: 't:d', text: 'Staff 1' }] })
  await new Promise(res => setTimeout(res, 5))
  lib.change('test', { kind: 'answer', body: { qid: 't:d', text: 'Principal 1' } })
  assert.equal(lib.change('test', { kind: 'undoAnswers', batch: r.batch }).restored, 0)
  assert.equal(lib.load('test').threads.d.decision, 'Principal 1')
})

test('a teammate batch replays once on the reader', () => {
  const op = { id: 'mate-1', at: new Date().toISOString(), by: 'mate', kind: 'answers', answers: [{ qid: 't:b', text: 'Staff 1' }] }
  assert.equal(lib.applyRemote('test', [op]), 1)
  assert.equal(lib.applyRemote('test', [op]), 0)
  assert.equal(lib.load('test').threads.b.answeredBy, 'mate')
})

test('groups are a change, so they reach the team', () => {
  lib.change('test', { kind: 'groups', list: [{ name: 'Owners', kind: 'owner', answers: ['Staff 1'], ids: ['t:a'] }] })
  assert.equal(lib.view('test').groups[0].name, 'Owners')
  assert.equal(lib.load('test').outbox.at(-1).kind, 'groups')
})

test('a rewrite that replaced a decision is put back from the record, unless it was edited or answered since', async () => {
  const st = lib.load('test')
  const at = new Date(Date.now() + 1000).toISOString()
  st.threads.e = { id: 'e', title: 'E', branch: 'field', status: 'decided', items: [], decision: 'What the rewrite wrote', answeredBy: 'mate', answeredAt: at }
  st.threads.f = { id: 'f', title: 'F', branch: 'field', status: 'decided', items: [], decision: 'A later edit', answeredBy: 'mate', answeredAt: at, editedAt: new Date(Date.now() + 2000).toISOString() }
  st.answers.push({ at, by: 'mate', thread: 'e', a: 'What the person said' }, { at, by: 'mate', thread: 'f', a: 'What the person said' })
  lib.save('test', true)
  await new Promise(r => setTimeout(r, 30))
  const fresh = await import('../server/library/library.js?again')
  const again = fresh.load('test')
  assert.equal(again.threads.e.decision, 'What the person said')
  assert.equal(again.threads.e.answeredBy, 'mate')
  assert.equal(again.threads.f.decision, 'A later edit')
})

test.after?.(() => rmSync(dir, { recursive: true, force: true }))
