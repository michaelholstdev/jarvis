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
{"version":1,"type":"ready","service":"core","status":{"ready":true,"mode":"mock","state":"idle","manual_activation":"mock","voice_conversation":"unavailable","audio":"ready","audio_diagnostic":null,"since_ms":0}}
```

Core refreshes audio through a real handshake at startup and on each health
request. It accepts only the audio readiness response, rather than trusting a
running PID or arbitrary JSON. `since_ms` is elapsed monotonic time since the
latest readiness transition. If audio disappears, health returns `ready:false`
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

Both decoders require valid UTF-8. UTF-16/UTF-32 frames and malformed UTF-8
return `invalid_message`; neither service auto-detects another wire encoding.

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
`acknowledging`, `listening`, `thinking`, `synthesizing`, `speaking`.

Core sends `audio-operation` with an `operation` object containing `type`
(`acknowledge`, `recognize`, `synthesize`, `play`), a unique `operation_id`, and
optional bounded `text`. Python returns `audio-result` with matching ID,
recognition `text`, or playback `completed` and `delivered_chars`. Synthesis
returns the ID without a delivery report. Inference is a fixed core mock;
Ollama is never contacted. Text is bounded to 4096 characters at the wire and
more tightly to the configured byte budget at the conversation boundary.
Delivery counts use UTF-16 code units in both languages. Full completed delivery
must match the answer length; synthesis completion alone never proves delivery.
The public core accepts partial delivery reports but CLI mocks always report
full completion. IDs are unique during a core process lifetime; stale events
cannot affect a newer operation. These reports are simulated evidence only.
Cancellation and real audio transport remain later work.
