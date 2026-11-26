import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

from signal_registry import PAIRS, record_hour


class SignalRegistryChecks(unittest.TestCase):
    def test_closed_candle_and_retry(self):
        now = datetime(2026, 11, 28, 12, 10, tzinfo=timezone.utc)
        start = now.replace(minute=0) - timedelta(hours=1)

        def get_series(symbol):
            _, quality, currency = PAIRS[symbol]
            last = 0 if quality == 'public_rest' else 2
            values = [
                {'datetime': (start - timedelta(hours=i)).isoformat(),
                 'close': 150 - i, 'high': 151 - i, 'low': 149 - i, 'volume': 100}
                for i in range(29, last - 1, -1)
            ]
            if quality == 'public_rest':
                values.append({'datetime': (start + timedelta(hours=1)).isoformat(),
                               'close': 999})
            return {'values': values, 'meta': {'quality': quality, 'currency': currency},
                    'fetched_at': now.timestamp()}

        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'signals.sqlite3'
            first = record_hour(path, now, get_series)
            retry = record_hour(path, now, get_series)
            self.assertEqual(first['inserted'], 2)
            self.assertEqual(set(first['skipped']), {'EUR/USD', 'USD/JPY'})
            self.assertEqual((retry['inserted'], retry['existing']), (0, 2))
            with closing(sqlite3.connect(path)) as db:
                session, raw = db.execute(
                    "SELECT session, snapshot FROM hourly_signals WHERE symbol = 'BTC/USD'"
                ).fetchone()
                count = db.execute('SELECT COUNT(*) FROM hourly_candles').fetchone()[0]
                latest = db.execute('SELECT MAX(bar_start) FROM hourly_candles').fetchone()[0]
            self.assertEqual((count, latest), (60, start.isoformat()))
            snapshot = json.loads(raw)
            self.assertEqual(session, start.isoformat())
            self.assertEqual(snapshot['features']['close'], 150)
            self.assertEqual(snapshot['decision']['state'], 'buy')
            self.assertEqual(snapshot['window_bars'], 30)
