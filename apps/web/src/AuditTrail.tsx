import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';

type AuditCategory='defect'|'hold'|'investigation'|'experiment'|'disposition'|'unknown';
type SubjectKind='defect'|'investigation'|'experiment'|'lot'|'unknown';
type TrailEvent={
  seq:number;at:string;action:string;type:string;typeLabel:string;
  category:AuditCategory;lot:string|null;summary:string;
  subject:{kind:SubjectKind;id:string|null;label:string}|null;
  raw:Record<string,unknown>;
};
type TrailResponse={events:TrailEvent[];types:Array<{key:string;label:string;category:AuditCategory}>;lots:string[];latestSeq:number;total:number};
type Preset='all'|'24h'|'7d';

const api=async(url:string,init?:RequestInit)=>fetch(url,init).then(r=>r.json());
const categoryNames:Record<AuditCategory,string>={defect:'缺陷复核',hold:'批次暂停',investigation:'调查',experiment:'试验',disposition:'处置',unknown:'未知'};
const categoryClass:Record<AuditCategory,string>={defect:'catDefect',hold:'catHold',investigation:'catInvestigation',experiment:'catExperiment',disposition:'catDisposition',unknown:'catUnknown'};

function formatAt(at:string){
  const d=new Date(at);
  if(Number.isNaN(d.getTime()))return at;
  const p=(n:number)=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function isoLocal(d:Date){
  const p=(n:number)=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function presetRange(preset:Preset){
  if(preset==='all')return {from:'',to:''};
  const to=new Date();
  const from=new Date(to.getTime()-(preset==='24h'?24:7*24)*3600*1000);
  return {from:isoLocal(from),to:isoLocal(to)};
}

export function AuditTrail({onOpenDefect}:{onOpenDefect:(id:string)=>void}){
  const [events,setEvents]=useState<TrailEvent[]>([]);
  const [types,setTypes]=useState<TrailResponse['types']>([]);
  const [lots,setLots]=useState<string[]>([]);
  const [lot,setLot]=useState('all');
  const [type,setType]=useState('all');
  const [preset,setPreset]=useState<Preset>('all');
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [lastUpdated,setLastUpdated]=useState<Date|null>(null);
  const [newCount,setNewCount]=useState(0);
  const [cursor,setCursor]=useState(0);
  const [selected,setSelected]=useState<TrailEvent|null>(null);
  const reqSeq=useRef(0);
  const inflightRef=useRef(false);

  const queryString=useCallback(()=>{
    const p=new URLSearchParams();
    if(lot!=='all')p.set('lot',lot);
    if(type!=='all')p.set('type',type);
    if(from)p.set('from',new Date(from).toISOString());
    if(to)p.set('to',new Date(to).toISOString());
    return p.toString();
  },[lot,type,from,to]);

  // 全量刷新（筛选变化或手动刷新）
  const reload=useCallback(async(opts?:{silent?:boolean})=>{
    const id=++reqSeq.current;
    if(!opts?.silent)setLoading(true);
    setError('');
    try{
      const data:TrailResponse=await api(`/api/audit/trail?${queryString()}`);
      if(id!==reqSeq.current)return;
      setEvents(data.events);
      setTypes(data.types);
      setLots(data.lots);
      setCursor(data.latestSeq);
      setNewCount(0);
      setLastUpdated(new Date());
    }catch{
      if(id===reqSeq.current)setError('审计追踪加载失败，请稍后重试');
    }finally{
      if(id===reqSeq.current)setLoading(false);
    }
  },[queryString]);

  useEffect(()=>{reload()},[reload]);

  // 增量轮询：仅取 seq 之后的新事件并按稳定顺序合并，刷新页面后新事件不会丢失
  useEffect(()=>{
    const poll=async()=>{
      if(inflightRef.current)return;
      inflightRef.current=true;
      try{
        const p=new URLSearchParams();
        if(lot!=='all')p.set('lot',lot);
        if(type!=='all')p.set('type',type);
        if(from)p.set('from',new Date(from).toISOString());
        if(to)p.set('to',new Date(to).toISOString());
        p.set('sinceSeq',String(cursor));
        const data:TrailResponse=await api(`/api/audit/trail?${p.toString()}`);
        if(data.latestSeq>cursor){
          setCursor(data.latestSeq);
          if(data.events.length){
            setNewCount(n=>n+data.events.length);
            setEvents(prev=>{
              const seen=new Set(prev.map(e=>e.seq));
              const merged=[...prev,...data.events.filter(e=>!seen.has(e.seq))];
              merged.sort((a,b)=>a.at<b.at?1:a.at>b.at?-1:b.seq-a.seq);
              return merged;
            });
            setLastUpdated(new Date());
          }
        }
      }catch{
        /* 轮询失败保持当前列表，下一轮重试 */
      }finally{
        inflightRef.current=false;
      }
    };
    const timer=setInterval(poll,10000);
    const onVisible=()=>{if(document.visibilityState==='visible')poll()};
    document.addEventListener('visibilitychange',onVisible);
    return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',onVisible)};
  },[cursor,lot,type,from,to]);

  const changePreset=(p:Preset)=>{setPreset(p);const r=presetRange(p);setFrom(r.from);setTo(r.to)};

  return <section className="auditPage">
    <div className="panel auditFilters">
      <div className="panelHead"><h2>审计追踪</h2><span>设备异常交接决策时间线 · 只读，不改变任何业务结果</span></div>
      <div className="filterRow">
        <label>批次
          <select value={lot} onChange={e=>setLot(e.target.value)}>
            <option value="all">全部批次</option>
            {lots.map(l=><option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label>事件类型
          <select value={type} onChange={e=>setType(e.target.value)}>
            <option value="all">全部类型</option>
            {types.map(t=><option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        <label>时间范围
          <div className="presets">{([['all','全部'],['24h','近24小时'],['7d','近7天']] as Array<[Preset,string]>).map(([p,label])=><button key={p} className={preset===p?'active':''} onClick={()=>changePreset(p)}>{label}</button>)}</div>
        </label>
        <label className="dt">开始 <input type="datetime-local" value={from} onChange={e=>{setPreset('all');setFrom(e.target.value)}}/></label>
        <label className="dt">结束 <input type="datetime-local" value={to} onChange={e=>{setPreset('all');setTo(e.target.value)}}/></label>
        <button className="refreshBtn" onClick={()=>reload()}>刷新</button>
      </div>
      <div className="auditMeta">
        <span>共 {events.length} 条事件{newCount>0?<em className="newBadge">{newCount} 条新增</em>:null}</span>
        <span>{loading?'加载中…':lastUpdated?`上次更新 ${formatAt(lastUpdated.toISOString())}`:''}</span>
      </div>
      {error&&<div className="auditError">{error}</div>}
    </div>
    <div className="panel auditList">
      {!loading&&events.length===0&&<div className="empty">当前筛选条件下没有审计事件</div>}
      {events.map(e=><div className="auditRow" key={e.seq} onClick={()=>setSelected(e)}>
        <div className="auditTime"><span>{formatAt(e.at)}</span><small>seq #{e.seq}</small></div>
        <span className={`auditCat ${categoryClass[e.category]}`}>{e.category==='unknown'?e.typeLabel:categoryNames[e.category]}</span>
        <div className="auditMain"><b>{e.typeLabel}</b><small>{e.summary}</small>{e.lot&&<small className="auditLot">批次 {e.lot}</small>}</div>
        <div className="auditSubject">{e.subject?<><span className={categoryClass[e.category]}>{e.subject.label}</span><em>查看详情 →</em></>:<em>无关联对象 →</em>}</div>
      </div>)}
    </div>
    {selected&&<EventDrawer event={selected} onClose={()=>setSelected(null)} onOpenDefect={onOpenDefect}/>}
  </section>;
}

function DrawerSection({title,children}:{title:string;children:ReactNode}){
  return <div className="drawerSection"><h3>{title}</h3>{children}</div>;
}
function KV({data}:{data:Record<string,unknown>}){
  return <div className="kv">{Object.entries(data).map(([k,v])=><div key={k}><span>{k}</span><b>{v===null||v===undefined?'—':typeof v==='object'?JSON.stringify(v):String(v)}</b></div>)}</div>;
}

function EventDrawer({event,onClose,onOpenDefect}:{event:TrailEvent;onClose:()=>void;onOpenDefect:(id:string)=>void}){
  const [detail,setDetail]=useState<Record<string,unknown>|null>(null);
  const [loadingDetail,setLoadingDetail]=useState(false);
  const [detailError,setDetailError]=useState('');
  const s=event.subject;

  useEffect(()=>{
    setDetail(null);setDetailError('');
    if(!s||!s.id||s.kind==='unknown')return;
    let cancelled=false;
    setLoadingDetail(true);
    const url=s.kind==='defect'?`/api/traceability/${encodeURIComponent(s.id)}`
      :s.kind==='investigation'?`/api/investigations/${encodeURIComponent(s.id)}`
      :s.kind==='experiment'?`/api/experiments/${encodeURIComponent(s.id)}`
      :`/api/lots/${encodeURIComponent(s.id)}/disposition`;
    api(url).then(d=>{if(!cancelled){if(d?.error)setDetailError(d.error);else setDetail(d)}})
      .catch(()=>{if(!cancelled)setDetailError('详情加载失败')})
      .finally(()=>{if(!cancelled)setLoadingDetail(false)});
    return ()=>{cancelled=true};
  },[event,s]);

  const defect=detail?.defect as Record<string,unknown>|undefined;
  const investigations=detail?.investigations as Array<Record<string,unknown>>|undefined;
  const hypotheses=detail?.hypotheses as Array<Record<string,unknown>>|undefined;
  const evidence=detail?.evidence as Array<Record<string,unknown>>|undefined;
  const result=detail?.result as Record<string,number>|undefined;
  const candidate=detail?.candidate as Record<string,number>|undefined;
  const baseline=detail?.baseline as Record<string,number>|undefined;

  return <div className="drawerMask" onClick={onClose}>
    <aside className="drawer" onClick={e=>e.stopPropagation()}>
      <div className="drawerHead">
        <div><span className="eyebrow">AUDIT EVENT / SEQ #{event.seq}</span><h2>{event.typeLabel}</h2><p>{formatAt(event.at)} · {event.action}{event.lot?` · 批次 ${event.lot}`:''}</p></div>
        <button className="ghost" onClick={onClose}>关闭</button>
      </div>
      <DrawerSection title="事件摘要"><p className="drawerSummary">{event.summary}</p></DrawerSection>

      {s?.kind==='defect'&&<DrawerSection title="关联缺陷">
        {loadingDetail&&<p>加载缺陷详情…</p>}
        {detailError&&<p className="auditError">{detailError==='defect_not_found'?'缺陷不存在或已被移除':detailError}</p>}
        {defect&&<KV data={{编号:defect.id,类型:defect.kind,严重度:defect.severity,评分:defect.score,工序:defect.step,设备:defect.tool,复核状态:defect.review,备注:defect.note}}/>}
        {s.id&&<div className="actions"><button onClick={()=>{const id=s.id;if(id)onOpenDefect(id)}}>跳转到缺陷复核</button></div>}
      </DrawerSection>}

      {s?.kind==='investigation'&&<DrawerSection title="关联调查">
        {loadingDetail&&<p>加载调查详情…</p>}
        {detailError&&<p className="auditError">{detailError==='investigation_not_found'?'调查不存在':detailError}</p>}
        {detail&&<>
          <KV data={{编号:detail.id,批次:detail.lot,标题:detail.title,负责人:detail.owner,状态:detail.status,严重度:detail.severity}}/>
          {!!hypotheses?.length&&<div className="subList"><h4>假设</h4>{hypotheses.map((h,i)=><div key={i} className="subRow"><b>{String(h.cause)}</b><span>权重 {String(h.weight)} · {String(h.state)}</span></div>)}</div>}
          {!!evidence?.length&&<div className="subList"><h4>证据</h4>{evidence.map((v,i)=><div key={i} className="subRow"><b>{String(v.finding)}</b><span>{String(v.source)} · {formatAt(String(v.at))}</span></div>)}</div>}
        </>}
      </DrawerSection>}

      {s?.kind==='experiment'&&<DrawerSection title="关联实验">
        {loadingDetail&&<p>加载实验详情…</p>}
        {detailError&&<p className="auditError">{detailError==='experiment_not_found'?'实验不存在（可能创建于其它会话）':detailError}</p>}
        {detail&&<>
          <KV data={{编号:detail.id,名称:detail.name,批次:detail.lot,状态:detail.status}}/>
          {baseline&&candidate&&<div className="subList"><h4>参数对比</h4>
            {(['temperature','pressure','rfPower'] as const).map(k=><div key={k} className="subRow"><b>{k}</b><span>{baseline[k]} → {candidate[k]}</span></div>)}
          </div>}
          {result&&<KV data={{预测缺陷密度:result.predictedDefectDensity,预测良率:`${result.predictedYield}%`,报废风险:`${result.scrapRisk}%`}}/>}
        </>}
      </DrawerSection>}

      {s?.kind==='lot'&&<DrawerSection title="关联批次处置">
        {loadingDetail&&<p>加载处置详情…</p>}
        {detailError&&<p className="auditError">{detailError==='lot_disposition_not_found'?'该批次暂无处置记录':detailError}</p>}
        {detail&&<>
          <KV data={{批次:detail.lot,状态:detail.state,原因:detail.reason,更新时间:detail.updatedAt?formatAt(String(detail.updatedAt)):'—'}}/>
          {!!investigations?.length&&<div className="subList"><h4>相关调查</h4>{investigations.map(i=><div key={String(i.id)} className="subRow"><b>{String(i.id)} · {String(i.title)}</b><span>{String(i.status)} · 严重度 {String(i.severity)}</span></div>)}</div>}
        </>}
      </DrawerSection>}

      {event.category==='unknown'&&<DrawerSection title="未知事件">
        <p className="auditError">该事件类型未被当前版本识别，已保留原始载荷用于追溯。</p>
      </DrawerSection>}

      <DrawerSection title="原始事件数据"><pre className="rawJson">{JSON.stringify(event.raw,null,2)}</pre></DrawerSection>
    </aside>
  </div>;
}
