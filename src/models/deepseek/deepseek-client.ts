/**
 * La tranche du SDK Anthropic que le bot utilise. Gardée minimale pour que
 * les tests puissent injecter un faux client sans construire une instance
 * Anthropic complète.
 *
 * @interface
 */
export interface DeepSeekClient {
  baseURL: string;
  messages: {
    create(
      params: Record<string, unknown>,
    ): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}
