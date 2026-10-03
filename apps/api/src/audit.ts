// 审计追踪独立模块：
// - seq 为单调递增序号，作为同一毫秒内事件的稳定排序依据
// - 事件类型由注册表描述；未登记的 action 统一归类为 unknown，不丢弃、不影响其它事件
export type AuditCategory='defect'|'hold'|'investigation'|'experiment'|'disposition'|'unknown';
export type AuditSubjectKind='defect'|'investigation'|'experiment'|'lot'|'unknown';
export type AuditSubject={kind:AuditSubjectKind;id:string|null;label:string};
export type AuditEntry={seq:number;at:string;action:string;[key:string]:unknown};
export type AuditTypeDef={
  key:string;
  label:string;
  category:AuditCategory;
  describe:(e:AuditEntry)=>{lot?:string|null;summary:string;subject?:AuditSubject|null};
};
export type TrailEvent={
  seq:number;
  at:string;
  action:string;
  type:string;
  typeLabel:string;
  category:AuditCategory;
  lot:string|null;
  summary:string;
  subject:AuditSubject|null;
  raw:Record<string,unknown>;
};
export type TrailQuery={
  lot?:string;
  type?:string;
  from?:string;
  to?:string;
  sinceSeq?:number;
  order?:'asc'|'desc';
  limit?:number;
};
export type TrailResponse={
  events:TrailEvent[];
  types:Array<{key:string;label:string;category:AuditCategory}>;
  lots:string[];
  latestSeq:number;
  total:number;
};

// 稳定排序：先按事件时间，再按入库序号；同毫秒事件的先后由此固定
function compareByTimeThenSeq(a:{at:string;seq:number},b:{at:string;seq:number}):number{
  return a.at<b.at?1:a.at>b.at?-1:b.seq-a.seq;
}
function stripSeq(e:AuditEntry):Record<string,unknown>{
  const {seq: _seq,...rest}=e;
  return rest;
}
function toTrailEvent(e:AuditEntry,registry:Record<string,AuditTypeDef>):TrailEvent{
  const raw=stripSeq(e);
  const def=registry[e.action];
  if(!def){
    // 未知事件：保留原始载荷，保证刷新与筛选时仍可追溯
    return {seq:e.seq,at:e.at,action:e.action,type:'unknown',typeLabel:`未知事件 · ${e.action||'(missing action)'}`,category:'unknown',lot:typeof e.lot==='string'?e.lot:null,summary:`未登记的事件类型（${e.action||'unknown'}），请检查服务端版本`,subject:null,raw};
  }
  let info:{lot?:string|null;summary:string;subject?:AuditSubject|null};
  try{
    info=def.describe(e);
  }catch{
    info={lot:typeof e.lot==='string'?e.lot:null,summary:`${def.label}（关联信息解析失败）`,subject:null};
  }
  return {seq:e.seq,at:e.at,action:e.action,type:def.key,typeLabel:def.label,category:def.category,lot:info.lot??null,summary:info.summary,subject:info.subject??null,raw};
}

export function createAuditStore(){
  let nextSeq=0;
  const entries:AuditEntry[]=[];
  function record(action:string,payload:Record<string,unknown>={},at?:string):AuditEntry{
    const entry:AuditEntry={seq:++nextSeq,at:at??new Date().toISOString(),action,...payload};
    entries.push(entry);
    return entry;
  }
  function rawList():Array<Record<string,unknown>>{
    // 与历史 unshift 行为一致：最新事件在前，同毫秒按入库倒序
    return [...entries].sort(compareByTimeThenSeq).map(stripSeq);
  }
  function latestSeq():number{return entries.length?entries[entries.length-1].seq:0;}
  function trail(query:TrailQuery,registry:Record<string,AuditTypeDef>):TrailResponse{
    const all=entries.map(e=>toTrailEvent(e,registry));
    let events=all;
    if(query.lot)events=events.filter(e=>e.lot===query.lot);
    if(query.type&&query.type!=='all')events=events.filter(e=>e.type===query.type);
    if(query.from)events=events.filter(e=>e.at>=query.from!);
    if(query.to)events=events.filter(e=>e.at<=query.to!);
    if(typeof query.sinceSeq==='number')events=events.filter(e=>e.seq>query.sinceSeq!);
    events.sort(compareByTimeThenSeq);
    if(query.order==='asc')events.reverse();
    const limit=Math.max(1,Math.min(500,query.limit??200));
    const types=Object.values(registry).map(d=>({key:d.key,label:d.label,category:d.category}));
    if(entries.some(e=>!registry[e.action]))types.push({key:'unknown',label:'未知事件',category:'unknown'});
    const lots=[...new Set(all.map(e=>e.lot).filter((l):l is string=>!!l))].sort();
    return {events:events.slice(0,limit),types,lots,latestSeq:latestSeq(),total:events.length};
  }
  return {record,rawList,trail,latestSeq,size:()=>entries.length};
}
export type AuditStore=ReturnType<typeof createAuditStore>;
