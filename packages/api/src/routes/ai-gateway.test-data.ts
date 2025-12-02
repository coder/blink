/**
 * Mock response from the AI Gateway API for language model endpoint (streaming).
 * Based on the AI SDK v5 language model protocol.
 */
export const mockLanguageModelStreamResponse = [
  {
    type: "stream-start",
    warnings: [],
  },
  {
    type: "response-metadata",
    id: "msg_01ABC123",
    modelId: "claude-sonnet-4-5-20250929",
  },
  {
    type: "text-delta",
    delta: "Crimson",
  },
  {
    type: "text-delta",
    delta: " leaves",
  },
  {
    type: "text-delta",
    delta: " drift",
  },
  {
    type: "text-delta",
    delta: " down",
  },
  {
    type: "finish",
    finishReason: "stop",
    usage: {
      inputTokens: 20,
      outputTokens: 15,
      totalTokens: 35,
    },
    providerMetadata: {
      anthropic: {
        usage: {
          input_tokens: 20,
          output_tokens: 15,
        },
      },
      gateway: {
        cost: "0.00123456",
        generationId: "gen_test123",
      },
    },
  },
];

/**
 * Mock response from the AI Gateway API for language model endpoint (non-streaming).
 */
export const mockLanguageModelNonStreamResponse = {
  type: "finish",
  finishReason: "stop",
  text: "Crimson leaves drift down",
  usage: {
    inputTokens: 20,
    outputTokens: 15,
    totalTokens: 35,
  },
  providerMetadata: {
    anthropic: {
      usage: {
        input_tokens: 20,
        output_tokens: 15,
      },
    },
    gateway: {
      cost: "0.00098765",
      generationId: "gen_test456",
    },
  },
};

/**
 * Mock response from the AI Gateway API. Obtained from:
 * ```sh
 * curl -N -i -sS \
 *   -X POST 'https://ai-gateway.vercel.sh/v1/chat/completions' \
 *   -H "Authorization: Bearer $AI_GATEWAY_API_KEY" \
 *   -H 'Content-Type: application/json' \
 *   -d '{
 *     "model": "openai/gpt-5-nano",
 *     "messages": [{"role":"user","content":"Write a one-sentence haiku about autumn leaves."}],
 *     "stream": true
 *   }'
 * ```
 */
export const mockStreamResponse = [
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { role: "assistant" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { content: "Leaves" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { content: " drift" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { content: " through" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { content: " autumn" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { content: "," },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { content: " amber" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { content: " and" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { content: " gold" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { content: " fill" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { content: " the" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { content: " air" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { content: "," },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { content: " crisp" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { content: " beneath" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { content: " gold" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { content: " light" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: { content: "." },
        logprobs: null,
        finish_reason: null,
      },
    ],
    system_fingerprint: "fp_fgxl45222n",
  },
  {
    id: "chatcmpl-1757349644035-l8a72s26lhk",
    object: "chat.completion.chunk",
    created: 1757349644,
    model: "openai/gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: {
          provider_metadata: {
            openai: {
              responseId:
                "resp_68bf070bd8c8819682f47993ab757cb40e98feaec1cde277",
              serviceTier: "default",
            },
            gateway: {
              routing: {
                originalModelId: "openai/gpt-5-nano",
                resolvedProvider: "openai",
                resolvedProviderApiModelId: "gpt-5-nano-2025-08-07",
                internalResolvedModelId: "openai:gpt-5-nano-2025-08-07",
                fallbacksAvailable: [],
                internalReasoning:
                  "Selected openai as preferred provider for gpt-5-nano. 0 fallback(s) available: ",
                planningReasoning:
                  "System credentials planned for: openai. Total execution order: openai(system)",
                canonicalSlug: "openai/gpt-5-nano",
                finalProvider: "openai",
                attempts: [
                  {
                    provider: "openai",
                    internalModelId: "openai:gpt-5-nano-2025-08-07",
                    providerApiModelId: "gpt-5-nano-2025-08-07",
                    credentialType: "system",
                    success: true,
                    startTime: 142645.133868,
                    endTime: 142895.83524,
                  },
                ],
              },
              cost: "0.00154605",
            },
          },
        },
        logprobs: null,
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 17,
      completion_tokens: 1943,
      total_tokens: 1960,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 1920 },
      cache_creation_input_tokens: 0,
      cost: 0.00154605,
      is_byok: false,
    },
    system_fingerprint: "fp_fgxl45222n",
  },
] as const;

/**
 * Mock response from the AI Gateway API. Obtained from:
 * ```sh
 * curl -N -i -sS \
 *   -X POST 'https://ai-gateway.vercel.sh/v1/chat/completions' \
 *   -H "Authorization: Bearer $AI_GATEWAY_API_KEY" \
 *   -H 'Content-Type: application/json' \
 *   -d '{
 *     "model": "openai/gpt-5-nano",
 *     "messages": [{"role":"user","content":"Write a one-sentence haiku about autumn leaves."}]
 *   }'
 * ```
 */
export const mockNonStreamingResponse = {
  id: "chatcmpl-1757351529366-xulgpen3xnd",
  object: "chat.completion",
  created: 1757351529,
  model: "openai/gpt-5-nano",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content:
          "Crimson leaves drift down, through the chilly autumn air, in quiet gold light.",
        provider_metadata: {
          openai: {
            responseId: "resp_68bf0e605c44819cb5dd6c3c3171c66b0f806517e2ece3e9",
            serviceTier: "default",
          },
          gateway: {
            routing: {
              originalModelId: "openai/gpt-5-nano",
              resolvedProvider: "openai",
              resolvedProviderApiModelId: "gpt-5-nano-2025-08-07",
              internalResolvedModelId: "openai:gpt-5-nano-2025-08-07",
              fallbacksAvailable: [],
              internalReasoning:
                "Selected openai as preferred provider for gpt-5-nano. 0 fallback(s) available: ",
              planningReasoning:
                "System credentials planned for: openai. Total execution order: openai(system)",
              canonicalSlug: "openai/gpt-5-nano",
              finalProvider: "openai",
              attempts: [
                {
                  provider: "openai",
                  internalModelId: "openai:gpt-5-nano-2025-08-07",
                  providerApiModelId: "gpt-5-nano-2025-08-07",
                  credentialType: "system",
                  success: true,
                  startTime: 355212.035928,
                  endTime: 364268.242051,
                },
              ],
            },
            cost: "0.00103405",
          },
        },
      },
      logprobs: null,
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 17,
    completion_tokens: 1303,
    total_tokens: 1320,
    prompt_tokens_details: { cached_tokens: 0 },
    completion_tokens_details: { reasoning_tokens: 1280 },
    cache_creation_input_tokens: 0,
    cost: 0.00103405,
    is_byok: false,
  },
  system_fingerprint: "fp_n2s0rii0gn",
} as const;
