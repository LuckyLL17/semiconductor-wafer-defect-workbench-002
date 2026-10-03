import Fastify from 'fastify';
import cors from '@fastify/cors';

type Defect={id:string;x:number;y:number;size:number;kind:'particle'|'scratch'|'void'|'edge'|'cluster';severity:'low'|'medium'|'high';score:number;step:string;tool:string;lot:string;review:'unreviewed'|'confirmed'|'false_positive';note:string};
type ProcessRun={id:string;lot:string;recipe:string;tool:string;chamber:string;temperature:number;pressure:number;gasFlow:number;rfPower:number;yield:number;status:'normal'|'watch'|'hold';};
const wafer={id:'WF-2026-09-30-A17',lot:'LOT-A17',diameter:300,product:'Logic-7nm',layer:'M2',recipe:'ETCH-M2-V4',timestamp:'2026-09-30T08:42:00Z'};
const defects:Defect[]=Array.from({length:48},(_,i)=>{const a=i*1.73;const r=35+(i%7)*12;const x=50+Math.cos(a)*r+(i%3)*3;const y=50+Math.sin(a)*r;const kind=i%11===0?'scratch':i%9===0?'edge':i%7===0?'void':i%5===0?'cluster':'particle';return{id:`D-${String(i+1).padStart(3,'0')}`,x:+x.toFixed(2),y:+y.toFixed(2),size:+(0.18+(i%6)*0.21).toFixed(2),kind,severity:i%13===0?'high':i%4===0?'medium':'low',score:+(0.61+(i%8)*.045).toFixed(2),step:i%3?'ETCH':'CLEAN',tool:i%2?'ETCH-04':'ETCH-03',lot:wafer.lot,review:i%10===0?'confirmed':'unreviewed',note:i%11===0?'连续线性缺陷，建议复核扫描':'自动检测候选缺陷'} });
const processRuns:ProcessRun[]=Array.from({length:12},(_,i)=>({id:`RUN-${i+1}`,lot:`LOT-A${String(17-i).padStart(2,'0')}`,recipe:i%2?'ETCH-M2-V4':'ETCH-M2-V3',tool:i%3?'ETCH-03':'ETCH-04',chamber:`CH-${(i%4)+1}`,temperature:+(42.2+(i%5)*.7).toFixed(1),pressure:+(18.4+(i%4)*.9).toFixed(2),gasFlow:+(126+(i%6)*2.2).toFixed(1),rfPower:+(780+(i%5)*11),yield:+(95.2-i*.34).toFixed(2),status:i<3?'watch':'normal'}));
const audits:Array<Record<string,unknown>>=[];
function spatial(){const cells=Array.from({length:25},()=>({count:0,high:0,score:0}));for(const d of defects){const ix=Math.max(0,Math.min(4,Math.floor(d.x/20)));const iy=Math.max(0,Math.min(4,Math.floor(d.y/20)));const c=cells[iy*5+ix];c.count++;c.high+=d.severity==='high'?1:0;c.score+=d.score}return cells.map((c,i)=>({cell:`${Math.floor(i/5)+1}-${i%5+1}`,count:c.count,high:c.high,density:+(c.count/((Math.PI*150**2)/25)).toFixed(4),meanScore:c.count?+(c.score/c.count).toFixed(2):0}));}
function clusters(){const groups=new Map<string,Defect[]>();for(const d of defects){const key=d.kind==='scratch'?`scratch-${Math.floor(d.y/15)}`:`grid-${Math.floor(d.x/20)}-${Math.floor(d.y/20)}`;groups.set(key,[...(groups.get(key)??[]),d])}return [...groups].map(([id,items])=>({id,count:items.length,kind:items[0].kind,centroid:{x:+(items.reduce((s,d)=>s+d.x,0)/items.length).toFixed(1),y:+(items.reduce((s,d)=>s+d.y,0)/items.length).toFixed(1)},maxSeverity:items.some(d=>d.severity==='high')?'high':items.some(d=>d.severity==='medium')?'medium':'low',tool:items[0].tool})).sort((a,b)=>b.count-a.count)}
function window(){const byTool=processRuns.reduce<Record<string,ProcessRun[]>>((m,r)=>(m[r.tool]=[...(m[r.tool]??[]),r],m),{});return Object.entries(byTool).map(([tool,rows])=>({tool,pointCount:rows.length,meanYield:+(rows.reduce((s,r)=>s+r.yield,0)/rows.length).toFixed(2),temperature:{min:Math.min(...rows.map(r=>r.temperature)),max:Math.max(...rows.map(r=>r.temperature))},pressure:{min:Math.min(...rows.map(r=>r.pressure)),max:Math.max(...rows.map(r=>r.pressure))},recommended:rows.filter(r=>r.yield>=94).map(r=>({recipe:r.recipe,chamber:r.chamber,temperature:r.temperature,pressure:r.pressure}))}));}
const app=Fastify({logger:false});await app.register(cors,{origin:true});
app.get('/api/health',async()=>({status:'ok',service:'wafer-defect-workbench'}));
app.get('/api/wafer/current',async()=>({wafer,summary:{defectCount:defects.length,highRisk:defects.filter(d=>d.severity==='high').length,confirmed:defects.filter(d=>d.review==='confirmed').length,clusterCount:clusters().length}}));
app.get('/api/defects',async(req)=>{const q=req.query as {kind?:string;severity?:string;review?:string};return defects.filter(d=>(!q.kind||d.kind===q.kind)&&(!q.severity||d.severity===q.severity)&&(!q.review||d.review===q.review));});
app.post('/api/defects/:id/review',async(req)=>{const id=(req.params as {id:string}).id;const body=req.body as {review:'confirmed'|'false_positive';note?:string};const d=defects.find(x=>x.id===id);if(!d)return {error:'defect_not_found'};d.review=body.review;if(body.note)d.note=body.note;audits.unshift({at:new Date().toISOString(),action:'defect_review',defectId:id,review:body.review});return d});
app.get('/api/analysis/spatial',async()=>({wafer,grid:spatial(),clusters:clusters(),hotspots:clusters().filter(c=>c.maxSeverity!=='low').slice(0,5)}));
app.get('/api/analysis/process-window',async()=>({runs:processRuns,window:window(),correlations:[{factor:'温度',metric:'缺陷密度',coefficient:-.62,interpretation:'高于 45°C 后颗粒缺陷密度上升'},{factor:'压力',metric:'划痕占比',coefficient:.48,interpretation:'压力波动与线性缺陷存在关联'},{factor:'RF功率',metric:'良率',coefficient:-.71,interpretation:'功率偏高时良率下降'}]}));
app.get('/api/analysis/compare',async()=>({current:{lot:wafer.lot,defects:defects.length,highRisk:defects.filter(d=>d.severity==='high').length,yield:93.7},baseline:{lot:'LOT-A16',defects:31,highRisk:2,yield:96.1},delta:{defects:17,highRisk:1,yield:-2.4}}));
app.post('/api/actions/hold',async(req)=>{const body=req.body as {lot:string;reason:string};audits.unshift({at:new Date().toISOString(),action:'lot_hold',...body});return {ok:true,lot:body.lot,status:'hold',reason:body.reason}});
app.get('/api/audit',async()=>audits);

