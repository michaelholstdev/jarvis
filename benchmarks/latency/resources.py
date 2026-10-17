"""Linux process-tree accounting; GPU totals never stand in for speech VRAM."""
from __future__ import annotations

import os
from pathlib import Path
import time
from typing import Any


def process_tree(pid: int) -> list[int]:
    found = [pid]
    for parent in found:
        try:
            for task in Path(f'/proc/{parent}/task').iterdir():
                for child in (task / 'children').read_text().split():
                    if int(child) not in found:
                        found.append(int(child))
        except (FileNotFoundError, ProcessLookupError):
            pass
    return found


def snapshot(pid: int) -> dict[str, Any]:
    ticks = rss = vram = 0
    inspected = 0
    unknown = False
    for child in process_tree(pid):
        root = Path(f'/proc/{child}')
        try:
            fields = (root / 'stat').read_text().rsplit(')', 1)[1].split()
            ticks += int(fields[11]) + int(fields[12])
            rss += int(fields[21]) * os.sysconf('SC_PAGE_SIZE')
            # No DRM fd means no direct GPU allocation by this CPU worker.
            clients = set()
            for fd in (root / 'fd').iterdir():
                try:
                    target = str(fd.readlink())
                except FileNotFoundError:
                    continue  # closed between listing and inspection
                if not target.startswith('/dev/dri/'):
                    continue
                info = (root / 'fdinfo' / fd.name).read_text()
                entries = dict(line.split(':', 1) for line in info.splitlines() if ':' in line)
                client = entries.get('drm-client-id')
                if client is None or 'drm-memory-vram' not in entries:
                    unknown = True
                elif client not in clients:
                    clients.add(client)
                    amount, unit = entries['drm-memory-vram'].split()
                    if unit != 'KiB':
                        unknown = True
                    else:
                        vram += int(amount) * 1024
            inspected += 1
        except (OSError, ValueError):
            unknown = True
    return {'monotonic_ms': time.monotonic_ns() / 1e6,
            'cpu_seconds': ticks / os.sysconf('SC_CLK_TCK'), 'rss_bytes': rss,
            'speech_vram_bytes': None if unknown or not inspected else vram,
            'processes': inspected}


def summarize_resources(rows: list[dict[str, Any]]) -> dict[str, Any]:
    known = [r['speech_vram_bytes'] for r in rows if r['speech_vram_bytes'] is not None]
    elapsed = (rows[-1]['monotonic_ms'] - rows[0]['monotonic_ms']) / 1000 if len(rows) > 1 else 0
    # Worker teardown resets cumulative ticks; exclude those intervals.
    cpu = sum(max(0, b['cpu_seconds'] - a['cpu_seconds']) for a, b in zip(rows, rows[1:]))
    return {'samples': len(rows), 'interval_ms': 100,
            'cpu_percent_one_core': cpu / elapsed * 100 if elapsed else None,
            'rss_peak_bytes': max((r['rss_bytes'] for r in rows), default=None),
            'speech_vram_peak_bytes': max(known, default=None),
            'zero_speech_vram': ('failed' if any(known) else 'passed' if rows and
                                 len(known) == len(rows) else 'unvalidated')}
