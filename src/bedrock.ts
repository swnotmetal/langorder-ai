// AWS Bedrock provider: the same prompt and the same acceptance rules as the local path, carried by
// the Converse API instead of an OpenAI-compatible one.
//
// Nova needs a cross-region inference profile id (`eu.amazon.nova-lite-v1:0`); a bare model id is
// rejected with "on-demand throughput isn't supported". Structured output is obtained by forcing a
// single tool, which is what Converse guarantees; the tool's input then goes through the same
// verifyPlainProposal as every other provider.
import { ConverseCommand, type BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { type Extraction, type InquiryCase, type Source } from './domain.js';
import { recordAttempt } from './ledger.js';
import { EXTRACT_SCHEMA, EXTRACT_SYSTEM, replyFacts, replySystem, validateReply } from './llm.js';
import { verifyPlainProposal } from './model.js';

export type BedrockOptions = {
  region?: string;
  modelId?: string;
  client?: Pick<BedrockRuntimeClient, 'send'>;
  dataDir?: string;
  // Tests inject a client and must not touch data/: the ledger write is what they opt out of.
  record?: boolean;
};

type ConverseReply = {
  output?: { message?: { content?: { text?: string; toolUse?: { name: string; input: unknown } }[] } };
  usage?: { inputTokens?: number; outputTokens?: number };
  metrics?: { latencyMs?: number };
};

const DEFAULT_MODEL = 'eu.amazon.nova-lite-v1:0';
const DEFAULT_REGION = 'eu-north-1';

async function converse(options: BedrockOptions, request: Record<string, unknown>): Promise<ConverseReply> {
  const region = options.region ?? process.env.BEDROCK_REGION ?? DEFAULT_REGION;
  const modelId = options.modelId ?? process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODEL;
  // The client is injected in tests so no request ever leaves the process.
  const client = options.client ?? await sharedClient(region);
  const reply = await client.send(new ConverseCommand({ modelId, ...request } as never)) as ConverseReply;
  if (options.record ?? true) {
    recordAttempt(options.dataDir ?? process.env.ORDER_DATA_DIR ?? 'data', modelId, reply.usage
      ? { input_tokens: reply.usage.inputTokens ?? 0, output_tokens: reply.usage.outputTokens ?? 0 }
      : undefined);
  }
  return reply;
}

let cached: BedrockRuntimeClient | undefined;
async function sharedClient(region: string): Promise<BedrockRuntimeClient> {
  if (!cached) {
    const { BedrockRuntimeClient: Client } = await import('@aws-sdk/client-bedrock-runtime');
    cached = new Client({ region });
  }
  return cached;
}

export function bedrockMailExtractor(options: BedrockOptions = {}) {
  return async (sources: Source[]): Promise<Extraction> => {
    const user = sources.map((source, index) => `[${index}] ${source.text}`).join('\n\n');
    if (Buffer.byteLength(user, 'utf8') > 8000) throw Error('MODEL_INPUT_LIMIT: mail exceeds 8000 bytes');
    const reply = await converse(options, {
      system: [{ text: EXTRACT_SYSTEM }],
      messages: [{ role: 'user', content: [{ text: user }] }],
      toolConfig: {
        tools: [{ toolSpec: { name: 'understand_mail', description: 'Extracted fields', inputSchema: { json: EXTRACT_SCHEMA } } }],
        toolChoice: { tool: { name: 'understand_mail' } },
      },
      inferenceConfig: { maxTokens: 900, temperature: 0 },
    });
    const tool = reply.output?.message?.content?.find(part => part.toolUse)?.toolUse;
    if (!tool) throw Error('MODEL_NO_STRUCTURED_EXTRACTION: Bedrock returned no tool use');
    return verifyPlainProposal(tool.input, sources);
  };
}

export function bedrockInquiryReply(options: BedrockOptions = {}) {
  return async (inquiry: InquiryCase) => {
    const facts = replyFacts(inquiry);
    if (Buffer.byteLength(facts, 'utf8') > 10000) throw Error('MODEL_REPLY_INPUT_LIMIT');
    const reply = await converse(options, {
      system: [{ text: replySystem(inquiry) }],
      messages: [{ role: 'user', content: [{ text: facts }] }],
      inferenceConfig: { maxTokens: 700, temperature: 0 },
    });
    const text = reply.output?.message?.content?.find(part => part.text)?.text ?? '';
    return {
      draft: validateReply(text),
      language: inquiry.replyLanguage,
      model: options.modelId ?? process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODEL,
    };
  };
}
