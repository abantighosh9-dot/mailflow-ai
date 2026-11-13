import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, Users, Send, Palette, Workflow, BrainCircuit,
  ChartNoAxesCombined, ShieldCheck, Plug, UsersRound, CreditCard, Settings, Mail
} from "lucide-react";
const groups = [
  ["Workspace", [
    ["/app","Dashboard",LayoutDashboard],
    ["/app/audience","Audience",Users],
    ["/app/campaigns","Campaigns",Send],
    ["/app/studio","Email Studio",Palette],
    ["/app/automation","Automation",Workflow],
    ["/app/assistant","AI Assistant",BrainCircuit],
    ["/app/analytics","Analytics & Reports",ChartNoAxesCombined],
    ["/app/deliverability","Deliverability",ShieldCheck],
    ["/app/integrations","Integrations",Plug]
  ]],
  ["Administration", [
    ["/app/team","Team Management",UsersRound],
    ["/app/billing","Billing & Usage",CreditCard],
    ["/app/settings","Settings",Settings]
  ]]
];
export default function Sidebar() {
  return <aside className="sidebar">
    <div className="brand"><span className="brand-icon"><Mail size={21}/></span><span>MailFlow <b>AI</b><small>Marketing workspace</small></span></div>
    {groups.map(([label,items]) => <div className="nav-group" key={label}>
      <div className="nav-label">{label}</div>
      {items.map(([to,name,Icon]) => <NavLink end={to==="/app"} to={to} className={({isActive})=>`nav-link ${isActive?"active":""}`} key={to}>
        <Icon size={18}/><span>{name}</span>
      </NavLink>)}
    </div>)}
    <div className="sidebar-bottom"><div className="help-card"><b>Need a hand?</b><p>Visit the help center for tips and guides.</p><span>Help center ↗</span></div></div>
  </aside>;
}