const investigations:Array<{id:string;lot:string;title:string;owner:string;status:'open'|'evidence'|'contained'|'closed';severity:string;hypotheses:Array<{id:string;cause:string;weight:number;state:'open'|'supported'|'rejected'}>;evidence:Array<{at:string;source:string;finding:string;weight:number}>}>=[{id:'INV-024',lot:wafer.lot,title:'M2 划痕簇异常调查',owner:'工艺整合工程师',status:'evidence',severity:'high',hypotheses:[{id:'H-1',cause:'ETCH-04 / CH-2 腔体颗粒脱落',weight:.68,state:'supported'},{id:'H-2',cause:'载具边缘接触磨损',weight:.42,state:'open'},{id:'H-3',cause:'AOI 分类模型漂移',weight:.16,state:'rejected'}],evidence:[{at:'2026-09-30T09:08:00Z',source:'空间聚类',finding:'线性簇与 CH-2 暴露批次重合',weight:.73},{at:'2026-09-30T09:20:00Z',source:'设备履历',finding:'上次湿法清洁后运行 186 小时',weight:.51}]}];
const experiments:Array<{id:string;name:string;lot:string;baseline:{temperature:number;pressure:number;rfPower:number};candidate:{temperature:number;pressure:number;rfPower:number};status:'draft'|'simulated'|'approved';result?:Record<string,number>}>=[];
const lotDispositions=new Map<string,{state:'released'|'hold'|'conditional_release';reason:string;updatedAt:string}>([[wafer.lot,{state:'hold',reason:'高风险线性缺陷待失效模式确认',updatedAt:'2026-09-30T09:10:00Z'}]]);
function lotYieldDashboard(){const byTool=processRuns.reduce<Record<string,ProcessRun[]>>((out,row)=>(out[row.tool]=[...(out[row.tool]??[]),row],out),{});return {wafer,defectDensity:+(defects.length/(Math.PI*150*150)*1_000_000).toFixed(2),dppm:Math.round(defects.length/Math.max(1,processRuns.length*25)*1_000_000),yieldLossEstimate:+(defects.filter(d=>d.severity==='high').length*.48+defects.filter(d=>d.severity==='medium').length*.11).toFixed(2),tools:Object.entries(byTool).map(([tool,rows])=>({tool,meanYield:+(rows.reduce((s,r)=>s+r.yield,0)/rows.length).toFixed(2),watchRuns:rows.filter(r=>r.status==='watch').length,defectAssociation:+(defects.filter(d=>d.tool===tool).length/Math.max(1,defects.length)).toFixed(3)})),disposition:lotDispositions.get(wafer.lot)}}
app.get('/api/yield/dashboard',async()=>lotYieldDashboard());
app.get('/api/investigations',async()=>investigations);
app.post('/api/investigations',async(req)=>{const body=req.body as {lot?:string;title:string;owner?:string;severity?:string};const item={id:`INV-${String(investigations.length+25).padStart(3,'0')}`,lot:body.lot??wafer.lot,title:body.title,owner:body.owner??'未分配',status:'open' as const,severity:body.severity??'medium',hypotheses:[],evidence:[]};investigations.unshift(item);audits.unshift({at:new Date().toISOString(),action:'investigation_created',investigationId:item.id});return item});
app.post('/api/investigations/:id/evidence',async(req)=>{const item=investigations.find(x=>x.id===(req.params as {id:string}).id);if(!item)return {error:'investigation_not_found'};const body=req.body as {source:string;finding:string;hypothesisId?:string;weight?:number};item.evidence.unshift({at:new Date().toISOString(),source:body.source,finding:body.finding,weight:body.weight??.5});if(body.hypothesisId){const h=item.hypotheses.find(x=>x.id===body.hypothesisId);if(h){h.weight=Math.min(.99,+(h.weight+(body.weight??.08)).toFixed(2));h.state=h.weight>.6?'supported':h.state}}item.status='evidence';audits.unshift({at:new Date().toISOString(),action:'investigation_evidence_added',investigationId:item.id});return item});
app.post('/api/experiments',async(req)=>{const body=req.body as {name:string;candidate:{temperature:number;pressure:number;rfPower:number}};const item={id:`DOE-${experiments.length+1}`,name:body.name,lot:wafer.lot,baseline:{temperature:44.1,pressure:19.2,rfPower:813},candidate:body.candidate,status:'draft' as const};experiments.unshift(item);return item});
app.post('/api/experiments/:id/run',async(req)=>{const item=experiments.find(x=>x.id===(req.params as {id:string}).id);if(!item)return {error:'experiment_not_found'};const tempPenalty=Math.abs(item.candidate.temperature-43.6)*.18;const pressurePenalty=Math.abs(item.candidate.pressure-18.9)*.34;const rfPenalty=Math.abs(item.candidate.rfPower-792)*.012;const density=+(1.36+tempPenalty+pressurePenalty+rfPenalty).toFixed(3);item.result={predictedDefectDensity:density,predictedYield:+(96.4-density*.78).toFixed(2),scrapRisk:+Math.min(100,18+density*12).toFixed(1)};item.status='simulated';audits.unshift({at:new Date().toISOString(),action:'doe_simulated',experimentId:item.id});return item});
app.get('/api/traceability/:defectId',async(req)=>{const defect=defects.find(d=>d.id===(req.params as {defectId:string}).defectId);if(!defect)return {error:'defect_not_found'};return {defect,genealogy:[{stage:'来料批次',entity:'WAFER-SUB-A17',at:'2026-09-28T04:00:00Z'},{stage:'CLEAN',entity:'CLEAN-02 / CH-1',at:'2026-09-30T06:20:00Z'},{stage:'ETCH',entity:`${defect.tool} / CH-2`,at:'2026-09-30T07:18:00Z'},{stage:'AOI',entity:'AOI-M2-01',at:'2026-09-30T08:42:00Z'}],relatedLots:processRuns.filter(r=>r.tool===defect.tool).map(r=>({lot:r.lot,chamber:r.chamber,yield:r.yield,status:r.status}))}});
app.post('/api/lots/:lot/disposition',async(req)=>{const lot=(req.params as {lot:string}).lot;const body=req.body as {state:'released'|'hold'|'conditional_release';reason:string};const blocking=investigations.some(i=>i.lot===lot&&i.severity==='high'&&i.status!=='closed');if(body.state==='released'&&blocking)return {ok:false,gate:'blocked',reason:'存在未关闭的高严重度失效模式调查'};const disposition={state:body.state,reason:body.reason,updatedAt:new Date().toISOString()};lotDispositions.set(lot,disposition);audits.unshift({at:new Date().toISOString(),action:'lot_disposition',lot,...disposition});return {ok:true,disposition}});

