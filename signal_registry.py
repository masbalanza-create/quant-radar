"""Capture hourly technical signals for the crypto and FX pairs in Quant Radar."""
import hashlib
import json
import os
import sqlite3
import subprocess
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

import server
from signal_evaluator import POLICY, evaluate_pending, evaluation_window
from signal_report import build_report

ROOT = Path(__file__).resolve().parent
PAIRS = {
    'BTC/USD': ('Crypto', 'public_rest', 'USD'),
    'ETH/USD': ('Crypto', 'public_rest', 'USD'),
    'EUR/USD': ('Forex', 'unverified', 'USD'),
    'USD/JPY': ('Forex', 'unverified', 'JPY'),
}
HOUR = timedelta(hours=1)
PUBLICATION_DELAY = timedelta(minutes=5)


def record_hour(database, now, series_for, *, postgres=False):
    """Record the most recently completed hour after a publication grace period."""
    now = now.astimezone(timezone.utc)
    close = (now - PUBLICATION_DELAY).replace(minute=0, second=0, microsecond=0)
    start = close - HOUR
    session = start.isoformat()

    engine = hashlib.sha256((ROOT / 'market-data.js').read_bytes()).hexdigest()
    summary = {'status': 'completed', 'inserted': 0, 'existing': 0, 'skipped': {}}
    if postgres:
        import psycopg
        connection = psycopg.connect(database, autocommit=True, connect_timeout=15)
    else:
        connection = sqlite3.connect(database)
    mark = '%s' if postgres else '?'
    with closing(connection) as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS hourly_signals (
                symbol TEXT NOT NULL, session TEXT NOT NULL,
                recorded_at TEXT NOT NULL, bar_close TEXT NOT NULL,
                engine_sha256 TEXT NOT NULL, snapshot TEXT NOT NULL,
                PRIMARY KEY (symbol, session)
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS hourly_candles (
                symbol TEXT NOT NULL, provider TEXT NOT NULL,
                bar_start TEXT NOT NULL, candle TEXT NOT NULL,
                PRIMARY KEY (symbol, provider, bar_start)
            )
        """)
        for symbol, (market, quality, currency) in PAIRS.items():
            if db.execute(f'SELECT 1 FROM hourly_signals WHERE symbol = {mark} AND session = {mark}',
                          (symbol, session)).fetchone():
                summary['existing'] += 1
                continue
            try:
                series = series_for(symbol)
                rows = {
                    datetime.fromisoformat(row['datetime'].replace('Z', '+00:00')): row
                    for row in series['values']
                }
                meta = series['meta']
                bar = rows.get(start)
                if (series.get('stale') or meta.get('quality') != quality
                        or meta.get('currency') != currency
                        or series['fetched_at'] < (close + PUBLICATION_DELAY).timestamp()
                        or bar is None):
                    raise ValueError('Vela horaria cerrada no disponible')
                if not (float(bar['close']) > 0):
                    raise ValueError('Cierre inválido')
                series = {**series, 'values': [rows[t] for t in sorted(rows) if t <= start]}
                result = subprocess.run(
                    ['node', str(ROOT / 'scripts/signal_snapshot.cjs')],
                    input=json.dumps({'symbol': symbol, 'market': market, 'series': series}),
                    capture_output=True, text=True, check=True, timeout=10,
                )
                snapshot = {
                    **json.loads(result.stdout),
                    'interval': '1h',
                    'basis': 'technical_baseline',
                    'market_data': meta,
                    'fetched_at': series['fetched_at'],
                    'window_start': series['values'][0]['datetime'],
                    'window_bars': len(series['values']),
                    'recovered': False,
                }
            except (OSError, ValueError, LookupError, TypeError, subprocess.SubprocessError) as exc:
                summary['skipped'][symbol] = str(exc)
                continue

            transaction = db.transaction() if postgres else db
            with transaction:
                inserted = db.execute(f"""
                    INSERT INTO hourly_signals VALUES ({", ".join([mark] * 6)})
                    ON CONFLICT(symbol, session) DO NOTHING
                """, (symbol, session, datetime.now(timezone.utc).isoformat(),
                      close.isoformat(), engine, json.dumps(snapshot, allow_nan=False))).rowcount
                if inserted:
                    provider = meta.get('source') or quality
                    with closing(db.cursor()) as cursor:
                        cursor.executemany(f"""
                            INSERT INTO hourly_candles VALUES ({", ".join([mark] * 4)})
                            ON CONFLICT(symbol, provider, bar_start) DO NOTHING
                        """, [(symbol, provider, datetime.fromisoformat(
                            row['datetime'].replace('Z', '+00:00')).astimezone(timezone.utc).isoformat(),
                            json.dumps(row, allow_nan=False)) for row in series['values']])
            summary['inserted'] += inserted
            summary['existing'] += 1 - inserted
        with db.transaction() if postgres else db:
            summary['outcomes'] = evaluate_pending(db, mark, now, PUBLICATION_DELAY)
            if summary_path := os.getenv('GITHUB_STEP_SUMMARY'):
                report = build_report(db, mark, POLICY, PAIRS, now,
                                      lambda recorded: evaluation_window(recorded)[1] + PUBLICATION_DELAY)
                with Path(summary_path).open('a', encoding='utf-8') as output:
                    output.write(report)
    return summary


def main():
    database = os.getenv('QR_SIGNAL_DATABASE', str(ROOT / 'hourly-signals.sqlite3'))
    database_url = os.getenv('DATABASE_URL')
    if os.getenv('GITHUB_ACTIONS') == 'true' and not database_url:
        raise SystemExit('Falta el secreto DATABASE_URL.')
    try:
        result = record_hour(database_url or database, datetime.now(timezone.utc),
                             lambda symbol: server.fetch(symbol, '1h'),
                             postgres=bool(database_url))
    except Exception as exc:
        if not database_url:
            raise
        raise SystemExit(f'No se pudo guardar el registro en PostgreSQL ({type(exc).__name__}).') from None
    print(json.dumps(result, ensure_ascii=False))
    return int(any(symbol in result['skipped'] for symbol in ('BTC/USD', 'ETH/USD')))


if __name__ == '__main__':
    raise SystemExit(main())
