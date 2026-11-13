import { useEffect, useRef } from "react";
import { useAuth } from "../state/AuthContext";

export default function GoogleLogin() {
  const buttonRef = useRef(null);
  const { googleLogin } = useAuth();
  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (!window.google || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response) => {
          try { await googleLogin(response.credential); }
          catch (error) { alert(error.message); }
        }
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "outline", size: "large", shape: "pill", text: "continue_with", width: 320
      });
    };
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, [googleLogin]);
  if (!import.meta.env.VITE_GOOGLE_CLIENT_ID) {
    return <div className="google-placeholder">Google login setup required — add VITE_GOOGLE_CLIENT_ID to .env</div>;
  }
  return <div ref={buttonRef} className="google-button" />;
}
