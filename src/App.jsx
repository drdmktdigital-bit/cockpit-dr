import { useState, useEffect } from "react";
import { supabase } from "./supabase.js";
import Cockpit from "./Cockpit.jsx";

const C = {
  bg: "#141213", card: "#1F1D1E", cardSoft: "#2A2728", border: "#3A3637",
  text: "#E9E9E9", dim: "#9A9496", accent: "#FF5A1F", expense: "#F0616D",
};

export default function App() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const login = async () => {
    if (!email || !senha || busy) return;
    setBusy(true);
    setErro("");
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) setErro("E-mail ou senha inválidos.");
    setBusy(false);
  };

  if (checking) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.dim, fontFamily: "ui-sans-serif, system-ui" }}>
        Carregando…
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "ui-sans-serif, system-ui" }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, width: "100%", maxWidth: 380 }}>
          <div style={{ color: C.accent, fontSize: 11, letterSpacing: 2, textTransform: "uppercase" }}>
            DR Marketing
          </div>
          <h1 style={{ color: C.text, fontSize: 22, fontWeight: 800, margin: "6px 0 18px" }}>
            Cockpit Financeiro
          </h1>
          <input
            type="email" placeholder="E-mail" value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: C.cardSoft, border: `1px solid ${C.border}`, color: C.text, borderRadius: 10, padding: "12px 14px", fontSize: 14, marginBottom: 10, outline: "none" }}
          />
          <input
            type="password" placeholder="Senha" value={senha}
            onChange={(e) => setSenha(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
            style={{ width: "100%", boxSizing: "border-box", background: C.cardSoft, border: `1px solid ${C.border}`, color: C.text, borderRadius: 10, padding: "12px 14px", fontSize: 14, marginBottom: 14, outline: "none" }}
          />
          {erro && <div style={{ color: C.expense, fontSize: 12, marginBottom: 10 }}>{erro}</div>}
          <button onClick={login} disabled={busy}
            style={{ width: "100%", background: C.accent, color: "#1A1205", border: "none", borderRadius: 10, padding: "12px", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
          <div style={{ color: C.dim, fontSize: 11, marginTop: 14, lineHeight: 1.5 }}>
            Acesso restrito. O usuário é criado no painel do Supabase (Authentication → Users).
          </div>
        </div>
      </div>
    );
  }

  return <Cockpit supabase={supabase} session={session} onLogout={() => supabase.auth.signOut()} />;
}
