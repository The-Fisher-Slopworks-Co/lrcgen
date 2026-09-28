export interface TranscriptionSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";

export function resolveTranscriptionSettings(
  stored: Partial<TranscriptionSettings> | undefined,
  env: Record<string, string | undefined> = {},
): TranscriptionSettings {
  return {
    apiKey: stored?.apiKey || env.OPENROUTER_API_KEY || env.OPENAI_API_KEY || "",
    baseUrl: stored?.baseUrl || env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
    model: stored?.model || DEFAULT_MODEL,
  };
}
