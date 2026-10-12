import type { Language, LiveSnapshot, OfficialReport } from '../lib/contracts';

const copy = {
  'zh-TW': {
    title: '官方電文與補抓狀態', limit: '只列出最近的參考紀錄。核實 feed 窗口不代表全國安全、沒有警報或可開始移動。',
    empty: '尚未有可顯示的官方電文原文紀錄。', unknown: '未判定', offline: '顯示保存／補抓紀錄，當前狀態未核實。',
    transport: '來源連線（最後查詢）', fetch: '最新成功接收', publication: '最新官方發表', verified: '長期 feed 核實至',
    pending: '待補抓電文', storage: '持久儲存', interrupted: '輪詢中斷：等待較新的長期 feed',
    scan: '補抓狀態', issued: '電文發表／更新', reported: '業務報告時間', received: '首次接收', age: '電文年齡（分鐘）',
    scope: '官方目標區域代碼（未映射地點）', noScope: '未提供可核實的目標區域', officialExpiry: '官方有效期', appExpiry: '應用程式證據使用期限',
    cancel: '電文已撤銷；不代表地區警報解除。', proof: '原文識別與版本', source: '開啟官方原文',
    states: { CURRENT: '目前電文', STALE: '過時', WITHDRAWN: '電文撤銷', SUPERSEDED: '已被取代', CONFLICT: '內容衝突', UNKNOWN: '未核實' },
    scans: { NOT_STARTED: '未開始', SCANNING: '補抓／等待中', WINDOW_VERIFIED: '已核實所見窗口', GAP: '歷史缺口未能補齊', UNKNOWN: '未核實' },
    connections: { REACHABLE: '可連接', UNAVAILABLE: '無法連接', UNKNOWN: '未判定' },
    stores: { HEALTHY: '可用', UNCONFIGURED: '未設定持久儲存', FAILED: '保存失敗' },
  },
  ja: {
    title: '公式電文と取得状況', limit: '最近の参考記録のみ表示します。feed 窓の確認は全国の安全、警報なし、移動許可を意味しません。',
    empty: '表示できる公式原文記録がありません。', unknown: '未判定', offline: '保存／取得記録を表示中。現在の状態は未確認です。',
    transport: '情報源への接続（最終照会）', fetch: '最終受信成功', publication: '最新の公式発表', verified: '長期 feed の確認時点',
    pending: '未取得の電文', storage: '永続保存', interrupted: '取得中断：新しい長期 feed を待っています',
    scan: '取得状況', issued: '電文の発表／更新', reported: '業務上の報告時刻', received: '初回受信', age: '電文の経過時間（分）',
    scope: '公式対象区域コード（地点に未対応）', noScope: '確認できる対象区域なし', officialExpiry: '公式の有効期限', appExpiry: 'アプリの根拠使用期限',
    cancel: '電文の取消です。地域の警報解除とは限りません。', proof: '原文識別とバージョン', source: '公式原文を開く',
    states: { CURRENT: '現在の電文', STALE: '期限切れ', WITHDRAWN: '電文取消', SUPERSEDED: '更新済み', CONFLICT: '内容の矛盾', UNKNOWN: '未確認' },
    scans: { NOT_STARTED: '未開始', SCANNING: '取得／待機中', WINDOW_VERIFIED: '取得窓を確認済み', GAP: '過去の欠落を補完できません', UNKNOWN: '未確認' },
    connections: { REACHABLE: '接続可能', UNAVAILABLE: '接続できません', UNKNOWN: '未判定' },
    stores: { HEALTHY: '利用可能', UNCONFIGURED: '永続保存が未設定', FAILED: '保存失敗' },
  },
  en: {
    title: 'Official bulletins and recovery', limit: 'Recent reference records only. A checked feed window does not establish nationwide safety, absence of warnings, or permission to move.',
    empty: 'No official raw bulletin records to display.', unknown: 'Unknown', offline: 'Saved / recovery records; current status is unverified.',
    transport: 'Source connection (last check)', fetch: 'Last successful receipt', publication: 'Latest official publication', verified: 'Long feed checked as of',
    pending: 'Pending bulletins', storage: 'Durable storage', interrupted: 'Polling interrupted: awaiting a newer long feed',
    scan: 'Recovery status', issued: 'Bulletin publication / update', reported: 'Business report time', received: 'First receipt', age: 'Bulletin age (minutes)',
    scope: 'Official target codes (not mapped to places)', noScope: 'No verified target scope provided', officialExpiry: 'Official validity deadline', appExpiry: 'Application evidence deadline',
    cancel: 'Bulletin withdrawn; this does not establish an area warning was lifted.', proof: 'Raw identity and versions', source: 'Open official raw bulletin',
    states: { CURRENT: 'Current bulletin', STALE: 'Stale', WITHDRAWN: 'Withdrawn', SUPERSEDED: 'Superseded', CONFLICT: 'Conflicting', UNKNOWN: 'Unverified' },
    scans: { NOT_STARTED: 'Not started', SCANNING: 'Recovering / waiting', WINDOW_VERIFIED: 'Observed window checked', GAP: 'Historical gap unresolved', UNKNOWN: 'Unverified' },
    connections: { REACHABLE: 'Reachable', UNAVAILABLE: 'Unavailable', UNKNOWN: 'Unknown' },
    stores: { HEALTHY: 'Available', UNCONFIGURED: 'Durable storage not configured', FAILED: 'Save failed' },
  },
};

