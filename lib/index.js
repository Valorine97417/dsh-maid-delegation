export const name = 'dsh-maid-delegation';
export const SECTION_NAME = 'dsh-maid-delegation:delegation-guidance';
export const RETRY_INTERVAL_MS = 1000;
export const MAX_ATTEMPTS = 20;

// 原样复用 dsh-maid-preset/cordis.patch.yml:23-38 的静态纪律。
// 不使用旧 runtime DEFAULT_DELEGATION_GUIDANCE 的另一套措辞。
export const DEFAULT_DELEGATION_GUIDANCE = `【子智能体委派纪律（强制执行，优先级高于你的惰性）】
你的默认反应必须是「这活儿能不能丢给子智能体」，而不是自己一件件抠。判断标准只有一条——这件事是否需要读大量文件、跑多步检索、或预计超过 3 次工具调用？是，就立刻委派，别犹豫、别先自己试两下。

强触发场景（出现任意一条即委派）：
· 审计 / 排查 / 调研 / 对比 / 全库检索 / 跨多文件理解 / 读长日志 / 抓取分析网页 / 批量改动 / 多方案评估。
· 需要翻大量源码或文档、但最终只要一个结论或一份改动清单。

并行纪律：有 2 个以上互不依赖的子项时，必须在同一条消息里一次性发起多个 subagent，不要串行等一个再发下一个。

选型：全新、自包含的任务用 subagent；要吃当前对话上下文的后续分析用 subagent_fork；几十个对象的批量扇出用 workflow（pipeline 或 parallel）。

委派 prompt 必须自带：绝对路径、验收标准、输出格式（结论优先、事实清单、改动点，禁止心路历程与复述需求）。

收口纪律：子智能体的产出只是原料，不是最终答卷。由你亲自提炼去噪，用女仆口吻向老大汇报核心结论。

唯一例外：任务能在一次工具调用里做完（单次 read / grep / glob / 一条简单命令），自己做更快，那就自己做。`;

// 同一 ctx 的重复 apply 不注册第二个 section、timer 或生命周期 effect。
const states = new WeakMap();

function log(ctx, level, message, error) {
  const text = `${name}: ${message}${error === undefined ? '' : `: ${error?.message ?? error}`}`;
  try {
    if (typeof ctx.logger?.[level] === 'function') {
      ctx.logger[level](text);
      return;
    }
  } catch { /* 日志服务失败时仍保留可见诊断。 */ }
  console[level === 'info' ? 'info' : 'warn'](text);
}

/** Cordis ESM 入口。配置变更应由宿主先卸载、再 apply。 */
export function apply(ctx, config = {}) {
  if (states.has(ctx) || config.enabled === false) return;
  const text = typeof config.guidance === 'string' && config.guidance.trim()
    ? config.guidance.trim() : DEFAULT_DELEGATION_GUIDANCE;
  const state = { disposed: false, timer: null, sectionDispose: null, attempts: 0 };
  states.set(ctx, state);

  const cleanup = () => {
    if (state.disposed) return;
    state.disposed = true;
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
    try { state.sectionDispose?.(); }
    catch (error) { log(ctx, 'warn', 'section 卸载失败', error); }
    state.sectionDispose = null;
    if (states.get(ctx) === state) states.delete(ctx);
  };

  // Cordis 4 的 on('dispose') 只是普通事件，Fiber._unload 不会发出它。
  // effect 立即执行 setup，并把返回的 cleanup 收进真实 fiber disposables。
  // 必须先登记清理才能允许插入 section 或启动等待 timer。
  try {
    if (typeof ctx.effect !== 'function') throw new TypeError('ctx.effect is not a function');
    ctx.effect(() => cleanup, `${name}:lifecycle`);
  } catch (error) {
    log(ctx, 'warn', '生命周期 effect 注册失败，未挂载', error);
    cleanup();
    return;
  }

  const attempt = () => {
    state.timer = null;
    if (state.disposed) return;
    state.attempts += 1;
    let service;
    try { service = ctx.get('systemPrompt'); }
    catch (error) { log(ctx, 'warn', '读取 systemPrompt 服务失败', error); }
    if (service && typeof service.section === 'function') {
      try {
        const base = typeof service.getSectionOrder === 'function'
          ? service.getSectionOrder('TOOL_SUBAGENT') : undefined;
        const order = typeof base === 'number' && Number.isFinite(base) ? base + 1 : 2801;
        const dispose = service.section({ name: SECTION_NAME, order, text, interpolate: false });
        if (typeof dispose !== 'function') {
          throw new TypeError('systemPrompt.section did not return a disposer');
        }
        state.sectionDispose = dispose;
        log(ctx, 'info', `委派指引已挂载 (section: ${SECTION_NAME}, order: ${order})`);
      } catch (error) {
        // section 可能已产生副作用，失败后不盲目重试插入，避免重复。
        log(ctx, 'warn', 'section 挂载失败；请检查服务接口后卸载重载', error);
      }
      return;
    }
    if (service) log(ctx, 'warn', 'systemPrompt.section 不可用，等待服务重试');
    if (state.attempts >= MAX_ATTEMPTS) {
      log(ctx, 'warn', `systemPrompt 服务等待超限 (${MAX_ATTEMPTS} 次)，未挂载；请在服务就绪后重载插件`);
      return;
    }
    state.timer = setTimeout(attempt, RETRY_INTERVAL_MS);
  };
  attempt();
}
