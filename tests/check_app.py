"""Comprueba la integración del HTML con el servidor sin pedir datos externos."""
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
import sys
import unittest

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
