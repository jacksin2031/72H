import type {DistressStatus,DistressTag,Language} from './contracts';
import type {SosProfile} from './emergency-contacts';
export const NET119_URL='https://www.fdma.go.jp/mission/prepare/transmission/transmission002.html';
const PIN_TAGS:readonly DistressTag[]=['TRAPPED','INJURED','MOBILITY_LIMITED'];
/** Same lifetime as the server's critical-report TTL (distress_critical_report_ttl_seconds). */
export const CRITICAL_REPORT_MS=60*60_000;
/** Keyed by scope so an exercise (replay / mock-live) never pins SOS in live, and vice versa. */
const sosPinKey=(scope:'live'|'replay'|'mock-live')=>`72h-sos-pinned-until:${scope}`;
export const isCriticalReport=(tags:readonly DistressTag[])=>tags.some(t=>PIN_TAGS.includes(t));
/** Device-local "SOS pinned" until time; survives reloads. Storage failures are ignored (pin still follows live state). */
export function readSosPinUntil(scope:'live'|'replay'|'mock-live'):number{
 try{const v=Number(localStorage.getItem(sosPinKey(scope)));return Number.isFinite(v)&&v>0?v:0;}catch{return 0;}
}
export function rememberSosPin(scope:'live'|'replay'|'mock-live',until:number):number{
 const next=Math.max(readSosPinUntil(scope),until);
 try{localStorage.setItem(sosPinKey(scope),String(next));}catch{/* per-device convenience only */}
 return next;
}
export function shouldPinSos(tags:readonly DistressTag[],profile:SosProfile,level:DistressStatus['level']):boolean{
 if(tags.some(t=>PIN_TAGS.includes(t)))return true;
 return level!=='NONE'&&(profile.needsAssistance||profile.mobilityLimited);
}
export const tagText:Record<Language,Record<DistressTag,string>>={
 'zh-TW':{WATER_RISING:'水淹進來',TRAPPED:'被困住',INJURED:'受傷',MOBILITY_LIMITED:'行動不便',WITH_DEPENDENTS:'帶小孩或長者',LOST_NO_DESTINATION:'不知道去哪',ROUTE_BLOCKED_REPORTED:'路被擋住'},
 ja:{WATER_RISING:'水が入ってきた',TRAPPED:'閉じ込められた',INJURED:'けがをした',MOBILITY_LIMITED:'移動が難しい',WITH_DEPENDENTS:'子ども・高齢者と一緒',LOST_NO_DESTINATION:'どこへ行けばいいか分からない',ROUTE_BLOCKED_REPORTED:'道がふさがれている'},
 en:{WATER_RISING:'Water is rising',TRAPPED:'Trapped',INJURED:'Injured',MOBILITY_LIMITED:'Limited mobility',WITH_DEPENDENTS:'With children or elderly',LOST_NO_DESTINATION:'Don’t know where to go',ROUTE_BLOCKED_REPORTED:'Road blocked'},
};
export const sosText={
 'zh-TW':{title:'需要協助',setupTitle:'設定緊急聯絡人（選填）',name:'名字',phone:'電話',mobility:'我行動不便',assist:'我需要協助撤離',testAlarm:'試播警報聲',save:'儲存',skip:'略過',
  battery:'聯絡人只存在這支手機，不會上傳。電量低時請先節省電力。',saveFailed:'無法儲存，請再試一次或略過。',
  call119:'撥打 119',call110:'撥打 110',message:'傳訊息給聯絡人',share:'分享我的位置',alarm:'播放警報聲',stop:'停止',net119:'網路 119（需先登錄）',needsNetwork:'需要網路連線'},
 ja:{title:'助けが必要',setupTitle:'緊急連絡先の設定（任意）',name:'名前',phone:'電話番号',mobility:'移動が難しい',assist:'避難の手助けが必要',testAlarm:'警報音をテスト',save:'保存',skip:'スキップ',
  battery:'連絡先はこの端末にのみ保存され、送信されません。電池が少ないときは先に節電してください。',saveFailed:'保存できませんでした。もう一度試すかスキップしてください。',
  call119:'119に電話',call110:'110に電話',message:'連絡先にメッセージ',share:'現在地を共有',alarm:'警報音を鳴らす',stop:'停止',net119:'ネット119（事前登録が必要）',needsNetwork:'ネット接続が必要です'},
 en:{title:'I need help',setupTitle:'Set up emergency contacts (optional)',name:'Name',phone:'Phone',mobility:'I have limited mobility',assist:'I need help evacuating',testAlarm:'Test alarm sound',save:'Save',skip:'Skip',
  battery:'Contacts stay on this phone and are never uploaded. If your battery is low, save power first.',saveFailed:'Could not save. Try again or skip.',
  call119:'Call 119',call110:'Call 110',message:'Message my contacts',share:'Share my location',alarm:'Play alarm',stop:'Stop',net119:'Net 119 (registration required)',needsNetwork:'Needs a network connection'},
} as const;
const msg={
 'zh-TW':{head:'【求救】我需要協助。',where:'位置',none:'無法取得位置',time:'時間',sent:'此訊息由使用者送出，並非官方訊息。'},
 ja:{head:'【救助要請】助けが必要です。',where:'位置',none:'位置情報なし',time:'時刻',sent:'このメッセージは本人が送信したもので、公式情報ではありません。'},
 en:{head:'[SOS] I need help.',where:'Location',none:'Location unavailable',time:'Time',sent:'Sent by the user; not an official message.'},
} as const;
/** Device-local wall time with an explicit UTC offset; seconds precision only. */
function localTime(at:number):string{
 const d=new Date(at),p=(n:number)=>String(n).padStart(2,'0'),off=-d.getTimezoneOffset(),a=Math.abs(off);
 return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} (UTC${off>=0?'+':'-'}${p(Math.floor(a/60))}:${p(a%60)})`;
}
export function buildSosMessage(i:{language:Language;tags:readonly DistressTag[];lat:number|null;lng:number|null;accuracy_m:number|null;at:number}):string{
 const t=msg[i.language],tags=i.tags.map(x=>tagText[i.language][x]).join('、');
 const loc=i.lat!==null&&i.lng!==null&&Number.isFinite(i.lat)&&Number.isFinite(i.lng)
  ?`${t.where}: ${i.lat.toFixed(5)},${i.lng.toFixed(5)}${i.accuracy_m!==null&&Number.isFinite(i.accuracy_m)?` (±${Math.round(i.accuracy_m)} m)`:''} https://maps.google.com/?q=${i.lat.toFixed(5)},${i.lng.toFixed(5)}`
  :t.none;
 return [t.head,tags,loc,`${t.time}: ${localTime(i.at)}`,t.sent].filter(Boolean).join('\n');
}
export function smsHref(phones:string[],body:string):string{return `sms:${phones.map(p=>encodeURIComponent(p).replace(/%2B/g,'+')).join(',')}?body=${encodeURIComponent(body)}`;}
/** Device-local HH:MM (24 h) for basis / last-confirmed lines. */
export function formatClock(at:number):string{
 const d=new Date(at),p=(n:number)=>String(n).padStart(2,'0');
 return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** Copy for primary distress instructions. Never promises safety; route text is a candidate, not a verdict. */
export const distressText={
 'zh-TW':{vertical:'現在往上走／往高處去，遠離水。',verticalNow:'立刻往堅固建築物 3 樓以上或高處移動（來不及抵達指定場所）',goTo:'立刻前往 {name}（官方指定海嘯避難場所）',verticalTrapped:'請求救，留在可以保護自己的地方；如果水在上升，就往高處移動。',
  roadCandidateNotice:'這是道路候選路線，沿途狀況未經確認。',exercise:'演練／模擬',aiSuggestion:'AI 建議',aiUnavailable:'AI 暫時無法使用，以下為內建指引。',
  countdown:'剩餘時間',speak:'朗讀',mute:'靜音',replay:'重播',chooseSituation:'請選擇你現在的狀況',confirm:'確認',record:'錄音',stopRecording:'停止錄音',typeInstead:'改用文字輸入',
  offlineReason:'目前離線，顯示的是上次確認的資訊。',
  send:'送出',voiceNeedsNetwork:'語音與文字判讀需要網路連線，請改用上方按鈕。',aiHeard:'AI 聽到：',micUnavailable:'無法使用麥克風，請改用上方按鈕。',noSession:'目前沒有連線中的工作階段，無法使用語音或文字判讀，請改用上方按鈕。',analyzing:'AI 判讀中…',lastVerified:'最後確認時間',extractFailed:'AI 無法判讀，請用按鈕選擇狀況。',sendFailed:'未能送出，已在這支手機上顯示指引。',
  notGuaranteed:'這是建議，不代表地點或路線一定沒有危險。請依現場狀況與官方指示判斷。',walkMeta:'步行約 {min} 分鐘 · {m} m',computing:'正在計算可到達的場所…',
  reasonNoTime:'海嘯預估抵達時間已到或已過。',reasonNoLocation:'沒有可靠的目前位置。',reasonNoReachable:'在預估抵達時間前走不到任何指定場所。',reasonNoSites:'這個範圍沒有指定緊急避難場所資料。',reasonExcludedByReport:'依你回報的封路，AI 建議排除可到達的指定場所。',
  officialSites:'查看官方指定避難場所',pendingTags:'AI 判讀的狀況（請勾選正確的項目）',analyze:'讓 AI 判讀',moreDetails:'更多細節',otherCandidates:'其他候選場所',sosSuggested:'建議求救',lastReport:'已回報',
  basis:'依據：氣象廳 {warning} · 發布 {time}',warningMajor:'大津波警報',warningWarning:'津波警報',staleNotice:'官方資料已超過有效時間，最後確認 {time}',locationStaleNotice:'位置資料過舊，最後定位 {time}'},
 ja:{vertical:'今すぐ上の階・高い場所へ。水から離れてください。',verticalNow:'今すぐ頑丈な建物の3階以上か高台へ移動（指定の場所には間に合いません）',goTo:'今すぐ {name} へ（公式指定の津波避難場所）',verticalTrapped:'助けを求め、身を守れる場所にとどまってください。水が上がってきたら高い所へ移動してください。',
  roadCandidateNotice:'道路の候補です。途中の状況は未確認です。',exercise:'訓練／模擬',aiSuggestion:'AIの提案',aiUnavailable:'AIを利用できません。内蔵の案内を表示しています。',
  countdown:'残り時間',speak:'読み上げ',mute:'消音',replay:'もう一度',chooseSituation:'今の状況を選んでください',confirm:'確認',record:'録音',stopRecording:'録音を停止',typeInstead:'文字で入力',
  offlineReason:'オフラインです。最後に確認した情報を表示しています。',
  send:'送信',voiceNeedsNetwork:'音声・文字の判定にはネット接続が必要です。上のボタンを使ってください。',aiHeard:'AIが聞き取った内容：',micUnavailable:'マイクを使えません。上のボタンを使ってください。',noSession:'接続中のセッションがないため、音声・文字の判定は使えません。上のボタンを使ってください。',analyzing:'AIが判定中…',lastVerified:'最終確認時刻',extractFailed:'AIが判定できませんでした。ボタンで状況を選んでください。',sendFailed:'送信できませんでした。この端末で案内を表示しています。',
  notGuaranteed:'これは提案です。場所や道に危険がないという意味ではありません。現地の状況と公式の指示で判断してください。',walkMeta:'徒歩 約{min}分 · {m} m',computing:'到達できる場所を計算中…',
  reasonNoTime:'津波の到達予想時刻になった、または過ぎました。',reasonNoLocation:'信頼できる現在地がありません。',reasonNoReachable:'到達予想時刻までに歩いて行ける指定場所がありません。',reasonNoSites:'この範囲の指定緊急避難場所データがありません。',reasonExcludedByReport:'あなたが報告した通行止めにより、AIは到達できる指定場所を除外するよう提案しています。',
  officialSites:'公式の指定避難場所を見る',pendingTags:'AIが判定した状況（正しいものにチェック）',analyze:'AIで判定',moreDetails:'詳細',otherCandidates:'ほかの候補',sosSuggested:'救助要請をおすすめ',lastReport:'報告済み',
  basis:'根拠：気象庁 {warning} · 発表 {time}',warningMajor:'大津波警報',warningWarning:'津波警報',staleNotice:'公式情報の有効時間を過ぎています。最終確認 {time}',locationStaleNotice:'位置情報が古くなっています。最終測位 {time}'},
 en:{vertical:'Move up / to high ground now, away from water.',verticalNow:'Move now to the 3rd floor or higher of a solid building, or to high ground (you cannot reach a designated site in time).',goTo:'Go now to {name} (officially designated tsunami site)',verticalTrapped:'Call for help and stay where you can protect yourself. If water is rising, move higher.',
  roadCandidateNotice:'Road candidate; conditions along the way are unverified.',exercise:'Exercise / simulated',aiSuggestion:'AI suggestion',aiUnavailable:'AI is unavailable. Showing built-in guidance.',
  countdown:'Time left',speak:'Read aloud',mute:'Mute',replay:'Replay',chooseSituation:'Choose your situation',confirm:'Confirm',record:'Record',stopRecording:'Stop recording',typeInstead:'Type instead',
  offlineReason:'You are offline. Showing the last verified information.',
  send:'Send',voiceNeedsNetwork:'Voice and text reading need a network connection. Use the buttons above.',aiHeard:'AI heard: ',micUnavailable:'Microphone unavailable. Use the buttons above.',noSession:'No active session, so voice and text reading are unavailable. Use the buttons above.',analyzing:'AI is reading…',lastVerified:'Last verified',extractFailed:'AI could not read that. Choose your situation with the buttons.',sendFailed:'Could not send. Showing guidance on this phone.',
  notGuaranteed:'This is a suggestion. It does not mean the place or road is free of danger. Follow local conditions and official instructions.',walkMeta:'About {min} min walk · {m} m',computing:'Working out which sites you can reach…',
  reasonNoTime:'The estimated tsunami arrival time has come or passed.',reasonNoLocation:'No reliable current location.',reasonNoReachable:'No designated site can be reached on foot before the estimated arrival.',reasonNoSites:'No designated emergency site data for this area.',reasonExcludedByReport:'Based on the road block you reported, AI suggests excluding the reachable designated sites.',
  officialSites:'See official designated evacuation sites',pendingTags:'Situation read by AI (tick the ones that are right)',analyze:'Let AI read it',moreDetails:'More details',otherCandidates:'Other candidates',sosSuggested:'Calling for help is suggested',lastReport:'Reported',
  basis:'Basis: JMA {warning} · issued {time}',warningMajor:'Major Tsunami Warning',warningWarning:'Tsunami Warning',staleNotice:'Official data has expired. Last confirmed {time}',locationStaleNotice:'Location data is too old. Last fix {time}'},
} as const;
/** AI emphasis clauses (fixed wording; the model only picks ids). */
export const emphasisText:Record<Language,Record<'MOVE_UP_NOW'|'AVOID_WATER'|'STAY_TOGETHER'|'CALL_FOR_HELP'|'KEEP_PHONE_POWER',string>>={
 'zh-TW':{MOVE_UP_NOW:'現在就往高處移動。',AVOID_WATER:'遠離水邊與河川。',STAY_TOGETHER:'和同行的人待在一起。',CALL_FOR_HELP:'需要時撥打 119 求救。',KEEP_PHONE_POWER:'節省手機電量。'},
 ja:{MOVE_UP_NOW:'今すぐ高い所へ。',AVOID_WATER:'水辺や川から離れてください。',STAY_TOGETHER:'一緒にいる人と離れないでください。',CALL_FOR_HELP:'必要なら119に助けを求めてください。',KEEP_PHONE_POWER:'スマホの電池を節約してください。'},
 en:{MOVE_UP_NOW:'Move to higher ground now.',AVOID_WATER:'Stay away from the shore and rivers.',STAY_TOGETHER:'Stay together with the people you are with.',CALL_FOR_HELP:'Call 119 for help if you need it.',KEEP_PHONE_POWER:'Save your phone battery.'},
};
