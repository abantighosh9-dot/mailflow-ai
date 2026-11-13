import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./state/AuthContext";
import Layout from "./components/Layout";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import EmailStudio from "./pages/EmailStudio";
import Placeholder from "./pages/Placeholder";

function Protected({children}) {
 const {user,loading}=useAuth();
 if(loading)return <div className="loading-screen">Loading MailFlow AI…</div>;
 return user?children:<Navigate to="/login" replace/>;
}
export default function App(){
 return <Routes>
  <Route path="/" element={<Navigate to="/app" replace/>}/>
  <Route path="/login" element={<Auth mode="login"/>}/>
  <Route path="/register" element={<Auth mode="register"/>}/>
  <Route path="/app" element={<Protected><Layout/></Protected>}>
   <Route index element={<Dashboard/>}/>
   <Route path="studio" element={<EmailStudio/>}/>
   <Route path="audience" element={<Placeholder type="audience"/>}/>
   <Route path="campaigns" element={<Placeholder type="campaigns"/>}/>
   <Route path="automation" element={<Placeholder type="automation"/>}/>
   <Route path="assistant" element={<Placeholder type="assistant"/>}/>
   <Route path="analytics" element={<Placeholder type="analytics"/>}/>
   <Route path="deliverability" element={<Placeholder type="deliverability"/>}/>
   <Route path="integrations" element={<Placeholder type="integrations"/>}/>
   <Route path="team" element={<Placeholder type="team"/>}/>
   <Route path="billing" element={<Placeholder type="billing"/>}/>
   <Route path="settings" element={<Placeholder type="settings"/>}/>
  </Route>
  <Route path="*" element={<Navigate to="/app" replace/>}/>
 </Routes>;
}
