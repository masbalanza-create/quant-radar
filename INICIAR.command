#!/bin/bash
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env
(sleep 2; open http://127.0.0.1:8767) &
python3 server.py
