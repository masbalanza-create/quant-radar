from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from unittest import TestCase, main
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from valuation import calculate, cost_of_capital
from valuation_data import facts_at, valuation_response


class ValuationChecks(TestCase):
    def test_manual(self):
        _, wacc = cost_of_capital(.04, 1.2, .05, .06, .25, 1500, 200)
        inputs = dict(sales=1000, working_capital=100, growth=.08, margin=.18,
                      da_ratio=.03, capex_ratio=.05, wc_ratio=.1, tax=.25,
                      shares=100, price=15, wacc=wacc,
                      bridge=dict(cash=70, investments=0, debt=200, preferred=0,
                                  minorities=0, other_claims=0))
        result = calculate(inputs)
        values = [round(s['value_per_share'], 2) for s in result['scenarios'].values()]
        self.assertEqual(values, [11.13, 16.45, 24.84])
        self.assertEqual(result['classification'], 'within_range')
        self.assertEqual(result['sensitivity']['values'][2][2], result['scenarios']['base']['value_per_share'])
        self.assertLess(result['sensitivity']['values'][3][2], result['sensitivity']['values'][2][2])
        self.assertIsNotNone(result['reverse_dcf']['growth'])
        self.assertIsNone(calculate({**inputs, 'wacc': .02})['classification'])

    def test_edgar_revision_after_cutoff(self):
        cutoff = datetime(2025, 2, 1, tzinfo=timezone.utc)
        rows = [dict(val=10, start='2023-10-01', end='2024-09-30',
                     filed='2024-11-01', accn='first', form='10-K'),
                dict(val=12, start='2023-10-01', end='2024-09-30',
                     filed='2025-02-01', accn='later', form='10-K/A')]
        payload = {'facts': {'us-gaap': {'Revenues': {'units': {'USD': rows}}}}}
        self.assertEqual(facts_at(payload, {}, cutoff, 1)['Revenues']['2023-10-01','2024-09-30']['value'], 10)

    def test_route_contract_and_full_provider_pipeline(self):
        cutoff = datetime(2025, 1, 20, 22, tzinfo=timezone.utc)
        published = '2025-01-15T16:00:00+00:00'
        payload = {'facts': {'us-gaap': {}, 'dei': {}}}
        reviews = []
        def add(tag, value, year, start=True, namespace='us-gaap', unit='USD'):
            concept = payload['facts'][namespace].setdefault(tag, {'units': {unit: []}})
            row = dict(val=value, end=f'{year}-12-31', filed=f'{year+1}-01-15',
                       accn=f'abc-{year}', form='10-K')
            if start:
                row['start'] = f'{year}-01-01'
            concept['units'][unit].append(row)
        for year in range(2021, 2025):
            sales = 1e9*1.08**(year-2024)
            for tag, value in [('Revenues', sales), ('OperatingIncomeLoss',sales*.18),
                               ('DepreciationDepletionAndAmortization',sales*.03),
                               ('PaymentsToAcquirePropertyPlantAndEquipment',sales*.05)]:
                add(tag, value, year)
            add('Assets', 2e9, year, False)
            reviews.append(dict(period_end=f'{year}-12-31', onwc=sales*.1,
                                published_at=f'{year+1}-01-15T16:00:00+00:00', source='Test'))
        add('CashAndCashEquivalentsAtCarryingValue', 70e6, 2024, False)
        add('EntityCommonStockSharesOutstanding',100e6,2024,False,'dei','shares')
        days = [date(2025,1,17)-timedelta(weeks=i) for i in range(110)]
        index = {day:100 + i + (i%3) for i,day in enumerate(days)}
        profile = dict(erp=[dict(value=.05,source='Test',published_at=published)],
                       companies={'AAPL':dict(annual=reviews, balance=[
                           dict(period_end='2024-12-31',published_at=published,source='Test',
                                cash_reserve=0,investments=0,debt=200e6,preferred=0,
                                minorities=0,other_claims=0,incremental_shares=0)],
                           capital=[dict(marginal_tax=.25,debt_yield=.06,tax_shield=True,
                                         source='Test',published_at=published)])})
        def get_json(url, headers):
            return {'filings':{'recent':{}}} if '/submissions/' in url else payload
        def market_history(get, symbol, at):
            prices = {days[0]:15} if symbol == 'AAPL' else index
            return prices, index, {}, 'https://market.example'
        with TemporaryDirectory() as tmp:
            path = Path(tmp)/'inputs.json'
            path.write_text(json.dumps(profile))
            with patch.dict('os.environ', {'QR_VALUATION_INPUTS':str(path)}), \
                 patch('valuation_data.market_history', market_history), \
                 patch('valuation_data.risk_free', return_value=dict(value=.04,observation='2025-01-17',
                                                                    published_at=published,source='Test')):
                args = (get_json, 'AAPL',cutoff.isoformat(), {'AAPL','SPY'}, {'AAPL':1}, 'Test')
                result, http = valuation_response(*args)
                self.assertEqual((http,result['status']), (200,'ok'),result['reasons'])
                self.assertEqual(result['run_id'], valuation_response(*args)[0]['run_id'])
                path.unlink()
                missing, http = valuation_response(*args)
                self.assertEqual((http,missing['missing_fields']), (200,['onwc']))
        self.assertEqual(valuation_response(get_json,'SPY',cutoff.isoformat(),{'SPY'}, {}, 'Test')[0]['status'],'unsupported')
        self.assertEqual(valuation_response(get_json,'BAD',cutoff.isoformat(),{'SPY'}, {}, 'Test')[1],404)
        self.assertEqual(valuation_response(get_json,'SPY','invalid',{'SPY'}, {}, 'Test')[1],400)


if __name__ == '__main__':
    main()
