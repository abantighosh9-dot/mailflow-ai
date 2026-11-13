import { Outlet, useLocation } from "react-router-dom";
import { Bell, Search, ChevronDown, Menu } from "lucide-react";
import Sidebar from "./Sidebar";
import { useAuth } from "../state/AuthContext";
const titles = {
  "/app":"Dashboard","/app/audience":"Audience","/app/campaigns":"Campaigns",
  "/app/studio":"Email Studio","/app/automation":"Automation","/app/assistant":"AI Assistant",
  "/app/analytics":"Analytics & Reports","/app/deliverability":"Deliverability",
  "/app/integrations":"Integrations","/app/team":"Team Management",
  "/app/billing":"Billing & Usage","/app/settings":"Settings"
};
export default function Layout() {
  const {user,logout}=useAuth(); const location=useLocation();
  return <div className="app-shell"><Sidebar/><main className="main-area">
    <header className="topbar"><div className="top-left"><button className="icon-button mobile-menu"><Menu/></button><div><div className="eyebrow">WORKSPACE / MAILFLOW</div><h2>{titles[location.pathname] || "MailFlow AI"}</h2></div></div>
      <div className="top-actions"><div className="search-box"><Search size={16}/><input placeholder="Search anything..."/></div><button className="icon-button"><Bell size={18}/></button><div className="user-menu"><div className="avatar">{user?.name?.[0] || "U"}</div><div><b>{user?.name || "User"}</b><small>{user?.email}</small></div><button className="icon-button" onClick={logout}><ChevronDown size={17}/></button></div></div>
    </header><section className="page-content"><Outlet/></section>
  </main></div>;
}
