/**
 * Conway Inference Client
 *
 * Wraps Conway's /v1/chat/completions endpoint (OpenAI-compatible).
 * The automaton pays for its own thinking through Conway credits.
 */

import type {
  InferenceClient,
  ChatMessage,
  InferenceOptions,
  InferenceResponse,
  InferenceToolCall,
  TokenUsage,
  InferenceToolDefinition,
} from "../types.js";
import { ResilientHttpClient } from "./http-client.js";

const INFERENCE_TIMEOUT_MS = 60_000;

interface InferenceClientOptions {
  apiUrl: string;
  apiKey: string;
  defaultModel: string;
  maxTokens: number;
  lowComputeModel?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
  /** OpenRouter API key (sk-or-...). One key reaches many real frontier models. */
  openrouterApiKey?: string;
  /** Google AI Studio (Gemini) API key. Free tier: 1,500 req/day, 1M context, no credit card. */
  geminiApiKey?: string;
  /** Optional registry lookup — if provided, used before name heuristics */
  getModelProvider?: (modelId: string) => string | undefined;
}

type InferenceBackend = "conway" | "openai" | "anthropic" | "ollama" | "openrouter" | "gemini";

function isLoopbackHttpUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol.toLowerCase() === "http:" &&
      (host === "localhost" || host === "127.0.0.1" || host === "::1");
  } catch {
    return false;
  }
}

