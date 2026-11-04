/**
 * The slice of the Anthropic SDK the bot uses. Kept minimal so tests can
 * inject a fake client without constructing a full Anthropic instance.
 */
export interface DeepSeekClient {
  baseURL: string;
  messages: {
    create(
      params: Record<string, unknown>,
    ): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}
