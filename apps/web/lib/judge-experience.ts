import type { Language } from './contracts';
import { boundedText } from './disaster-map';
import { mockLiveResponseSchema, type MockLiveResponse } from './mock-live-envelope';
import { projectContinuity } from './continuity';

export const judgeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function judgeRequest(path: string, signal: AbortSignal, language: Language = 'ja'): Promise<MockLiveResponse> {
  if (path !== 'start' && !(path.endsWith('/next') && judgeUuid.test(path.slice(0, -5)))) throw new Error('Invalid judge endpoint');
  const response = await fetch('/api/judge/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: path === 'start' ? JSON.stringify({ language }) : undefined, cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
  });
  if (!response.ok) throw new Error(String(response.status));
  const result = mockLiveResponseSchema.parse(JSON.parse((await boundedText(response, 1_000_000)).text));
  if (result.historical?.case_id !== 'tohoku-2011' || result.total_steps !== 4 || result.historical.milestones.length !== 4) {
    throw new Error('Unexpected judge scenario');
  }
  return result;
}

/** Presentation only: the existing local freshness/dependency gates still own action eligibility. */
export function judgeProjection(result: MockLiveResponse, now: number, connected: boolean) {
  const clock = Math.max(now, Date.parse(result.snapshot.situation.updated_at));
  const projection = projectContinuity(result.snapshot, clock, connected ? 'online' : 'offline');
  const actions = result.snapshot.plan_actions.filter(action => action.plan_id === projection.plan?.id
    && !projection.invalidActionIds.includes(action.id));
  return { ...projection, actions, clock };
}

