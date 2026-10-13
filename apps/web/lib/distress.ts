import type {DistressStatus,DistressTag,Language} from './contracts';
import type {SosProfile} from './emergency-contacts';
export const NET119_URL='https://www.fdma.go.jp/mission/prepare/transmission/transmission002.html';
const PIN_TAGS:readonly DistressTag[]=['TRAPPED','INJURED','MOBILITY_LIMITED'];
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
export function buildSosMessage(i:{language:Language;tags:readonly DistressTag[];lat:number|null;lng:number|null;accuracy_m:number|null;at:number}):string{
 const t=msg[i.language],tags=i.tags.map(x=>tagText[i.language][x]).join('、');
 const loc=i.lat!==null&&i.lng!==null&&Number.isFinite(i.lat)&&Number.isFinite(i.lng)
  ?`${t.where}: ${i.lat.toFixed(5)},${i.lng.toFixed(5)}${i.accuracy_m!==null&&Number.isFinite(i.accuracy_m)?` (±${Math.round(i.accuracy_m)} m)`:''} https://maps.google.com/?q=${i.lat.toFixed(5)},${i.lng.toFixed(5)}`
  :t.none;
 return [t.head,tags,loc,`${t.time}: ${new Date(i.at).toISOString()}`,t.sent].filter(Boolean).join('\n');
}
export function smsHref(phones:string[],body:string):string{return `sms:${phones.map(p=>encodeURIComponent(p).replace(/%2B/g,'+')).join(',')}?body=${encodeURIComponent(body)}`;}
/** Copy for primary distress instructions. Never promises safety; route text is a candidate, not a verdict. */
export const distressText={
 'zh-TW':{vertical:'現在往上走／往高處去，遠離水。',verticalNow:'來不及到達指定地點：現在就到堅固建築的 3 樓以上或高處。',goTo:'現在前往 {name}',
  roadCandidateNotice:'這是道路候選路線，沿途狀況未經確認。',exercise:'演練／模擬',aiSuggestion:'AI 建議',aiUnavailable:'AI 暫時無法使用，以下為內建指引。',
  countdown:'剩餘時間',speak:'朗讀',mute:'靜音',replay:'重播',chooseSituation:'請選擇你現在的狀況',confirm:'確認',record:'錄音',stopRecording:'停止錄音',typeInstead:'改用文字輸入',
  offlineReason:'目前離線，顯示的是上次確認的資訊。'},
 ja:{vertical:'今すぐ上の階・高い場所へ。水から離れてください。',verticalNow:'指定の場所に間に合いません：今すぐ頑丈な建物の3階以上または高台へ。',goTo:'今すぐ {name} へ',
  roadCandidateNotice:'道路の候補です。途中の状況は未確認です。',exercise:'訓練／模擬',aiSuggestion:'AIの提案',aiUnavailable:'AIを利用できません。内蔵の案内を表示しています。',
  countdown:'残り時間',speak:'読み上げ',mute:'消音',replay:'もう一度',chooseSituation:'今の状況を選んでください',confirm:'確認',record:'録音',stopRecording:'録音を停止',typeInstead:'文字で入力',
  offlineReason:'オフラインです。最後に確認した情報を表示しています。'},
 en:{vertical:'Move up / to high ground now, away from water.',verticalNow:'You cannot reach a designated site in time: go to the 3rd floor or higher of a solid building, or to high ground, now.',goTo:'Go now to {name}',
  roadCandidateNotice:'Road candidate; conditions along the way are unverified.',exercise:'Exercise / simulated',aiSuggestion:'AI suggestion',aiUnavailable:'AI is unavailable. Showing built-in guidance.',
  countdown:'Time left',speak:'Read aloud',mute:'Mute',replay:'Replay',chooseSituation:'Choose your situation',confirm:'Confirm',record:'Record',stopRecording:'Stop recording',typeInstead:'Type instead',
  offlineReason:'You are offline. Showing the last verified information.'},
} as const;
