/** Keep formatted material for deliberate text access rather than reciting it. */
export function spokenAnswer(
  text: string,
  spokenSummary?: string,
): string | null {
  const prose: string[] = [];
  let fence: { marker: string; length: number } | undefined;
  let code = false;
  let table = false;
  const lines = text.split('\n');
  let inTable = false;
  for (const [index, line] of lines.entries()) {
    const delimiter = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (
        delimiter?.[0] === fence.marker &&
        delimiter.length >= fence.length &&
        line.trim() === delimiter
      )
        fence = undefined;
      continue;
    }
    if (delimiter) {
      code = true;
      fence = { marker: delimiter[0] ?? '`', length: delimiter.length };
    } else if (/^( {4,}|\t)\S/.test(line)) code = true;
    else if (
      line.includes('|') &&
      (inTable || isTableSeparator(lines[index + 1] ?? ''))
    ) {
      table = true;
      inTable = true;
    } else {
      inTable = false;
      prose.push(line);
    }
  }
  const explanation =
    spokenSummary ??
    prose
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  if (!code && !table) return text;
  if (!explanation) return null;
  const content =
    code && table ? 'Code und eine Tabelle' : code ? 'Code' : 'eine Tabelle';
  const notice = `Die Antwort enthält ${content}. Den vollständigen Text kannst du mit dem CLI-Befehl „text“ ansehen.`;
  // Leave room for the notice without splitting a Unicode code point.
  const budget = 4096 - Buffer.byteLength(notice) - 2;
  let summary = '';
  let bytes = 0;
  for (const character of explanation) {
    bytes += Buffer.byteLength(character);
    if (bytes > budget) break;
    summary += character;
  }
  return [summary.trim(), notice].filter(Boolean).join('\n\n');
}

function isTableSeparator(line: string): boolean {
  const cells = line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|');
  return (
    cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  );
}
