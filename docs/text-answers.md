# Concise speech and temporary text answers

Jarvis instructs the local model to answer in German, briefly in a few sentences
by default. Ask “Bitte ausführlicher” or “Erkläre das mit mehr Details” for a
longer answer; the request reaches the model unchanged with delivered context.
This is a model instruction, not a hard truncation or a quality guarantee.

With `llm.mode: ollama`, the built-in system instruction also asks for a prose
summary around code and tables, with Markdown fences for code and Markdown pipe
tables. The core speaks that explanation and adds a German notice pointing to
the CLI `text` command. Fenced code (backticks or tildes, including an unclosed
fence), indented code and Markdown tables are omitted from speech. All recognized
pipe tables are summarized, including small ones. If the model supplies only
formatted material, Jarvis requests one short, content-bearing German prose
summary from the same local model before synthesis. The original formatted
answer remains available as text. A formatted or unusable summary fails the turn
through the existing explicit-retry path; it cannot loop into more summary
requests. This additional request uses the same generation limits, watchdog and
cancellation controls and can add latency. Summary quality still depends on the
model. This is a bounded Markdown filter, not a parser for arbitrary HTML or
unmarked source code. Ordinary prose is spoken unchanged. The spoken explanation is capped at
4096 UTF-8 bytes including the notice; a near-limit explanation may be shortened
to reserve space for it, while the full text stays intact.

## Deliberate text access

After building and starting both services with the same configuration:

```sh
node dist/apps/core/main.js activate
# Speak after the cue; then, while the conversation is open:
node dist/apps/core/main.js text
```

For a hardware-free scripted question, use `demo` instead of `activate`:

```sh
node dist/apps/core/main.js demo 'Zeige ein kurzes Codebeispiel.'
node dist/apps/core/main.js text
```

`llm.mode: mock` uses the existing scripted response; select `ollama` for real
model answers. See [Ollama configuration](ollama.md). `llm.num_predict` (default
512) and `llm.max_context_tokens` bound generation; a detailed answer still uses
those limits. The spoken-style instruction is built in, with no additional
configuration key. Generated answers retain the existing per-answer UTF-8 byte
limit, the smaller of 4096 and `llm.max_context_tokens`.

Only `text` prints the full latest successfully generated answer, including its
formatting. Health and routine control output contain no answer text. An empty
session prints `Keine Textantwort in dieser Sitzung verfügbar.` and exits
successfully. Text inspection does not start listening, renew a timer, generate
an answer, replay audio, or change follow-up context.

The answer is held only in service memory, available once generation completes,
including during synthesis/playback and after a stopped reply. It is replaced
when a new question is accepted (and unavailable until that question succeeds).
Session closure, silence timeout, lock, software/hardware mute and service exit
clear access. Conversation expiry retains it while awaiting an explicit
extension; refusal or timeout closes the session and clears it. Unlock/unmute
never restores it. Late canceled results cannot restore it either.

This is temporary answer access, not persistent conversation history. Even if
you inspect a stopped reply's full text, only the portion reported as heard is
retained in follow-up context. For code and tables this means the delivered
spoken explanation and notice, not the hidden formatted content. Jarvis writes
no answer, transcript or prompt file and adds no content to routine diagnostics.
Terminal scrollback or deliberate shell redirection can retain what you choose
to display; session cleanup cannot erase those user-controlled copies.

## Verification limits

Deterministic controller and daemon/CLI tests cover prose/code/table separation,
explicit detail requests and system instructions, delivered-only context,
cleanup, and content-free diagnostics. They use fake model output and mock
audio, and do not establish real model compliance, summary quality, physical
speech intelligibility or hardware latency.
