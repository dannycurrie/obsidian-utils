import Anthropic from '@anthropic-ai/sdk';
import type { Book } from './book.ts';
import type { LinkedPart } from './links.ts';

export const LEARNING_COUNT = 5;

const SYSTEM = [
  "You distil a reader's own notes on a book into its key learnings.",
  'Use only what is in the notes; do not add anything from your general knowledge of the book.',
  `Return exactly ${LEARNING_COUNT} learnings, each a single sentence, with no preamble or numbering.`,
  'The first <notes> are the book note itself; any after it come from notes linked to or from it, so use those only where they bear on this book.',
  "Keep the reader's own wording and examples where possible.",
  'Ignore leftover checklist scaffolding such as ☐/☑ bullets and Status/Context labels.',
].join(' ');

const LEARNINGS_SCHEMA = {
  type: 'object',
  properties: { learnings: { type: 'array', items: { type: 'string' } } },
  required: ['learnings'],
  additionalProperties: false,
};

/** The book note first, then each linked part, each labelled with its vault-relative path. */
export function buildPrompt(book: Book, linked: LinkedPart[] = []): string {
  const byline = book.author ? `${book.title} by ${book.author}` : book.title;
  const notes = [{ path: book.path, text: book.body }, ...linked].map((part) => `<notes path="${part.path}">\n${part.text}\n</notes>`);
  return `Book: ${byline}\n\n${notes.join('\n\n')}`;
}

/** The parts of a Messages API reply this module reads; both the GA and beta message types fit it. */
type Reply = { content: ReadonlyArray<{ type: string }>; stop_reason: string | null };

/** A reply that arrived but is not exactly the learnings asked for. */
export class BadReplyError extends Error {}

function replyText(message: Reply): string | undefined {
  return (message.content.find((block) => block.type === 'text') as { text: string } | undefined)?.text;
}

/** The count is checked here rather than trusted to the schema. Throws a `BadReplyError` saying what is wrong. */
export function parseLearnings(message: Reply): string[] {
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

/**
 * Models that accept the server-side refusal fallback (`fallbacks: "default"`): a request the model declines on
 * safety grounds is re-run on a fallback model inside the same call. Other models (e.g. Haiku) have none.
 */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

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
    return new Error('Claude API rejected the key (401); check the Keychain item or BOOK_RECALL_API_KEY');
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
 * A safety refusal is not retried. The SDK's own retries are off so every attempt and wait is decided here.
 * `model` is the model that answered, which differs from `options.model` when a refusal fallback ran.
 */
export async function summarise(
  options: { apiKey: string; baseUrl?: string; model: string; book: Book; linked?: LinkedPart[] } & RetryOptions,
): Promise<{ learnings: string[]; model: string }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseUrl, maxRetries: 0, timeout: timeoutMs });
  const fallback = FALLBACK_MODELS.has(options.model)
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
    : {};
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: buildPrompt(options.book, options.linked) }];
  let requestRetried = false;
  let replyRetried = false;

  for (;;) {
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await client.beta.messages.create({
        model: options.model,
        max_tokens: 16000,
        system: SYSTEM,
        messages,
        output_config: { format: { type: 'json_schema', schema: LEARNINGS_SCHEMA } },
        ...fallback,
      });
    } catch (error) {
      const described = describeRequestError(error, client.baseURL, timeoutMs);
      if (!isRetryable(error)) throw described;
      if (requestRetried) throw new Error(`${described.message} (after retrying once)`);
      requestRetried = true;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }

    if (message.stop_reason === 'refusal') {
      const category = message.stop_details?.category;
      throw new Error(
        `Claude declined to summarise "${options.book.title}" (safety refusal${category ? `, category ${category}` : ''}); try --reroll or another --book`,
      );
    }
    try {
      return { learnings: parseLearnings(message), model: message.model };
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
