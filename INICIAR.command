#!/bin/bash
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env
(sleep 2; open http://127.0.0.1:8767) &
if [ -x .venv/bin/python ]; then
  exec .venv/bin/python server.py
fi
exec python3 server.py
