import { useState } from "react";
import { Sparkles, WandSparkles, Copy, Save, Monitor, Smartphone, RefreshCw, ArrowRight, Check, Code2 } from "lucide-react";
import { api } from "../lib/api";
export default function EmailStudio(){
 const [prompt,setPrompt]=useState("Create a premium product launch email for a new summer skincare collection. Introduce the collection, highlight a 20% launch offer, use an elegant and friendly tone, and include a strong shop-now call to action.");
 const [purpose,setPurpose]=useState("Product launch"); const [tone,setTone]=useState("Professional"); const [audience,setAudience]=useState("Existing customers");
 const [result,setResult]=useState(null); const [loading,setLoading]=useState(false); const [error,setError]=useState(""); const [mobile,setMobile]=useState(false);
 async function generate(){
  setLoading(true);setError("");
  try{const data=await api("/ai/generate-email",{method:"POST",body:JSON.stringify({prompt,purpose,tone,audience,brandName:"Your Brand",language:"English"})});setResult(data.email);}
  catch(e){setError(e.message);}
  finally{setLoading(false);}
 }
 async function saveTemplate(){
  if(!result)return;
  try{await api("/templates",{method:"POST",body:JSON.stringify({name:result.headline||"AI email template",email:result})});alert("Template saved.");}
  catch(e){alert(e.message);}
 }
 const html=result?.html || "";
 return <div className="page-stack"><div className="welcome-row"><div><span className="form-kicker">CREATE SOMETHING BRILLIANT</span><h1>AI Email Studio <span className="ai-label"><Sparkles size={13}/> AI POWERED</span></h1><p className="muted">Turn a simple idea into a complete, beautifully designed email.</p></div></div>
 <div className="studio-layout"><div className="panel prompt-panel"><div className="panel-heading"><div><h3><WandSparkles size={18}/> Tell us what to create</h3><p>Be as descriptive as you like. AI will handle the structure and copy.</p></div></div>
 <label className="field-label">Campaign description<textarea rows="7" value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Describe your email campaign..."/></label>
 <div className="form-two"><label className="field-label">Email purpose<select value={purpose} onChange={e=>setPurpose(e.target.value)}>{["Product launch","Promotion","Newsletter","Welcome email","Event invitation","Announcement","Re-engagement"].map(x=><option>{x}</option>)}</select></label><label className="field-label">Writing tone<select value={tone} onChange={e=>setTone(e.target.value)}>{["Professional","Friendly","Luxury","Conversational","Persuasive","Minimalist"].map(x=><option>{x}</option>)}</select></label></div>
 <label className="field-label">Target audience<select value={audience} onChange={e=>setAudience(e.target.value)}>{["Existing customers","New subscribers","Potential customers","VIP customers","General audience"].map(x=><option>{x}</option>)}</select></label>
 <div className="tip-box"><Sparkles size={17}/><span><b>Pro tip</b><small>Include your offer, product benefits and desired action for more useful results.</small></span></div>
 <button className="primary-button full generate-button" onClick={generate} disabled={loading||!prompt.trim()}>{loading?<><RefreshCw className="spin" size={17}/> Creating your email...</>:<><Sparkles size={17}/> Generate complete email <ArrowRight size={17}/></>}</button>
 {error&&<div className="error-box">{error}</div>}
 </div>
 <div className="panel preview-panel"><div className="preview-toolbar"><div><h3>Email preview</h3><p>{result?"AI-generated editable content":"Your design will appear here"}</p></div><div className="preview-actions"><button className={`icon-button ${!mobile?"selected":""}`} onClick={()=>setMobile(false)} title="Desktop"><Monitor size={17}/></button><button className={`icon-button ${mobile?"selected":""}`} onClick={()=>setMobile(true)} title="Mobile"><Smartphone size={17}/></button></div></div>
 {!result?<div className="empty-preview"><div className="empty-icon"><Sparkles size={26}/></div><h3>Your next great email starts here</h3><p>Describe your campaign and click Generate. Your complete email will appear in this preview.</p></div>:
 <div className="email-canvas-wrap"><div className={`email-canvas ${mobile?"mobile-preview":""}`}><div className="email-brand">YOUR BRAND</div><div className="email-hero"><span>{purpose.toUpperCase()}</span><h1>{result.headline}</h1><p>{result.previewText}</p></div>{result.sections?.map((s,i)=><div className="email-section" key={i}><h2>{s.heading}</h2><p>{s.body}</p></div>)}<div className="email-cta"><a>{result.ctaText}</a></div><div className="email-footer">{result.footer}<br/><small>You are receiving this email because you subscribed to updates. Unsubscribe</small></div></div></div>}
 {result&&<div className="result-actions"><button className="soft-button" onClick={()=>navigator.clipboard.writeText(html)}><Copy size={15}/> Copy HTML</button><button className="soft-button" onClick={saveTemplate}><Save size={15}/> Save template</button><button className="soft-button" onClick={()=>setResult(null)}><RefreshCw size={15}/> New generation</button></div>}
 </div></div>
 </div>;
}
