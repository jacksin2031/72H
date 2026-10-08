"""Regression for generator/runtime decoded JSON shard agreement."""
import json
import unittest

from build_japan_areas import feature_line


class ShardBounds(unittest.TestCase):
    def test_exact_runtime_bound_is_valid_json(self):
        line = feature_line({"x": "a" * 8}, limit=18)
        payload = b"[" + line.rstrip(b"\n") + b"]"
        self.assertEqual(len(payload), 18)
        self.assertEqual(json.loads(payload), [{"x": "a" * 8}])

    def test_ndjson_bound_cannot_hide_array_bracket_overflow(self):
        # This NDJSON line is 18 bytes, but its JSON array would be 19.
        with self.assertRaises(ValueError):
            feature_line({"x": "a" * 9}, limit=18)


if __name__ == "__main__":
    unittest.main()
