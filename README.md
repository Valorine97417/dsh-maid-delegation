# dsh-maid-delegation

DSH 小困插件 · 子智能体委派：独立提供提示词纪律，版本 0.1.0。

## 功能与边界

- 仅注册普通 `systemPrompt.section`，不实现调度器，不改并发/深度/权限限制，不注册工具、路由、preset、seed 或 profile patch。
- 默认文本逐字复用迁移前静态纪律（历史来源：原 preset 的 `cordis.patch.yml:23-38`，现已迁出）；校验依据为 `D:/Works By DSH/_probe/preset-delegation-migration-20261018T082752Z/source/cordis.patch.yml` 备份快照，三处 persona 对应文本一致。不是旧 runtime 常量的另一套措辞。保留原始 workflow 等表述，不擅改语义。
- 本目录实现不改源 preset/profile。若安装环境仍保留旧静态纪律，并用会重复注入；需由迁移流程另行处理。`enabled: false` 只停用本插件，不会移除其他 persona 中的规则。
- 普通 section 受调用上下文 scope 影响；存在 `complete: true` 的自定义 preset 时，宿主可仅保留 complete 段落，普通 section 不会进入最终提示词。本插件不劫持 complete，不修改 personaPrefix，不绕过宿主装配规则。
- 文本规则不等于硬执行：不保证所有会话强制委派。AgentTeams 协议、工具可用性、委派深度、宿主权限及更高优先级指令仍以宿主为准。

## 接入与配置

使用宿主已有的本地插件安装/加载方式解析此目录。`package.json` 按源插件已知规范声明 `dsh.bundle.patch: ./cordis.patch.yml`；该 patch 仅加载本插件，配置 `enabled: true`，不插入 preset/seed/routes。`exports` 与 `files` 均包含该真实入口；MIT LICENSE 随包携带。下例为对应 Cordis 条目，可在其 `config` 中自定义。本轮未安装到当前运行宿主，安装/装配仍需实际宿主验收。

```yaml
- id: maid-delegation
  name: dsh-maid-delegation
  config:
    enabled: true
    # guidance: |
    #   这里写完整的自定义委派纪律。
```

上面 `name` 仅在包已由宿主解析到时有效，不应直接假设本地绝对目录已注册。启用需要对应条目 `config.enabled: true`（或省略），停用设 `false` 后由宿主正常重载；具体 profile 装配/安装命令依赖真实部署，本轮未验证，不编造一条“安装即生效”的通用 CLI。

| 参数 | 默认值 | 行为 |
| --- | --- | --- |
| `enabled` | `true`（省略时启用） | 精确 `false` 时不注册 section、监听或 timer |
| `guidance` | 源静态纪律 | 非空字符串取 trim 后全文；空白/非字符串回落默认 |

按纯文本注册（`interpolate: false`），`{{name}}` 不作为宿主变量插值。配置修改需按宿主正常流程先卸载再加载；同一 ctx 内重复 apply 保留首次配置，不做热替换。停用现有挂载也需要卸载；重复调用 `apply(ctx, { enabled: false })` 不是卸载接口。

## 生命周期与诊断

- 唯一 section 名：`dsh-maid-delegation:delegation-guidance`。
- 顺序为 `getSectionOrder('TOOL_SUBAGENT') + 1`，缺失/非有限数值回退 `2801`。
- 即刻探测一次；服务缺失/读取异常/接口未就绪时每 1000ms 重试，合计最多 20 次（正常计时末次约 19 秒，事件循环延迟可能更长）。超限显式 warn，服务晚到需重载插件。
- 成功后停止重试。section/顺序 API 抛错时记录 warn 并停止，不盲目重复插入可能已产生副作用的 section；修复后卸载重载。
- 使用 `ctx.effect(() => cleanup)` 把清理函数登记到真实 Fiber 生命周期；卸载时清除 timer、调用 section disposer、删除当前 ctx 状态；卸载再挂可重新注册。不同 ctx 独立。不依赖 `ctx.on('dispose')` 普通事件。
- 日志优先用 `ctx.logger`，缺失或抛错时回落 console。第三方 disposer 抛错会记录诊断并完成本插件其余清理，但不能保证损坏的服务撤销其内部副作用。

