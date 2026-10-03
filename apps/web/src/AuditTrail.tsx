import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
type RefObj={id:string;exists:boolean;label:string;status?:string;kind?:string;severity?:string;data?:any};
type AuditEvent={id:string;seq:number;at:string|null;action:string;category:'defect'|'lot'|'investigation'|'experiment'|'disposition'|'unknown';typeLabel:string;title:string;lot:string|null;refs:{defect?:RefObj;investigation?:RefObj;experiment?:RefObj;lotDisposition?:{lot:string|null;state:string|null;reason:string;updatedAt:string|null}};summary:Record<string,unknown>;unknown:boolean;parseError?:boolean;raw:unknown};
type TrailResp={events:AuditEvent[];total:number;offset:number;limit:number;latestSeq:number;generatedAt:string;filters:{lots:string[];types:Array<{action:string;label:string;category:string;unknown:boolean;count:number}>}};
const PAGE=50;
const catColor:Record<string,string>={defect:'badge-defect',lot:'badge-lot',investigation:'badge-inv',experiment:'badge-exp',disposition:'badge-disp',unknown:'badge-unknown'};
const statusLabel:Record<string,string>={unreviewed:'待复核',confirmed:'已确认',false_positive:'误报',open:'待调查',evidence:'取证中',contained:'已遏制',closed:'已关闭',draft:'草稿',simulated:'已模拟',approved:'已批准',released:'放行',hold:'暂停扣留',conditional_release:'附条件放行',watch:'观察',normal:'正常'};
const fmt=(at:string|null)=>!at?'时间缺失':new Date(at).toLocaleString('zh-CN',{hour12:false});
const summaryLabel:Record<string,string>={review:'复核结果',reason:'原因',state:'处置状态',operator:'操作人',note:'备注',rule:'规则',score:'评分',waferId:'晶圆',candidateCount:'候选缺陷数'};
const api=async(url:string,init?:RequestInit)=>fetch(url,init).then(r=>r.json());

