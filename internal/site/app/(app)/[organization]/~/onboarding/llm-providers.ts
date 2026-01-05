export type AIProvider = "anthropic" | "openai" | "vercel";

export interface LlmProvider {
  id: AIProvider;
  name: string;
  description: string;
  placeholder: string;
  helpUrl: string;
  createKeyText: string;
  envVarKey: string;
}

export const LLM_PROVIDERS: LlmProvider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude models",
    placeholder: "sk-ant-...",
    helpUrl: "https://console.anthropic.com/settings/keys",
    createKeyText: "Create Anthropic API Key",
    envVarKey: "ANTHROPIC_API_KEY",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT models",
    placeholder: "sk-...",
    helpUrl: "https://platform.openai.com/api-keys",
    createKeyText: "Create OpenAI API Key",
    envVarKey: "OPENAI_API_KEY",
  },
  {
    id: "vercel",
    name: "Vercel AI Gateway",
    description: "Unified gateway for multiple AI providers",
    placeholder: "vck_...",
    helpUrl: "https://vercel.com/ai-gateway",
    createKeyText: "Create Vercel AI Gateway API Key",
    envVarKey: "VERCEL_AI_GATEWAY_API_KEY",
  },
];

export function getEnvVarKeyForProvider(provider: AIProvider): string {
  const p = LLM_PROVIDERS.find((p) => p.id === provider);
  return p?.envVarKey || "AI_API_KEY";
}
