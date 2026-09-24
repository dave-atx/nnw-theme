from __future__ import annotations

import os
import tempfile
import tomllib
import unittest
from pathlib import Path

import nnwdump


class NnwdumpTests(unittest.TestCase):
    def test_every_value_round_trips_through_toml(self) -> None:
        values = {
            "title": "Plain title",
            "byline": 'O\'Brien & "Friends"',
            "body": "\n<p>It's <em>fine</em>.</p>\n<pre>\ttab</pre>\n",
            "quoted": "<p>Contains ''' three quotes</p>",
            "control": "<p>carriage\rreturn and bell\x07</p>",
            "path": "C:\\Users\\x",
        }
        text = nnwdump.fixture_text(list(values.items()), "sample")
        self.assertEqual(tomllib.loads(text), values)

    def test_html_is_a_readable_literal_and_body_comes_last(self) -> None:
        text = nnwdump.fixture_text([("body", "<p>Hi</p>"), ("title", "T")], "sample")
        self.assertIn("npx nnw-theme@2 render sample", text)
        self.assertTrue(text.endswith("body = '''\n<p>Hi</p>'''\n"))
        self.assertLess(text.index("title = 'T'"), text.index("body"))

    def test_relative_output_resolves_against_the_working_directory(self) -> None:
        previous = Path.cwd()
        with tempfile.TemporaryDirectory() as directory:
            os.chdir(directory)
            try:
                expected = Path.cwd() / "fixtures/x.toml"
                self.assertEqual(nnwdump.resolve_output("fixtures/x.toml"), expected)
            finally:
                os.chdir(previous)
        self.assertEqual(nnwdump.resolve_output("/tmp/x.toml"), Path("/tmp/x.toml"))


if __name__ == "__main__":
    unittest.main()
