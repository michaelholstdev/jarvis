"""Allowlist diagnostics at both sides of the audio worker boundary."""


def safe_diagnostic(value: object) -> str:
    known = {
        'missing_input_model', 'input_checksum_mismatch', 'unsupported_input_runtime',
        'unsupported_input_model', 'input_device_missing', 'input_device_muted',
        'input_format_unsupported', 'input_disconnected',
        'output_device_missing', 'output_device_muted',
    }
    return value if isinstance(value, str) and value in known else 'audio_runtime_failed'