export default function AuditTrail({jumpDefect}:{jumpDefect:(id:string)=>void}){
  const [lot,setLot]=useState('');const [type,setType]=useState('');const [from,setFrom]=useState('');const [to,setTo]=useState('');
  const [events,setEvents]=useState<AuditEvent[]>([]);const [meta,setMeta]=useState<TrailResp['filters']>({lots:[],types:[]});const [total,setTotal]=useState(0);
  const [shown,setShown]=useState(PAGE);const [loading,setLoading]=useState(false);const [lastRefresh,setLastRefresh]=useState<string>('');const [newHint,setNewHint]=useState(0);
  const [selected,setSelected]=useState<AuditEvent>();const [auto,setAuto]=useState(true);
  const firstLoad=useRef(true);
  const qs=useCallback(()=>{const p=new URLSearchParams();if(lot)p.set('lot',lot);if(type)p.set('type',type);if(from)p.set('from',new Date(from).toISOString());if(to)p.set('to',new Date(to).toISOString());p.set('limit','200');return '/api/audit-trail?'+p.toString();},[lot,type,from,to]);

  // 筛选变化 / 首次加载：完整重载
  useEffect(()=>{
    let cancelled=false;setLoading(true);
    api(qs()).then((d:TrailResp)=>{if(cancelled)return;setEvents(d.events);setMeta(d.filters);setTotal(d.total);setShown(PAGE);setLastRefresh(d.generatedAt);
      firstLoad.current=false;setNewHint(0);})
      .finally(()=>!cancelled&&setLoading(false));
    return()=>{cancelled=true;};
  },[qs]);

  // 自动刷新：服务端稳定排序后做合并，刷新后新增事件置顶且不丢已有选择
  useEffect(()=>{if(!auto)return;const t=setInterval(async()=>{
    const d:TrailResp=await api(qs());setMeta(d.filters);setTotal(d.total);setLastRefresh(d.generatedAt);
    setEvents(prev=>{const known=new Map(prev.map(e=>[e.seq,e]));const incoming=d.events.filter(e=>!known.has(e.seq));incoming.forEach(e=>known.set(e.seq,e));
      if(!firstLoad.current&&incoming.length)setNewHint(n=>n+incoming.length);
      const all=[...known.values()];all.sort((a,b)=>!a.at||!b.at?(a.at?1:b.at?1:b.seq-a.seq):a.at<b.at?1:a.at>b.at?-1:b.seq-a.seq);return all;});
  },10000);return()=>clearInterval(t);},[auto,qs]);

  const refresh=useCallback(async()=>{setLoading(true);try{const d:TrailResp=await api(qs());setEvents(d.events);setMeta(d.filters);setTotal(d.total);setShown(PAGE);setLastRefresh(d.generatedAt);setNewHint(0);}finally{setLoading(false);}}, [qs]);
  const reset=()=>{setLot('');setType('');setFrom('');setTo('');};
  const visible=useMemo(()=>events.slice(0,shown),[events,shown]);
  const refsOf=(e:AuditEvent):Array<{kind:string;ref:RefObj|{lot:string|null;state:string|null;reason:string;updatedAt:string|null}}>=>{const out:any[]=[];if(e.refs.defect)out.push({kind:'defect',ref:e.refs.defect});if(e.refs.investigation)out.push({kind:'investigation',ref:e.refs.investigation});if(e.refs.experiment)out.push({kind:'experiment',ref:e.refs.experiment});if(e.refs.lotDisposition)out.push({kind:'lotDisposition',ref:e.refs.lotDisposition});return out;};

  return <section className="grid2 auditPage">
    <div className="panel">
      <div className="panelHead"><h2>审计追踪时间线</h2><span>缺陷复核 · 批次暂停 · 调查 · 实验 · 处置</span></div>
      <div className="auditFilters">
        <select value={lot} onChange={e=>setLot(e.target.value)}><option value="">全部批次</option>{meta.lots.map(l=><option key={l} value={l}>{l}</option>)}</select>
        <select value={type} onChange={e=>setType(e.target.value)}><option value="">全部事件类型</option>{meta.types.map(t=><option key={t.action} value={t.action}>{t.label}（{t.count}）</option>)}</select>
        <input type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)} title="起始时间"/>
        <input type="datetime-local" value={to} onChange={e=>setTo(e.target.value)} title="结束时间"/>
        <button onClick={reset} className="ghost">重置</button>
        <button onClick={refresh} disabled={loading}>{loading?'加载中…':'刷新'}</button>
        <label className="autoLabel"><input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)}/>自动刷新</label>
      </div>
      <div className="auditMeta"><span>共 {total} 个事件 · 每页 {PAGE} · 上次刷新 {lastRefresh?new Date(lastRefresh).toLocaleTimeString('zh-CN',{hour12:false}):'—'}</span>{newHint>0&&<button className="newHint" onClick={refresh}>有 {newHint} 个新事件，点击查看</button>}</div>
      <ol className="timeline">
        {visible.map(e=><li key={e.id} className={selected?.id===e.id?'active':''} onClick={()=>setSelected(e)}>
          <div className="tlDot"><i className={catColor[e.category]}/></div>
          <div className="tlBody">
            <div className="tlHead"><span className={`badge ${catColor[e.category]}`}>{e.typeLabel}</span>{e.unknown&&<span className="badge badge-unknown">未注册类型</span>}<b>{e.title}</b></div>
            <div className="tlSub"><span>{fmt(e.at)}</span>{e.lot&&<span className="chip chip-lot">{e.lot}</span>}{refsOf(e).map(({kind,ref})=>{const r=ref as RefObj;return <span key={kind} className={`chip ${r.exists===false?'chipMissing':'chip-'+kind}`} onClick={ev=>{ev.stopPropagation();if(kind==='defect'&&r.exists){jumpDefect(r.id);setSelected(undefined);}}}>
              {kind==='lotDisposition'?`处置 ${(ref as any).lot??''} · ${statusLabel[(ref as any).state??'']??(ref as any).state??''}`:r.label}{r.exists===false?' 🔒':''}{kind==='defect'&&r.exists?' ↗':''}
            </span>;})}</div>
          </div>
        </li>)}
      </ol>
      {events.length===0&&!loading&&<div className="empty">当前筛选条件下没有审计事件</div>}
      {shown<events.length&&<div className="loadMore"><button onClick={()=>setShown(s=>s+PAGE)}>加载更多（剩余 {events.length-shown}）</button></div>}
    </div>

    <div className="panel detail">
      {selected?<EventDetail e={selected} jumpDefect={(id)=>{jumpDefect(id);setSelected(undefined);}}/>:<div className="empty">选择时间线上的事件查看审计详情与关联对象</div>}
    </div>
  </section>;
}

