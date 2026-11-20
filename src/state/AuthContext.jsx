import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../lib/api";
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  async function refresh() {
    try { const data = await api("/auth/me"); setUser(data.user); setWorkspace(data.workspace || null); }
    catch { setUser(null); setWorkspace(null); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);
  async function login(email, password) { await api("/auth/login", { method:"POST", body:JSON.stringify({email,password}) }); await refresh(); }
  async function register(name,email,password) { await api("/auth/register", { method:"POST", body:JSON.stringify({name,email,password}) }); await refresh(); }
  async function googleLogin(credential) { await api("/auth/google", { method:"POST", body:JSON.stringify({credential}) }); await refresh(); }
  async function logout() { await api("/auth/logout", { method:"POST", body:"{}" }); setUser(null); setWorkspace(null); }
  return <AuthContext.Provider value={{user,workspace,loading,login,register,googleLogin,logout,refresh}}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
