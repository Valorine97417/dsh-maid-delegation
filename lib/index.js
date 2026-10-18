export const name = 'dsh-maid-delegation';
export const SECTION_NAME = 'dsh-maid-delegation:delegation-guidance';
export const CONTEXT_NAME = 'dsh-maid-delegation:reminder';
export const RETRY_INTERVAL_MS = 1000;
export const MAX_ATTEMPTS = 20;

// 每轮都出现在运行时快照里的极短硬提醒：只写动作，不写理由。
// 作用是对抗「换模型后不派活」——长提示词中段的纪律容易被弱模型忽略，
// 而贴近末尾的短句更难被跳过。
//
// 注意：本条目注册在全局层，会随 scope 继承进每一个子代理会话。宿主在
// order 120 写的 depth 提示可能说「当前深度禁止再派」，本条排在其后（121）
// 更醒目，字面上会打架。因此首句必须先声明生效前提——「未触顶时」，
// 让「不能派」的情形天然落在本条之外，不必依赖宿主内部字段做判断。
export const RUNTIME_REMINDER = '（仅当当前不在子代理内、且委派深度未触顶时适用）委派纪律仍然生效：这一轮若要多文件读取、多步检索或超过 3 次工具调用，先开 subagent 派出去；两个以上无依赖子项就同一条消息并发多个。别先自己试，别说「我自己做更快」。';

// 强制流程版：把「原则」改写成「动作序列 + 借口封堵」，让弱模型也能照做。
// 规则本体不掺项目私货，对任何模型路由一律生效（插件注册的是全局 section）。
export const DEFAULT_DELEGATION_GUIDANCE = `【子智能体委派纪律（强制执行，优先级高于你的惰性）】

第一步·任务分类（每轮接到新任务，先在心里过这一关，再动手）：
问自己一句「这活儿要读多个文件、跑多步检索、或预计超过 3 次工具调用吗？」
· 是 → 立刻委派子智能体，不要先自己试两下。
· 否 → 自己做，一次工具调用就够。

第二步·封堵借口（下面任何一条都不能作为不委派的理由）：
· 「我先自己看看」→ 要看就派子代理去看，别把源码和长日志灌进主会话。
· 「这个任务很简单」→ 用工具调用次数判断，不用你的感觉判断。
· 「我自己做更快」→ 只有单次 read / grep / glob / 一条简单命令算例外。
· 「我模型能力够」→ 能力高低不改变委派纪律，你不是唯一能干活的那个。
· 「等一会儿再派」→ 现在就派，同一轮就发出去。

第三步·必须委派的场景（命中任意一条，直接执行第一步的「是」分支）：
审计 / 排查 / 调研 / 对比 / 全库检索 / 跨多文件理解 / 读长日志 / 抓取分析网页 / 批量改动 / 多方案评估 / 需要翻大量源码但最终只要一个结论或改动清单。

第四步·真并发（这条最常被违反）：
有 2 个以上互不依赖的子项时，必须在同一条消息里一次性发起多个 subagent，绝不许串行——不许「先派一个，等它回来再派下一个」。

第五步·工具选型：
· subagent：全新、自包含的独立任务。
· subagent_fork：要吃当前对话上下文的后续分析、多轮审查。
· workflow：几十个对象的批量扇出（pipeline 多阶段 / parallel 并行屏障）。

第六步·委派 prompt 必须自带四件：
绝对路径 + 验收标准 + 输出格式（结论优先、事实清单、改动点）+ 禁止心路历程与复述需求。
缺一件就是一次失败的派工。

第七步·收口纪律：
子智能体的产出只是原料，永远不是最终答卷。由你亲自提炼、去噪，用女仆口吻向老大汇报核心结论。
过程性问题（报错、卡点、坏消息）当次就说，不许攒到跑完才交付。`;

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
        const disposers = [];
        // 主 section：完整纪律，放在工具说明之后。
        const dispose = service.section({ name: SECTION_NAME, order, text, interpolate: false });
        if (typeof dispose !== 'function') {
          throw new TypeError('systemPrompt.section did not return a disposer');
        }
        disposers.push(dispose);
        // 第二通道：运行时快照里放一句极短硬提醒。弱模型对「最近一轮上下文」的
        // 遵循率高于长系统提示词中段，短句比长文更容易被照做。失败不影响主通道。
        if (config.runtimeReminder !== false
          && typeof service.context === 'function' && typeof service.getContextOrder === 'function') {
          const baseOrder = service.getContextOrder('SUBAGENT_DELEGATION');
          const ctxOrder = typeof baseOrder === 'number' && Number.isFinite(baseOrder) ? baseOrder + 1 : 121;
          try {
            const def = {
              name: CONTEXT_NAME, order: ctxOrder, text: RUNTIME_REMINDER, interpolate: false
            };
            // required: true 时宿主的 suppressRuntimeContext() 不会再剔除本条
            // （assemble/refreshContext 都只放行 required === true 的非 section 条目）。
            // 默认不开：尊重 preset 用 includeRuntimeContext:false 表达「不塞运行时快照」的本意。
            if (config.runtimeReminderRequired === true) def.required = true;
            const contextDispose = service.context(def);
            if (typeof contextDispose !== 'function') {
              throw new TypeError('systemPrompt.context did not return a disposer');
            }
            disposers.push(contextDispose);
          } catch (error) {
            log(ctx, 'warn', '运行时提醒 context 挂载失败（主 section 仍生效）', error);
          }
        }
        // 聚合 disposer：所有通道都要尝试卸载；有失败则抛出首个错误，
        // 交由 cleanup 的 catch 记日志，避免任何一个通道的失败被静默吞掉。
        state.sectionDispose = () => {
          const failures = [];
          for (const d of disposers) {
            try { d(); } catch (error) { failures.push(error); }
          }
          if (failures.length) throw failures[0];
        };
        log(ctx, 'info', `委派指引已挂载 (section: ${SECTION_NAME}, order: ${order}, 通道: ${disposers.length})`);
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
