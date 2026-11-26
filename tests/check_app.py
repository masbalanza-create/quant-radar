"""Comprueba la integración del HTML con el servidor sin pedir datos externos."""
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
import sys
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server


class ControlIds(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []

    def handle_starttag(self, tag, attrs):
        self.ids.extend(value for name, value in attrs if name == "id")


class AppChecks(unittest.TestCase):
    def test_required_files(self):
        for route in server.STATIC - {"/"}:
            self.assertTrue((ROOT / route.lstrip("/")).is_file(), route)
        manifest = json.loads((ROOT / "manifest.webmanifest").read_text())
        for icon in manifest["icons"]:
            self.assertIn(icon["src"], server.STATIC)

    def test_valuation_http_dispatch(self):
        handler = server.Handler.__new__(server.Handler)
        handler.authorized = Mock(return_value=True)
        handler.reply = Mock()
        handler.path = '/api/valuation?symbol=BTC%2FUSD'
        handler.do_GET()
        payload, status = handler.reply.call_args.args
        self.assertEqual((status, payload['status']), (200, 'unsupported'))
        handler.path = '/api/valuation?symbol=AAPL&as_of=invalido'
        handler.do_GET()
        self.assertEqual(handler.reply.call_args.args[1], 400)

    def test_browser_scripts_and_control_ids(self):
        html = (ROOT / "index.html").read_text()
        scripts = re.findall(r"<script>(.*?)</script>", html, re.S)
        for script in scripts:
            subprocess.run(["node", "--check"], input=script, text=True, check=True)
        markup = ControlIds()
        markup.feed(html)
        ids = markup.ids
        self.assertEqual(len(ids), len(set(ids)), "IDs duplicados")
        for control in set(re.findall(r"\$\('([^']+)'\)", "\n".join(scripts))):
            self.assertIn(control, ids)


if __name__ == "__main__":
    unittest.main()
