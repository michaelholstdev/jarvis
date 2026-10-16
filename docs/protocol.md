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
{"version":1,"type":"ready","service":"core","status":{"ready":true,"mode":"mock","state":"idle","manual_activation":"mock","voice_conversation":"unavailable","audio":"ready","audio_diagnostic":null,"since_ms":0,"state_since_ms":0,"inhibitions":{"locked":false,"muted":false,"hardware_muted":false},"privacy_pending":false,"audio_cleanup_pending":false,"capabilities":{"wake":"unavailable","stt":"mock","tts":"mock","inference":"mock"},"retry_available":false,"last_failure":null}}
```

Core refreshes audio through a real handshake at startup and on each health
request and through periodic bounded probes. It accepts only the audio readiness response, rather than trusting a
running PID or arbitrary JSON. `since_ms` is elapsed monotonic time since the
latest readiness transition. `state_since_ms` independently measures elapsed
time since the latest conversation-state entry or reset, and supplies watchdog
log timing. Conversation activity never resets the readiness timer. If audio
disappears, health returns `ready:false`
and an `audio_diagnostic`; recovery requires another successful handshake and, if old work might still be active, a confirmed cleanup barrier before readiness returns. It never replays a question. This proves mock service readiness only.

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
an invalid report resets the turn, while a missing report degrades audio at the watchdog deadline. The Python mock retains only its latest playback
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


## Privacy signals and audio barrier (#06)

The desktop/audio-facing core socket accepts
`{version:1,type:"inhibition-changed",source:"locked"|"muted"|"hardware_muted",active:boolean}`.
The CLI `lock`, `unlock`, `mute`, `unmute`, `hardware-mute` and `hardware-unmute`
commands send these simulated events. Repeated identical values are idempotent.
Hardware mute is distinct from software mute; clearing either cannot clear the
other or desktop lock. Health includes all three `inhibitions` booleans and
`privacy_pending`; these are capture conditions separate from conversation state.

The public orchestration boundary dispatches the same event (without `version`).
It immediately drops conversation data and replaces the current operation with
`privacy`, carrying a full `inhibitions` snapshot and a new operation ID.
This operation must stop capture/wake/pre-roll, playback, recognition and synthesis,
cancel outstanding audio operations, erase temporary audio and delivery tracking,
and apply the snapshot before returning `audio-result` with the matching ID.
It makes no sound. Core generation is invalidated immediately. The mock holds no
audio buffers; it clears its last playback report and rejects ordinary audio
operations with `unavailable` whenever any snapshot flag is true.

The driver converts a matching result to `privacy-applied`. Core ignores other
results while cleanup is pending, and ignores all conversation events while
inhibited. Privacy updates are serialized to audio independently of any stalled
turn; a superseded acknowledgment cannot release the latest barrier. Clearing
all flags also requires a privacy round trip before activation is permitted.
On failure/timeout, readiness remains blocked and a new handshake reissues the
pending snapshot. Audio loss never removes an inhibition. No work or context
resumes after a release; new operation IDs keep canceled results stale.

Real adapters must enforce the barrier before acknowledgment, including rejecting
late tasks from canceled work and preserving local hardware inhibition. The
current sockets exercise simulated signals only; real KDE/PipeWire monitoring,
startup state synchronization and acoustic stop/cleanup validation are ticket #12.


Pending CLI activation, demo and stop requests are invalidated by any change to
an inhibition, even if all flags clear before their audio handshake or cleanup
wait completes. A privacy generation check prevents those requests from starting
old work or stopping a fresh conversation. Readiness results from an earlier
privacy generation cannot change current audio readiness or clear current work.

## Failure and capability recovery (#07)

Audio readiness may include `capabilities`, an object with any of `wake`, `stt`,
`tts`, `inference`, each `mock` or `unavailable`. Omitted fields retain the last
advertised value. The Python mock supports scripted STT/TTS and the core has
scripted inference; wake defaults to unavailable. There is no `ready` real-model
capability in this mock protocol. `voice_conversation` remains `unavailable`.
Core health additionally requires `capabilities`, `retry_available`, and
`last_failure` (null or `{code,capability}` with allowlisted values, including
`audio`). `ready` describes the audio handshake plus any required recovery cleanup; inspect capabilities separately.
The most recent failure remains visible after recovery without storing content.

Core probes audio at startup, on CLI health/control requests, and periodically
according to `recovery.probe_interval_ms`. Same-generation probes coalesce;
privacy changes invalidate obsolete probes without blocking fresh commands.
Readiness restoration neither replays a question nor emits a failure cue.
Audio loss during an open conversation invalidates the operation but retains
completed context and an available unsuccessful question until the existing
follow-up deadline. If loss interrupts work, a single follow-up window starts;
subsequent loss/recovery cannot renew it. At idle, failures stay silent.

At the public core boundary `operation-failed` carries the current operation ID,
a diagnostic `code`, and affected `capability`. Stale failures are ignored just
like stale successes. A current failure requests `cancel`; after confirmation
it requests `indicate-failure` in state `indicating-failure`. This operation
requests a brief nonverbal failure cue independent of STT/TTS, with no user text.
Audio responds with the same zero-character completion shape as acknowledgment.
The mock simulates it without sound. Cancellation must still confirm final
playback delivery. Only confirmed delivery enters context. A failed/timed-out
cancellation or cue degrades audio rather than looping. Transport loss can make
a cue impossible; CLI health is then the indication.

Standalone `Noch einmal` uses the retained unsuccessful question and existing
completed context. Without one it never invokes inference. Quoted/embedded words
remain questions. A new question discards the retry candidate; success, closure,
lock and mute clear it. Recovery alone requests no inference or synthesis.
Capability changes can also enter through public `capabilities-changed` events;
a future Ollama adapter must report inference failure/recovery through this
boundary. No real Ollama process is contacted by this ticket.

One active operation and no control/audio application queue are retained. Core
and audio cap concurrent connections, frame bytes and exchange time. Outbound
requests are byte-checked before connecting and written as one bounded frame;
Python awaits `drain()` with a deadline. Privacy updates share one worker and
coalesce into the latest snapshot instead of accumulating promises. Core
routine diagnostics discard messages beyond 100 per 30-second monotonic window
without buffering; readiness logs report transitions rather than every failed
probe. Deliberate CLI status/config output is separate. Jarvis writes no log
files. Collector disk retention must be bounded independently (see recovery guide).


### Confirming cleanup after uncertain audio work

If an audio operation loses its connection or cancellation fails/times out,
`audio_cleanup_pending:true` survives further handshakes and conversation expiry.
A successful hello alone cannot restore `ready` or manual activation. Core
requests a silent `privacy` operation with the current inhibition snapshot as a
stop-all barrier. This reuses the existing audio contract: stop all outstanding
work and clear temporary audio/delivery state before acknowledging. For recovery
alone, core context and retry access retain their original follow-up deadline;
the audio-side reset does not close or renew the core conversation.

Only `privacy-applied` for the current cleanup operation releases the barrier.
Late target/cancellation results and old cleanup acknowledgments remain stale.
Cleanup failure or timeout leaves readiness unavailable; subsequent probes can
request a new bounded cleanup attempt. Expiry clears conversation data without
forgetting the barrier. A lock/mute change supersedes recovery with the latest
privacy snapshot and immediately clears context as usual. No cue, question or
reply is replayed by a recovered handshake or cleanup acknowledgment.

## Optional real output

Audio readiness may advertise `mode: piper` and `tts: ready`. Core remains scripted
and voice conversation unavailable. Audio operation results wait for real synthesis
or successful PulseAudio drain; sound flags suppress the corresponding cue. Stop
and privacy destroy the bounded resident worker. Content-free audio events mark
first successful PCM write, drained completion, or cancellation. Partial canceled
speech reports zero delivered characters conservatively; completed text counts
UTF-16 units. See [runtime limits and verification](audio-output.md).

### Recognition progress (ticket 10)

A recognition request may return one `speech-started` frame (`version:1`, matching `operation_id`) before its final `audio-result`. Core uses this content-free onset to apply the original follow-up deadline and bounded completion allowance. Duplicate or mismatched progress is invalid; progress never resets the socket deadline. Progress and final frames may share a read. Other requests remain single-response. Operational health permits `manual_activation: ready` for real STT and `voice_conversation: ready` when all real conversation adapters are available; see [health semantics](ollama.md). The legacy `mode: mock` status field remains for protocol compatibility; use the individual capabilities.


## Temporary text access

A CLI peer deliberately sends `{"version":1,"type":"text-answer-request"}`
(optionally `offset:0`). Core returns a page such as:

```json
{"version":1,"type":"text-answer","text":"…","answer_id":"opaque-id","next_offset":123}
```

`next_offset:null` marks the final page. If no answer exists, `text`, `answer_id`
and `next_offset` are all null. Continuations send `offset` equal to the previous
`next_offset` and the same `answer_id`. Offsets count Unicode code points, not
UTF-16 units or bytes; they range from 0 to 4096. Nonzero offsets require an answer
ID. Replacement answers get a new ID even when their text is identical; closure,
lock and mute invalidate it. A stale ID returns `unavailable`, while invalid
offsets return `invalid_message`. IDs are unique across daemon restarts.

Each page, including JSON escaping, metadata and newline, fits
`transport.max_frame_bytes`. The CLI bounds the assembled answer at 4096 UTF-8
bytes, validates continuation progress/identity and prints only after complete
retrieval. It discards partial output on failure. No page queue or archive is
stored service-side. This is the only control response carrying answer content;
do not log it. Normal `ready` health/control messages stay content-free. Reading
does not renew session timers or promote generated text into delivered context.
See [text lifetime and CLI commands](text-answers.md).

During an answer `play`, audio may send one `control-stopped` progress frame with
that playback's `operation_id`. It contains no transcript and means the audio
adapter validated standalone spoken stop. It does not complete playback. Core
cancels the operation and awaits a cancellation result before follow-up. Like
`speech-started`, it cannot renew the request deadline; duplicates, mismatched IDs
and progress on the wrong operation are rejected.