export const judgeText = {
  ja: {
    blockedReason: 'この演習では安全な避難先・経路を確認していません。特定の場所への移動は許可せず、一般的な身の守り方を示しています。',
    entry: '3.11を体験する', lead: '警報の、その先へ。', purpose: '情報が変わったとき、次の行動も変わる。72Hが何を根拠に計画を見直すか、あなたのペースで確かめてください。',
    title: '3.11 東日本大震災', persona: '演習設定：宮城県石巻市にいる旅行者。土地勘がなく、次に何をすべきか迷っています。',
    assumptions: '場所・人物は演習用の仮定です。当時の現地状況を完全再現するものではありません。',
    notice: '歴史演習 · 現在の警報ではありません', limits: '過去の記録を模擬入力として処理します。安全な場所・経路の確認や、現実の移動許可ではありません。',
    start: '3.11体験を始める', next: '次の出来事へ', review: '体験を振り返る', restart: '最初からやり直す', exit: '体験を終了', advanced: '詳細な演習設定',
    pace: '4つの出来事を自分のペースで。歴史の待ち時間を省略します。AIの処理には時間がかかります。',
    processing: '新しい情報を確認し、行動計画を評価しています…', changed: '計画を更新', kept: '新しい情報を確認 · 計画を維持', first: '最初の行動計画',
    why: 'この行動の理由', before: 'ひとつ前の行動', refreshed: '根拠を更新 · 行動を維持', archive: '演習の過去の記録です。現在の行動指示ではありません。', result: '今回の行動', source: '根拠を確かめる', historical: '当時の記録', history: '演習の記録', pending: '未処理',
    empty: '現在使える行動計画はありません。情報の再確認が必要です。', expired: '計画の期限切れ・通信断。保存した行動を現在の指示として使わないでください。',
    error: '処理結果を確認できませんでした。出来事を飛ばさないため、最初からやり直してください。', capacity: 'ただいま演習が混み合っています。少し待ってからやり直してください。',
    finished: '警報から、行動へ。', takeaway: '72Hは新しい情報で計画を再評価し、根拠とともに次の行動を示します。以下は今回実際に処理された結果です。',
    plans: '作成された計画', evaluated: '評価した出来事', ai: 'Gemini / ADK の実行結果', success: '実行成功', fallback: 'AI失敗・安全規則にフォールバック', notRun: '未実行',
    retained: '計画が維持される場合もあります。イベント数と計画数は同じとは限りません。', version: '計画', event: '出来事', safety: '実際の移動許可', no: 'なし', language: '表示言語', updated: '模擬情報の最終確認',
  },
  'zh-TW': {
    blockedReason: '這次演習未有核實安全的目的地或路線；系統顯示一般防護指引，不會批准前往特定場所。',
    entry: '體驗 311 地震', lead: '收到警報，然後呢？', purpose: '資訊改變，下一步亦可能要改變。親手看看 72H 如何根據證據重新檢查行動計劃。',
    title: '311 東日本大震災', persona: '演習設定：你是一名身處宮城縣石卷市的旅客，不熟悉附近環境，正猶豫下一步應怎樣做。',
    assumptions: '位置及人物均屬演習假設，並非完整重現當時當地的情況。', notice: '歷史演習 · 並非目前警報', limits: '歷史紀錄會以模擬資料輸入系統；不代表已核實安全地點、路線或授權真實移動。',
    start: '開始 311 體驗', next: '前往下一事件', review: '回顧這次體驗', restart: '由頭再試', exit: '結束體驗', advanced: '進階演習設定',
    pace: '自行逐步體驗四個事件，跳過歷史等待時間；AI 處理仍需時間。', processing: '正在核對新資訊，重新評估行動計劃…',
    changed: '行動計劃已更新', kept: '已核對新資訊 · 保留現有計劃', first: '第一份行動計劃', refreshed: '依據更新 · 行動維持', archive: '以下是過往演習紀錄，並非目前行動指示。', why: '為何這樣做', before: '上一步行動', result: '這一步行動', source: '查看依據', historical: '歷史紀錄', history: '演習紀錄', pending: '尚未處理',
    empty: '目前沒有可用的行動計劃，需要重新核對資訊。', expired: '計劃已過期或連線中斷，請勿將保存的行動視為目前指示。',
    error: '未能確認處理結果。為免跳過事件，請由頭重新開始。', capacity: '目前演習使用量較高，請稍候再試。',
    finished: '由警報，走到下一步。', takeaway: '72H 會因應新資訊重新評估計劃，並交代下一步的依據。以下是這次實際處理的結果。',
    plans: '已建立的計劃', evaluated: '已評估事件', ai: 'Gemini／ADK 執行結果', success: '執行成功', fallback: 'AI 失敗，回退至安全規則', notRun: '未執行',
    retained: '新資訊未必需要改變計劃；事件數量不等於計劃版本數量。', version: '計劃', event: '事件', safety: '真實移動授權', no: '沒有', language: '顯示語言', updated: '模擬資訊最後核對',
  },
  en: {
    blockedReason: 'This exercise has not verified a safe destination or route. General protective guidance is shown; travel to a specific place is not authorized.',
    entry: 'Experience 3.11', lead: 'An alert. What next?', purpose: 'When information changes, your next action may need to change too. See how 72H re-evaluates a plan against the evidence.',
    title: '3.11 Tohoku earthquake', persona: 'Drill setting: you are a visitor in Ishinomaki, Miyagi. You do not know the area and are unsure what to do next.',
    assumptions: 'The person and location are drill assumptions, not a complete reconstruction of local conditions in 2011.', notice: 'Historical exercise · Not a current alert', limits: 'Archived events enter as synthetic data. No verified safe destination, route or real movement authorization.',
    start: 'Start the 3.11 experience', next: 'Next event', review: 'Review this experience', restart: 'Start again', exit: 'End experience', advanced: 'Advanced exercise settings',
    pace: 'Explore four events at your own pace. Historical waiting time is skipped; AI processing still takes time.', processing: 'Checking new information and re-evaluating the action plan…',
    changed: 'Action plan updated', kept: 'New information checked · Plan retained', first: 'First action plan', refreshed: 'Evidence updated · Action retained', archive: 'Past exercise records, not current action instructions.', why: 'Why this action', before: 'Previous action', result: 'This action', source: 'Check the evidence', historical: 'Historical record', history: 'Exercise record', pending: 'Not processed',
    empty: 'No usable action plan. Information needs to be checked again.', expired: 'Plan expired or connection lost. Saved actions are not current instructions.',
    error: 'The result could not be confirmed. Start again to avoid skipping an event.', capacity: 'The exercise is busy. Please wait a moment and try again.',
    finished: 'From an alert to a next step.', takeaway: '72H re-evaluates plans when information changes and shows the evidence for the next action. These are the actual results of this run.',
    plans: 'Plans created', evaluated: 'Events evaluated', ai: 'Gemini / ADK execution', success: 'Executed successfully', fallback: 'AI failed; safe deterministic fallback', notRun: 'Not executed',
    retained: 'New information can leave a plan unchanged. Event and plan counts need not match.', version: 'Plan', event: 'Event', safety: 'Real movement authorization', no: 'None', language: 'Language', updated: 'Synthetic information last checked',
  },
  'zh-CN': {
    blockedReason: '这次演习未有核实安全的目的地或路线；系统显示一般防护指引，不会批准前往特定场所。',
    entry: '体验 311 地震', lead: '收到警报，然后呢？', purpose: '信息改变，下一步也可能需要改变。亲手看看 72H 如何根据证据重新检查行动计划。',
    title: '311 东日本大地震', persona: '演习设置：你是一名身处宫城县石卷市的旅客，不熟悉附近环境，正犹豫下一步该怎么做。',
    assumptions: '位置及人物均属演习假设，并非完整重现当时当地的情况。', notice: '历史演习 · 并非目前警报', limits: '历史记录会以模拟数据输入系统；不代表已核实安全地点、路线或授权真实移动。',
    start: '开始 311 体验', next: '前往下一事件', review: '回顾这次体验', restart: '从头再试', exit: '结束体验', advanced: '进阶演习设置',
    pace: '自行逐步体验四个事件，跳过历史等待时间；AI 处理仍需时间。', processing: '正在核对新信息，重新评估行动计划…',
    changed: '行动计划已更新', kept: '已核对新信息 · 保留现有计划', first: '第一份行动计划', refreshed: '依据更新 · 行动维持', archive: '以下是过往演习记录，并非目前行动指示。', why: '为何这样做', before: '上一步行动', result: '这一步行动', source: '查看依据', historical: '历史记录', history: '演习记录', pending: '尚未处理',
    empty: '目前没有可用的行动计划，需要重新核对信息。', expired: '计划已过期或连接中断，请勿将保存的行动视为目前指示。',
    error: '未能确认处理结果。为免跳过事件，请从头重新开始。', capacity: '目前演习使用量较高，请稍候再试。',
    finished: '由警报，走到下一步。', takeaway: '72H 会因应新信息重新评估计划，并交代下一步的依据。以下是这次实际处理的结果。',
    plans: '已创建的计划', evaluated: '已评估事件', ai: 'Gemini／ADK 执行结果', success: '运行成功', fallback: 'AI 失败，回退至安全规则', notRun: '未运行',
    retained: '新信息未必需要改变计划；事件数量不等于计划版本数量。', version: '计划', event: '事件', safety: '真实移动授权', no: '没有', language: '显示语言', updated: '模拟信息最后核对',
  },
} as const;
