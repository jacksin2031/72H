"""Official-source historical event anchors for synthetic Mock Live exercises.

Historical times are archived facts (JST). We translate archived events to the
exercise runtime clock when entering the Live evaluator; we NEVER pass 2011
timestamps off as fresh JMA observations. Supplemental tsunami/power events
are *not* currently actionable inputs for the earthquake-only Safety Core.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Literal

HistoricalId = Literal["tohoku-2011", "kobe-1995", "kumamoto-2016", "iburi-2018", "noto-2024"]
StageKind = Literal["EARTHQUAKE", "TSUNAMI_WARNING", "TSUNAMI_UPGRADE", "POWER_OUTAGE", "AFTERSHOCK"]
JMA_TOHOKU = "https://www.jma.go.jp/jma/en/2011_Earthquake/Information_on_2011_Earthquake.html"
JMA_KOBE = "https://www.data.jma.go.jp/eqev/data/1995_01_17_hyogonanbu/gaiyo.html"
JMA_KUMAMOTO = "https://www.data.jma.go.jp/eqev/data/2016_04_14_kumamoto/"
JMA_IBURI = "https://www.data.jma.go.jp/eqev/data/kyoshin/jishin/1809060307_hokkaido-iburi-tobu/index.html"
METI_IBURI = "https://www.enecho.meti.go.jp/about/whitepaper/2019html/1-3-1.html"
JMA_NOTO = "https://www.jma.go.jp/jma/kishou/books/hakusho/2024/index2.html"


@dataclass(frozen=True)
class HistoricMilestone:
    at_jst: str
    kind: StageKind
    ja: str
    zh: str
    en: str
    source_url: str
    historic_observation: bool = True

    def public(self) -> dict:
        return {
            "at_jst": self.at_jst, "kind": self.kind,
            "label": {"ja": self.ja, "zh-TW": self.zh, "en": self.en},
            "source_url": self.source_url,
            "historic_observation": self.historic_observation,
            "fed_to_safety_core": self.kind in {"EARTHQUAKE", "AFTERSHOCK"},
        }


@dataclass(frozen=True)
class HistoricCase:
    id: HistoricalId
    ja: str
    zh: str
    en: str
    year: int
    magnitude: str
    max_intensity: str
    area_code: str
    area_ja: str
    source_url: str
    milestones: tuple[HistoricMilestone, ...]

    def public(self) -> dict:
        return {
            "id": self.id, "year": self.year,
            "label": {"ja": self.ja, "zh-TW": self.zh, "en": self.en},
            "magnitude": self.magnitude, "max_intensity": self.max_intensity,
            "area_id": "JP-" + self.area_code,
            "source_url": self.source_url,
            "milestones": [item.public() for item in self.milestones],
        }


CASES: dict[HistoricalId, HistoricCase] = {
    "tohoku-2011": HistoricCase(
        "tohoku-2011", "東日本大震災（3.11）", "東日本大震災（311）", "2011 Tohoku earthquake / tsunami",
        2011, "9.0", "7", "04", "宮城県", JMA_TOHOKU, (
            HistoricMilestone("2011-03-11T14:46:00+09:00", "EARTHQUAKE",
                "三陸沖M9.0、宮城県栗原市で最大震度7", "三陸沖 M9.0，宮城縣栗原市最大震度7",
                "M9.0 offshore Tohoku; JMA intensity 7 at Kurihara", JMA_TOHOKU),
            HistoricMilestone("2011-03-11T14:49:00+09:00", "TSUNAMI_WARNING",
                "岩手・宮城・福島に大津波警報", "岩手、宮城、福島發布大海嘯警報",
                "Major tsunami warnings issued for Iwate, Miyagi, Fukushima", JMA_TOHOKU),
            HistoricMilestone("2011-03-11T15:14:00+09:00", "TSUNAMI_UPGRADE",
                "津波警報の対象範囲・予想高さを引き上げ", "擴大海嘯警報範圍並提高預測海嘯高度",
                "Tsunami warnings expanded and upgraded",
                "https://www.data.jma.go.jp/eqev/data/tsunamihyoka/20110311Tohokuchihoutaiheiyouoki/index.html"),
            HistoricMilestone("2011-03-11T15:15:00+09:00", "AFTERSHOCK",
                "M7.6の最大余震発生", "發生 M7.6 大型餘震",
                "Major M7.6 aftershock", JMA_TOHOKU),
        )
    ),
    "kobe-1995": HistoricCase(
        "kobe-1995", "阪神・淡路大震災（1995）", "阪神淡路大震災（1995）", "1995 Kobe / Hanshin-Awaji earthquake",
        1995, "7.3", "7", "28", "兵庫県", JMA_KOBE, (
            HistoricMilestone("1995-01-17T05:46:00+09:00", "EARTHQUAKE",
                "兵庫県南部M7.3、最大震度7", "兵庫縣南部 M7.3，最大震度7",
                "Southern Hyogo M7.3, intensity 7", JMA_KOBE),
            HistoricMilestone("1995-01-17T06:00:00+09:00", "POWER_OUTAGE",
                "災害後の電力・交通遮断を仮定する演習（時刻は仮定）",
                "演習假設：災後電力與交通中斷（時間並非歷史紀錄）",
                "DRILL ASSUMPTION: post-quake utility / transport disruption (time illustrative)",
                JMA_KOBE, False),
        )
    ),
    "kumamoto-2016": HistoricCase(
        "kumamoto-2016", "熊本地震（2016）", "熊本地震（2016）", "2016 Kumamoto earthquakes",
        2016, "7.3", "7", "43", "熊本県", JMA_KUMAMOTO, (
            HistoricMilestone("2016-04-14T21:26:00+09:00", "EARTHQUAKE",
                "M6.5、益城町で最大震度7", "M6.5，益城町最大震度7",
                "M6.5 shock; intensity 7 in Mashiki", JMA_KUMAMOTO),
            HistoricMilestone("2016-04-16T01:25:00+09:00", "EARTHQUAKE",
                "M7.3、益城町と西原村で最大震度7", "M7.3，益城町及西原村最大震度7",
                "M7.3 second major shock; intensity 7", JMA_KUMAMOTO),
        )
    ),
    "iburi-2018": HistoricCase(
        "iburi-2018", "北海道胆振東部地震（2018）", "北海道膽振東部地震（2018）", "2018 Hokkaido Iburi earthquake / blackout",
        2018, "6.7", "7", "01", "北海道", JMA_IBURI, (
            HistoricMilestone("2018-09-06T03:07:00+09:00", "EARTHQUAKE",
                "M6.7、厚真町で最大震度7", "M6.7，厚真町最大震度7",
                "M6.7 earthquake; intensity 7 at Atsuma", JMA_IBURI),
            HistoricMilestone("2018-09-06T03:25:00+09:00", "POWER_OUTAGE",
                "道内全域で大規模停電（ブラックアウト）", "全北海道約295萬戶大規模停電",
                "Island-wide blackout, roughly 2.95 million households",
                METI_IBURI),
        )
    ),
    "noto-2024": HistoricCase(
        "noto-2024", "能登半島地震（2024）", "能登半島地震（2024）", "2024 Noto Peninsula earthquake / tsunami",
        2024, "7.6", "7", "17", "石川県", JMA_NOTO, (
            HistoricMilestone("2024-01-01T16:10:00+09:00", "EARTHQUAKE",
                "能登地方M7.6、最大震度7", "能登地方 M7.6，最大震度7",
                "M7.6 Noto earthquake; intensity 7", JMA_NOTO),
            HistoricMilestone("2024-01-01T16:12:00+09:00", "TSUNAMI_WARNING",
                "新潟・富山・石川へ津波警報", "新潟、富山、石川發布海嘯警報",
                "Tsunami warnings for Niigata, Toyama and Ishikawa", JMA_NOTO),
            HistoricMilestone("2024-01-01T16:18:00+09:00", "AFTERSHOCK",
                "能登地方M6.1の地震", "能登地方發生 M6.1 地震",
                "M6.1 earthquake in Noto",
                "https://www.jma.go.jp/jma/menu/20240101_noto_jishin.html"),
            HistoricMilestone("2024-01-01T16:22:00+09:00", "TSUNAMI_UPGRADE",
                "石川県能登に大津波警報へ切替", "石川縣能登升級至大海嘯警報",
                "Major tsunami warning upgraded for Noto", JMA_NOTO),
        )
    ),
}


def list_historical_cases() -> tuple[dict, ...]:
    return tuple(case.public() for case in CASES.values())
