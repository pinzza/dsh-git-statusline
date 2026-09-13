import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getGitStatus, parseAheadBehind, parseNumstat, parsePorcelainV2 } from '../lib/git.js'

const exec = promisify(execFile)

test('parseNumstat sums text changes and ignores binary markers', () => {
  assert.deepEqual(parseNumstat('10\t2\ta.txt\n-\t-\timage.png\n6\t0\tb.txt\n'), {
    insertions: 16,
    deletions: 2,
  })
})

test('parseAheadBehind follows git rev-list behind/ahead order', () => {
  assert.deepEqual(parseAheadBehind('3\t2\n'), { ahead: 2, behind: 3 })
})

test('parsePorcelainV2 extracts branch, upstream, divergence and dirty state', () => {
  const parsed = parsePorcelainV2([
    '# branch.oid abc',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 abc abc tracked.txt',
    '? new.txt',
    'u UU N... 100644 100644 100644 100644 a b c conflict.txt',
  ].join('\n'))
  assert.deepEqual(parsed, {
    branch: 'main',
    upstream: 'origin/main',
    ahead: 2,
    behind: 1,
    dirty: true,
    untracked: 1,
    modified: 1,
    conflicts: 1,
  })
})

test('getGitStatus reports staged and unstaged line totals', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-git-statusline-'))
  await exec('git', ['init', '-q', dir])
  await exec('git', ['-C', dir, 'config', 'user.name', 'Test'])
  await exec('git', ['-C', dir, 'config', 'user.email', 'test@example.com'])
  await writeFile(join(dir, 'tracked.txt'), 'one\ntwo\n')
  await exec('git', ['-C', dir, 'add', 'tracked.txt'])
  await exec('git', ['-C', dir, 'commit', '-qm', 'initial'])
  await writeFile(join(dir, 'tracked.txt'), 'one\ntwo changed\nthree\n')

  const result = await getGitStatus(dir)
  assert.equal(result.isRepo, true)
  assert.equal(result.dirty, true)
  assert.equal(result.insertions, 2)
  assert.equal(result.deletions, 1)
  assert.equal(result.upstream, null)
})
