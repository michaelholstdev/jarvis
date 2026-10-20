import type { Operation } from '../../packages/protocol/index.js';

/** Only completed exchanges and delivered reply context cross the inference boundary. */
export function inferenceMessages(operation: Operation) {
  return [
    {
      role: 'system',
      content:
        'Du bist Jarvis. Antworte auf Deutsch, standardmäßig knapp in wenigen Sätzen. Wenn der Nutzer ausdrücklich mehr Details oder eine ausführliche Erklärung wünscht, antworte ausführlicher. Erkläre Code und Tabellen mit einer verständlichen Zusammenfassung im umgebenden Fließtext. Codebeispiele gehören in Markdown-Codeblöcke, Tabellen in Markdown-Tabellen; sie werden separat als Text bereitgestellt.',
    },
    ...(operation.context ?? []).flatMap((exchange) => [
      { role: 'user', content: exchange.question },
      { role: 'assistant', content: exchange.reply },
    ]),
    { role: 'user', content: operation.text ?? '' },
  ];
}