function EventDetail({e,jumpDefect}:{e:AuditEvent;jumpDefect:(id:string)=>void}){
  const d=e.refs.defect,inv=e.refs.investigation,exp=e.refs.experiment,disp=e.refs.lotDisposition;
  return <>
    <span className="eyebrow">AUDIT EVENT / {e.id}</span>
    <h2>{e.title}</h2>
    <p>{fmt(e.at)}{e.lot?` · 批次 ${e.lot}`:''}{e.parseError?' · 事件数据解析异常':''}</p>
    {e.unknown&&<div className="warnBox">该事件动作 <code>{e.action}</code> 未在事件注册表中登记，已按未知事件类型归档；原始数据仍可追溯，不影响时间线加载。</div>}
    <div className="refCards">
      {d&&(d.exists?<div className="refCard"><small>关联缺陷</small><b>{d.id}</b><span>类型 {d.kind} · 严重度 <i className={d.severity==='high'?'high':d.severity==='medium'?'medium':'low'}>{d.severity}</i> · 复核 {statusLabel[d.status??'']??d.status}</span><button onClick={()=>jumpDefect(d.id)}>前往缺陷复核 ↗</button></div>:<MissingRef label={d.label}/>)}
      {inv&&(inv.exists?<div className="refCard"><small>关联调查</small><b>{inv.data.title}</b><span>{inv.id} · 负责人 {inv.data.owner} · 状态 {statusLabel[inv.data.status]??inv.data.status} · 严重度 {inv.data.severity}</span><em>假设 {inv.data.hypotheses.length} 条 · 证据 {inv.data.evidence.length} 条</em>{inv.data.hypotheses.map((h:any)=><div className="miniRow" key={h.id}><span>{h.cause}</span><i className={'hyp-'+h.state}>{statusLabel[h.state]??h.state} · 权重 {h.weight}</i></div>)}{inv.data.evidence.slice(0,3).map((v:any,i:number)=><div className="miniRow muted" key={i}><span>{v.source}：{v.finding}</span><small>{new Date(v.at).toLocaleString('zh-CN',{hour12:false})}</small></div>)}</div>:<MissingRef label={inv.label}/>)}
      {exp&&(exp.exists?<div className="refCard"><small>关联实验</small><b>{exp.data.name}</b><span>{exp.id} · 状态 {statusLabel[exp.data.status]??exp.data.status} · 批次 {exp.data.lot}</span><div className="miniRow muted"><span>基线 T/P/RF：{exp.data.baseline.temperature}°C · {exp.data.baseline.pressure} Torr · {exp.data.baseline.rfPower}W</span></div><div className="miniRow muted"><span>候选 T/P/RF：{exp.data.candidate.temperature}°C · {exp.data.candidate.pressure} Torr · {exp.data.candidate.rfPower}W</span></div>{exp.data.result&&<em>预测缺陷密度 {exp.data.result.predictedDefectDensity} · 预测良率 {exp.data.result.predictedYield}% · 报废风险 {exp.data.result.scrapRisk}%</em>}</div>:<MissingRef label={exp.label}/>)}
      {disp&&<div className="refCard"><small>关联批次处置</small><b>{disp.lot??'—'}</b><span>状态 {statusLabel[disp.state??'']??disp.state??'—'} · 更新于 {fmt(disp.updatedAt)}</span><em>{disp.reason||'无备注原因'}</em></div>}
      {!d&&!inv&&!exp&&!disp&&<div className="warnBox">该事件未关联任何可跳转对象（系统级/未知事件）。</div>}
    </div>
    {Object.keys(e.summary).length>0&&<div className="rawSummary"><h3>事件摘要</h3><div className="kvGrid">{Object.entries(e.summary).map(([k,v])=><div key={k}><small>{summaryLabel[k]??k}</small><span>{String(v)}</span></div>)}</div></div>}
    <div className="rawSummary"><h3>原始事件数据</h3><pre>{JSON.stringify(e.raw,null,2)}</pre></div>
  </>;
}
function MissingRef({label}:{label:string}){return <div className="refCard missing"><small>关联对象缺失</small><b>🔒 {label}</b><span>对象已归档或在当前数据集中不存在，事件本身仍保留完整审计记录。</span></div>;}
