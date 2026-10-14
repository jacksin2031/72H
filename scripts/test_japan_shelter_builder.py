"""National designation import must not infer opening or hazard eligibility."""
import unittest
import json
import tempfile
from pathlib import Path

from build_japan_shelters import normalize_place, build, SOURCE_PATHS


class NationalShelterImport(unittest.TestCase):
    def row(self, **extra):
        return {"共通ID": "E0110000001111", "施設・場所名": "試験施設",
                "都道府県名及び市町村名": "北海道札幌市", "住所": "試験住所",
                "緯度": "43.038", "経度": "141.484", "備考": "原典の備考", **extra}

    def test_shelter_has_no_inferred_hazard_designation(self):
        place = normalize_place(self.row(津波="1"), "SHELTER")
        self.assertEqual(place[6], "UUUUUUUU")
        self.assertEqual(place[8], "01100")

    def test_emergency_site_preserves_one_blank_and_unknown(self):
        place = normalize_place(self.row(洪水="1", 地震="", 津波="unexpected"), "EMERGENCY_SITE")
        self.assertEqual(place[6], "DUUNUUUU")

    def test_invalid_coordinates_or_identity_fail_the_import(self):
        for extra in ({"緯度": "NaN"}, {"経度": "200"}, {"共通ID": ""}, {"施設・場所名": ""}):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                normalize_place(self.row(**extra), "SHELTER")

    def test_keeps_reception_restrictions_as_reference_notes(self):
        place = normalize_place(self.row(受入対象者="要配慮者", その他市町村長が必要と認める事項="事前確認"), "SHELTER")
        self.assertIn("要配慮者", place[7])
        self.assertIn("事前確認", place[7])

    def test_preserves_published_alphanumeric_common_ids(self):
        self.assertEqual(normalize_place(self.row(共通ID="E304060000620B"), "EMERGENCY_SITE")[0], "E304060000620B")

    def test_rejects_modified_retained_downloads_before_building_public_assets(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder)
            for path in SOURCE_PATHS.values():
                (source / Path(path).name).write_text("changed source", encoding="utf-8")
            (source / "receipts.json").write_text(json.dumps({key: {"sha256": "0" * 64} for key in SOURCE_PATHS}))
            with self.assertRaisesRegex(ValueError, "download receipts"):
                build(source, source / "output", None)
            self.assertFalse((source / "output").exists())


if __name__ == "__main__":
    unittest.main()
