import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../lib/api";
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  async function refresh() {
    try { const data = await api("/auth/me"); setUser(data.user); }
    catch { setUser(null); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);
  async function login(email, password) {
    const data = await api("/auth/login", { method:"POST", body:JSON.stringify({email,password}) });
    setUser(data.user);
  }
  async function register(name,email,password) {
    const data = await api("/auth/register", { method:"POST", body:JSON.stringify({name,email,password}) });
    setUser(data.user);
  }
  async function googleLogin(credential) {
    const data = await api("/auth/google", { method:"POST", body:JSON.stringify({credential}) });
    setUser(data.user);
  }
  async function logout() {
    await api("/auth/logout", { method:"POST", body:"{}" });
    setUser(null);
  }
  return <AuthContext.Provider value={{user,loading,login,register,googleLogin,logout,refresh}}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
