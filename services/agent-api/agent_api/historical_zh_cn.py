"""Simplified Chinese (zh-CN) wording for historical_cases.py Traditional Chinese labels.

Keyed by the exact zh-TW text so case definitions keep their positional shape. A test
requires every case and milestone label to have an entry here.
"""

ZH_CN: dict[str, str] = {
    "東日本大震災（311）": "东日本大震灾（311）",
    "三陸沖 M9.0，宮城縣栗原市最大震度7": "三陆冲 M9.0，宫城县栗原市最大震度7",
    "岩手、宮城、福島發布大海嘯警報": "岩手、宫城、福岛发布大海啸警报",
    "擴大海嘯警報範圍並提高預測海嘯高度": "扩大海啸警报范围并提高预测海啸高度",
    "發生 M7.6 大型餘震": "发生 M7.6 大型余震",
    "阪神淡路大震災（1995）": "阪神淡路大震灾（1995）",
    "兵庫縣南部 M7.3，最大震度7": "兵库县南部 M7.3，最大震度7",
    "演習假設：災後電力與交通中斷（時間並非歷史紀錄）": "演习假设：灾后电力与交通中断（时间并非历史纪录）",
    "熊本地震（2016）": "熊本地震（2016）",
    "M6.5，益城町最大震度7": "M6.5，益城町最大震度7",
    "M7.3，益城町及西原村最大震度7": "M7.3，益城町及西原村最大震度7",
    "北海道膽振東部地震（2018）": "北海道胆振东部地震（2018）",
    "M6.7，厚真町最大震度7": "M6.7，厚真町最大震度7",
    "全北海道約295萬戶大規模停電": "全北海道约295万户大规模停电",
    "能登半島地震（2024）": "能登半岛地震（2024）",
    "能登地方 M7.6，最大震度7": "能登地方 M7.6，最大震度7",
    "新潟、富山、石川發布海嘯警報": "新潟、富山、石川发布海啸警报",
    "能登地方發生 M6.1 地震": "能登地方发生 M6.1 地震",
    "石川縣能登升級至大海嘯警報": "石川县能登升级至大海啸警报",
}


def zh_cn(text: str) -> str:
    """Return the zh-CN label; unknown text falls back to the zh-TW original."""
    return ZH_CN.get(text, text)
