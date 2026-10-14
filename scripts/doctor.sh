#!/bin/sh
set -eu
failed=0
for command in node npm python3 uv; do
  if command -v "$command" >/dev/null 2>&1; then
    "$command" --version
  else
    echo "missing_runtime: $command; see README.md prerequisites" >&2
    failed=1
  fi
done
if command -v node >/dev/null 2>&1; then
  node -e 'if (+process.versions.node.split(".")[0] < 22) { console.error("unsupported_runtime: Node.js >=22 required"); process.exit(1); }' || failed=1
fi
if command -v python3 >/dev/null 2>&1; then
  python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else "unsupported_runtime: Python >=3.10 required")' || failed=1
fi
[ -d node_modules ] || { echo 'missing_environment: run npm ci' >&2; failed=1; }
[ -x .venv/bin/python ] || { echo 'missing_environment: run uv sync --frozen' >&2; failed=1; }
[ -d dist ] || { echo 'missing_build: run npm run build' >&2; failed=1; }
[ -n "${XDG_RUNTIME_DIR:-}" ] || { echo 'missing_runtime_directory: set XDG_RUNTIME_DIR to your private user runtime directory' >&2; failed=1; }
exit "$failed"
