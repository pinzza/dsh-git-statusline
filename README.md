# dsh-git-statusline

DSH Web 侧边栏底部的紧凑 Git 状态插件，参考 ccstatusline-zh 的 Git widgets。

显示格式：

```text
main (+16,-2) ↑2 ↓1
```

- `(+16,-2)`：已暂存和未暂存文本改动的新增/删除行数。
- `↑2`：当前分支相对 upstream 待推送的提交数。
- `↓1`：当前分支相对 upstream 待拉取的提交数。
- `✓`：工作区干净，且相对 upstream 没有领先或落后。
- 无 upstream 时不会显示错误的“已推送”结论，悬停提示会说明无法判断。

## 安装

在此目录的父目录执行：

```bash
dsh plugin --profile web add ./dsh-git-statusline
```

安装后重启 `dsh web`。如果 Web 服务由其他进程管理，重启该进程并刷新 `http://127.0.0.1:3080`。

卸载：

```bash
dsh plugin --profile web remove dsh-git-statusline
```

## 验证

```bash
npm test --prefix dsh-git-statusline
```

插件每 5 秒固定轮询一次，并在窗口重新获得焦点时立即刷新。同一时刻最多一个进行中的请求（客户端并发去重）。Git 命令均为只读操作，设置 `GIT_OPTIONAL_LOCKS=0`。

> **为什么 5 秒轮询不烧 CPU**：服务端每次请求先做 mtime 预检（stat `.git/HEAD` 与 `.git/index`，毫秒级）——工作区未变直接命中缓存，**连 git 进程都不拉起**；只有 index/HEAD 变化（如 git add/commit）才真正执行 git。因此轮询本身成本几乎为零，无需事件驱动或长间隔。

> **性能保护**（机制借鉴自 ccstatusline 的 git 缓存设计）：Windows 挂载路径（WSL 的 `/mnt/*`，即 9P/v9fs/drvfs）上 git 遍历工作树极慢（分钟级），服务端针对慢速文件系统：
> - **mtime 预检**：每次请求先 stat `.git/HEAD` 与 `.git/index`（两次 stat，毫秒级）——工作区未变则直接命中缓存，**连 git 进程都不拉起**；只有 index/HEAD 变化（如 git add/commit）才真正执行 git；
> - **超时 90 秒**（快路径 5 秒），保证查询能跑完而非被反复杀掉；
> - **完整行数统计**：`diff --numstat` 只比较已跟踪文件，实测秒级（远快于 status 的全工作树扫描），因此慢速路径同样返回 `(+x,-y)`；
> - **结果缓存**（慢速 60s / 快速 15s，从完成时刻起算；失败/超时只缓存 10s）+ **in-flight 去重**——同目录并发请求共享一次 git 执行。
>
> 因此 Windows 目录下的仓库可以正常显示完整 Git 状态（分支、`(+x,-y)` 行数、未跟踪数、前后提交数），且**工作区未变化时零 git 进程开销**。代价是工作区真实变化时首次查询较慢（数秒到一分钟级）。如需更快刷新，仍建议把仓库放在 Linux 原生文件系统（ext4，如 `/home`）路径下。
