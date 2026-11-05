import type { EffortLevel } from '../config/effort-level.ts';
import type { ThinkingMode } from '../config/thinking-mode.ts';

/**
 * Les réglages DeepSeek lus par DeepSeek.ask.
 *
 * @interface
 */
export interface DeepSeekSettings {
  deepseekModel: string;
  deepseekMaxTokens: number;
  deepseekTemperature: number | null;
  deepseekThinking: ThinkingMode;
  deepseekEffort: EffortLevel;
  systemPrompt: string;
}
