import {
  encodeMessage,
  type Message,
  ProtocolError,
  type TextAnswer,
} from '../../packages/protocol/index.js';
import type { Config } from './config.js';
import { request } from './transport.js';

type TextPage = Extract<Message, { type: 'text-answer' }>;
type TextQuery = Extract<Message, { type: 'text-answer-request' }>;

/** Serialize against the actual frame budget, including JSON escaping. */
export function textAnswerPage(
  answer: TextAnswer | null,
  query: TextQuery,
  maxFrameBytes: number,
): TextPage {
  const offset = query.offset ?? 0;
  if (query.answer_id && query.answer_id !== answer?.answer_id)
    throw new ProtocolError('unavailable');
  if (offset && !query.answer_id) throw new ProtocolError('invalid_message');
  if (!answer)
    return {
      version: 1,
      type: 'text-answer',
      text: null,
      answer_id: null,
      next_offset: null,
    };
  const characters = Array.from(answer.text);
  if (offset >= characters.length) throw new ProtocolError('invalid_message');
  const page = (count: number): TextPage => ({
    version: 1,
    type: 'text-answer',
    answer_id: answer.answer_id,
    text: characters.slice(offset, offset + count).join(''),
    next_offset: offset + count < characters.length ? offset + count : null,
  });
  let low = 1;
  let high = characters.length - offset;
  if (Buffer.byteLength(encodeMessage(page(high))) <= maxFrameBytes)
    return page(high);
  // Non-final pages have monotonically increasing serialized sizes.
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (Buffer.byteLength(encodeMessage(page(middle))) <= maxFrameBytes)
      low = middle + 1;
    else high = middle - 1;
  }
  if (high < 1) throw new ProtocolError('frame_too_large');
  return page(high);
}

/** Assemble privately, then display once complete; never print partial pages. */
export async function readTextAnswer(
  path: string,
  limits: Config['transport'],
): Promise<string | null> {
  let offset = 0;
  let answerId: string | undefined;
  let text = '';
  // Every nonempty page advances by at least one code point; answers are bounded.
  for (let page = 0; page < 4096; page++) {
    const response = await request(path, 'cli', limits, {
      version: 1,
      type: 'text-answer-request',
      offset,
      ...(answerId ? { answer_id: answerId } : {}),
    });
    if (response.type === 'error') throw new ProtocolError(response.code);
    if (response.type !== 'text-answer')
      throw new ProtocolError('invalid_message');
    if (response.text === null) {
      if (
        offset ||
        response.answer_id !== null ||
        response.next_offset !== null
      )
        throw new ProtocolError('invalid_message');
      return null;
    }
    if (
      !response.answer_id ||
      (answerId && answerId !== response.answer_id) ||
      !response.text
    )
      throw new ProtocolError('invalid_message');
    answerId = response.answer_id;
    text += response.text;
    if (Buffer.byteLength(text) > 4096)
      throw new ProtocolError('frame_too_large');
    offset += Array.from(response.text).length;
    if (response.next_offset === null) return text;
    if (response.next_offset !== offset)
      throw new ProtocolError('invalid_message');
  }
  throw new ProtocolError('frame_too_large');
}
