import unittest
from datetime import datetime, timedelta, timezone

from portfolio_simulator import simulate


class PortfolioSimulationChecks(unittest.TestCase):
    def test_overlap_same_hour_reentry_and_closed_drawdown(self):
        start = datetime(2026, 11, 27, tzinfo=timezone.utc)

        def entry(pair, hour, net, motor=True):
            return {
                'pair': pair, 'entry': start + timedelta(hours=hour),
                'exit': start + timedelta(hours=hour + 4), 'net': net,
                'motor': motor, 'baseline': True,
            }

        entries = [
            entry('BTC/USD', 0, -0.10),
            entry('BTC/USD', 1, 0.80),
            entry('ETH/USD', 2, 0.20, motor=False),
            entry('BTC/USD', 4, 0.20),
        ]
        motor = simulate(entries, 'motor')
        baseline = simulate(entries, 'baseline')
        self.assertEqual((motor['trades'], baseline['trades']), (2, 3))
        self.assertAlmostEqual(motor['net_return'], 0.025)
        self.assertAlmostEqual(baseline['net_return'], 0.075)
        self.assertAlmostEqual(motor['closed_drawdown'], 0.025)
