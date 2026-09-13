import { getGitStatus } from './git.js'

export const name = 'dsh-git-statusline'
export const inject = ['webServer', 'sessions', 'loader']

function trustedHostsOf(ctx) {
  for (const entry of ctx.loader.entries()) {
    if (entry.options.name === 'connection') {
      return entry.options.config?.trustedHosts ?? []
    }
  }
  return []
}

function isTrustedRequest(req, trustedHosts) {
  const host = req.headers.host?.split(':')[0]?.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return true
  return host !== undefined && trustedHosts.some((value) => String(value).split(':')[0].toLowerCase() === host)
}

function readJson(req, maxBytes = 8192) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      raw += chunk
      if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
        reject(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(raw === '' ? {} : JSON.parse(raw))
      } catch {
        reject(new Error('invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function writeJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function sessionCwd(ctx, sessionId, fallbackCwd) {
  const cwd = ctx.sessions.get(sessionId)?.header.cwd
  if (typeof cwd === 'string' && cwd !== '') return cwd
  if (typeof fallbackCwd === 'string' && fallbackCwd !== '') return fallbackCwd
  return process.cwd()
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/git-statusline/status',
    handler: async (req, res) => {
      if (!isTrustedRequest(req, trustedHostsOf(ctx))) {
        writeJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        const body = await readJson(req)
        if (typeof body.sessionId !== 'string' || body.sessionId === '') {
          writeJson(res, 400, { ok: false, error: 'sessionId is required' })
          return
        }
        const cwd = sessionCwd(ctx, body.sessionId, body.cwd)
        // 慢速文件系统保护由 getGitStatus 内部承担：加长超时 + 结果缓存 + in-flight 去重
        writeJson(res, 200, { ok: true, value: await getGitStatus(cwd) })
      } catch (error) {
        writeJson(res, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }), 'dsh-git-statusline: status route')
}
