import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, Sparkles, ArrowRight, ShieldCheck } from "lucide-react";
import GoogleLogin from "../components/GoogleLogin";
import { useAuth } from "../state/AuthContext";

export default function Auth({mode="login"}) {
  const isRegister=mode==="register"; const {login,register}=useAuth(); const navigate=useNavigate();
  const [name,setName]=useState(""); const [email,setEmail]=useState(""); const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError("");
    try { isRegister ? await register(name,email,password) : await login(email,password); navigate("/app"); }
    catch(err){setError(err.message);}
    finally{setBusy(false);}
  }
  return <div className="auth-page"><div className="auth-art"><div className="auth-art-inner"><div className="brand brand-light"><span className="brand-icon"><Mail/></span><span>MailFlow <b>AI</b></span></div><div className="art-copy"><span className="pill-light"><Sparkles size={14}/> Marketing, made intelligent</span><h1>Turn every email into a meaningful connection.</h1><p>Create beautiful campaigns, automate customer journeys and understand what works — all in one place.</p><div className="art-metric"><div><b>AI-powered</b><small>Campaign creation</small></div><div><b>One workspace</b><small>Complete control</small></div></div></div><div className="floating-mail"><Mail size={23}/><span><b>Your next campaign</b><small>Ready to create</small></span><Sparkles color="#8d70ed"/></div></div></div>
    <div className="auth-form-side"><div className="auth-form-wrap"><div className="mobile-brand"><Mail color="#6545bc"/> MailFlow AI</div><span className="form-kicker">{isRegister?"GET STARTED":"WELCOME BACK"}</span><h2>{isRegister?"Create your workspace":"Sign in to MailFlow"}</h2><p className="muted">{isRegister?"Start creating smarter email campaigns today.":"Enter your details to access your marketing workspace."}</p>
      {error&&<div className="error-box">{error}</div>}
      <form onSubmit={submit} className="auth-form">{isRegister&&<label>Full name<input required value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"/></label>}<label>Work email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com"/></label><label>Password<input type="password" required minLength={8} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters"/></label>{!isRegister&&<div className="forgot-row"><span>Protected sign-in</span><ShieldCheck size={14}/></div>}<button className="primary-button full" disabled={busy}>{busy?"Please wait":isRegister?"Create account":"Sign in"}<ArrowRight size={17}/></button></form>
      <div className="separator"><span>or continue with</span></div><GoogleLogin/><p className="auth-switch">{isRegister?"Already have an account?":"New to MailFlow?"} <Link to={isRegister?"/login":"/register"}>{isRegister?"Sign in":"Create an account"}</Link></p><small className="legal">By continuing, you agree to our Terms of Service and Privacy Policy.</small>
    </div></div></div>;
}
