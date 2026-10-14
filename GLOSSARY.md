# Jarvis Conversation

Jarvis supports private German voice conversations with explicit activation and bounded listening. This glossary defines the language agreed during the design interview.

## Language

**Manual activation**:
A deliberate user action that starts listening without a wake phrase.
_Avoid_: Manual wake word

**Idle**:
The condition in which Jarvis awaits activation and may listen for its wake phrase, but does not transcribe ambient speech.
_Avoid_: Muted, inactive microphone

**Pre-roll**:
A short, temporary audio window immediately preceding activation, used to preserve the beginning of the user's utterance.
_Avoid_: Recording history

**Stop playback**:
The user's intent to silence the current spoken reply without ending the conversation or supplying a new question.
_Avoid_: End conversation, barge-in

**Barge-in**:
An interruption of a spoken reply that starts a new user turn.
_Avoid_: Stop playback

**Muted**:
The condition in which Jarvis microphone capture is disabled by a mute control.
_Avoid_: Idle

**Locked**:
The condition in which the user's desktop session is locked and Jarvis microphone capture is disabled.
_Avoid_: Idle, logged out

**Conversation expiry**:
The point at which a conversation has reached its duration allowance and needs an explicit extension before another user turn, after the current turn finishes.
_Avoid_: Playback cancellation

**Delivered reply**:
The portion of Jarvis's answer the user has actually heard, excluding any remainder stopped before playback.
_Avoid_: Generated answer

**Conversation extension**:
The user's explicit agreement to continue an expired conversation with its existing context and a renewed duration allowance.
_Avoid_: New conversation, automatic renewal

**Retry request**:
An explicit user instruction to try an unsuccessful question again while its conversation remains open.
_Avoid_: Automatic recovery

**Follow-up window**:
The bounded opportunity to speak another question without reactivation after Jarvis finishes or stops a reply.
_Avoid_: Conversation duration allowance

**Voice control phrase**:
A standalone spoken instruction with a defined conversation-control meaning, distinct from the same words quoted or used within a question.
_Avoid_: Keyword occurrence

**Replacement question**:
A new user question supplied after deliberately canceling an unfinished response, continuing from earlier completed exchanges.
_Avoid_: Follow-up to an unanswered question

**Text answer**:
An answer deliberately viewed as text within the current conversation, including content unsuitable for spoken delivery.
_Avoid_: Conversation archive, routine log
