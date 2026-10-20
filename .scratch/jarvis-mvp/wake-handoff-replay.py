"""Local, content-free #26 replay; never opens a microphone or invokes an LLM.

Uses existing calibration development clips, not held-out acceptance data.
Example: .venv/bin/python .scratch/jarvis-mvp/wake-handoff-replay.py --pre-roll-ms 750 0
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import threading
from unittest.mock import patch
import wave

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import numpy as np
from apps.audio.input import Input
from apps.audio.main import load_config

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--pre-roll-ms', required=True, type=int, choices=(750, 1000))
parser.add_argument('cases', type=int, nargs='+')
args = parser.parse_args()
config = load_config()
config['audio']['pre_roll_ms'] = args.pre_roll_ms
engine = Input(config)
real_popen = subprocess.Popen
source = {'name': 'fixture', 'mute': False,
          'sample_specification': 's16le 1ch 16000Hz',
          'properties': {'node.name': 'fixture'}}
failed = False
for case in args.cases:
    path = ROOT / f'models/wake/headset-calibration-01/positive-{case:02}.wav'
    with wave.open(str(path)) as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 16000)
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').astype('float32') / 32768
    tokens = lambda text: re.findall(r'\w+', text.lower())
    full_words = tokens(engine.recognizer.recognize(samples))
    cancelled = threading.Event()
    timer = threading.Timer(12, cancelled.set)
    events = []

    def capture(*unused, **kwargs):
        return real_popen([
            sys.executable, '-c',
            'import sys,time,wave; '
            'w=wave.open(sys.argv[1]); '
            'sys.stdout.buffer.write(w.readframes(w.getnframes())); '
            'sys.stdout.buffer.flush(); time.sleep(20)', str(path),
        ], **kwargs)

    timer.start()
    try:
        with patch('apps.audio.input.selected_source', return_value=source), \
             patch('apps.audio.input.subprocess.Popen', side_effect=capture):
            result = engine.recognize(lambda event, **kw: events.append(event), cancelled, wake=True)
        words = tokens(result['text'])
        retained = len(full_words) > 3 and words[-3:] == full_words[-3:]
        failed |= not retained
        print(json.dumps({'case': case, 'pre_roll_ms': args.pre_roll_ms,
                          'wake_detected': 'wake_detected' in events,
                          'full_words': len(full_words), 'wake_words': len(words),
                          'question_tail_retained': retained}), flush=True)
    except RuntimeError:
        failed = True
        print(json.dumps({'case': case, 'completed': False}), flush=True)
    finally:
        timer.cancel()
        timer.join()
sys.exit(1 if failed else 0)
