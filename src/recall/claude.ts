import Anthropic from '@anthropic-ai/sdk';
import type { Book } from './book.ts';

export const LEARNING_COUNT = 5;

const SYSTEM = [
  "You distil a reader's own notes on a book into its key learnings.",
  'Use only what is in the notes; do not add anything from your general knowledge of the book.',
  `Return exactly ${LEARNING_COUNT} learnings, each a single sentence, with no preamble or numbering.`,
  "Keep the reader's own wording and examples where possible.",
  'Ignore leftover checklist scaffolding such as ☐/☑ bullets and Status/Context labels.',
].join(' ');

const LEARNINGS_SCHEMA = {
  type: 'object',
  properties: { learnings: { type: 'array', items: { type: 'string' } } },
  required: ['learnings'],
  additionalProperties: false,
};

export function buildPrompt(book: Book): string {
  const byline = book.author ? `${book.title} by ${book.author}` : book.title;
  return `Book: ${byline}\n\n<notes path="${book.path}">\n${book.body}\n</notes>`;
}

/** A reply that arrived but is not exactly the learnings asked for. */
export class BadReplyError extends Error {}

function replyText(message: Anthropic.Message): string | undefined {
  return message.content.find((block): block is Anthropic.TextBlock => block.type === 'text')?.text;
}

/** The count is checked here rather than trusted to the schema. Throws a `BadReplyError` saying what is wrong. */
export function parseLearnings(message: Anthropic.Message): string[] {
  if (message.stop_reason === 'max_tokens') throw new BadReplyError("Claude's reply was cut off at max_tokens");
  let learnings: unknown;
  try {
    learnings = (JSON.parse(replyText(message) ?? '') as { learnings?: unknown }).learnings;
  } catch {
    throw new BadReplyError(`Claude did not return JSON learnings (stop reason: ${message.stop_reason})`);
  }
  if (!Array.isArray(learnings) || learnings.length !== LEARNING_COUNT) {
    throw new BadReplyError(
      `Claude returned ${Array.isArray(learnings) ? learnings.length : 'no'} learnings, expected ${LEARNING_COUNT}`,
    );
  }
  if (learnings.some((l) => typeof l !== 'string' || !l.trim())) {
    throw new BadReplyError(`Claude returned an empty learning, expected ${LEARNING_COUNT} non-empty sentences`);
  }
  if (learnings.some((l: string) => l.trim().includes('\n'))) {
    throw new BadReplyError(`Claude returned a learning spanning several lines, expected ${LEARNING_COUNT} single sentences`);
  }
  return learnings.map((l: string) => l.trim());
}

/** Not user-facing; tests shorten both so the suite stays fast. */
export type RetryOptions = {
  /** Wait before retrying a failed request. */
  retryDelayMs?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
};

export const DEFAULT_RETRY_DELAY_MS = 1000;
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Failures worth one more try: unreachable, timeout, rejected key (the brief asks for it), rate limit, server error. */
function isRetryable(error: unknown): boolean {
  if (error instanceof Anthropic.APIConnectionError) return true;
  if (!(error instanceof Anthropic.APIError) || error.status === undefined) return false;
  return [401, 408, 409, 429].includes(error.status) || error.status >= 500;
}

function describeRequestError(error: unknown, baseURL: string, timeoutMs: number): Error {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new Error(`Claude API timed out after ${timeoutMs / 1000}s`);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    // fetch wraps the socket error (ECONNREFUSED, ENOTFOUND, ...) a level or two down the cause chain.
    let cause: unknown = error.cause;
    while (cause instanceof Error && !(cause as NodeJS.ErrnoException).code) cause = cause.cause;
    const code = (cause as NodeJS.ErrnoException | undefined)?.code;
    return new Error(`Could not reach the Claude API at ${baseURL}${code ? ` (${code})` : ''}`);
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new Error('Claude API rejected the key (401); check BOOK_RECALL_API_KEY');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new Error(`Claude API rate limit hit (429): ${error.message}`);
  }
  if (error instanceof Anthropic.APIError) {
    return new Error(`Claude API returned ${error.status}: ${error.message}`);
  }
  return error as Error;
}

const RETRY_INSTRUCTION = `Return exactly ${LEARNING_COUNT} learnings as JSON, each a single non-empty sentence, with no preamble.`;

/**
 * Asks Claude for the learnings. A failed request (see `isRetryable`) is retried once after a short wait,
 * and a bad reply is retried once with the problem sent back to the model; after that it throws.
 * The SDK's own retries are off so every attempt and wait is decided here.
 */
export async function summarise(
  options: { apiKey: string; baseUrl?: string; model: string; book: Book } & RetryOptions,
): Promise<string[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseUrl, maxRetries: 0, timeout: timeoutMs });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: buildPrompt(options.book) }];
  let requestRetried = false;
  let replyRetried = false;

  for (;;) {
    let message: Anthropic.Message;
    try {
      message = await client.messages.create({
        model: options.model,
        max_tokens: 16000,
        system: SYSTEM,
        messages,
        output_config: { format: { type: 'json_schema', schema: LEARNINGS_SCHEMA } },
      });
    } catch (error) {
      const described = describeRequestError(error, client.baseURL, timeoutMs);
      if (!isRetryable(error)) throw described;
      if (requestRetried) throw new Error(`${described.message} (after retrying once)`);
      requestRetried = true;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }

    try {
      return parseLearnings(message);
    } catch (error) {
      if (!(error instanceof BadReplyError)) throw error;
      if (replyRetried) throw new Error(`${error.message} (after retrying once)`);
      replyRetried = true;
      const text = replyText(message);
      if (text?.trim()) messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: `That reply was invalid: ${error.message}. ${RETRY_INSTRUCTION}` });
    }
  }
}
