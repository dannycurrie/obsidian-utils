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

/** The count is checked here rather than trusted to the schema. */
export function parseLearnings(message: Anthropic.Message): string[] {
  const text = message.content.find((block): block is Anthropic.TextBlock => block.type === 'text')?.text;
  let learnings: unknown;
  try {
    learnings = (JSON.parse(text ?? '') as { learnings?: unknown }).learnings;
  } catch {
    throw new Error(`Claude did not return JSON learnings (stop reason: ${message.stop_reason})`);
  }
  if (
    !Array.isArray(learnings) ||
    learnings.length !== LEARNING_COUNT ||
    learnings.some((l) => typeof l !== 'string' || !l.trim())
  ) {
    throw new Error(`Claude returned ${Array.isArray(learnings) ? learnings.length : 'no'} learnings, expected ${LEARNING_COUNT}`);
  }
  return learnings.map((l: string) => l.trim());
}

export async function summarise(options: { apiKey: string; baseUrl?: string; model: string; book: Book }): Promise<string[]> {
  const client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseUrl });
  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: options.model,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(options.book) }],
      output_config: { format: { type: 'json_schema', schema: LEARNINGS_SCHEMA } },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new Error('Claude API rejected the key (401); check BOOK_RECALL_API_KEY');
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new Error(`Could not reach the Claude API at ${client.baseURL}`);
    }
    if (error instanceof Anthropic.APIError) {
      throw new Error(`Claude API returned ${error.status}: ${error.message}`);
    }
    throw error;
  }
  return parseLearnings(message);
}