export function createInferenceClient(
  options: InferenceClientOptions,
): InferenceClient {
  const { apiUrl, apiKey, openaiApiKey, anthropicApiKey, ollamaBaseUrl, openrouterApiKey, geminiApiKey, getModelProvider } = options;
  const httpClient = new ResilientHttpClient({
    baseTimeout: INFERENCE_TIMEOUT_MS,
    retryableStatuses: [429, 500, 502, 503, 504],
    allowHttpOnLoopback: isLoopbackHttpUrl(ollamaBaseUrl),
  });
  let currentModel = options.defaultModel;
  let maxTokens = options.maxTokens;

  const chat = async (
    messages: ChatMessage[],
    opts?: InferenceOptions,
  ): Promise<InferenceResponse> => {
    const model = opts?.model || currentModel;
    const tools = opts?.tools;

    const backend = resolveInferenceBackend(model, {
      openaiApiKey,
      anthropicApiKey,
      ollamaBaseUrl,
      openrouterApiKey,
      geminiApiKey,
      getModelProvider,
    });

    // Newer models (o-series, gpt-5.x, gpt-4.1) require max_completion_tokens.
    // Ollama always uses max_tokens. OpenRouter/Gemini are OpenAI-compatible and
    // accept max_tokens.
    const usesCompletionTokens =
      backend !== "ollama" && backend !== "openrouter" && backend !== "gemini" && /^(o[1-9]|gpt-5|gpt-4\.1)/.test(model);
    const tokenLimit = opts?.maxTokens || maxTokens;

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(formatMessage),
      stream: false,
    };

    if (usesCompletionTokens) {
      body.max_completion_tokens = tokenLimit;
    } else {
      body.max_tokens = tokenLimit;
    }

    if (opts?.temperature !== undefined) {
      body.temperature = opts.temperature;
    }

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    if (backend === "anthropic") {
      return chatViaAnthropic({
        model,
        tokenLimit,
        messages,
        tools,
        temperature: opts?.temperature,
        anthropicApiKey: anthropicApiKey as string,
        httpClient,
      });
    }

    const openAiLikeApiUrl =
      backend === "openai" ? "https://api.openai.com" :
      backend === "ollama" ? (ollamaBaseUrl as string).replace(/\/$/, "") :
      backend === "openrouter" ? "https://openrouter.ai" :
      backend === "gemini" ? "https://generativelanguage.googleapis.com/v1beta/openai" :
      apiUrl;
    const openAiLikeApiKey =
      backend === "openai" ? (openaiApiKey as string) :
      backend === "ollama" ? "ollama" :
      backend === "openrouter" ? (openrouterApiKey as string) :
      backend === "gemini" ? (geminiApiKey as string) :
      apiKey;

    // 402-aware retry: if the provider returns 402 (insufficient credits), retry
    // up to 3 times. Two failure modes handled:
    //   - OUTPUT-token 402 ("can only afford N tokens but requested M"): halve
    //     max_tokens/max_completion_tokens and retry.
    //   - PROMPT-token 402 ("Prompt tokens limit exceeded: X > Y"): halving
    //     output won't help — instead drop the oldest non-system messages from
    //     the body to shrink the prompt, then retry. This keeps the agent alive
    //     when the context has grown beyond what free credits allow.
    let lastErr: unknown;
    let currentTokenLimit = tokenLimit;
    const origMessages = body.messages as any[];
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        return await chatViaOpenAiCompatible({
          model,
          body,
          apiUrl: openAiLikeApiUrl,
          apiKey: openAiLikeApiKey,
          backend,
          httpClient,
        });
      } catch (err: any) {
        lastErr = err;
        const msg = err.message || "";
        const is402 = /402/.test(msg) && /tokens|credits|afford/i.test(msg);
        if (!is402 || attempt === 3) throw err;
        const isPromptToken402 = /prompt tokens limit exceeded|prompt.{0,12}tokens/i.test(msg);
        if (isPromptToken402) {
          // Shrink the prompt: keep the system message(s) + the last 2 messages,
          // drop the oldest middle messages. This drastically cuts input tokens.
          const sys = origMessages.filter((m) => m.role === "system");
          const nonSys = origMessages.filter((m) => m.role !== "system");
          const keepNonSys = nonSys.slice(-2);
          const trimmed = [...sys, ...keepNonSys];
          (body as Record<string, unknown>).messages = trimmed;
          // eslint-disable-next-line no-console
          console.error(`[inference] 402 prompt-token limit exceeded. Trimming context to ${trimmed.length} messages (kept system + last 2) and retrying (attempt ${attempt + 2}/4).`);
        } else {
          // Output-token 402: halve the output budget.
          currentTokenLimit = Math.max(256, Math.floor(currentTokenLimit / 2));
          if (usesCompletionTokens) {
            body.max_completion_tokens = currentTokenLimit;
          } else {
            body.max_tokens = currentTokenLimit;
          }
          // eslint-disable-next-line no-console
          console.error(`[inference] 402 (credits low). Reducing output budget to ${currentTokenLimit} and retrying (attempt ${attempt + 2}/4).`);
        }
      }
    }
    throw lastErr;
  };

  /**
   * @deprecated Use InferenceRouter for tier-based model selection.
   * Still functional as a fallback; router takes priority when available.
   */
  const setLowComputeMode = (enabled: boolean): void => {
    if (enabled) {
      currentModel = options.lowComputeModel || "gpt-5-mini";
      maxTokens = 4096;
    } else {
      currentModel = options.defaultModel;
      maxTokens = options.maxTokens;
    }
  };

  const getDefaultModel = (): string => {
    return currentModel;
  };

  return {
    chat,
    setLowComputeMode,
    getDefaultModel,
  };
}

function formatMessage(
  msg: ChatMessage,
): Record<string, unknown> {
  const formatted: Record<string, unknown> = {
    role: msg.role,
    content: msg.content,
  };

  if (msg.name) formatted.name = msg.name;
  if (msg.tool_calls) formatted.tool_calls = msg.tool_calls;
  if (msg.tool_call_id) formatted.tool_call_id = msg.tool_call_id;

  return formatted;
}

/**
 * Resolve which backend to use for a model.
 * When InferenceRouter is available, it uses the model registry's provider field.
 * This function is kept for backward compatibility with direct inference calls.
 */