## API 依据与验证等级

历史实现参考：迁移前 `D:/Works By DSH/dsh-maid-preset/lib/index.js:265-358`（该段已由迁移流程移除），以及该仓 `package.json`（ESM、Cordis peer）。源仓与父目录未找到 `AGENTS.md`。

只读检查本机 ComfyUI 插件依赖缓存中的 `@deepseek-ai/dsh-system-prompt` 0.2.0-rc.2：`section({ name, order, text, interpolate })` 返回 Cordis disposer；同层重名抛错；装配按 scope 合并；complete 段落最终独占提示词。用户给的 `D:/DeepSeek Harness/Works/dsh-maid-comfyui/node_modules` 不存在，实际缓存位于 `D:/Works By DSH/dsh-maid-comfyui/node_modules/.pnpm/`。

基础 19 项测试使用真实接口形状的 mock（`ctx.get/effect`、section disposer、同层重名）。额外 3 项导入缓存 Cordis 4.0.1 的真实 Context/Fiber，验证 restart/unload 与等待 timer 清理；systemPrompt 仍为契约 mock，非真实 system-prompt 服务或当前宿主安装/装配/会话集成。已读真实 `src/fiber.ts:402-418,675-695`：effect setup 立即执行并收集 cleanup，Fiber 卸载清理 effects，不发出普通 dispose 事件。只有 Cordis peer，无运行时依赖，无推测性 dsh manifest 字段。

## 本地验收

Node v24.21.0 实测，内建 `node:test`，无需安装依赖即可测试。

```bash
# 工作目录 D:/Works By DSH/dsh-maid-delegation
node --test
node --check lib/index.js
node scripts/verify-source.mjs 'D:/Works By DSH/_probe/preset-delegation-migration-20261018T082752Z/source/cordis.patch.yml'
npm pack --dry-run
```

真实 Cordis 生命周期回归命令（路径指本机只读缓存，迁移到其他机器时设置为实际 Cordis 入口）：

```bash
CORDIS_MODULE='D:/Works By DSH/dsh-maid-comfyui/node_modules/.pnpm/@deepseek-ai+cordis@4.0.1_@_35b5bc140c27f271c4932dbee92a1c1c/node_modules/@deepseek-ai/cordis/lib/index.js' node --test scripts/verify-cordis.mjs
```

上命令 3/3 通过：真实 Fiber restart 后注册/卸载计数 `2/1`，最终卸载 `2/2`；等待期间 unload 后服务晚到不重挂；等待期 restart 清旧 timer/WeakMap 后新期只挂一次。结合基础测试共 22 项通过，0 失败/跳过/取消。

`node --test`：19 个基础测试，19 通过，0 失败/跳过/取消。覆盖默认/禁用/自定义/空白回退、顺序回退、服务晚到、等待卸载、20 次上限、重复 apply（等待/已挂载）、get/section/order/effect 异常、错误 disposer、日志回落、卸载再挂和 ctx 隔离、最小 manifest。源对照命令额外校验迁移前备份快照 3/3 处静态纪律完全一致（只读快照，不依赖迁出后的源仓仍有规则，不算 node:test 测试数）。`npm pack --dry-run` 核对 bundle 入口与 LICENSE 实际入包。

本机 Bash 没有 `npm` 命令（初次 `npm pack --dry-run` 返回 127），实际成功执行：

```bash
node 'C:/Users/Kayle/AppData/Local/Programs/npm/package/bin/npm-cli.js' pack --dry-run --cache 'D:/Works By DSH/dsh-maid-delegation/.npm-cache'
```

干跑包内共 7 文件：`LICENSE`、`README.md`、`TROUBLESHOOTING.md`、`cordis.patch.yml`、`lib/index.js`、`lib/index.d.ts`、`package.json`；不产出 tgz，不安装插件。测试与源对照脚本留在本地开发目录，不随包分发。

无远程仓、无 push，本目录实现未修改源 preset/profile 或宿主配置。故障处理见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)。
