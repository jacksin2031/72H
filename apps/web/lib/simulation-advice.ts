import { z } from 'zod';

export const simulationDecisions = ['STAY_PROTECT','EVACUATE_SHELTER','HIGH_GROUND','ASSISTANCE','UNKNOWN'] as const;
export const simulationLimits = ['SIMULATION_ONLY','NOT_LIVE_AUTHORITY','NO_SAFE_ROUTE','LOCATION_NOT_SAFETY'] as const;
export const simulationConditionsSchema = z.object({
  site: z.enum(['UNKNOWN','INDOOR','INLAND','COASTAL_LOWLAND','HIGH_GROUND']).default('UNKNOWN'),
  shaking: z.enum(['DURING','AFTER']).default('DURING'),
  building: z.enum(['UNKNOWN','INTACT_IN_SCENARIO','DAMAGED_IN_SCENARIO']).default('UNKNOWN'),
  shelter: z.enum(['UNKNOWN','OPEN_IN_SCENARIO','CLOSED_IN_SCENARIO']).default('UNKNOWN'),
  high_ground: z.enum(['UNKNOWN','VERIFIED_IN_SCENARIO','BLOCKED_IN_SCENARIO']).default('UNKNOWN'),
  route: z.enum(['UNKNOWN','PASSABLE_IN_SCENARIO','BLOCKED_IN_SCENARIO']).default('UNKNOWN'),
}).strict();
export type SimulationConditions = z.infer<typeof simulationConditionsSchema>;
export const defaultSimulationConditions = simulationConditionsSchema.parse({});
export type SimulationLocation = {area_ids:string[]; source:'GPS'|'USER_SELECTED'; observed_at:string};
const identifier=z.string().min(1).max(128);
export const simulationAssessmentSchema=z.object({
  authority:z.literal('SIMULATION_REFERENCE_ONLY'), version:z.string().regex(/^[a-f0-9]{64}$/),
  session_id:identifier, step:z.number().int().min(1).max(24),plan_id:identifier.nullable(),
  decision:z.enum(simulationDecisions),allowed_decisions:z.array(z.enum(simulationDecisions)).min(1).max(5),
  area_ids:z.array(identifier).max(3),area_label:z.string().max(200),location_source:z.enum(['GPS','USER_SELECTED','UNKNOWN']),
  location_observed_at:z.string().datetime({offset:true}).nullable(),created_at:z.string().datetime({offset:true}),expires_at:z.string().datetime({offset:true}),
  facts:z.array(z.object({id:identifier,value:z.string().max(512)}).strict()).min(1).max(16),fact_ids:z.array(identifier).min(1).max(16),
  limitation_ids:z.array(z.enum(simulationLimits)).length(4),ai_mode:z.enum(['GEMINI_ADK','GEMINI_ADK_FALLBACK','NOT_RUN']),
  reason_code:identifier.nullable(),route_authorized:z.literal(false),safe_location_verified:z.literal(false),
}).strict().superRefine((a,ctx)=>{
  const ids=a.facts.map(f=>f.id);
  if(!a.allowed_decisions.includes(a.decision)||new Set(a.allowed_decisions).size!==a.allowed_decisions.length
    ||!a.allowed_decisions.includes('UNKNOWN')||new Set(ids).size!==ids.length||new Set(a.fact_ids).size!==a.fact_ids.length
    ||ids.length!==a.fact_ids.length||a.fact_ids.some(id=>!ids.includes(id))||new Set(a.limitation_ids).size!==4
    ||(a.ai_mode!=='GEMINI_ADK'&&a.decision!=='UNKNOWN')||(a.ai_mode==='GEMINI_ADK'&&a.reason_code!==null)
    ||(a.location_source==='UNKNOWN'&&(a.area_ids.length||a.location_observed_at!==null))
    ||(a.location_source!=='UNKNOWN'&&(a.area_ids.length<2||a.location_observed_at===null)))
    ctx.addIssue({code:'custom',message:'Invalid simulation assessment bindings'});
});
export type SimulationAssessment=z.infer<typeof simulationAssessmentSchema>;

/** Wall clock, never the historical playback clock. Retained history is not current advice. */
export function activeSimulationAdvice(a:SimulationAssessment|null|undefined,binding:{session_id:string;step:number;plan_id:string|null},connected:boolean,now:number){
  if(!a||!connected||a.session_id!==binding.session_id||a.step!==binding.step||a.plan_id!==binding.plan_id
    ||Date.parse(a.created_at)>now+5000||now>=Date.parse(a.expires_at)||Date.parse(a.expires_at)>Date.parse(a.created_at)+300000
    ||(a.location_source==='GPS'&&(!a.location_observed_at||now>=Date.parse(a.location_observed_at)+120000||Date.parse(a.location_observed_at)>now)))return null;
  return a;
}

export const simulationAdviceText={
  'zh-TW':{title:'Gemini 所在地演練判斷',area:'用戶所在地區',unknownArea:'未提供所在地區',gps:'GPS 區域（座標只留在裝置）',manual:'手動選擇地區',
    assumptions:'以下條件是演練假設，並非所在地的實際災情或官方核實資料。',limits:'只供演練參考；沒有核實安全地點或安全路線，並不授權真實移動。',
    expired:'判斷已過期、斷線或正在更新，暫時無法判定。',success:'Gemini／ADK 已成功執行',fallback:'Gemini 未能完成有效判斷',notRun:'Gemini 尚未執行',facts:'依據及演練條件',
    STAY_PROTECT:'原地防護',EVACUATE_SHELTER:'前往避難所（演練）',HIGH_GROUND:'前往高處（演練）',ASSISTANCE:'請求協助，避免自行移動',UNKNOWN:'資料不足，無法判定'},
  ja:{title:'Gemini の所在地演習判断',area:'利用者の地域',unknownArea:'所在地未設定',gps:'GPS 地域（座標は端末内のみ）',manual:'手動選択の地域',
    assumptions:'以下は演習用の仮定です。所在地の実際の災害や公式確認ではありません。',limits:'演習参考のみ。安全な場所・経路の確認や実際の移動許可はありません。',
    expired:'期限切れ・通信断・更新中のため判断できません。',success:'Gemini / ADK 実行成功',fallback:'Gemini の有効な判断なし',notRun:'Gemini 未実行',facts:'根拠と演習条件',
    STAY_PROTECT:'その場で身を守る',EVACUATE_SHELTER:'避難所へ（演習）',HIGH_GROUND:'高所へ（演習）',ASSISTANCE:'支援を要請し、自力移動を控える',UNKNOWN:'情報不足・判断不能'},
  en:{title:'Gemini location drill assessment',area:'User area',unknownArea:'Location not supplied',gps:'GPS area (coordinates remain on device)',manual:'Manually selected area',
    assumptions:'These are drill assumptions, not actual conditions or verified official evidence for your area.',limits:'Drill reference only. No verified safe destination, safe route or real movement authorization.',
    expired:'Expired, disconnected or updating: assessment unavailable.',success:'Gemini / ADK executed successfully',fallback:'Gemini could not produce a valid assessment',notRun:'Gemini not executed',facts:'Basis and drill assumptions',
    STAY_PROTECT:'Protect yourself in place',EVACUATE_SHELTER:'Go to shelter (drill)',HIGH_GROUND:'Go to higher ground (drill)',ASSISTANCE:'Request assistance; avoid moving alone',UNKNOWN:'Insufficient information to decide'},
} as const;
