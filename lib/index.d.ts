export declare const name: 'dsh-maid-delegation';
export declare const SECTION_NAME: 'dsh-maid-delegation:delegation-guidance';
export declare const CONTEXT_NAME: 'dsh-maid-delegation:reminder';
export declare const RETRY_INTERVAL_MS: 1000;
export declare const MAX_ATTEMPTS: 20;
export declare const DEFAULT_DELEGATION_GUIDANCE: string;
export declare const RUNTIME_REMINDER: string;
export interface Config {
  /** 默认 true；false 时不注册 section、context 或定时器。 */
  enabled?: boolean;
  /** 空白或非字符串回落默认静态纪律；按纯文本注册，不执行变量插值。 */
  guidance?: string;
  /** 默认 true；false 时只挂主 section，不注册运行时短提醒（第二通道）。 */
  runtimeReminder?: boolean;
  /** 默认 false；true 时给次通道条目加 required，使其不被 suppressRuntimeContext() 剔除。 */
  runtimeReminderRequired?: boolean;
}
export declare function apply(ctx: import('@deepseek-ai/cordis').Context, config?: Config): void;
