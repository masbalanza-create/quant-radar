"""Public sovereign yields for the macro context panel."""
import csv
import io
import math
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError, URLError
from datetime import date, datetime, timedelta, timezone
from urllib.request import Request, urlopen

FRED = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id='
TREASURY_PAGE = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/'
TREASURY_CSV = TREASURY_PAGE + 'daily-treasury-rates.csv/all/'
ECB = 'https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_'
JAPAN = 'https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv'
SOURCES = {
    'US': ('EE. UU.', 'Reserva Federal · FRED', 'https://fred.stlouisfed.org/series/DGS10'),
    'EU': ('Zona euro', 'Banco Central Europeo', 'https://data.ecb.europa.eu/data/datasets/YC'),
    'JP': ('Japón', 'Ministerio de Finanzas de Japón', 'https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/index.htm'),
}
MARKETS = {
    **dict.fromkeys(('AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'SPY', 'QQQ'), ('US',)),
    **dict.fromkeys(('ASML:Euronext Amsterdam', 'SAP:XETR', 'SAN:BME'), ('EU',)),
    **dict.fromkeys(('7203:JPX', '9984:JPX'), ('JP',)),
    'EUR/USD': ('EU', 'US'),
    'USD/JPY': ('US', 'JP'),
    **dict.fromkeys(('BTC/USD', 'ETH/USD', 'XAU/USD', 'XAG/USD'), ('US',)),
}
_cached = {}


def download(url):
    request = Request(url, headers={'Accept': 'text/csv', 'User-Agent': 'QuantRadar'})
    with urlopen(request, timeout=8) as response:
        return response.read(2_000_000).decode('utf-8-sig', errors='replace')


def observation(day, value):
    try:
        day = datetime.strptime(day.strip().replace('/', '-'), '%Y-%m-%d').date()
        rate = float(value)
        if math.isfinite(rate):
            return day.isoformat(), rate
    except (AttributeError, TypeError, ValueError):
        pass
    return None


def read_series(document, date_column, value_column):
    result = {}
    for row in csv.DictReader(io.StringIO(document)):
        item = observation(row.get(date_column), row.get(value_column))
        if item:
            result[item[0]] = item[1]
    return result


def japan_series(document):
    rows = csv.reader(io.StringIO(document))
    for row in rows:
        names = [value.strip().lower() for value in row]
        if names and names[0] in ('date', 'date of record') and '2y' in names and '10y' in names:
            positions = [names.index(key) for key in ('2y', '10y')]
            break
    else:
        raise ValueError('Cabecera de rendimientos de Japón no reconocida')
    result = ({}, {})
    for row in rows:
        for series, position in zip(result, positions):
            if len(row) > position:
                item = observation(row[0], row[position])
                if item:
                    series[item[0]] = item[1]
    return result


def treasury_curves(today):
    months = (today.strftime('%Y%m'), (today.replace(day=1)-timedelta(days=1)).strftime('%Y%m'))

    def read_month(month):
        url = TREASURY_CSV + month + '?_format=csv&field_tdr_date_value_month=' + month + '&page=&type=daily_treasury_yield_curve'
        result = {}
        for row in csv.DictReader(io.StringIO(download(url))):
            try:
                day = datetime.strptime(row['Date'], '%m/%d/%Y').date()
                pair = float(row['2 Yr']), float(row['10 Yr'])
                if all(math.isfinite(rate) for rate in pair):
                    result[day.isoformat()] = pair
            except (KeyError, TypeError, ValueError):
                continue
        return result

    data = {}
    with ThreadPoolExecutor(max_workers=2) as executor:
        requests = [executor.submit(read_month, month) for month in months]
        for request in requests:
            try:
                data.update(request.result())
            except (OSError, csv.Error):
                if not data and request is requests[-1]:
                    raise
    data = {day: pair for day, pair in data.items() if day < today.isoformat()}
    if not data or max(data) < (today-timedelta(days=7)).isoformat():
        raise ValueError('El Tesoro no entregó rendimientos recientes')
    return data


def curves(region, today):
    cached = _cached.get(region)
    if cached and time.monotonic() - cached[0] < 900:
        return cached[1], cached[2]
    since = (today - timedelta(days=45)).isoformat()
    if region == 'US':
        try:
            data = treasury_curves(today)
            _cached[region] = time.monotonic(), data, True
            return data, True
        except (OSError, ValueError, csv.Error):
            # Try the FRED series when the direct Treasury export fails.
            pass

    if region == 'JP':
        short, long = japan_series(download(JAPAN))
    else:
        def read_maturity(term):
            if region == 'US':
                key = 'DGS' + term
                document = download(FRED + key + '&cosd=' + since)
                date_column = 'observation_date' if document.startswith('observation_date,') else 'DATE'
                return read_series(document, date_column, key)
            return read_series(download(ECB + term + 'Y?format=csvdata&startPeriod=' + since),
                               'TIME_PERIOD', 'OBS_VALUE')

        with ThreadPoolExecutor(max_workers=2) as executor:
            short, long = executor.map(read_maturity, ('2', '10'))
    # Use at most yesterday's dated observations. This panel displays context from a
    # live query; daily source labels alone do not establish historical publication time.
    before = today.isoformat()
    data = {day: (short[day], long[day]) for day in short.keys() & long.keys()
            if since <= day < before}
    if not data:
        raise ValueError('No hay fechas con ambos vencimientos')
    _cached[region] = time.monotonic(), data, False
    return data, False


def macro_report(symbol):
    today = datetime.now(timezone.utc).date()
    regions = MARKETS.get(symbol, ())
    if not regions:
        return {'economies': [], 'difference': None}

    def fetch_region(region):
        name, source, url = SOURCES[region]
        info = {'name': name, 'source': source, 'url': url}
        try:
            data, from_treasury = curves(region, today)
            if from_treasury:
                info.update(source='Tesoro de EE. UU.', url=TREASURY_PAGE + 'TextView?type=daily_treasury_yield_curve')
            dates = sorted(data)
            latest = dates[-1]
            short, long = data[latest]
            slope = long - short
            previous = dates[-2] if len(dates) > 1 else None
            change = slope - (data[previous][1] - data[previous][0]) if previous else None
            age = (today - date.fromisoformat(latest)).days
            info.update(date=latest, short=short, long=long, slope=slope, change=change,
                        previous=previous, age=age)
            return info, data
        except HTTPError as error:
            info['error'] = 'La fuente devolvió un error HTTP ' + str(error.code) + '.'
        except TimeoutError:
            info['error'] = 'La fuente agotó el tiempo de espera.'
        except URLError as error:
            info['error'] = ('La fuente agotó el tiempo de espera.' if isinstance(error.reason, TimeoutError)
                             else 'No se pudo establecer conexión con la fuente.')
        except (ValueError, csv.Error):
            info['error'] = 'La fuente no entregó fechas comparables a 2 y 10 años.'
        except OSError:
            info['error'] = 'La conexión con la fuente se interrumpió.'
        return info, None

    with ThreadPoolExecutor(max_workers=len(regions)) as executor:
        results = list(executor.map(fetch_region, regions))
    economies = [info for info, _ in results]
    available = {region: data for region, (_, data) in zip(regions, results) if data is not None}
    difference = None
    if len(regions) == 2 and all(region in available for region in regions):
        left, right = (available[region] for region in regions)
        dates = left.keys() & right.keys()
        if dates:
            day = max(dates)
            difference = {'date': day, 'left': left[day], 'right': right[day]}
    return {'economies': economies, 'difference': difference}
