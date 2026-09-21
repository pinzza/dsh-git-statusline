window.__ModuleLoader__.load({
  id: 'dsh-git-statusline',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')

    const MONO = 'var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Consolas, monospace)'

    /**
     * 可选显示位置。
     * - `sidebar` 是 root scope（只能从 uiSession 绑定源取当前会话）；
     * - 其余三个是 session scope，组件会直接收到 `sessionId` prop；
     * - `slot: null` 表示不注册（关闭）。
     */
    const POSITIONS = [
      {
        id: 'sidebar',
        label: '侧边栏底部（默认）',
        slot: 'sidebar.footer.action',
        variant: 'sidebar',
        order: -100,
      },
      {
        id: 'header',
        label: '会话顶部标题后方',
        slot: 'conversation.session.header.actions',
        variant: 'header',
        order: 20,
      },
      {
        id: 'above',
        label: '对话框上方',
        slot: 'conversation.input.dock',
        variant: 'dock',
        order: 20,
      },
      {
        // composer.dock 与内置的用量条、上下文占比同处一行，宽度预算很紧，
        // 所以这里用无边框的纯文本形态，尽量少挤占那一行
        id: 'below',
        label: '对话框下方',
        slot: 'conversation.composer.dock',
        variant: 'strip',
        order: 20,
      },
      { id: 'off', label: '不显示', slot: null },
    ]

    const CONFIG_KEY = 'dsh-git-statusline:config'
    const DEFAULT_CONFIG = { position: 'sidebar' }

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
        fontFamily: MONO,
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
      chip: {
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        maxWidth: '340px',
        height: '24px',
        padding: '0 8px',
        color: 'var(--dsw-alias-label-tertiary)',
        background: 'var(--dsw-specific-tip, transparent)',
        border: '0.5px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.28))',
        borderRadius: '6px',
        cursor: 'default',
        fontFamily: MONO,
        fontSize: '12px',
        lineHeight: '18px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      },
      dockRow: {
        display: 'flex',
        justifyContent: 'center',
        width: '100%',
        padding: '2px 0',
      },
      strip: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        maxWidth: '100%',
        color: 'var(--dsw-alias-label-tertiary)',
        cursor: 'default',
        fontFamily: MONO,
        fontSize: '12px',
        lineHeight: '18px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      },
      settings: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '4px 0 8px',
        color: 'var(--dsw-alias-label-primary)',
      },
      settingsTitle: { fontSize: '15px', fontWeight: '600', lineHeight: '22px' },
      settingsNote: {
        margin: '0',
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: '13px',
        lineHeight: '20px',
      },
      settingsField: { display: 'flex', alignItems: 'center', gap: '10px' },
      settingsLabel: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' },
      select: {
        height: '30px',
        minWidth: '200px',
        padding: '0 8px',
        color: 'inherit',
        background: 'transparent',
        border: '0.5px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.28))',
        borderRadius: '6px',
        fontSize: '13px',
      },
      previewRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 12px',
        border: '0.5px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.28))',
        borderRadius: '8px',
      },
      previewLabel: {
        flex: 'none',
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: '13px',
      },
    }

    // ---------------------------------------------------------------------
    // 配置：localStorage 持久化 + 订阅。刻意不依赖 DSH 内部 store 模块，
    // 避免上游版本变动再次波及这个插件。
    // ---------------------------------------------------------------------
    function readConfig() {
      try {
        const raw = window.localStorage.getItem(CONFIG_KEY)
        if (raw === null) return { ...DEFAULT_CONFIG }
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return { ...DEFAULT_CONFIG }
        return { ...DEFAULT_CONFIG, ...parsed }
      } catch {
        return { ...DEFAULT_CONFIG }
      }
    }

    const configSource = {
      value: readConfig(),
      listeners: new Set(),
      getSnapshot() {
        return configSource.value
      },
      subscribe(listener) {
        configSource.listeners.add(listener)
        return () => {
          configSource.listeners.delete(listener)
        }
      },
      set(next) {
        configSource.value = next
        try {
          window.localStorage.setItem(CONFIG_KEY, JSON.stringify(next))
        } catch {
          // 隐私模式等场景下 localStorage 可能不可写：内存里仍然生效
        }
        for (const listener of [...configSource.listeners]) listener()
      },
    }

    function useConfig() {
      return React.useSyncExternalStore(
        React.useCallback((notify) => configSource.subscribe(notify), []),
        React.useCallback(() => configSource.getSnapshot(), []),
      )
    }

    function positionOf(id) {
      return POSITIONS.find((position) => position.id === id) ?? POSITIONS[0]
    }

    // ---------------------------------------------------------------------
    // 状态查询
    // ---------------------------------------------------------------------
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

    // DSH 0.1.6 起 `sessions.list` 的列表快照不再包含 `current`（当前会话选择已
    // 交给 ui-session 的 `current` 绑定源，值为 `{ key: sessionId, ... }`）。
    // session scope 的插槽会直接把 sessionId 传进来；root scope（侧边栏）走绑定源，
    // 旧版本（0.1.5）再回退到 `list.current`。
    function useCurrentSessionId(ctx, sessionIdProp, list) {
      const binding = GitStatusline.uiCurrent
      const fromBinding = React.useSyncExternalStore(
        React.useCallback((notify) => (binding ? binding.subscribe(notify) : () => {}), [binding]),
        React.useCallback(() => (binding ? binding.getSnapshot().key : undefined), [binding]),
      )
      return sessionIdProp ?? fromBinding ?? list.current
    }

    function useGitStatus(ctx, sessionIdProp) {
      const list = useSessionList(ctx)
      const sessionId = useCurrentSessionId(ctx, sessionIdProp, list)
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

      return status
    }

    // ---------------------------------------------------------------------
    // 渲染
    // ---------------------------------------------------------------------
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

    function statusParts(status) {
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
      return children
    }

    function GitStatusline(props) {
      const ctx = GitStatusline.ctx
      const variant = props.variant ?? 'sidebar'
      const status = useGitStatus(ctx, props.sessionId)
      if (!status?.isRepo) return null

      const title = tooltipFor(status)

      if (variant === 'sidebar') {
        if (!props.wide) {
          const mark = status.ahead > 0 ? '↑' : status.behind > 0 ? '↓' : status.dirty ? '±' : '✓'
          return React.createElement('div', {
            title,
            style: { ...styles.button, ...styles.rail },
            'aria-label': title,
          }, mark)
        }
        return React.createElement('div', {
          title,
          style: styles.button,
          'aria-label': title,
        }, statusParts(status))
      }

      if (variant === 'header') {
        return React.createElement('div', {
          title,
          style: styles.chip,
          'aria-label': title,
        }, statusParts(status))
      }

      if (variant === 'strip') {
        return React.createElement('div', {
          title,
          style: styles.strip,
          'aria-label': title,
        }, statusParts(status))
      }

      return React.createElement('div', { style: styles.dockRow },
        React.createElement('div', {
          title,
          style: styles.chip,
          'aria-label': title,
        }, statusParts(status)))
    }

    // 每个插槽注册自己的入口组件：把 variant 固化在闭包里，避免运行时再判定
    function entryFor(position) {
      return (props) => React.createElement(GitStatusline, { ...props, variant: position.variant })
    }

    // 各位置对应的示例形态，供设置页预览
    function previewStyle(variant) {
      if (variant === 'sidebar') return styles.button
      if (variant === 'strip') return styles.strip
      return styles.chip
    }

    function SettingsSection(props) {
      const config = useConfig()
      const position = positionOf(config.position)
      const sample = { branch: 'main', insertions: 16, deletions: 2, ahead: 2, behind: 0, dirty: true, upstream: 'origin/main' }

      return React.createElement('div', { style: styles.settings },
        React.createElement('div', { style: styles.settingsTitle }, 'Git 状态栏'),
        React.createElement('p', { style: styles.settingsNote },
          '选择 Git 状态栏的显示位置。它只读取当前会话工作目录的 git 状态，目录不是 git 仓库时不会显示；服务端做了 mtime 预检与结果缓存，工作区未变化时不拉起 git 进程。'),
        React.createElement('div', { style: styles.settingsField },
          React.createElement('label', { style: styles.settingsLabel, htmlFor: 'dsh-git-statusline-position' }, '显示位置'),
          React.createElement('select', {
            id: 'dsh-git-statusline-position',
            style: styles.select,
            value: position.id,
            onChange: (event) => configSource.set({ ...config, position: event.target.value }),
          }, POSITIONS.map((item) => React.createElement('option', { key: item.id, value: item.id }, item.label)))),
        React.createElement('div', { style: styles.previewRow },
          React.createElement('span', { style: styles.previewLabel }, '样式示例'),
          position.id === 'off'
            ? React.createElement('span', { style: styles.previewLabel }, '已关闭，状态栏不会出现在任何位置')
            : React.createElement('div', { style: previewStyle(position.variant) }, statusParts(sample))),
        React.createElement('p', { style: styles.settingsNote },
          '提示：“对话框下方”与内置的用量统计、上下文占比同处一行且宽度预算很紧，因此该位置使用不带边框的纯文本形态；悬停任意位置的状态栏都能看到完整信息。'),
        typeof props.close === 'function'
          ? React.createElement('div', null, React.createElement('button', {
            type: 'button',
            style: styles.select,
            onClick: () => props.close(),
          }, '完成'))
          : null)
    }

    // ---------------------------------------------------------------------
    // 插件装配
    // ---------------------------------------------------------------------
    const inject = ['slots', 'sessions', 'uiSession']

    function apply(ctx) {
      GitStatusline.ctx = ctx
      // ui-session 的绑定源：publishMain 时把主视图当前会话的绑定写进 value.key
      GitStatusline.uiCurrent = ctx.uiSession?.current ?? null

      // 当前生效的插槽注册（切换位置时先拆旧的再装新的）
      let disposePlacement = null
      const clearPlacement = () => {
        const dispose = disposePlacement
        disposePlacement = null
        if (dispose !== null) dispose()
      }
      const syncPlacement = () => {
        clearPlacement()
        const position = positionOf(configSource.getSnapshot().position)
        if (position.slot === null) return
        disposePlacement = ctx.slots.inject(position.slot, () => ctx.slots.register({
          name: position.slot,
          id: 'git-statusline',
          order: position.order,
        }, entryFor(position)))
      }

      ctx.effect(() => {
        const unsubscribe = configSource.subscribe(syncPlacement)
        syncPlacement()
        return () => {
          unsubscribe()
          clearPlacement()
        }
      }, 'dsh-git-statusline: placement')

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'git-statusline',
        order: 40,
        label: 'Git 状态栏',
      }, SettingsSection))
    }

    module.exports.apply = apply
    module.exports.inject = inject
    return module.exports
  },
})
