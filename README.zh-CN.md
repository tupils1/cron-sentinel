# cron-sentinel

[English](README.md) | **简体中文**

零配置的 GitHub Actions 定时任务（`schedule:`）漏跑哨兵。GitHub [官方文档](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)写明：高负载时定时任务会延迟，"部分排队任务可能被丢弃"；公开仓库 60 天没有活动，定时任务会被自动停用。这些情况发生时没有任何提醒，cron-sentinel 就是来补这个空的。

## 功能

- 读取默认分支上所有 workflow 的 `on.schedule` cron（按 UTC，或可选的 `timezone`）。支持 `*`、列表、范围、步长、`JAN`/`MON` 名称、`7` 表示周日，以及「日和星期同时限定时取并集」的 cron 规则。
- 在回看窗口内算出期望触发时间，和 runs API（`event=schedule`）逐一对照。
- **漏跑**：超过 `grace-minutes`（默认 90 分钟，因为 GitHub 经常延迟）仍没有对应的 run。
- **严重延迟**：开始时间晚于 `delay-threshold-minutes`（默认 30 分钟）。
- **持续失败**：最近的定时 run 失败时，issue 里附上 job、失败的 step、退出码、耗时和清洗过的日志尾部。
- **已停用 / 即将停用**：workflow 状态为 `disabled_inactivity` 时报告；默认分支 `inactivity-warn-days`（默认 45）天没有提交时提前预警。
- **每个 workflow 一个 issue**（用隐藏标记去重），之后更新同一个 issue，恢复正常后自动关闭。
- **可选补跑，默认关闭**：`rerun-on-incident: true` 时，只对**定时触发**的最近一次失败 run 重跑失败的 job；前提是 [githubstatus.com](https://www.githubstatus.com/api/v2/incidents.json) 报告了时间上重叠的 Actions 事故，且 `run_attempt <= max-reruns`。

不调用大模型，不依赖外部服务，不需要配置文件。

## 用法

见英文 README 的示例，或 [`examples/cron-sentinel.yml`](examples/cron-sentinel.yml)。

> ⚠️ 哨兵本身也是定时任务，同样可能漏跑。建议另加一个外部触发：用外部 cron 调 `workflow_dispatch`，或者放在另一个仓库里，用 `repository: owner/name` 加一个能读目标仓库的 token。

## 参数

| 参数 | 默认 | 含义 |
|---|---|---|
| `github-token` | `github.token` | 需要 `actions:read`、`contents:read`、`issues:write`（补跑需 `actions:write`） |
| `repository` | 当前仓库 | 要监控的 `owner/name` |
| `lookback-minutes` | `1440` | 回看窗口 |
| `delay-threshold-minutes` | `30` | 超过即算严重延迟 |
| `grace-minutes` | `90` | 过了这么久没有 run 才算漏跑 |
| `ignore-workflows` | | 跳过的文件名或路径，逗号或换行分隔 |
| `create-issues` | `true` | 开 / 更新 issue |
| `close-on-recovery` | `true` | 恢复后关闭 issue |
| `inactivity-warn-days` | `45` | 60 天停用前提前预警 |
| `rerun-on-incident` | `false` | 见上 |
| `max-reruns` | `1` | 重试上限 |
| `log-tail-lines` | `40` | issue 里附的日志行数 |
| `dry-run` | `false` | 只打日志不写入 |

## 局限

- workflow 文件按检查时的默认分支读取；窗口内改过 cron 的话，旧时段也按新 cron 算。
- workflow 创建之前的期望时间会跳过。
- 每 5 分钟这类高频任务常被 GitHub 稀释，建议调大 `grace-minutes` 或忽略。
