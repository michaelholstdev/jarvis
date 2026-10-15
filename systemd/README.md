# User-session services

M0 runs both mock processes in foreground terminals, as described in the root
README. systemd user units, login startup, desktop lock/mute and device recovery
are ticket #12 / M3 work. Do not install a root service or enable linger for these
mocks. They open no microphone and provide no desktop activation.

For current foreground recovery, bounded diagnostics, watchdog configuration,
and proposed restart settings for the future user units, see
[the recovery guide](../docs/recovery.md). No user units are installed yet.
