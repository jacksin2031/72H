import {z} from 'zod';
import type {Snapshot,Language} from './contracts';
export type ExplanationSnapshot=Pick<Snapshot,'situation'|'plans'|'plan_actions'|'evidence'>&{replay?:{current_time:string}};
// Mirrors the backend: actions the Safety Core approved or is holding for evidence.
export const EXPLAINABLE_DECISIONS:readonly string[]=['ALLOW','MODIFY','WAIT_FOR_EVIDENCE'];
const ids=z.array(z.string().min(1).max(160)).max(128);
export const planExplanationSchema=z.object({plan_id:z.string().min(1).max(160).nullable(),plan_version:z.number().int().positive().nullable(),
 binding:z.string().regex(/^[a-f0-9]{64}$/),language:z.enum(['ja','en','zh-TW']),
 mode:z.enum(['GEMINI_ADK_EXPLANATION','DETERMINISTIC_FALLBACK','NOT_RUN']),created_at:z.iso.datetime({offset:true}),expires_at:z.iso.datetime({offset:true}),
 paragraphs:z.array(z.string().min(1).max(320)).max(96),limitations:z.array(z.string().min(1).max(240)).min(1).max(8),
 evidence_ids:ids,fact_ids:ids,action_ids:ids,explanation_has_authority:z.literal(false),reason_code:z.string().max(100).nullable().optional(),
}).strict();
export type PlanExplanation=z.infer<typeof planExplanationSchema>;
export function planExplanationKey(snapshot:ExplanationSnapshot){
 const plan=snapshot.plans.find(p=>p.id===snapshot.situation.current_plan_id);
 return JSON.stringify([snapshot.situation.current_plan_id,snapshot.situation.network_state,plan,
  snapshot.plan_actions.filter(a=>a.plan_id===plan?.id),snapshot.evidence.map(e=>[e.id,e.trust_status,e.freshness_status,e.conflict,e.expires_at,e.claims])]);
}
export function acceptPlanExplanation(raw:unknown,snapshot:ExplanationSnapshot,language:Language,now:number):PlanExplanation|null{
 const parsed=planExplanationSchema.safeParse(raw);if(!parsed.success||!Number.isFinite(now))return null;
 const value=parsed.data,plan=snapshot.plans.find(p=>p.id===snapshot.situation.current_plan_id);
 if(value.language!==language||value.plan_id!==(plan?.id??null)||value.plan_version!==(plan?.version??null)
  ||(plan&&plan.status!=='ACTIVE')||Date.parse(value.created_at)>now+5000||Date.parse(value.expires_at)<=now
  ||Date.parse(value.expires_at)<=Date.parse(value.created_at)||Date.parse(value.expires_at)-Date.parse(value.created_at)>300000)return null;
 // Plan and evidence deadlines use the snapshot's logical clock (virtual time in replay).
 const logicalNow=snapshot.replay?Date.parse(snapshot.replay.current_time):now;
 if(!Number.isFinite(logicalNow)||(plan&&!(Date.parse(plan.expires_at)>logicalNow)))return null;
 const actions=new Set(snapshot.plan_actions.filter(a=>a.plan_id===plan?.id&&a.status==='ACTIVE'&&EXPLAINABLE_DECISIONS.includes(a.safety_decision)).map(a=>a.id));
 const evidence=new Set(snapshot.evidence.filter(e=>e.freshness_status==='CURRENT'&&!e.conflict&&['VERIFIED_OFFICIAL','VERIFIED_PARTNER'].includes(e.trust_status)
  &&(e.expires_at===null||Date.parse(e.expires_at)>logicalNow)).map(e=>e.id));
 const facts=new Set(snapshot.situation.claim_states.filter(c=>c.status==='VERIFIED').map(c=>c.key));
 const unique=(list:string[])=>new Set(list).size===list.length;
 if(!unique(value.action_ids)||!unique(value.evidence_ids)||!unique(value.fact_ids)
  ||value.action_ids.some(id=>!actions.has(id))||value.evidence_ids.some(id=>!evidence.has(id))||value.fact_ids.some(id=>!facts.has(id)))return null;
 return value;
}

export const explanationText={
 'zh-TW':{title:'AI 行動解釋',loading:'正在解釋已批准的行動…',retry:'重新解釋目前行動',ai:'Gemini／ADK 已核對解釋',fallback:'固定說明 · 未取得有效 AI 解釋',
  limits:'限制及重新核實',noPlan:'目前沒有有效計劃，先查看官方消息及現場指示。',stale:'資料已過期、離線或計劃改變，請重新核實。',
  scope:'解釋只適用於這個計劃版本；不能新增行動、保證場所或路線安全。',sources:'依據',routes:'按災害分類評估避難路線'},
 ja:{title:'AI 行動の説明',loading:'承認済みの行動を説明しています…',retry:'現在の行動を再説明',ai:'Gemini／ADK の説明を検証済み',fallback:'固定説明 · 有効なAI説明なし',
  limits:'制約・再確認',noPlan:'有効な計画がありません。公式情報と現場の指示を確認してください。',stale:'期限切れ・オフライン・計画変更。再確認してください。',
  scope:'この計画版だけの説明です。新しい行動や場所・経路の安全を保証しません。',sources:'根拠',routes:'災害種別から避難経路を検討'},
 en:{title:'AI action explanation',loading:'Explaining approved actions…',retry:'Explain current actions again',ai:'Gemini / ADK explanation validated',fallback:'Fixed explanation · no valid AI explanation',
  limits:'Limits and rechecking',noPlan:'No valid plan is available. Review official information and local instructions.',stale:'Expired, offline or changed plan. Recheck information.',
  scope:'This explanation applies to this plan version. It cannot add actions or guarantee destination or route safety.',sources:'Evidence',routes:'Review evacuation routes by hazard'},
} as const;
