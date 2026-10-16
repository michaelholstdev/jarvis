import { chmodSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  type Diagnostic,
  encodeMessage,
  type Message,
  ProtocolError,
} from '../../packages/protocol/index.js';
import { configPath, loadConfig } from './config.js';
import { createCore } from './core.js';
import { diagnostic as logDiagnostic } from './diagnostics.js';
import { probeInference } from './ollama.js';
import { runtimeDirectory } from './runtime.js';
import { receive, request } from './transport.js';
import { runTurn } from './turn-driver.js';

async function main() {
  const path = configPath();
  const config = loadConfig(
    existsSync(path) || process.env.JARVIS_CONFIG ? path : undefined,
  );
  const command = process.argv[2];
  if (command === 'config') {
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  const privacyControls = {
    lock: ['locked', true],
    unlock: ['locked', false],
    mute: ['muted', true],
    unmute: ['muted', false],
    'hardware-mute': ['hardware_muted', true],
    'hardware-unmute': ['hardware_muted', false],
  } as const;
  const privacyControl =
    privacyControls[command as keyof typeof privacyControls];
  if (
    !privacyControl &&
    !['start', 'health', 'activate', 'stop', 'demo'].includes(command ?? '')
  )
    throw new Error(
      'usage: start | health | config | activate | stop | demo [utterance] | lock | unlock | mute | unmute | hardware-mute | hardware-unmute',
    );
  const directory = runtimeDirectory();
  const corePath = join(directory, 'core.sock');
  if (command !== 'start') {
    const response = await request(
      corePath,
      'cli',
      {
        ...config.transport,
        timeout_ms:
          command === 'demo' &&
          (config.audio.mode === 'piper' || config.llm.mode === 'ollama')
            ? config.recovery.playback_timeout_ms * 3
            : config.transport.timeout_ms * (command === 'health' ? 2 : 6),
      },
      privacyControl
        ? {
            version: 1,
            type: 'inhibition-changed',
            source: privacyControl[0],
            active: privacyControl[1],
          }
        : command === 'activate' || command === 'stop'
          ? { version: 1, type: command }
          : command === 'demo'
            ? {
                version: 1,
                type: 'demo',
                text: process.argv[3] ?? 'Wie geht es dir?',
              }
            : undefined,
    );
    if (response.type !== 'ready' || response.service !== 'core')
      throw new Error(
        response.type === 'error' ? response.code : 'invalid_message',
      );
    console.log(JSON.stringify(response.status));
    process.exitCode = response.status.ready ? 0 : 1;
    return;
  }
  const core = createCore({ now: () => performance.now() }, config);
  let privacyGeneration = 0;
  let audioGeneration = 0;
  const loseAudio = (diagnostic: Diagnostic = 'unavailable') => {
    audioGeneration++;
    core.dispatch({ type: 'audio-lost', diagnostic });
  };
  let refreshPending:
    | { generation: string; promise: Promise<Diagnostic | undefined> }
    | undefined;
  let inferenceProbe: Promise<void> | undefined;
  const refreshInference = () => {
    if (config.llm.mode !== 'ollama') return Promise.resolve();
    inferenceProbe ??= probeInference(config)
      .then((ready) => {
        core.dispatch({
          type: 'capabilities-changed',
          capabilities: { inference: ready ? 'ready' : 'unavailable' },
        });
      })
      .finally(() => {
        inferenceProbe = undefined;
      });
    return inferenceProbe;
  };
  const probe = async (): Promise<Diagnostic | undefined> => {
    const wasReady = core.status().ready;
    const audioEpoch = audioGeneration;
    const generation = privacyGeneration;
    try {
      const response = await request(
        join(directory, 'audio.sock'),
        'core',
        config.transport,
      );
      if (response.type !== 'ready' || response.service !== 'audio')
        throw new ProtocolError(
          response.type === 'error' ? response.code : 'invalid_message',
        );
      if (generation !== privacyGeneration || audioEpoch !== audioGeneration)
        return 'unavailable';
      core.dispatch({
        type: 'audio-ready',
        ...(response.capabilities
          ? { capabilities: response.capabilities }
          : {}),
      });
      if (!wasReady) logDiagnostic({ event: 'audio_recovered' });
      return undefined;
    } catch (error) {
      const diagnostic =
        error instanceof ProtocolError ? error.code : 'unavailable';
      if (generation === privacyGeneration && audioEpoch === audioGeneration) {
        loseAudio(diagnostic);
        if (wasReady)
          logDiagnostic({ event: 'audio_unavailable', code: diagnostic });
      }
      return diagnostic;
    }
  };
  const refresh = () => {
    const generation = `${privacyGeneration}:${audioGeneration}`;
    if (!refreshPending || refreshPending.generation !== generation) {
      const pending = {
        generation,
        promise: probe().finally(() => {
          if (refreshPending === pending) refreshPending = undefined;
        }),
      };
      refreshPending = pending;
    }
    return refreshPending.promise;
  };
  await Promise.all([refresh(), refreshInference()]);
  let runningTurn: symbol | undefined;
  const drive = async (utterance?: string) => {
    const run = Symbol();
    runningTurn = run;
    try {
      await runTurn(core, join(directory, 'audio.sock'), config, utterance);
    } finally {
      if (runningTurn === run) runningTurn = undefined;
    }
  };
  let privacyDrive: Promise<void> | undefined;
  const synchronizePrivacy = () => {
    privacyDrive ??= (async () => {
      // Coalesce updates into the latest privacy barrier; never queue promises.
      while (core.operations()[0]?.type === 'privacy') {
        await runTurn(core, join(directory, 'audio.sock'), config);
      }
    })().finally(() => {
      privacyDrive = undefined;
    });
    return privacyDrive;
  };
  const recovery = setInterval(() => {
    void Promise.all([refresh(), refreshInference()])
      .then(async () => {
        if (core.operations()[0]?.type === 'privacy')
          await synchronizePrivacy();
      })
      .catch(() => loseAudio());
  }, config.recovery.probe_interval_ms);
  const ticker = setInterval(() => {
    const before = core.status();
    core.dispatch({ type: 'tick' });
    if (before.ready && !core.status().ready) audioGeneration++;
    const operation = core.operations()[0];
    if (
      !runningTurn &&
      ((config.audio.mode === 'voice' &&
        config.llm.mode === 'ollama' &&
        operation?.type === 'recognize') ||
        operation?.type === 'cancel' ||
        operation?.type === 'indicate-failure' ||
        operation?.type === 'close-conversation' ||
        (core.status().state === 'awaiting-extension' &&
          (operation?.type === 'synthesize' || operation?.type === 'play')))
    ) {
      void drive().catch(() => loseAudio());
    }
    if (before.state !== core.status().state)
      logDiagnostic({
        event:
          core.status().state === 'awaiting-extension'
            ? 'conversation_expired'
            : 'turn_expired',
        ...(core.status().state === 'awaiting-extension'
          ? {}
          : { code: 'timeout' }),
        state: core.status().state,
        elapsed_ms: before.state_since_ms,
      });
  }, 100);
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    void (async () => {
      let response: Message;
      try {
        const message = await receive(socket, config.transport);
        if (
          !(
            (message.type === 'hello' && message.role === 'cli') ||
            message.type === 'inhibition-changed' ||
            message.type === 'activate' ||
            message.type === 'stop' ||
            message.type === 'demo'
          )
        )
          throw new ProtocolError('invalid_message');
        if (message.type === 'inhibition-changed') {
          // Apply privacy before any asynchronous readiness/cleanup request.
          if (core.status().inhibitions[message.source] !== message.active)
            privacyGeneration++;
          core.dispatch(message);
          if (core.status().privacy_pending) runningTurn = undefined;
          try {
            await synchronizePrivacy();
          } catch (error) {
            loseAudio();
            throw error;
          }
        }
        if (
          message.type === 'activate' ||
          message.type === 'stop' ||
          message.type === 'demo'
        ) {
          const generation = privacyGeneration;
          const [diagnostic] = await Promise.all([
            refresh(),
            refreshInference(),
          ]);
          if (core.operations()[0]?.type === 'privacy')
            await synchronizePrivacy();
          if (
            generation !== privacyGeneration ||
            core.status().privacy_pending ||
            Object.values(core.status().inhibitions).some(Boolean)
          )
            throw new ProtocolError('unavailable');
          if (runningTurn && message.type === 'demo')
            throw new ProtocolError('busy');
          if (diagnostic) throw new ProtocolError(diagnostic);
          const shouldRun =
            message.type !== 'stop' || core.status().state === 'speaking';
          if (message.type === 'stop') core.stop();
          else if (
            message.type === 'activate' ||
            core.status().state === 'idle'
          )
            core.activate();
          if (
            message.type === 'demo' &&
            ![
              'listening',
              'acknowledging',
              'follow-up',
              'awaiting-extension',
            ].includes(core.status().state)
          )
            throw new ProtocolError('busy');
          try {
            if (shouldRun) {
              if (config.audio.mode === 'voice' && message.type === 'activate')
                void drive().catch(() => loseAudio());
              else
                await drive(message.type === 'demo' ? message.text : undefined);
            }
          } catch (error) {
            loseAudio(
              error instanceof ProtocolError ? error.code : 'unavailable',
            );
            throw error;
          }
          if (
            message.type === 'demo' &&
            !core.reply() &&
            !['idle', 'follow-up', 'awaiting-extension'].includes(
              core.status().state,
            )
          )
            throw new ProtocolError('invalid_message');
        }
        if (message.type === 'hello')
          await Promise.all([refresh(), refreshInference()]);
        if (core.operations()[0]?.type === 'privacy')
          await synchronizePrivacy();
        response = {
          version: 1,
          type: 'ready',
          service: 'core',
          status: core.status(),
        };
      } catch (error) {
        response = {
          version: 1,
          type: 'error',
          code: error instanceof ProtocolError ? error.code : 'unavailable',
        };
      }
      socket.end(encodeMessage(response), () => socket.destroy());
    })();
  });
  server.maxConnections = config.transport.max_connections;
  server.on('error', () => {
    clearInterval(ticker);
    clearInterval(recovery);
    logDiagnostic({ event: 'error', code: 'socket_in_use_or_unavailable' });
    process.exitCode = 1;
  });
  server.listen(corePath, () => {
    chmodSync(corePath, 0o600);
    console.log(
      JSON.stringify({
        event: 'service_started',
        service: 'core',
        mode: 'mock',
      }),
    );
  });
  const stop = () => {
    core.dispatch({ type: 'audio-lost' });
    clearInterval(ticker);
    clearInterval(recovery);
    for (const socket of sockets) socket.destroy();
    server.close();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

main().catch((error: unknown) => {
  const known: Diagnostic[] = [
    'invalid_message',
    'incompatible_version',
    'frame_too_large',
    'timeout',
    'unavailable',
    'busy',
  ];
  const message = error instanceof Error ? error.message : '';
  const code =
    message.startsWith('invalid_config:') ||
    message.startsWith('usage:') ||
    known.includes(message as Diagnostic) ||
    [
      'unsafe_runtime_directory',
      'missing_runtime_directory',
      'runtime_path_too_long',
    ].includes(message)
      ? message
      : 'startup_failed';
  logDiagnostic({ event: 'error', code });
  process.exitCode = 1;
});