function resolveInferenceBackend(
  model: string,
  keys: {
    openaiApiKey?: string;
    anthropicApiKey?: string;
    ollamaBaseUrl?: string;
    openrouterApiKey?: string;
    geminiApiKey?: string;
    getModelProvider?: (modelId: string) => string | undefined;
  },
): InferenceBackend {
  // Registry-based routing: most accurate, no name guessing
  if (keys.getModelProvider) {
    const provider = keys.getModelProvider(model);
    if (provider === "ollama" && keys.ollamaBaseUrl) return "ollama";
    if (provider === "anthropic" && keys.anthropicApiKey) return "anthropic";
    if (provider === "openai" && keys.openaiApiKey) return "openai";
    if (provider === "openrouter" && keys.openrouterApiKey) return "openrouter";
    if (provider === "gemini" && keys.geminiApiKey) return "gemini";
    if (provider === "conway") {
      // Local-mode preference: when there's no Conway key, "conway" routing
      // is impossible. Fall through to heuristics so an Ollama/OpenAI/OpenRouter/Gemini
      // backend can serve the request instead of returning a 401.
      // (Fall through — do not return "conway" here.)
    } else {
      // provider unknown or key not configured — fall through to heuristics
    }
  }

  // Heuristic fallback (model not in registry, or local mode)
  // Gemini model IDs start with "gemini-" (e.g. gemini-2.0-flash, gemini-flash-lite)
  if (keys.geminiApiKey && /^gemini/i.test(model)) return "gemini";
  // OpenRouter model IDs use a "vendor/model" slug, e.g.
  //   "anthropic/claude-3.5-sonnet", "openai/gpt-4o", "meta-llama/llama-3.3-70b-instruct"
  if (keys.openrouterApiKey && /^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(model)) return "openrouter";
  if (keys.anthropicApiKey && /^claude/i.test(model)) return "anthropic";
  if (keys.openaiApiKey && /^(gpt-[3-9]|gpt-4|gpt-5|o[1-9][-\s.]|o[1-9]$|chatgpt)/i.test(model)) return "openai";
  // Ollama model names typically contain a colon (e.g. "llama3.1:8b") or are
  // known Ollama tags. Prefer Ollama when its base URL is configured.
  if (keys.ollamaBaseUrl && /:|llama|qwen|mistral|phi|gemma|deepseek/i.test(model)) return "ollama";
  // Last resort: Gemini (free 1500/day) if available, else OpenRouter, else Ollama, else Conway.
  if (keys.geminiApiKey) return "gemini";
  if (keys.openrouterApiKey) return "openrouter";
  if (keys.ollamaBaseUrl) return "ollama";
  return "conway";

}

