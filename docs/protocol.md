# Local mock protocol, version 1

`packages/protocol/schemas/message.schema.json` is the shared runtime contract:
Ajv validates it in TypeScript and jsonschema validates it in Python. TypeScript
types live in `packages/protocol/index.ts`. Python public functions carry type
hints; the schema validates their decoded JSON. Content-bearing fields are accepted only for explicit scripted mock operations;
they never appear in routine logs. All objects reject unknown properties.

Each AF_UNIX stream connection exchanges exactly one newline-terminated UTF-8
JSON request and one response, then closes. There are no TCP listeners, binary
audio frames, model calls or tool execution in M0. Paths are
`$XDG_RUNTIME_DIR/jarvis/{audio,core}.sock`. The runtime root and `jarvis`
directory must belong to the current UID with mode 0700; symlinks are refused.
Sockets have mode 0600. Both services refuse an existing socket so a second
process cannot replace the first service's listener.

Core → audio:

```json
{"version":1,"type":"hello","role":"core"}
{"version":1,"type":"ready","service":"audio","mode":"mock"}
```

CLI → core:

```json
{"version":1,"type":"hello","role":"cli"}
{"version":1,"type":"ready","service":"core","status":{"ready":true,"mode":"mock","state":"idle","manual_activation":"mock","voice_conversation":"unavailable","audio":"ready","audio_diagnostic":null,"since_ms":0,"state_since_ms":0}}
```

Core refreshes audio through a real handshake at startup and on each health
request. It accepts only the audio readiness response, rather than trusting a
running PID or arbitrary JSON. `since_ms` is elapsed monotonic time since the
latest readiness transition. `state_since_ms` independently measures elapsed
time since the latest conversation-state entry or reset, and supplies watchdog
log timing. Conversation activity never resets the readiness timer. If audio
disappears, health returns `ready:false`
and an `audio_diagnostic`; recovery requires another successful handshake and
never requests speech or inference. This proves mock service readiness only.

Errors have only an allowlisted code, with no input content:

```json
{"version":1,"type":"error","code":"incompatible_version"}
```

Codes: `invalid_message`, `incompatible_version`, `frame_too_large`, `timeout`,
`unavailable`, `busy` (reserved for an explicit capacity response). No payloads,
JSON parser messages or schema values appear in errors. Routine output consists
of `service_started`, health status, operation/playback status and timing, and
content-free error codes. There are no
log files or conversation archives.

Both decoders require valid UTF-8. The audio decoder also rejects escaped lone
surrogates with `invalid_message`; valid supplementary characters remain
supported. UTF-16/UTF-32 frames and malformed UTF-8
return `invalid_message`; neither service auto-detects another wire encoding.

Audio responses use compact UTF-8 JSON without ASCII escaping, and the audio
service enforces the configured frame byte limit on responses as well as requests.
Every audio request releases its connection slot on exit, including error paths.

Defaults: 8192 bytes per frame including newline, eight concurrent connections
per service, 1000 ms per exchange. CLI health allows 2000 ms because core may
spend one exchange deadline waiting for audio. Configuration bounds these
limits. Capacity exhaustion closes extra connections; it never queues work in
an unbounded application queue. A missing newline hits the deadline; oversize
frames are rejected. Reconnect means a fresh handshake; no work is replayed.

CLI also sends `{"version":1,"type":"activate"}` or
`{"version":1,"type":"demo","text":"Wie geht es dir?"}` and receives the core
readiness/status response after the requested mock flow. `manual_activation` is
`mock` when ready, otherwise `unavailable`; `state` additionally accepts
`acknowledging`, `listening`, `thinking`, `synthesizing`, `speaking`, `follow-up`,
`cancelling`, `awaiting-extension`.

Core sends `audio-operation` with an `operation` object containing `type`
(`acknowledge`, `recognize`, `synthesize`, `play`, `close-conversation`, `cancel`), a unique `operation_id`, and
optional bounded `text`. Python returns `audio-result` with matching ID,
recognition `text`, or playback `completed` and `delivered_chars`. Synthesis
returns the ID without a delivery report. Inference is a deterministic core mock with completed-exchange context;
Ollama is never contacted. Text is bounded to 4096 characters at the wire and
more tightly to the configured byte budget at the conversation boundary.
Delivery counts use UTF-16 code units in both languages, with a wire maximum
of 8192 units for the permitted 4096 Unicode characters. Full completed delivery
must match the answer length; synthesis completion alone never proves delivery.
The public core accepts partial delivery reports; ordinary Python mock playback
reports full completion. IDs are unique during a core process lifetime; stale events
cannot affect a newer operation. These reports are simulated evidence only.
`close-conversation` requests clearing temporary audio and optionally a distinct
end sound via its boolean `sound` field. The audio mock has no capture buffers
and returns a zero-character playback completion, with no audible output.
Silence cleanup is dispatched by the core ticker. Standalone German end phrases
are interpreted at the core before inference; quoted/embedded phrases remain
content. In-process `speech-started` events identify the current recognition
operation and enable bounded completion beyond the original follow-up deadline
(see README). The CLI supplies simulated onset when submitting a script.
History stays in the core; it is never sent to the audio process or routine logs.
CLI `{"version":1,"type":"stop"}` requests stop playback, distinct from
`activate` for replacement and scripted end phrases for closure. Both controls
are accepted while a previous audio exchange is awaiting its result.

`cancel` includes the required `target_operation_id` of the operation to stop.
Its own new `operation_id` identifies the cancellation result. Audio responds
with `audio-result`, that new ID, `completed` and final `delivered_chars` for the
target playback (zero for recognition/synthesis/inference). Cancellation must
stop target work before responding; the core ignores all later target results.
The core enters `cancelling` until this response, then acknowledges replacement
or opens follow-up for stop. No generation/synthesis text is inferred as heard.
Counts splitting a UTF-16 surrogate pair are rejected. Zero delivery omits the
question from history. A missing/invalid delivery report cannot start listening;
the watchdog resets the turn. The Python mock retains only its latest playback
ID/count to report already-completed delivery during cancellation; no audio is
captured, buffered or played.

Public `control-recognized` events carry the current playback ID and text;
standalone normalized `Stopp` invokes the same stop path. There is no wire or
acoustic microphone recognition during playback yet. Real audio transport and
measured delivery tracking remain later work.


Conversation expiry uses `awaiting-extension` throughout prompt synthesis,
playback and command recognition. It reuses `synthesize`/`play`/`recognize`
operations with new IDs; prompt delivery never becomes a conversational exchange.
The daemon drives the prompt even without a CLI request. A scripted `demo` while
awaiting the extension response accepts only standalone `Weiter` or an end
phrase; all other text is ignored and gets another recognition operation under
the same deadline, without inference. `activate` returns `busy` during the prompt
or extension response. Expiry itself never cancels healthy operations. Stop or
replacement finishing at expiry prompts before another turn can start.
