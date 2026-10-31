import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { questionsInBranch } from '../shared/library-questions.js'

const dir = mkdtempSync(join(tmpdir(), 'thinking-questions-'))
const cfg = join(dir, 'config.json')
writeFileSync(cfg, JSON.stringify({ libraries: [{ id: 'test', name: 'Test business', dir, sources: [] }] }))
process.env.THINK_CONFIG = cfg
const lib = await import('../server/library/library.js')
const s = lib.load('test')
s.tree.branches = [{ id: 'field', name: 'Field app', children: [{ id: 'photos', name: 'Photos' }] }, { id: 'marketing', name: 'Marketing' }]
const index = new Map([['field', { id: 'field' }], ['photos', { id: 'photos', parent: 'field' }], ['marketing', { id: 'marketing' }]])
s.items = Object.fromEntries(['photos', 'marketing'].map(branch => [branch, { id: branch, text: branch, branch, placed: true, rule: 'same', links: [], date: '2026-10-31', file: 'test.txt' }]))
s.threads = Object.fromEntries(['photos', 'marketing'].map(branch => [branch, { id: branch, title: branch, branch, status: 'unsettled', items: [branch], summary: 'Fixture topic', question: { q: `Decide ${branch}?` } }]))

test('branch questions, personal skips, persistence and answering from Later', () => {
  let v = lib.view('test')
  let scoped = questionsInBranch(v.questions, v.threads, index, 'field')
  assert.deepEqual(scoped.map(q => q.id), ['spot', 't:photos'])
  assert.deepEqual(scoped[0].items.map(i => i.id), ['photos'])
  assert.equal(v.byBranch.field.need, scoped.length)
  assert.equal(questionsInBranch(v.questions, v.threads, index, 'missing').length, 0)
  assert.equal(questionsInBranch(v.questions, v.threads, index, null).length, v.questions.length)
  const overlap = { id: 'overlap', kind: 'tree', a: { id: 'photos' }, b: { id: 'marketing' } }
  const place = { id: 'place', kind: 'place', guess: 'photos' }
  assert.deepEqual(questionsInBranch([overlap, place], {}, index, 'field'), [overlap, place])
  assert.deepEqual(questionsInBranch([overlap, place], {}, index, 'marketing'), [overlap])

  lib.change('test', { kind: 'answer', body: { qid: 't:photos', skip: true } })
  lib.change('test', { kind: 'answer', body: { qid: 'spot', skip: true, items: ['photos'] } })
  v = lib.view('test')
  scoped = questionsInBranch(v.questions, v.threads, index, 'field')
  assert.equal(scoped.length, 2)
  assert.ok(scoped.every(q => !q.now && q.skipped))
  assert.equal(v.byBranch.field.now, 0)
  assert.equal(s.answers.length, 0)
  assert.equal(s.corrections.length, 0)
  assert.equal(s.outbox?.length || 0, 0, 'personal skips must not sync as team decisions')
  assert.equal(lib.ruleStats(s).same.checked, 0)
  assert.equal(s.items.photos.by, undefined)
  assert.ok(v.questions.find(q => q.id === 't:marketing').now)
  lib.save('test', true)
  assert.ok(JSON.parse(readFileSync(join(dir, 'library.json'))).snoozed['s:photos'])

  lib.change('test', { kind: 'answer', body: { qid: 'spot', checks: [{ id: 'photos', ok: true }] } })
  lib.change('test', { kind: 'answer', body: { qid: 't:photos', text: 'Use job folders' } })
  v = lib.view('test')
  assert.equal(questionsInBranch(v.questions, v.threads, index, 'field').length, 0)
  assert.equal(lib.ruleStats(s).same.checked, 1)
  assert.equal(s.threads.photos.decision, 'Use job folders')
  assert.equal(s.items.marketing.by, undefined, 'saving a scoped sample must not confirm other branches')
  assert.ok(v.questions.find(q => q.id === 't:marketing').now)
  lib.save('test', true)
  rmSync(dir, { recursive: true, force: true })
})