/* ===================== 审计追踪（独立只读视图，不改变 /api/audit 及任何既有接口） ===================== */
type AuditCategory='defect'|'lot'|'investigation'|'experiment'|'disposition'|'unknown';
type AuditRef={id:string;exists:boolean;label:string;status?:string;kind?:string;severity?:string;data?:unknown};
type AuditEventView={id:string;seq:number;at:string|null;action:string;category:AuditCategory;typeLabel:string;title:string;lot:string|null;refs:{defect?:AuditRef;investigation?:AuditRef;experiment?:AuditRef;lotDisposition?:{lot:string|null;state:string|null;reason:string;updatedAt:string|null}};summary:Record<string,unknown>;unknown:boolean;parseError?:boolean;raw:unknown};
// 交接回看用的历史时间线（仅供 /api/audit-trail 聚合展示，不进入 /api/audit 原数组）
const seedAuditEvents:Array<Record<string,unknown>>=[
  {at:'2026-09-30T08:42:00Z',action:'aoi_scan_completed',lot:wafer.lot,waferId:wafer.id,candidateCount:defects.length},
  {at:'2026-09-30T08:56:00Z',action:'defect_review',defectId:'D-014',review:'confirmed',operator:'质量工程师'},
  {at:'2026-09-30T09:05:00Z',action:'defect_review',defectId:'D-032',review:'false_positive',operator:'质量工程师'},
  {at:'2026-09-30T09:08:00Z',action:'investigation_created',investigationId:'INV-024',lot:wafer.lot},
  {at:'2026-09-30T09:10:00Z',action:'lot_hold',lot:wafer.lot,reason:'高风险线性缺陷待失效模式确认',operator:'工艺工程师'},
  {at:'2026-09-30T09:24:00Z',action:'investigation_evidence_added',investigationId:'INV-024',operator:'工艺整合工程师'},
  {at:'2026-09-30T10:40:00Z',action:'doe_simulated',experimentId:'DOE-1',operator:'工艺整合工程师'},
  {at:'2026-09-30T10:52:00Z',action:'rule_engine_flagged',lot:wafer.lot,rule:'R-117',score:.91}
];
const seedSeqs=seedAuditEvents.map((_,i)=>-(seedAuditEvents.length-i));
// 为实时事件分配稳定序列号：同一时间戳的事件也能得到确定性排序；不修改事件对象本身
const liveEventSeq=new WeakMap<object,number>();let liveSeqNext=1;
function touchLiveSeqs(){for(let i=audits.length-1;i>=0;i--){const e=audits[i];if(!liveEventSeq.has(e))liveEventSeq.set(e,liveSeqNext++);}}
const auditTypeRegistry:Record<string,{label:string;category:AuditCategory}>={
  defect_review:{label:'缺陷复核',category:'defect'},
  lot_hold:{label:'批次暂停',category:'lot'},
  investigation_created:{label:'调查创建',category:'investigation'},
  investigation_evidence_added:{label:'证据补充',category:'investigation'},
  doe_simulated:{label:'实验模拟',category:'experiment'},
  lot_disposition:{label:'批次处置',category:'disposition'}
};
const dispositionStateLabel:Record<string,string>={released:'放行',hold:'暂停扣留',conditional_release:'附条件放行'};
const reviewLabel:Record<string,string>={confirmed:'确认缺陷',false_positive:'标记误报'};
// 序列号→稳定ID：实时事件（正序）AE-000xxx，种子历史事件（负序）AH-000xxx，绝不碰撞
function auditEventId(seq:number){return `${seq>0?'AE':'AH'}-${String(Math.abs(seq)).padStart(6,'0')}`;}
function normalizeAuditEvent(ev:unknown,seq:number):AuditEventView{
  const fallback=(parseError:boolean):AuditEventView=>({id:auditEventId(seq),seq,at:null,action:'unknown',category:'unknown',typeLabel:'未知事件类型',title:'无法解析的审计事件',lot:null,refs:{},summary:{},unknown:true,parseError,raw:ev});
  try{
    if(typeof ev!=='object'||ev===null)return fallback(true);
    const e=ev as Record<string,unknown>;
    const rawAt=e.at;
    const at=typeof rawAt==='string'&&!Number.isNaN(Date.parse(rawAt))?rawAt:null;
    const action=typeof e.action==='string'&&e.action.trim()?e.action:'unknown';
    const reg=auditTypeRegistry[action];
    const unknown=!reg;
    const str=(k:string)=>typeof e[k]==='string'?(e[k] as string):undefined;
    const defectId=str('defectId'),investigationId=str('investigationId'),experimentId=str('experimentId');
    let lot=str('lot');
    const refs:AuditEventView['refs']={};
    if(defectId){const d=defects.find(x=>x.id===defectId);if(d){lot??=d.lot;
      // 复核事件的状态以事件发生时的载荷为准（当前对象状态可能已被后续操作改变）
      const reviewAtEvent=action==='defect_review'&&typeof e.review==='string'?(e.review as string):d.review;
      refs.defect={id:d.id,exists:true,label:`缺陷 ${d.id}`,status:reviewAtEvent,kind:d.kind,severity:d.severity,data:reviewAtEvent===d.review?d:{...d,review:reviewAtEvent}};
    }else refs.defect={id:defectId,exists:false,label:`缺陷 ${defectId}（不存在或已归档）`};}
    if(investigationId){const inv=investigations.find(x=>x.id===investigationId);if(inv){lot??=inv.lot;refs.investigation={id:inv.id,exists:true,label:inv.title,status:inv.status,severity:inv.severity,data:inv};}else refs.investigation={id:investigationId,exists:false,label:`调查 ${investigationId}（不存在或已归档）`};}
    if(experimentId){const exp=experiments.find(x=>x.id===experimentId);if(exp){lot??=exp.lot;refs.experiment={id:exp.id,exists:true,label:exp.name,status:exp.status,data:exp};}else refs.experiment={id:experimentId,exists:false,label:`实验 ${experimentId}（不存在或已归档）`};}
    if(action==='lot_hold')refs.lotDisposition={lot:lot??null,state:'hold',reason:typeof e.reason==='string'?e.reason:'',updatedAt:at};
    if(action==='lot_disposition')refs.lotDisposition={lot:lot??null,state:str('state')??null,reason:typeof e.reason==='string'?e.reason:'',updatedAt:str('updatedAt')??at};
    let title:string;
    switch(action){
      case 'defect_review':title=`缺陷 ${defectId??'?'} 复核：${reviewLabel[e.review as string]??String(e.review??'未知状态')}`;break;
      case 'lot_hold':title=`批次 ${lot??'?'} 暂停`;break;
      case 'investigation_created':title=`创建调查 ${investigationId??'?'}`;break;
      case 'investigation_evidence_added':title=`调查 ${investigationId??'?'} 新增证据`;break;
      case 'doe_simulated':title=`实验 ${experimentId??'?'} 完成工艺模拟`;break;
      case 'lot_disposition':title=`批次 ${lot??'?'} 处置：${dispositionStateLabel[e.state as string]??String(e.state??'未知')}`;break;
      default:title=action==='unknown'?'未知审计事件':`未知事件：${action}`;
    }
    const summary:Record<string,unknown>={};
    for(const [k,v] of Object.entries(e)){if(['at','action','defectId','investigationId','experimentId'].includes(k))continue;if(v===null||['string','number','boolean'].includes(typeof v))summary[k]=v;}
    return {id:auditEventId(seq),seq,at,action,category:reg?.category??'unknown',typeLabel:reg?.label??'未知事件类型',title,lot:lot??null,refs,summary,unknown,raw:e};
  }catch{return fallback(true);}
}
function auditCmp(a:AuditEventView,b:AuditEventView){if(a.at===null&&b.at===null)return b.seq-a.seq;if(a.at===null)return 1;if(b.at===null)return -1;if(a.at!==b.at)return a.at<b.at?1:-1;return b.seq-a.seq;}
app.get('/api/audit-trail',async(req)=>{
  const q=req.query as Record<string,string|undefined>;
  touchLiveSeqs();
  const merged:[unknown,number][]=[...audits.map(e=>[e,liveEventSeq.get(e)!] as [unknown,number]),...seedAuditEvents.map((e,i)=>[e,seedSeqs[i]] as [unknown,number])];
  let rows=merged.map(([e,seq])=>normalizeAuditEvent(e,seq));
  if(q.lot)rows=rows.filter(r=>r.lot===q.lot);
  if(q.type)rows=rows.filter(r=>q.type==='__unknown__'?r.unknown:r.action===q.type);
  if(q.from){const f=Date.parse(q.from);if(!Number.isNaN(f))rows=rows.filter(r=>r.at!==null&&Date.parse(r.at)>=f);}
  if(q.to){const t=Date.parse(q.to);if(!Number.isNaN(t))rows=rows.filter(r=>r.at!==null&&Date.parse(r.at)<=t);}
  rows.sort(auditCmp);
  const typeMap=new Map<string,{action:string;label:string;category:AuditCategory;unknown:boolean;count:number}>();
  for(const r of rows){const key=r.unknown?'__unknown__':r.action;const cur=typeMap.get(key);if(cur)cur.count++;else typeMap.set(key,{action:key,label:r.unknown?'未知事件类型':r.typeLabel,category:r.category,unknown:r.unknown,count:1});}
  const total=rows.length;
  const offset=Math.max(0,Number(q.offset)||0);
  const limit=Math.min(200,Math.max(1,Number(q.limit)||50));
  return {
    events:rows.slice(offset,offset+limit),total,offset,limit,
    latestSeq:merged.length?Math.max(...merged.map(([,s])=>s)):0,
    generatedAt:new Date().toISOString(),
    filters:{lots:[...new Set(rows.map(r=>r.lot).filter((x):x is string=>!!x))].sort(),types:[...typeMap.values()].sort((a,b)=>b.count-a.count)}
  };
});

await app.listen({host:'127.0.0.1',port:6201});
