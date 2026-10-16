import { Marked } from 'marked';

// Tokenize only; no HTML rendering or model-supplied code execution.
const markdown = new Marked({ gfm: true });

/** Keep formatted material for deliberate text access rather than reciting it. */
export function spokenAnswer(
  text: string,
  spokenSummary?: string,
): string | null {
  let code = false;
  let table = false;
  const tokens = markdown.lexer(text);
  markdown.walkTokens(tokens, (token) => {
    if (token.type === 'code') code = true;
    if (token.type === 'table') table = true;
  });
  if (!code && !table) return text;
  // Prose around formatted material may be only an introduction. Always obtain
  // a separate content-bearing summary instead of guessing from its wording.
  if (spokenSummary === undefined) return null;
  const content =
    code && table ? 'Code und eine Tabelle' : code ? 'Code' : 'eine Tabelle';
  const notice = `Die Antwort enthält ${content}. Den vollständigen Text kannst du mit dem CLI-Befehl „text“ ansehen.`;
  // Leave room for the notice without splitting a Unicode code point.
  const budget = 4096 - Buffer.byteLength(notice) - 2;
  let summary = '';
  let bytes = 0;
  for (const character of spokenSummary) {
    bytes += Buffer.byteLength(character);
    if (bytes > budget) break;
    summary += character;
  }
  return [summary.trim(), notice].filter(Boolean).join('\n\n');
}
