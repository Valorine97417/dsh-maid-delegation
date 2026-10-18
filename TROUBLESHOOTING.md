# 故障排查

## 真实问题记录

当前运行宿主的插件事故：暂未遇到（未安装）。开发审查确实复现过下面的生命周期缺陷并已修复；基础测试为契约 mock，额外回归使用真实缓存 Cordis Context/Fiber，不冒充线上事故或宿主会话验收。

### 本次审查实际遇到：普通 dispose 事件不能代替 Fiber 生命周期

- 症状：初版 `ctx.on('dispose')` 在真实 Cordis 4.0.1 中，restart 后与最终卸载后均是注册/卸载计数 `1/0`；mock 手动发 dispose 的测试产生假阳性。
- 原因：`ctx.on` 仅注册普通事件，Fiber `_unload` 清理其 effects/disposables，不发出 dispose 事件，所以 timer、WeakMap 与 section disposer 没被本插件清理。
- 解法：已读真实 effect API，改为 `ctx.effect(() => cleanup)`，在插入 section 或启动 timer 之前登记清理；mock 也改为 effect 契约。
- 验证：真实 Cordis Context/Fiber 的 3 项回归通过：restart `2/1`、最终 unload `2/2`；等待期 unload 后服务晚到不重挂；等待期 restart 清旧 timer/状态并只挂新期一次。命令见 README。

### 本次开发实际遇到：参考依赖路径不存在

- 症状：读取 `D:/DeepSeek Harness/Works/dsh-maid-comfyui/node_modules` 返回 `NOT_FOUND`。
- 原因：用户提供的是参考位置，本机真实项目在 `D:/Works By DSH/dsh-maid-comfyui`；其 pnpm 缓存路径并非原参考路径。
- 解法：经只读定位后读取实际缓存 `@deepseek-ai/dsh-system-prompt` 的 `lib/index.js`，不安装、不改动参考项目，不把缓存版本称作当前宿主版本。
- 验证：已确认 `section()` 返回 disposer、同层重复名抛错、scope 合并与 complete 独占行为；运行宿主兼容性仍未验证。

### 本次开发实际遇到：Bash 找不到 npm

- 症状：`npm pack --dry-run` 返回 `/usr/bin/bash: line 1: npm: command not found`（127）。
- 原因：该 Bash PATH 无 npm 可执行入口；本机有 npm.cmd 与独立 npm CLI 脚本。
- 解法：使用 Node 调用实际入口，并将 cache 限定在本目录：`node 'C:/Users/Kayle/AppData/Local/Programs/npm/package/bin/npm-cli.js' pack --dry-run --cache 'D:/Works By DSH/dsh-maid-delegation/.npm-cache'`。
- 验证：干跑成功，7 个发布文件，包含 `cordis.patch.yml` 和 `LICENSE`；未安装或产生 tgz。

### 本次挂载实际遇到：cordis.patch.yml 漏写顶级 - insert: 导致被重写冲刷

- 症状：挂载重启后，`cordis.yml` 中手动写入的插件声明条目消失，插件未被宿主加载。
- 原因：`cordis.patch.yml` 顶级漏写 `- insert:` 原语，宿主启动重装配识别不出 patch 操作而跳过，且重新生成 `cordis.yml` 时覆盖了手动写入的条目。
- 解法：在 `cordis.patch.yml` 补全顶层 `- insert:` 原语，并在 `desktop/cordis.yml` 对齐声明。
- 验证：重启后 `cordis.yml` 稳定保留插件声明。

## 预防性排查（契约测试或源码推导，非已发生事故）

| 症状 | 原因 | 解法 | 验证 |
| --- | --- | --- | --- |
| 没有挂载日志，section 不存在 | 本插件 `enabled: false`，或本地包未被加载 | 检查实际 Cordis 条目及包解析，启用后按宿主流程重载 | 应出现含 section 名的“已挂载”日志；disabled mock 验证服务调用为 0 |
| 日志提示“等待超限 (20 次)” | systemPrompt 未就绪，或启动顺序晚于等待窗口 | 确认服务就绪后重载插件，不增加并发限额 | 查看一次成功挂载；mock 验证恰好 20 次后不再调用 |
| 日志提示读取服务失败或 section 不可用 | `ctx.get` 异常或服务接口版本不匹配 | 根据异常检查宿主接口；修复后重载 | get/接口异常测试确认显式日志、等待恢复 |
| 日志提示 section 挂载失败 | 重名、顺序服务异常或非 disposer 接口 | 解除冲突/升级兼容服务；卸载后重载，不重复 apply 赌重试 | 对应失败日志含原始异常；mock 验证不盲重试 |
| 成功挂载但某会话仍看不到规则 | scope 不可见，或 complete 自定义 preset 排除了普通 section | 检查该会话的最终提示词装配与 preset；需规则时由配置维护者自行合并到 complete 文本 | 在宿主最终提示词中搜 section 或独特句；本轮未实测该集成行为 |
| 委派规则出现两遍 | 原 preset 静态人设仍有同一规则，或人为加载了其他副本 | 明确由哪一处提供；本轮不改原仓，可先停用本插件 | 对照最终提示词；`enabled: false` 不会删除旧人设纪律 |
| 模型未委派/无法委派 | 提示词非调度器；工具不可用、深度/权限限制或更高优先级协议生效 | 检查实际工具和宿主限制，不靠本插件绕过限制 | 查看工具可用列表与真实执行记录，不仅看提示词措辞 |
| 修改配置后仍旧文本 | 相同 ctx 重复 apply 防重，配置不支持原地热替换 | 正常卸载再加载 | mock 验证卸载后可挂新 guidance |
| 卸载时提示 disposer 异常 | 服务提供的 disposer 抛错 | 修复宿主服务；必要时按正常流程重启宿主清理服务状态 | 日志含原始异常，mock 确认其余监听清理；不承诺第三方副作用已撤销 |

## 重跑离线测试

在本目录执行 `node --test`（19/19 通过）与 `node --check lib/index.js`。静态迁移一致性可执行：

```bash
node scripts/verify-source.mjs 'D:/Works By DSH/_probe/preset-delegation-migration-20261018T082752Z/source/cordis.patch.yml'
```

预期输出：`Static guidance parity: 3/3 copies identical`。该命令只读迁移前备份快照，不依赖迁出后的源仓仍有规则，不改原仓或 profile。
