"""Hardware-free audio handshake service. No speech libraries or network listeners."""

from __future__ import annotations

import asyncio
from collections.abc import Hashable
import copy
import json
import os
from pathlib import Path
import signal
import socket
import stat
from typing import Any

import jsonschema
import yaml

ROOT = Path(__file__).resolve().parents[2]
CONFIG_SCHEMA = json.loads((ROOT / "packages/protocol/schemas/config.schema.json").read_text())
MESSAGE_SCHEMA = json.loads((ROOT / "packages/protocol/schemas/message.schema.json").read_text())
MESSAGE_VALIDATOR = jsonschema.Draft7Validator(MESSAGE_SCHEMA)


class Diagnostic(Exception):
    """An allowlisted content-free diagnostic."""


class ConfigLoader(yaml.SafeLoader):
    """Match the core's rejection of ambiguous duplicate configuration keys."""

    def construct_mapping(self, node: yaml.Node, deep: bool = False) -> dict[Hashable, Any]:
        if not isinstance(node, yaml.MappingNode):
            raise Diagnostic("invalid_config: expected_mapping")
        seen: set[str] = set()
        for key_node, _ in node.value:
            if not isinstance(key_node, yaml.ScalarNode) or key_node.tag != "tag:yaml.org,2002:str":
                raise Diagnostic("invalid_config: expected_string_key")
            if key_node.value in seen:
                raise Diagnostic("invalid_config: duplicate_key")
            seen.add(key_node.value)
        return super().construct_mapping(node, deep=deep)


def defaults(value: Any, schema: dict[str, Any]) -> Any:
    if isinstance(value, dict):
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
            if any(isinstance(token, (yaml.tokens.AliasToken, yaml.tokens.AnchorToken))
                   for token in yaml.scan(content)):
                raise Diagnostic("invalid_config: aliases_disabled")
            value = yaml.load(content, Loader=ConfigLoader)
        except (OSError, yaml.YAMLError, RecursionError):
            raise Diagnostic("invalid_config: unreadable_or_malformed_yaml") from None
    value = defaults(value, CONFIG_SCHEMA)
    error = next(jsonschema.Draft7Validator(CONFIG_SCHEMA).iter_errors(value), None)
    if error:
        location = "/" + "/".join(str(item) for item in error.absolute_path)
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
        value = json.loads(frame)
    except (ValueError, UnicodeError, RecursionError):
        raise Diagnostic("invalid_message") from None
    if isinstance(value, dict) and "version" in value and value["version"] != 1:
        raise Diagnostic("incompatible_version")
    if not MESSAGE_VALIDATOR.is_valid(value):
        raise Diagnostic("invalid_message")
    return dict(value)


async def serve() -> None:
    config = load_config()
    limits = config["transport"]
    path = runtime_directory() / "audio.sock"
    active: set[asyncio.StreamWriter] = set()

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        if len(active) >= limits["max_connections"]:
            writer.close()
            return
        active.add(writer)
        try:
            try:
                frame = await asyncio.wait_for(reader.readuntil(b"\n"), limits["timeout_ms"] / 1000)
                if len(frame) > limits["max_frame_bytes"]:
                    raise Diagnostic("frame_too_large")
                message = parse_message(frame)
                if message["type"] != "hello" or message["role"] != "core":
                    raise Diagnostic("invalid_message")
                response: dict[str, Any] = {"version": 1, "type": "ready", "service": "audio", "mode": "mock"}
            except asyncio.TimeoutError:
                raise Diagnostic("timeout") from None
            except asyncio.LimitOverrunError:
                raise Diagnostic("frame_too_large") from None
            except asyncio.IncompleteReadError:
                raise Diagnostic("invalid_message") from None
        except Diagnostic as error:
            response = {"version": 1, "type": "error", "code": str(error)}
        try:
            writer.write((json.dumps(response) + "\n").encode())
            await asyncio.wait_for(writer.drain(), limits["timeout_ms"] / 1000)
        except (ConnectionError, asyncio.TimeoutError):
            pass
        finally:
            writer.close()
            active.discard(writer)

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
            print(json.dumps({"event": "service_started", "service": "audio", "mode": "mock"}), flush=True)
            await stop.wait()
    finally:
        listener.close()
        for writer in active:
            writer.close()
        if path.exists() and path.lstat().st_ino == identity:
            path.unlink()


if __name__ == "__main__":
    os.umask(0o077)
    try:
        asyncio.run(serve())
    except (Diagnostic, OSError) as error:
        code = str(error) if isinstance(error, Diagnostic) else "startup_failed"
        print(json.dumps({"event": "error", "code": code}), file=__import__("sys").stderr)
        raise SystemExit(1) from None
