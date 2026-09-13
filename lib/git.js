import { spawn } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024

// WSL 上 Windows 挂载（9P/v9fs/drvfs）路径：git status 遍历工作树极慢且吃 CPU。
// 常见挂载点：/mnt/c、/mnt/d…；/home/code 之类可能是指向 /mnt/* 的软链接，realpath 后同样命中。
const SLOW_FS_RE = /^(\/mnt\/|\/run\/media\/|\/media\/)/

export function isSlowFilesystem(cwd) {
  try {
    return SLOW_FS_RE.test(realpathSync(cwd))
  } catch {
    return SLOW_FS_RE.test(cwd)
  }
}

export class GitStatusError extends Error {
  constructor(message, code = 'git-error') {
    super(message)
    this.code = code
  }
}

// 每目录结果缓存：慢速文件系统 60s TTL，快速文件系统 15s TTL。
// 关键：缓存附带 .git/HEAD 与 .git/index 的 mtime 快照——工作区未变时（mtime 一致）
// 直接命中缓存，连 git 进程都不 spawn（借鉴 ccstatusline 的 mtime 预检机制，成本仅两次 stat）。
const cache = new Map()

// 读取仓库 .git 元数据（HEAD/index mtime），用于缓存新鲜度判断。
// 返回 null 表示无法判定（非仓库/权限问题），此时退化为纯 TTL 判断。
function getRepoMetadata(cwd) {
  try {
    const gitDir = join(realpathSync(cwd), '.git')
    const head = statSync(join(gitDir, 'HEAD'))
    const index = statSync(join(gitDir, 'index'))
    return { headMtimeMs: head.mtimeMs, indexMtimeMs: index.mtimeMs }
  } catch {
    return null
  }
}

// 缓存条目新鲜度：HEAD/index mtime 未变 且 在条目自身 TTL 内 → 新鲜
function isCacheFresh(entry, metadata, now) {
  if (metadata) {
    if (entry.headMtimeMs !== metadata.headMtimeMs || entry.indexMtimeMs !== metadata.indexMtimeMs) {
      return false
    }
  }
  return entry.ttlMs === 0 || now - entry.createdAt <= entry.ttlMs
}

function runGit(cwd, args, timeoutMs = 5000) {
  const fullArgs = ['-C', cwd, '--no-pager', '-c', 'color.ui=false', ...args]
  return new Promise((resolve, reject) => {
    const child = spawn('git', fullArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    })
    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let settled = false

    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(() => reject(new GitStatusError(`git timed out after ${timeoutMs}ms`, 'timeout')))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL')
        finish(() => reject(new GitStatusError('git output exceeded 2 MiB', 'output-limit')))
        return
      }
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      finish(() => reject(new GitStatusError(`cannot run git: ${error.message}`)))
    })
    child.on('close', (code) => {
      finish(() => {
        if (code === 0) resolve(stdout)
        else reject(new GitStatusError(stderr.trim() || `git exited with ${String(code)}`))
      })
    })
  })
}

export function parseNumstat(output) {
  let insertions = 0
  let deletions = 0
  for (const line of output.split('\n')) {
    if (line === '') continue
    const [added, removed] = line.split('\t', 2)
    if (added !== '-' && /^\d+$/.test(added ?? '')) insertions += Number(added)
    if (removed !== '-' && /^\d+$/.test(removed ?? '')) deletions += Number(removed)
  }
  return { insertions, deletions }
}

export function parseAheadBehind(output) {
  const match = output.trim().match(/^(\d+)\s+(\d+)$/)
  if (match === null) return { ahead: 0, behind: 0 }
  return { behind: Number(match[1]), ahead: Number(match[2]) }
}

export function parsePorcelainV2(output) {
  let branch = 'HEAD'
  let upstream = null
  let ahead = 0
  let behind = 0
  let dirty = false
  let untracked = 0
  let modified = 0
  let conflicts = 0

  for (const line of output.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice(14).trim()
    else if (line.startsWith('# branch.upstream ')) upstream = line.slice(18).trim()
    else if (line.startsWith('# branch.ab ')) {
      const match = line.match(/\+([0-9]+)\s+-([0-9]+)/)
      if (match !== null) {
        ahead = Number(match[1])
        behind = Number(match[2])
      }
    } else if (line.startsWith('? ')) {
      dirty = true
      untracked += 1
    } else if (line.startsWith('u ')) {
      dirty = true
      conflicts += 1
    } else if (/^[12] /.test(line)) {
      dirty = true
      modified += 1
    }
  }

  return { branch, upstream, ahead, behind, dirty, untracked, modified, conflicts }
}

export async function getGitStatus(cwd) {
  // 慢速文件系统（/mnt 等 9P 挂载）上 git status 遍历工作树极慢（分钟级，瓶颈是
  // --untracked-files=normal 的全工作树扫描）；但 diff --numstat 只比较已跟踪文件，
  // 实测快得多（秒级），因此恢复完整行数统计 (+x,-y)。超时仍按慢速 90s / 快速 5s。
  const slow = isSlowFilesystem(cwd)
  const timeoutMs = slow ? 90000 : 5000
  const metadata = getRepoMetadata(cwd)
  const cached = cache.get(cwd)
  const now = Date.now()
  const ttlMs = slow ? 60000 : 15000
  // mtime 预检：HEAD/index 未变且 TTL 内 → 直接命中缓存，零 git 进程
  if (cached?.value && isCacheFresh(cached, metadata, now)) return cached.value
  if (cached?.inflight) return cached.inflight

  const promise = (async () => {
    let porcelain
    try {
      porcelain = await runGit(cwd, ['status', '--porcelain=v2', '--branch', '--untracked-files=normal'], timeoutMs)
    } catch (error) {
      return {
        isRepo: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    const state = parsePorcelainV2(porcelain)
    const [unstaged, staged] = await Promise.all([
      runGit(cwd, ['diff', '--numstat', '--no-ext-diff'], timeoutMs).catch(() => ''),
      runGit(cwd, ['diff', '--cached', '--numstat', '--no-ext-diff'], timeoutMs).catch(() => ''),
    ])
    const worktree = parseNumstat(unstaged)
    const index = parseNumstat(staged)

    return {
      isRepo: true,
      branch: state.branch,
      upstream: state.upstream,
      ahead: state.ahead,
      behind: state.behind,
      insertions: worktree.insertions + index.insertions,
      deletions: worktree.deletions + index.deletions,
      dirty: state.dirty,
      untracked: state.untracked,
      modified: state.modified,
      conflicts: state.conflicts,
    }
  })()

  // 记录 in-flight，同目录并发请求共享同一个查询（去重防叠加）；
  // promise 完成时写回 value，TTL 内后续请求直接命中缓存不再拉起 git
  const entry = {
    inflight: promise,
    value: null,
    createdAt: now,
    ttlMs,
    headMtimeMs: metadata?.headMtimeMs ?? null,
    indexMtimeMs: metadata?.indexMtimeMs ?? null,
  }
  cache.set(cwd, entry)
  // 容量控制：超过 50 个目录时淘汰最旧条目，防止长期运行内存增长
  if (cache.size > 50) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  promise.then((value) => {
    entry.value = value
    // 失败/超时结果只缓存 10 秒（避免状态条长时间显示错误），成功结果保持原 TTL
    if (value.isRepo === false) entry.ttlMs = 10000
  }).finally(() => {
    entry.inflight = null
  }).catch(() => {})
  return promise
}
