import type {DistressTag,Language} from './contracts';
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
