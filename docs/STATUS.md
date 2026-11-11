# 进行中的事

同一时间只由一个执行者修改主目录 `media-workspace` 的 `dev`。开工前登记任务，完成并提交后删行；已完成内容看提交记录和 `docs/decisions/`。

| 事项 | 谁在做 | 目录 / 分支 | 状态 | 下一步 |
|---|---|---|---|---|
| 素材库删除入口验收 | Codex / 负责人 | media-workspace / dev | 已实现并通过独立审查及自动检查 | 工作台点验删除、引用保护与撤销；通过后删行 |
| 封面越界与标题截断提示 | Codex | cover-warnings-worktree / detached（基于 dev 2b04f78） | 待验收 | check、test、e2e 已通过；负责人验收后再合入 dev |
