"""Bounded local audio service with mock and optional CPU Piper output."""

from __future__ import annotations

import asyncio
import copy
import json
import os
import re
from pathlib import Path
import signal
import socket
import stat
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from apps.audio.output import Output, OutputError, verify_voice
else:
    from importlib import import_module
    _output = import_module("apps.audio.output" if __package__ else "output")
    Output, OutputError, verify_voice = _output.Output, _output.OutputError, _output.verify_voice

import jsonschema
from ruamel.yaml import YAML
from ruamel.yaml.error import YAMLError
from ruamel.yaml.resolver import VersionedResolver
from ruamel.yaml.tokens import AliasToken, AnchorToken

if TYPE_CHECKING:
    from ruamel.yaml.compat import VersionType

ROOT = Path(__file__).resolve().parents[2]
CONFIG_SCHEMA = json.loads((ROOT / "packages/protocol/schemas/config.schema.json").read_text())
MESSAGE_SCHEMA = json.loads((ROOT / "packages/protocol/schemas/message.schema.json").read_text())
MESSAGE_VALIDATOR = jsonschema.Draft7Validator(MESSAGE_SCHEMA)


class Diagnostic(Exception):
    """An allowlisted content-free diagnostic."""


class CoreSchemaResolver(VersionedResolver):
    """Keep YAML 1.1 tag extensions out of YAML 1.2 core scalar resolution."""

    def add_version_implicit_resolver(
        self, version: VersionType, tag: Any, regexp: Any, first: Any,
    ) -> None:
        if version == (1, 2):
            if tag in {
                "tag:yaml.org,2002:timestamp", "tag:yaml.org,2002:merge", "tag:yaml.org,2002:value",
            }:
                return
            if tag == "tag:yaml.org,2002:int":
                regexp = re.compile(r"^(?:[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+)$")
            elif tag == "tag:yaml.org,2002:float":
                regexp = re.compile(
                    r"^(?:[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+"
                    r"|[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)"
                    r"|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$"
                )
        super().add_version_implicit_resolver(version, tag, regexp, first)