export function referenceLifecycle(report: OfficialReport, now: number, connected: boolean): OfficialReport['lifecycle'] {
  if (report.lifecycle !== 'CURRENT') return report.lifecycle;
  if (!Number.isFinite(now) || now < Date.parse(report.issued_at) || now < Date.parse(report.received_at)) return 'UNKNOWN';
  if (now >= Date.parse(report.evidence_expires_at)) return 'STALE';
  return connected ? 'CURRENT' : 'UNKNOWN';
}

export function OfficialSourceReview({ snapshot, language, now, connected }: {
  snapshot: LiveSnapshot; language: Language; now: number; connected: boolean;
}) {
  const t = copy[language];
  const format = (value: string | null) => value === null ? t.unknown : new Date(value).toLocaleString(language);
  const sources = snapshot.official_sources.length ? snapshot.official_sources : [snapshot.source];
  return <section className="official-source-review" aria-label={t.title}>
    <h2>{t.title}</h2><p>{t.limit}</p>
    {(!connected || snapshot.situation.network_state !== 'ONLINE_VERIFIED') && <p role="status">{t.offline}</p>}
    <div className="official-source-grid">{sources.map(source => {
      const recovery = source.recovery;
      return <article key={source.source_key}><h3>{source.source_name}</h3>
        <dl>
          <dt>{t.transport}</dt><dd>{connected && recovery ? t.connections[recovery.connection_status] : t.unknown}</dd>
          <dt>{t.fetch}</dt><dd>{format(recovery?.last_successful_fetch_at ?? source.retrieved_at)}</dd>
          <dt>{t.publication}</dt><dd>{format(source.last_published_at)}</dd>
          <dt>{t.verified}</dt><dd>{format(recovery?.last_verified_at ?? null)}</dd>
          <dt>{t.scan}</dt><dd>{connected && recovery ? t.scans[recovery.scan_status] : t.unknown}</dd>
          <dt>{t.pending}</dt><dd>{recovery?.pending_details ?? t.unknown}</dd>
          <dt>{t.storage}</dt><dd>{recovery ? `${recovery.persistence} · ${t.stores[recovery.storage_status]}` : t.unknown}</dd>
        </dl>
        {recovery?.reconciliation_required_since && <p role="status">{t.interrupted}: {format(recovery.reconciliation_required_since)}</p>}
        {recovery?.limitations.length ? <details><summary>{t.proof}</summary>{recovery.limitations.map(item => <p key={item}>{item}</p>)}</details> : null}
      </article>;
    })}</div>
    {snapshot.official_reports.map(report => {
      const age = now >= Date.parse(report.issued_at) ? Math.floor((now - Date.parse(report.issued_at)) / 60_000) : null;
      return <article className="official-report" key={report.report_id}>
        <div className="section-head"><h3>{report.title} · {report.product}</h3><strong>{t.states[referenceLifecycle(report, now, connected && snapshot.situation.network_state === 'ONLINE_VERIFIED')]}</strong></div>
        {report.operation === 'CANCEL' && <p>{t.cancel}</p>}
        <dl>
          <dt>{t.issued}</dt><dd>{format(report.issued_at)}</dd>
          <dt>{t.reported}</dt><dd>{format(report.reported_at)}</dd>
          <dt>{t.received}</dt><dd>{format(report.received_at)}</dd>
          <dt>{t.age}</dt><dd>{age ?? t.unknown}</dd>
          <dt>{t.scope}</dt><dd>{report.target_codes.join(' · ') || t.noScope}</dd>
          <dt>{t.officialExpiry}</dt><dd>{format(report.official_valid_until)}</dd>
          <dt>{t.appExpiry}</dt><dd>{format(report.evidence_expires_at)}</dd>
        </dl>
        <a href={report.reference_url} target="_blank" rel="noreferrer">{t.source} · {report.source_name}</a>
        <details><summary>{t.proof}</summary><p>{report.event_ids.join(' · ')} · {report.serial ?? '—'}</p>
          <p>{report.report_id}</p><p>SHA-256: {report.raw_sha256}</p>
          <p>{report.parser_version} · {report.information_version} · {report.code_mapping_version}</p>
        </details>
      </article>;
    })}
    {!snapshot.official_reports.length && <p>{t.empty}</p>}
  </section>;
}
