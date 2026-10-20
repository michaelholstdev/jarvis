"""Audit connect() attempts in a command and its descendants without saving traces.

Requires strace. This is connection-only coverage: unconnected datagram sends,
already-open descriptors and separately managed services remain unvalidated.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import sys
from typing import Any


async def audit(command: list[str], seconds: float) -> dict[str, Any]:
    # Child output can contain conversation content. Keep it out of the trace pipe.
    launcher = ('import os,sys; fd=os.open(os.devnull,os.O_WRONLY); '
                'os.dup2(fd,2); os.close(fd); os.execvp(sys.argv[1],sys.argv[1:])')
    process = await asyncio.create_subprocess_exec(
        'strace', '-f', '-q', '-e', 'trace=connect', '--', sys.executable,
        '-c', launcher, *command, stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE, start_new_session=True)
    counts = dict(loopback_connections=0, unix_connections=0, external_connections=0,
                  unknown_trace_lines=0)
    exits = 0
    unfinished = 0

    async def consume() -> None:
        nonlocal exits, unfinished
        assert process.stderr
        while raw := await process.stderr.readline():
            line = raw.decode('utf-8', errors='replace').strip()
            line = re.sub(r'^(?:\[pid\s+\d+\]|\d+)\s+', '', line)
            if line.startswith('connect('):
                unfinished += int('<unfinished ...>' in line)
                if 'sa_family=AF_UNIX' in line:
                    counts['unix_connections'] += 1
                else:
                    address = re.search(r'(?:inet_addr\("|inet_pton\(AF_INET6, ")([^"\s]+)', line)
                    try:
                        if address is None:
                            raise ValueError('unknown_address')
                        ip = ipaddress.ip_address(address[1])
                        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
                            ip = ip.ipv4_mapped
                        key = 'loopback_connections' if ip.is_loopback else 'external_connections'
                        counts[key] += 1
                    except ValueError:
                        counts['unknown_trace_lines'] += 1
            elif line.startswith('<... connect resumed>'):
                unfinished -= 1
            elif line == '+++ exited with 0 +++':
                exits += 1
            elif line.startswith('--- '):
                # Signals have no destination or conversation payload.
                continue
            else:
                counts['unknown_trace_lines'] += 1
        await process.wait()

    try:
        await asyncio.wait_for(consume(), seconds)
    finally:
        # Also dispose of descendants after tracer/command exit or timeout.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await process.wait()
    complete = (process.returncode == 0 and exits > 0 and unfinished == 0
                and counts['unknown_trace_lines'] == 0)
    verdict = ('failed' if counts['external_connections'] else
               'passed' if complete else 'unvalidated')
    return {**counts, 'command_exit_code': process.returncode,
            'checks': {'external_connection_attempts': verdict,
                       'all_external_request_attempts': 'unvalidated'},
            'coverage': 'connect() in launched command and descendants, including failed calls',
            'unvalidated': ['unconnected datagram sends', 'inherited network descriptors',
                            'services outside the traced process tree',
                            'scenarios not exercised by the command']}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--seconds', type=float, default=900)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {
        'run_completed': False, 'timestamp_utc': datetime.now(timezone.utc).isoformat(),
        'checks': {'execution': 'failed', 'all_external_request_attempts': 'unvalidated'}}
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    try:
        import math
        if not command or not math.isfinite(args.seconds) or args.seconds <= 0:
            raise ValueError('invalid_arguments')
        result = asyncio.run(audit(command, args.seconds))
        report.update(result, run_completed=True)
    except Exception as error:
        # Exception messages and command arguments can contain private content.
        report['error_type'] = type(error).__name__
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)
    if not report['run_completed'] or report['checks'].get('external_connection_attempts') != 'passed':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