def defaults(value: Any, schema: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        if any(not isinstance(key, str) for key in value):
            raise Diagnostic("invalid_config: expected_string_key")
        for key, child in schema.get("properties", {}).items():
            if key not in value and "default" in child:
                value[key] = copy.deepcopy(child["default"])
            if key in value:
                defaults(value[key], child)
    return value


def load_config() -> dict[str, Any]:
    configured = os.environ.get("JARVIS_CONFIG")
    path = Path(configured or str(Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "jarvis/config.yaml"))
    value: Any = {}
    if configured or path.exists():
        try:
            content = path.read_bytes()
            if len(content) > 65536:
                raise Diagnostic("invalid_config: file_too_large")
            # Aliases are unnecessary for config and can amplify small documents.
            # Use the pure Python parser so scalar resolution follows YAML 1.2,
            # matching the core even when the optional C extension is installed.
            loader = YAML(typ="safe", pure=True)
            loader.version = (1, 2)
            loader.Resolver = CoreSchemaResolver
            loader.allow_duplicate_keys = False
            if any(isinstance(token, (AliasToken, AnchorToken))
                   for token in loader.scan(content)):
                raise Diagnostic("invalid_config: aliases_disabled")
            value = loader.load(content)
        except (OSError, YAMLError, RecursionError):
            raise Diagnostic("invalid_config: unreadable_or_malformed_yaml") from None
    value = defaults(value, CONFIG_SCHEMA)
    error = next(jsonschema.Draft7Validator(CONFIG_SCHEMA).iter_errors(value), None)
    if error:
        location = "/" + "/".join(str(item) for item in error.absolute_path)
        if location in {"/wake_word/model_path", "/wake_word/threshold"}:
            raise Diagnostic(
                "invalid_config: /wake_word wake unavailable; set model_path and threshold "
                "to null for manual activation; see docs/wake-activation.md"
            )
        raise Diagnostic(f"invalid_config: {location} {error.validator}")
    from urllib.parse import urlsplit
    try:
        port = urlsplit(value["llm"]["base_url"]).port
        if not port:
            raise ValueError("port")
    except ValueError:
        raise Diagnostic("invalid_config: /llm/base_url port") from None
    return dict(value)


def runtime_directory() -> Path:
    root = os.environ.get("XDG_RUNTIME_DIR")
    if not root or not Path(root).is_absolute():
        raise Diagnostic("missing_runtime_directory")
    directory = Path(root)
    for path in (directory, directory / "jarvis"):
        if path != directory:
            path.mkdir(mode=0o700, exist_ok=True)
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise Diagnostic("unsafe_runtime_directory")
    directory /= "jarvis"
    if len(os.fsencode(directory / "audio.sock")) > 103:
        raise Diagnostic("runtime_path_too_long")
    return directory


def parse_message(frame: bytes) -> dict[str, Any]:
    try:
        value = json.loads(frame.decode("utf-8"))
    except (ValueError, UnicodeError, RecursionError):
        raise Diagnostic("invalid_message") from None
    if isinstance(value, dict) and "version" in value and value["version"] != 1:
        raise Diagnostic("incompatible_version")
    if not MESSAGE_VALIDATOR.is_valid(value):
        raise Diagnostic("invalid_message")
    try:
        # Escaped lone surrogates are valid JSON syntax, but not Unicode text.
        json.dumps(value, ensure_ascii=False).encode("utf-8")
    except UnicodeError:
        raise Diagnostic("invalid_message") from None
    return dict(value)


async def serve() -> None:
    config = load_config()
    output: Output | None = None
    if config["audio"]["mode"] in {"piper", "voice"}:
        verify_voice(config)
        output = Output(config)
        await output.start()
    limits = config["transport"]
    path = runtime_directory() / "audio.sock"
    active: set[asyncio.StreamWriter] = set()
    last_playback: tuple[str, int] | None = None
    inhibited = False

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        nonlocal last_playback, inhibited
        if len(active) >= limits["max_connections"]:
            writer.close()
            return
        active.add(writer)
        try:
            try:
                try:
                    frame = await asyncio.wait_for(reader.readuntil(b"\n"), limits["timeout_ms"] / 1000)
                    if len(frame) > limits["max_frame_bytes"]:
                        raise Diagnostic("frame_too_large")
                    message = parse_message(frame)
                    response: dict[str, Any]
                    if message["type"] == "hello" and message["role"] == "core":
                        response = {"version": 1, "type": "ready", "service": "audio", "mode": config["audio"]["mode"],
                                    "capabilities": {"wake": "unavailable", "stt": "ready" if config["audio"]["mode"] == "voice" else "mock", "tts": "ready" if output else "mock"}}
                    elif message["type"] == "audio-operation":
                        operation = message["operation"]
                        kind = operation["type"]
                        response = {"version": 1, "type": "audio-result", "operation_id": operation["operation_id"]}
                        if kind == "privacy":
                            # Real adapters must stop all capture/playback/inference and erase
                            # temporary audio/pre-roll before acknowledging this barrier.
                            inhibited = any(operation["inhibitions"].values())
                            last_playback = None
                            if output:
                                await output.run(operation)
                        elif inhibited:
                            raise Diagnostic("unavailable")
                        elif output:
                            if kind == "cancel" or (kind == "recognize" and config["audio"]["mode"] != "voice"):
                                response.update(await output.run(operation))
                            else:
                                def speech_started() -> None:
                                    writer.write((json.dumps({"version": 1, "type": "speech-started",
                                                              "operation_id": operation["operation_id"]}) + "\n").encode())
                                def control_stopped() -> None:
                                    writer.write((json.dumps({"version": 1, "type": "control-stopped",
                                                              "operation_id": operation["operation_id"]}) + "\n").encode())
                                work_generation = output.generation
                                work = asyncio.create_task(output.run(operation, speech_started if kind == "recognize" else None, control_stopped if kind == "play" else None))
                                disconnected = asyncio.create_task(reader.read(1))
                                try:
                                    done, _ = await asyncio.wait({work, disconnected}, return_when=asyncio.FIRST_COMPLETED)
                                    if work not in done:
                                        if output.generation == work_generation:
                                            await output.stop(preserve_delivery_for=operation["operation_id"])
                                        await work
                                        raise Diagnostic("unavailable")
                                    response.update(await work)
                                finally:
                                    disconnected.cancel()
                                    await asyncio.gather(disconnected, return_exceptions=True)
                        elif kind == "cancel":
                            # Operations complete synchronously in this mock. No buffered audio.
                            delivered = (last_playback[1] if last_playback and
                                         last_playback[0] == operation["target_operation_id"] else 0)
                            response.update(completed=False, delivered_chars=delivered)
                            last_playback = None
                        elif kind == "recognize":
                            if "text" not in operation:
                                raise Diagnostic("invalid_message")
                            response["text"] = operation["text"]
                        elif kind in {"acknowledge", "play", "close-conversation", "indicate-failure"}:
                            if kind == "play" and "text" not in operation:
                                raise Diagnostic("invalid_message")
                            response.update(completed=True, delivered_chars=len(operation.get("text", "").encode("utf-16-le")) // 2)
                            if kind == "play":
                                last_playback = (operation["operation_id"], response["delivered_chars"])
                            elif kind == "close-conversation":
                                last_playback = None
                        elif kind == "synthesize" and "text" not in operation:
                            raise Diagnostic("invalid_message")
                    else:
                        raise Diagnostic("invalid_message")
                except asyncio.TimeoutError:
                    raise Diagnostic("timeout") from None
                except asyncio.LimitOverrunError:
                    raise Diagnostic("frame_too_large") from None
                except asyncio.IncompleteReadError:
                    raise Diagnostic("invalid_message") from None
                payload = (json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
                if len(payload) > limits["max_frame_bytes"]:
                    raise Diagnostic("frame_too_large")
            except (Diagnostic, OutputError) as error:
                payload = (json.dumps({"version": 1, "type": "error", "code": str(error)}, separators=(",", ":")) + "\n").encode("utf-8")
            try:
                writer.write(payload)
                await asyncio.wait_for(writer.drain(), limits["timeout_ms"] / 1000)
            except (ConnectionError, asyncio.TimeoutError):
                pass
        finally:
            active.discard(writer)
            writer.close()

    # Bind ourselves: asyncio's path API can remove an existing service socket.
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.setblocking(False)
    try:
        listener.bind(str(path))
    except OSError:
        listener.close()
        raise Diagnostic("socket_in_use_or_unavailable") from None
    os.chmod(path, 0o600)
    identity = path.lstat().st_ino
    listener.listen(limits["max_connections"])
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    try:
        server = await asyncio.start_unix_server(handle, sock=listener, limit=limits["max_frame_bytes"])
        async with server:
            print(json.dumps({"event": "service_started", "service": "audio", "mode": config["audio"]["mode"]}), flush=True)
            await stop.wait()
    finally:
        listener.close()
        if output:
            await output.stop()
        for writer in active:
            writer.close()
        if path.exists() and path.lstat().st_ino == identity:
            path.unlink()


if __name__ == "__main__":
    os.umask(0o077)
    try:
        asyncio.run(serve())
    except (Diagnostic, OutputError, OSError) as error:
        code = str(error) if isinstance(error, (Diagnostic, OutputError)) else "startup_failed"
        print(json.dumps({"event": "error", "code": code}), file=__import__("sys").stderr)
        raise SystemExit(1) from None