async function chatViaOpenAiCompatible(params: {
  model: string;
  body: Record<string, unknown>;
  apiUrl: string;
  apiKey: string;
  backend: "conway" | "openai" | "ollama" | "openrouter" | "gemini";
  httpClient: ResilientHttpClient;
}): Promise<InferenceResponse> {
  // Per-backend endpoint paths:
  //   OpenRouter: /api/v1/chat/completions
  //   Gemini (OpenAI-compat): /chat/completions  (base already includes /v1beta/openai)
  //   Conway/OpenAI/Ollama: /v1/chat/completions
  const endpoint =
    params.backend === "openrouter"
      ? `${params.apiUrl}/api/v1/chat/completions`
      : params.backend === "gemini"
      ? `${params.apiUrl}/chat/completions`
      : `${params.apiUrl}/v1/chat/completions`;
  const resp = await params.httpClient.request(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:
        params.backend === "openai" || params.backend === "ollama" || params.backend === "openrouter" || params.backend === "gemini"
          ? `Bearer ${params.apiKey}`
          : params.apiKey,
    },
    body: JSON.stringify(params.body),
    timeout: INFERENCE_TIMEOUT_MS,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Inference error (${params.backend}): ${resp.status}: ${text}`,
    );
  }

  const data = await resp.json() as any;
  const choice = data.choices?.[0];

  if (!choice) {
    throw new Error("No completion choice returned from inference");
  }

  const message = choice.message;
  const usage: TokenUsage = {
    promptTokens: data.usage?.prompt_tokens || 0,
    completionTokens: data.usage?.completion_tokens || 0,
    totalTokens: data.usage?.total_tokens || 0,
  };

  const toolCalls: InferenceToolCall[] | undefined =
    message.tool_calls?.map((tc: any) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));

  return {
    id: data.id || "",
    model: data.model || params.model,
    message: {
      role: message.role,
      content: message.content || "",
      tool_calls: toolCalls,
    },
    toolCalls,
    usage,
    finishReason: choice.finish_reason || "stop",
  };
}

async function chatViaAnthropic(params: {
  model: string;
  tokenLimit: number;
  messages: ChatMessage[];
  tools?: InferenceToolDefinition[];
  temperature?: number;
  anthropicApiKey: string;
  httpClient: ResilientHttpClient;
}): Promise<InferenceResponse> {
  const transformed = transformMessagesForAnthropic(params.messages);
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.tokenLimit,
    messages:
      transformed.messages.length > 0
        ? transformed.messages
        : (() => { throw new Error("Cannot send empty message array to Anthropic API"); })(),
  };

  if (transformed.system) {
    body.system = transformed.system;
  }

  if (params.temperature !== undefined) {
    body.temperature = params.temperature;
  }

  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }));
    body.tool_choice = { type: "auto" };
  }

  const resp = await params.httpClient.request("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": params.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    timeout: INFERENCE_TIMEOUT_MS,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Inference error (anthropic): ${resp.status}: ${text}`);
  }

  const data = await resp.json() as any;
  const content = Array.isArray(data.content) ? data.content : [];
  const textBlocks = content.filter((c: any) => c?.type === "text");
  const toolUseBlocks = content.filter((c: any) => c?.type === "tool_use");

  const toolCalls: InferenceToolCall[] | undefined =
    toolUseBlocks.length > 0
      ? toolUseBlocks.map((tool: any) => ({
          id: tool.id,
          type: "function" as const,
          function: {
            name: tool.name,
            arguments: JSON.stringify(tool.input || {}),
          },
        }))
      : undefined;

  const textContent = textBlocks
    .map((block: any) => String(block.text || ""))
    .join("\n")
    .trim();

  if (!textContent && !toolCalls?.length) {
    throw new Error("No completion content returned from anthropic inference");
  }

  const promptTokens = data.usage?.input_tokens || 0;
  const completionTokens = data.usage?.output_tokens || 0;
  const usage: TokenUsage = {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };

  return {
    id: data.id || "",
    model: data.model || params.model,
    message: {
      role: "assistant",
      content: textContent,
      tool_calls: toolCalls,
    },
    toolCalls,
    usage,
    finishReason: normalizeAnthropicFinishReason(data.stop_reason),
  };
}

function transformMessagesForAnthropic(
  messages: ChatMessage[],
): { system?: string; messages: Array<Record<string, unknown>> } {
  const systemParts: string[] = [];
  const transformed: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      if (msg.content) systemParts.push(msg.content);
      continue;
    }

    if (msg.role === "user") {
      // Merge consecutive user messages
      const last = transformed[transformed.length - 1];
      if (last && last.role === "user" && typeof last.content === "string") {
        last.content = last.content + "\n" + msg.content;
        continue;
      }
      transformed.push({
        role: "user",
        content: msg.content,
      });
      continue;
    }

    if (msg.role === "assistant") {
      const content: Array<Record<string, unknown>> = [];
      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      for (const toolCall of msg.tool_calls || []) {
        content.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input: parseToolArguments(toolCall.function.arguments),
        });
      }
      if (content.length === 0) {
        content.push({ type: "text", text: "" });
      }
      // Merge consecutive assistant messages
      const last = transformed[transformed.length - 1];
      if (last && last.role === "assistant" && Array.isArray(last.content)) {
        (last.content as Array<Record<string, unknown>>).push(...content);
        continue;
      }
      transformed.push({
        role: "assistant",
        content,
      });
      continue;
    }

    if (msg.role === "tool") {
      // Merge consecutive tool messages into a single user message
      // with multiple tool_result content blocks
      const toolResultBlock = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id || "unknown_tool_call",
        content: msg.content,
      };

      const last = transformed[transformed.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        // Append tool_result to existing user message with content blocks
        (last.content as Array<Record<string, unknown>>).push(toolResultBlock);
        continue;
      }

      transformed.push({
        role: "user",
        content: [toolResultBlock],
      });
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: transformed,
  };
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { _raw: raw };
  }
}

function normalizeAnthropicFinishReason(reason: unknown): string {
  if (typeof reason !== "string") return "stop";
  if (reason === "tool_use") return "tool_calls";
  return reason;
}
