// Local model access for a self-hosted deployment: llama.cpp / Ollama on loopback.
//
// Two deliberate differences from the Gemini entry points, both forced by the measurement on
// 2026-10-26 (see AGENTS.md): the request uses an OpenAI-compatible chat call with a JSON schema
// constraint, and the result goes through verifyPlainProposal, which locates each value in the
// source instead of trusting a character-exact quote from the model.
import { type Extraction, type InquiryCase, type Source } from './domain.js';
import { EXTRACT_SCHEMA, EXTRACT_SYSTEM, replyFacts, replySystem, validateReply } from './llm.js';
import { verifyPlainProposal } from './model.js';

export type LocalOptions = {
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type ChatArgs = { system: string; user: string; schema?: unknown; maxTokens: number };
type ChatResult = { content: string; ms: number; usage?: { input_tokens: number; output_tokens: number } };

const DEFAULT_BASE = 'http://127.0.0.1:8081';

function resolveOptions(options: LocalOptions) {
  return {
    baseUrl: (options.baseUrl ?? process.env.LOCAL_MODEL_URL ?? DEFAULT_BASE).replace(/\/$/, ''),
    model: options.model ?? process.env.LOCAL_MODEL_ID,
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs ?? 600000,
  };
}

async function modelId(options: LocalOptions, baseUrl: string, fetchImpl: typeof fetch): Promise<string> {
  if (options.model ?? process.env.LOCAL_MODEL_ID) return (options.model ?? process.env.LOCAL_MODEL_ID)!;
  const response = await fetchImpl(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error(`LOCAL_MODEL_HTTP_${response.status} on /v1/models`);
  const body = (await response.json()) as { data?: { id: string }[] };
  const id = body.data?.[0]?.id;
  if (!id) throw Error('LOCAL_MODEL_NOT_FOUND: the server listed no model');
  return id;
}

async function chat(options: LocalOptions, args: ChatArgs): Promise<ChatResult> {
  const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
  const model = await modelId(options, baseUrl, fetchImpl);
  const started = Date.now();
  const response = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, temperature: 0, stream: false, max_tokens: args.maxTokens,
      messages: [{ role: 'system', content: args.system }, { role: 'user', content: args.user }],
      ...(args.schema
        ? { response_format: { type: 'json_schema', json_schema: { name: 'extraction', strict: true, schema: args.schema } } }
        : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const ms = Date.now() - started;
  if (!response.ok) throw Error(`LOCAL_MODEL_HTTP_${response.status}: ${(await response.text()).slice(0, 200)}`);
  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = body.choices?.[0]?.message?.content ?? '';
  return {
    content,
    ms,
    usage: body.usage ? { input_tokens: body.usage.prompt_tokens ?? 0, output_tokens: body.usage.completion_tokens ?? 0 } : undefined,
  };
}

export function localMailExtractor(options: LocalOptions = {}) {
  return async (sources: Source[]): Promise<Extraction> => {
    const user = sources.map((source, index) => `[${index}] ${source.text}`).join('\n\n');
    if (Buffer.byteLength(user, 'utf8') > 8000) throw Error('MODEL_INPUT_LIMIT: mail exceeds 8000 bytes');
    const result = await chat(options, { system: EXTRACT_SYSTEM, user, schema: EXTRACT_SCHEMA, maxTokens: 900 });
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.content);
    } catch {
      throw Error('MODEL_NO_STRUCTURED_EXTRACTION: the local model did not return JSON');
    }
    return verifyPlainProposal(parsed, sources);
  };
}

export function localInquiryReply(options: LocalOptions = {}) {
  return async (inquiry: InquiryCase) => {
    const facts = replyFacts(inquiry);
    if (Buffer.byteLength(facts, 'utf8') > 10000) throw Error('MODEL_REPLY_INPUT_LIMIT');

    const result = await chat(options, { system: replySystem(inquiry), user: facts, maxTokens: 700 });
    return {
      draft: validateReply(result.content),
      language: inquiry.replyLanguage,
      model: options.model ?? process.env.LOCAL_MODEL_ID ?? 'local',
    };
  };
}
