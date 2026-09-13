window.__ModuleLoader__.load({
  id: 'dsh-git-statusline',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')

    const styles = {
      button: {
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        height: '28px',
        padding: '0 8px',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'transparent',
        border: '0',
        borderRadius: '6px',
        cursor: 'default',
        fontFamily: 'var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Consolas, monospace)',
        fontSize: '12px',
        lineHeight: '18px',
        letterSpacing: '0',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      },
      branch: {
        color: 'var(--dsw-alias-label-tertiary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      changes: { color: 'var(--dsw-alias-state-warning-primary, #b7791f)' },
      ahead: { color: 'var(--dsw-alias-state-success-primary, #16825d)' },
      behind: { color: 'var(--dsw-alias-state-error-primary, #c2413b)' },
      clean: { color: 'var(--dsw-alias-label-caption)' },
      rail: {
        width: '32px',
        padding: '0',
        justifyContent: 'center',
      },
    }

    async function fetchStatus(sessionId, cwd, signal) {
      const response = await fetch('/git-statusline/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, ...(cwd ? { cwd } : {}) }),
        signal,
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.ok !== true) throw new Error(body?.error ?? `HTTP ${response.status}`)
      return body.value
    }

    function useSessionList(ctx) {
      return React.useSyncExternalStore(
        React.useCallback((notify) => ctx.sessions.list.subscribe(notify), [ctx]),
        React.useCallback(() => ctx.sessions.list.getSnapshot(), [ctx]),
      )
    }

    function tooltipFor(status) {
      const details = [`分支: ${status.branch}`]
      if (status.insertions || status.deletions) details.push(`未提交改动: +${status.insertions}, -${status.deletions}`)
      else if (status.modified) details.push(`已修改文件: ${status.modified} 个`)
      else if (status.dirty) details.push('存在未跟踪文件或二进制改动')
      else details.push('工作区干净')
      if (status.upstream) details.push(`相对 ${status.upstream}: 待推送 ${status.ahead}, 待拉取 ${status.behind}`)
      else details.push('未配置 upstream，无法判断推送状态')
      if (status.untracked) details.push(`未跟踪文件: ${status.untracked}`)
      if (status.conflicts) details.push(`冲突: ${status.conflicts}`)
      return details.join('\n')
    }

    function GitStatusline({ wide }) {
      const ctx = GitStatusline.ctx
      const list = useSessionList(ctx)
      const sessionId = list.current
      const cwd = sessionId ? list.byId[sessionId]?.cwd : undefined
      const [status, setStatus] = React.useState(null)
      const inFlight = React.useRef(false)

      const refresh = React.useCallback((signal) => {
        if (!sessionId) {
          setStatus(null)
          return Promise.resolve()
        }
        // 并发去重：上一次请求未返回时跳过本次，避免慢文件系统上 git 进程叠加
        if (inFlight.current) return Promise.resolve()
        inFlight.current = true
        return fetchStatus(sessionId, cwd, signal)
          .then(setStatus)
          .catch((error) => {
            if (error?.name !== 'AbortError') setStatus(null)
          })
          .finally(() => {
            inFlight.current = false
          })
      }, [sessionId, cwd])

      React.useEffect(() => {
        const controller = new AbortController()
        void refresh(controller.signal)
        // 固定轮询：mtime 预检保证工作区未变时请求仅为两次 stat（毫秒级），
        // 真正的 git 进程只在 index/HEAD 变化时才拉起，因此轮询间隔无需拉长
        const timer = window.setInterval(() => void refresh(controller.signal), 5000)
        const onFocus = () => void refresh(controller.signal)
        window.addEventListener('focus', onFocus)
        return () => {
          controller.abort()
          window.clearInterval(timer)
          window.removeEventListener('focus', onFocus)
        }
      }, [refresh])

      if (!status?.isRepo) return null
      if (!wide) {
        const mark = status.ahead > 0 ? '↑' : status.behind > 0 ? '↓' : status.dirty ? '±' : '✓'
        return React.createElement('div', {
          title: tooltipFor(status),
          style: { ...styles.button, ...styles.rail },
          'aria-label': tooltipFor(status),
        }, mark)
      }

      const children = [
        React.createElement('span', { key: 'branch', style: styles.branch }, status.branch),
      ]
      if (status.insertions || status.deletions) {
        children.push(React.createElement('span', { key: 'changes', style: styles.changes }, `(+${status.insertions},-${status.deletions})`))
      } else if (status.dirty) {
        // 无行数统计时的回退标注（如 diff 超时或二进制改动）：只标未跟踪/冲突
        const labels = []
        if (status.untracked > 0) labels.push(`未跟踪${status.untracked}`)
        if (status.conflicts > 0) labels.push(`冲突${status.conflicts}`)
        if (labels.length === 0) labels.push('有改动')
        children.push(React.createElement('span', { key: 'dirty', style: styles.changes }, `(${labels.join(' ')})`))
      }
      if (status.ahead > 0) children.push(React.createElement('span', { key: 'ahead', style: styles.ahead }, `↑${status.ahead}`))
      if (status.behind > 0) children.push(React.createElement('span', { key: 'behind', style: styles.behind }, `↓${status.behind}`))
      if (!status.dirty && status.ahead === 0 && status.behind === 0) {
        children.push(React.createElement('span', { key: 'clean', style: styles.clean }, '✓'))
      }

      return React.createElement('div', {
        title: tooltipFor(status),
        style: styles.button,
        'aria-label': tooltipFor(status),
      }, children)
    }

    const inject = ['slots', 'sessions']
    function apply(ctx) {
      GitStatusline.ctx = ctx
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'git-statusline',
        order: -100,
      }, GitStatusline))
    }

    module.exports.apply = apply
    module.exports.inject = inject
    return module.exports
  },
})
