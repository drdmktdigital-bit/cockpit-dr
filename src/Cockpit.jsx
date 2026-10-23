import { useState, useEffect, useMemo } from "react";
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine, Legend,
} from "recharts";

/* ============================================================
   MODELO FINANCEIRO (única fonte de verdade)
   ------------------------------------------------------------
   banks[].saldo  = SALDO ATUAL do banco (já líquido de tudo que
                    foi baixado). Dar baixa altera este número.
                    Ajustar o banco = corrigir este número.
   SALDO ATUAL    = soma dos saldos dos bancos.
   EM ABERTO      = lançamentos ainda não baixados, filtrados
                    pelo status (Confirmado / A confirmar / Provisão).
   PROJEÇÃO       = SALDO ATUAL + (receitas em aberto − despesas
                    em aberto) do período.
   Lançamento baixado NUNCA entra de novo na projeção.
   ============================================================ */

const C = {
  bg: "#141213", card: "#1F1D1E", cardSoft: "#2A2728", border: "#3A3637",
  text: "#E9E9E9", dim: "#9A9496", faint: "#6B6567",
  income: "#2DD4A7", expense: "#F0616D", accent: "#FF5A1F", blue: "#5B9CF5",
};
const FAINT = C.faint;
const fmt = (v) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmt2 = (v) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

const Card = ({ children, style }) => (
  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, ...style }}>{children}</div>
);
const KpiBox = ({ label, value, sub, color, big }) => (
  <Card style={{ flex: 1, minWidth: big ? 190 : 150 }}>
    <div style={{ color: C.dim, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
    <div style={{ color: color || C.text, fontSize: big ? 26 : 22, fontWeight: 800, marginTop: 4 }}>{value}</div>
    {sub && <div style={{ color: FAINT, fontSize: 11, marginTop: 2 }}>{sub}</div>}
  </Card>
);
const inputSt = { background: C.cardSoft, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: "8px 10px", fontSize: 13, colorScheme: "dark", outline: "none" };
const chip = (active, col) => ({
  padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
  border: `1px solid ${active ? col : C.border}`,
  background: active ? "rgba(255,255,255,0.06)" : C.card,
  color: active ? col : C.dim, cursor: "pointer",
});

const STATUS = {
  conf: { label: "Confirmado", short: "C", color: C.income },
  aconf: { label: "A confirmar", short: "AC", color: C.accent },
  prov: { label: "Provisão", short: "P", color: C.blue },
};
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const CAT_DEF = {
  out: ["Ferramentas", "Fornecedor", "Equipe", "Marketing", "Impostos", "Repasse Job", "Escritório", "Eventos", "Diversos"],
  in: ["Escalada no Digital", "Plano 45", "Consultoria e Mentoria", "Trade Marketing", "IA para Executivos", "Palestras/Workshops", "Outros"],
};
const DEF_ST = {};

/* ===== datas ===== */
const HOJE = new Date();
const START = new Date(HOJE.getFullYear(), HOJE.getMonth(), 1);
const END = new Date(HOJE.getFullYear(), HOJE.getMonth() + 12, 0);
const hoje0 = new Date(HOJE.getFullYear(), HOJE.getMonth(), HOJE.getDate());
const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dKey = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
const dKeyY = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;
const pdate = (v) => { const [y, m, d] = v.split("-").map(Number); return new Date(y, m - 1, d); };
const MIDX = (d) => d.getFullYear() * 12 + d.getMonth();
const mDate = (mi, d) => new Date(Math.floor(mi / 12), mi % 12, d || 1);
const mLast = (mi) => new Date(Math.floor(mi / 12), (mi % 12) + 1, 0).getDate();
const mLabel = (mi) => MESES[mi % 12] + "/" + String(Math.floor(mi / 12)).slice(-2);
const MI_HOJE = MIDX(hoje0);
const ISO_START = iso(START), ISO_END = iso(END);
function fifthBusinessDay(y, m) {
  let c = 0;
  for (let d = 1; d <= 28; d++) { const wd = new Date(y, m, d).getDay(); if (wd !== 0 && wd !== 6) { c++; if (c === 5) return d; } }
  return 5;
}
function mondayOf(d) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }

/* ===== motor de lançamentos ===== */
function buildEvents(extras) {
  const ev = [];
  const push = (date, serie, amount, type, cat, grp) => {
    if (date < START || date > END) return;
    ev.push({ id: `${serie}__${iso(date)}`, date, name: serie, serie, amount, type, cat, grp: grp || cat });
  };
  (extras || []).forEach((x) => {
    const [yy, mm, dd] = x.date.split("-").map(Number);
    const base = new Date(yy, mm - 1, dd);
    const freq = x.freq || "once";
    const n = Number(x.vezes) || 0;
    const mc = x.cat || (x.type === "in" ? "Outros" : "Diversos");
    if (freq === "once") push(base, x.name, Number(x.amount), x.type, mc, "Manual");
    else if (freq === "mensal") {
      const d0 = new Date(yy, mm - 1, 1); let c = 0;
      while (d0 <= END && (!n || c < n)) {
        const ld = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
        push(new Date(d0.getFullYear(), d0.getMonth(), Math.min(dd, ld)), x.name, Number(x.amount), x.type, mc, "Manual");
        d0.setMonth(d0.getMonth() + 1, 1); c++;
      }
    } else {
      const d2 = new Date(base); let c = 0;
      while (d2 <= END && (!n || c < n)) { push(new Date(d2), x.name, Number(x.amount), x.type, mc, "Manual"); d2.setDate(d2.getDate() + 7); c++; }
    }
  });
  ev.sort((a, b) => a.date - b.date || (a.type === "in" ? -1 : 1));
  return ev;
}

/* ============================================================ */
export default function Cockpit({ supabase, session, onLogout }) {
  const [tab, setTab] = useState("saude");
  const [loaded, setLoaded] = useState(false);

  const [banks, setBanks] = useState([{ id: "b1", nome: "Conta principal", saldo: 12000 }]);
  const [extras, setExtras] = useState([]);
  const [stItem, setStItem] = useState({});
  const [stSerie, setStSerie] = useState({});
  const [settle, setSettle] = useState({});
  const [ovr, setOvr] = useState({});
  const [cats, setCats] = useState(CAT_DEF);
  const [catSerie, setCatSerie] = useState({});
  const [scenClasses, setScenClasses] = useState({ conf: true, aconf: true, prov: true });
  const [schema, setSchema] = useState(2);

  const [expanded, setExpanded] = useState({});
  const [mesFiltro, setMesFiltro] = useState(MI_HOJE);
  const [gran, setGran] = useState("mes");
  const [mesFiltro2, setMesFiltro2] = useState(-1);
  const [mesFiltro3, setMesFiltro3] = useState(-1);
  const [scenChartMode, setScenChartMode] = useState("mes");
  const [scenDe, setScenDe] = useState(ISO_START);
  const [scenAte, setScenAte] = useState(ISO_END);
  const [movMes, setMovMes] = useState(MI_HOJE);
  const [movTipo, setMovTipo] = useState("todos");
  const [movStatus, setMovStatus] = useState("pend");
  const [movModo, setMovModo] = useState("mes");
  const [movBusca, setMovBusca] = useState("");
  const [movDe, setMovDe] = useState(ISO_START);
  const [movAte, setMovAte] = useState(ISO_END);
  const [movSt, setMovSt] = useState({ conf: true, aconf: true, prov: true });
  const [movCat, setMovCat] = useState("todas");
  const [fluxoModo, setFluxoModo] = useState("mes");
  const [fluxoDe, setFluxoDe] = useState(ISO_START);
  const [fluxoAte, setFluxoAte] = useState(ISO_END);
  const [verBaixados, setVerBaixados] = useState(false);
  const [saudeDe, setSaudeDe] = useState(iso(mDate(MI_HOJE, 1)));
  const [saudeAte, setSaudeAte] = useState(iso(mDate(MI_HOJE, mLast(MI_HOJE))));
  const [movDeD, setMovDeD] = useState(ISO_START);
  const [movAteD, setMovAteD] = useState(ISO_END);
  const [fluxoDeD, setFluxoDeD] = useState(ISO_START);
  const [fluxoAteD, setFluxoAteD] = useState(ISO_END);
  const [saudeDeD, setSaudeDeD] = useState(iso(mDate(MI_HOJE, 1)));
  const [saudeAteD, setSaudeAteD] = useState(iso(mDate(MI_HOJE, mLast(MI_HOJE))));
  const [baixaOpen, setBaixaOpen] = useState(null);
  const [baixaForm, setBaixaForm] = useState({ bankId: "", valor: "", data: "" });
  const [editOpen, setEditOpen] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", amount: "", date: "", cat: "" });
  const [novoBanco, setNovoBanco] = useState({ nome: "", saldo: "" });
  const [novaCat, setNovaCat] = useState({ nome: "", tipo: "out" });
  const [form, setForm] = useState({ name: "", amount: "", date: iso(hoje0), type: "out", freq: "once", vezes: "", cat: "Diversos" });
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 700);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 700);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  /* ===== carregar ===== */
  useEffect(() => {
    (async () => {
      try {
        const { data: row } = await supabase.from("dr_state").select("data").eq("user_id", session.user.id).maybeSingle();
        const s = row?.data;
        if (s && Object.keys(s).length) {
          let bk = Array.isArray(s.banks) && s.banks.length ? s.banks
            : [{ id: "b1", nome: "Conta principal", saldo: s.saldoInicial != null ? s.saldoInicial : 12000 }];
          const st = s.settle || {};
          /* MIGRAÇÃO v2: antes o saldo do banco era "abertura" e as baixas
             eram recalculadas. Agora o saldo é o ATUAL — somamos as baixas
             uma única vez para converter. */
          if (!s.schema || s.schema < 2) {
            const evm = buildEvents(s.extras || []);
            const mapa = {}; evm.forEach((e) => (mapa[e.id] = e));
            const delta = {};
            Object.entries(st).forEach(([id, v]) => {
              const e = mapa[id]; if (!e) return;
              const val = Number(v.valor) || 0;
              delta[v.bankId] = (delta[v.bankId] || 0) + (e.type === "in" ? val : -val);
            });
            bk = bk.map((b) => ({ ...b, saldo: Number(b.saldo || 0) + (delta[b.id] || 0) }));
          }
          setBanks(bk);
          setSettle(st);
          if (s.extras) setExtras(s.extras);
          if (s.stItem) setStItem(s.stItem);
          if (s.stSerie) setStSerie(s.stSerie); else if (s.scenStatus) setStSerie(s.scenStatus);
          if (s.ovr) setOvr(s.ovr);
          if (s.cats && s.cats.out && s.cats.in) setCats(s.cats);
          if (s.catSerie) setCatSerie(s.catSerie);
          if (s.scenClasses) setScenClasses(s.scenClasses);
        }
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(async () => {
      try {
        await supabase.from("dr_state").upsert({
          user_id: session.user.id,
          data: { schema: 2, banks, extras, stItem, stSerie, settle, ovr, cats, catSerie, scenClasses },
          updated_at: new Date().toISOString(),
        });
      } catch (e) {}
    }, 700);
    return () => clearTimeout(t);
  }, [banks, extras, stItem, stSerie, settle, ovr, cats, catSerie, scenClasses, loaded]);

  /* ===== eventos ===== */
  const rawEvents = useMemo(() => buildEvents(extras), [extras]);
  const events = useMemo(() => rawEvents
    .filter((e) => !(ovr[e.id] && ovr[e.id].deleted))
    .map((e) => {
      const o = ovr[e.id];
      if (!o) return e;
      let date = e.date;
      if (o.date) date = pdate(o.date);
      return { ...e, name: o.name != null ? o.name : e.name, amount: o.amount != null ? Number(o.amount) : e.amount, date, editado: true };
    })
    .sort((a, b) => a.date - b.date || (a.type === "in" ? -1 : 1)), [rawEvents, ovr]);
  const nExcluidos = Object.values(ovr).filter((o) => o.deleted).length;

  const catOf = (e) => (ovr[e.id] && ovr[e.id].cat) || catSerie[e.serie] || e.cat;
  const stOf = (e) => stItem[e.id] || stSerie[e.serie] || DEF_ST[e.grp] || "conf";
  const isPaid = (e) => !!settle[e.id];
  const valOf = (e) => (settle[e.id] ? Number(settle[e.id].valor) : e.amount);
  const incluido = (e) => !isPaid(e) && scenClasses[stOf(e)];

  /* ===== SALDO ATUAL (fonte única) ===== */
  const saldoAtual = useMemo(() => banks.reduce((s, b) => s + Number(b.saldo || 0), 0), [banks]);

  /* ===== lançamentos em aberto, encadeados ===== */
  const abertos = useMemo(() => events.filter(incluido), [events, settle, stItem, stSerie, scenClasses]);
  const flat = useMemo(() => {
    let saldo = saldoAtual;
    return abertos.map((e) => {
      const v = e.amount;
      saldo += e.type === "in" ? v : -v;
      return { e, rec: e.type === "in" ? v : 0, desp: e.type === "out" ? v : 0, saldo };
    });
  }, [abertos, saldoAtual]);

  const daily = useMemo(() => {
    const rows = []; let cur = null;
    flat.forEach((r) => {
      const k = dKey(r.e.date);
      if (!cur || cur.key !== k) { cur = { key: k, date: r.e.date, items: [], inSum: 0, outSum: 0, saldo: 0 }; rows.push(cur); }
      cur.items.push(r.e); cur.inSum += r.rec; cur.outSum += r.desp; cur.saldo = r.saldo;
    });
    return rows;
  }, [flat]);

  const weekly = useMemo(() => {
    const map = new Map();
    daily.forEach((r) => {
      const mo = mondayOf(r.date), k = dKey(mo);
      if (!map.has(k)) map.set(k, { key: k, dt: mo, inSum: 0, outSum: 0, saldo: 0 });
      const w = map.get(k); w.inSum += r.inSum; w.outSum += r.outSum; w.saldo = r.saldo;
    });
    return [...map.values()];
  }, [daily]);

  const monthly = useMemo(() => {
    const map = new Map();
    daily.forEach((r) => {
      const k = MIDX(r.date);
      if (!map.has(k)) map.set(k, { m: k, nome: mLabel(k), inSum: 0, outSum: 0, saldo: 0 });
      const w = map.get(k); w.inSum += r.inSum; w.outSum += r.outSum; w.saldo = r.saldo;
    });
    return [...map.values()].sort((a, b) => a.m - b.m);
  }, [daily]);

  /* meses disponíveis = os que têm lançamento + mês atual */
  const MLIST = useMemo(() => {
    const s = new Set(events.map((e) => MIDX(e.date))); s.add(MI_HOJE);
    return [...s].sort((a, b) => a - b);
  }, [events]);

  /* ===== projeções por recorte ===== */
  const projetar = (de, ate) => {
    let rec = 0, desp = 0, antes = 0;
    abertos.forEach((e) => {
      const v = e.amount;
      if (e.date < de) { antes += e.type === "in" ? v : -v; return; }
      if (e.date > ate) return;
      if (e.type === "in") rec += v; else desp += v;
    });
    const ini = saldoAtual + antes;
    return { ini, rec, desp, res: rec - desp, fim: ini + rec - desp };
  };
  const projMesAtual = useMemo(() => projetar(mDate(MI_HOJE, 1), mDate(MI_HOJE, mLast(MI_HOJE))), [abertos, saldoAtual]);
  const passaAberto = (e) => !isPaid(e) && scenClasses[stOf(e)];

  const atrasados = useMemo(() => abertos.filter((e) => e.date < hoje0), [abertos]);
  const atrasadoIn = atrasados.filter((e) => e.type === "in").reduce((s, e) => s + e.amount, 0);
  const atrasadoOut = atrasados.filter((e) => e.type === "out").reduce((s, e) => s + e.amount, 0);

  /* menor saldo dentro de um recorte qualquer */
  const minSaldoEm = (de, ate, ini) => {
    const rows = flat.filter((r) => r.e.date >= de && r.e.date <= ate);
    let min = { saldo: ini, key: "início" };
    rows.forEach((r) => { if (r.saldo < min.saldo) min = { saldo: r.saldo, key: dKey(r.e.date) }; });
    return min;
  };

  /* ============================================================
     calcPeriodo — fonte única de todos os números de uma tela.
     Recebe o MESMO filtro usado na lista exibida, então os boxes
     e a listagem nunca divergem.
     ============================================================ */
  const calcPeriodo = (passa, de, ate, passaSaldo) => {
    const pS = passaSaldo || passa;
    let rec = 0, desp = 0, nBaix = 0;          /* movimento da LISTA exibida */
    let antes = 0, recAb = 0, despAb = 0;      /* fluxo de caixa do período  */
    const dentro = [], fluxo = [];
    events.forEach((e) => {
      const v = valOf(e);
      const noFluxo = pS(e) && !isPaid(e);
      if (e.date < de) { if (noFluxo) antes += e.type === "in" ? v : -v; return; }
      if (e.date > ate) return;
      if (passa(e)) {
        dentro.push(e);
        if (isPaid(e)) nBaix++;
        if (e.type === "in") rec += v; else desp += v;
      }
      if (noFluxo) { if (e.type === "in") recAb += v; else despAb += v; fluxo.push(e); }
    });
    const ini = saldoAtual + antes;
    const res = rec - desp;
    const resAb = recAb - despAb;
    const fim = ini + resAb;
    let sal = ini, min = { saldo: ini, key: "início" };
    fluxo.forEach((e) => {
      sal += e.type === "in" ? valOf(e) : -valOf(e);
      if (sal < min.saldo) min = { saldo: sal, key: dKeyY(e.date) };
    });
    return { ini, rec, desp, res, resAb, fim, min, dentro, fluxo, n: dentro.length, nBaix, de, ate, recortado: !!passaSaldo };
  };

  const projSaude = useMemo(() => calcPeriodo(passaAberto, pdate(saudeDe), pdate(saudeAte)),
    [events, settle, stItem, stSerie, scenClasses, saldoAtual, saudeDe, saudeAte]);

  /* bloco padrão de totalizadores do período — usado em todas as telas de fluxo */
  const boxesPeriodo = (p, extras) => {
    const dias = Math.max(1, Math.round((p.ate - p.de) / 86400000) + 1);
    return (
      <>
        <div style={{ color: FAINT, fontSize: 11 }}>
          Subtotais de <b style={{ color: C.dim }}>{dKeyY(p.de)}</b> a <b style={{ color: C.dim }}>{dKeyY(p.ate)}</b> · {dias} dia(s) · {p.n} lançamento(s)
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <KpiBox label="Saldo inicial" value={fmt(p.ini)} sub={dKeyY(p.de)} />
          <KpiBox label="Receitas no período" value={fmt(p.rec)} color={C.income} />
          <KpiBox label="Despesas no período" value={fmt(p.desp)} color={C.expense} />
          <KpiBox label="Resultado no período" value={`${p.res >= 0 ? "+" : ""}${fmt(p.res)}`}
            sub={`${fmt(p.rec)} − ${fmt(p.desp)}`} color={p.res >= 0 ? C.income : C.expense} big />
          <KpiBox label="Saldo final" value={fmt(p.fim)} sub={dKeyY(p.ate)} color={p.fim < 0 ? C.expense : C.accent} big />
          <KpiBox label="Menor saldo" value={fmt(p.min.saldo)} sub={`em ${p.min.key}`} color={p.min.saldo < 0 ? C.expense : C.accent} />
          {extras}
        </div>
        {p.nBaix > 0 && (
          <div style={{ color: FAINT, fontSize: 11, background: C.cardSoft, borderRadius: 8, padding: "7px 10px", lineHeight: 1.5 }}>
            ℹ️ {p.nBaix} lançamento(s) da lista já está baixado: entra no <b style={{ color: C.dim }}>resultado</b>, mas não no <b style={{ color: C.dim }}>saldo final</b> — ali já está dentro do saldo do banco. Em aberto no período: {p.resAb >= 0 ? "+" : ""}{fmt(p.resAb)}.
          </div>
        )}
      </>
    );
  };

  /* linha de TOTAL para o rodapé das tabelas */
  const linhaTotal = (p, cols, key) => {
    const st = { borderTop: `2px solid ${C.accent}`, paddingTop: 6, marginTop: 2, fontWeight: 800 };
    return [
      <div key={key + "t1"} style={{ ...st, color: C.accent }}>TOTAL</div>,
      <div key={key + "t2"} style={{ ...st, textAlign: "right", color: C.dim }}>{fmt(p.ini)}</div>,
      <div key={key + "t3"} style={{ ...st, textAlign: "right", color: C.income }}>{fmt(p.rec)}</div>,
      <div key={key + "t4"} style={{ ...st, textAlign: "right", color: C.expense }}>{fmt(p.desp)}</div>,
      <div key={key + "t5"} style={{ ...st, textAlign: "right", color: p.fim < 0 ? C.expense : C.accent }}>{fmt(p.fim)}</div>,
    ];
  };

  const chartSaude = useMemo(() => {
    const de = pdate(saudeDe), ate = pdate(saudeAte);
    const rows = daily.filter((r) => r.date >= de && r.date <= ate);
    return [{ d: "hoje", saldo: Math.round(projSaude.ini) }].concat(rows.map((r) => ({ d: r.key, saldo: Math.round(r.saldo) })));
  }, [daily, saudeDe, saudeAte, projSaude]);

  /* ===== ações ===== */
  const bancoDe = (id) => banks.find((b) => b.id === id);
  const abrirBaixa = (e) => {
    setBaixaOpen(e.id); setEditOpen(null);
    setBaixaForm({ bankId: banks[0]?.id || "", valor: String(e.amount.toFixed(2)), data: iso(e.date > hoje0 ? e.date : hoje0) });
  };
  const confirmarBaixa = (e) => {
    const bid = baixaForm.bankId; if (!bid) return;
    const v = Number(baixaForm.valor) || e.amount;
    setSettle({ ...settle, [e.id]: { bankId: bid, valor: v, data: baixaForm.data } });
    setBanks(banks.map((b) => (b.id === bid ? { ...b, saldo: Number(b.saldo || 0) + (e.type === "in" ? v : -v) } : b)));
    setBaixaOpen(null);
  };
  const estornar = (e) => {
    const s = settle[e.id]; if (!s) return;
    const v = Number(s.valor) || 0;
    setBanks(banks.map((b) => (b.id === s.bankId ? { ...b, saldo: Number(b.saldo || 0) - (e.type === "in" ? v : -v) } : b)));
    const ns = { ...settle }; delete ns[e.id]; setSettle(ns);
  };
  const addBanco = () => {
    if (!novoBanco.nome) return;
    setBanks([...banks, { id: "b" + Date.now(), nome: novoBanco.nome, saldo: Number(novoBanco.saldo) || 0 }]);
    setNovoBanco({ nome: "", saldo: "" });
  };
  const addExtra = () => {
    if (!form.name || !form.amount) return;
    setExtras([...extras, { ...form, id: Date.now() }]);
    setForm({ name: "", amount: "", date: form.date, type: form.type, freq: "once", vezes: "", cat: form.cat });
  };

  const sendChat = async () => {
    const q = chatInput.trim(); if (!q || chatBusy) return;
    const hist = [...chat, { role: "user", content: q }];
    setChat(hist); setChatInput(""); setChatBusy(true);
    try {
      const ctx = {
        empresa: "DR Marketing",
        hoje: iso(hoje0),
        saldoAtualBancos: Math.round(saldoAtual),
        bancos: banks.map((b) => ({ nome: b.nome, saldo: Math.round(Number(b.saldo || 0)) })),
        mesAtual: { mes: mLabel(MI_HOJE), receitasEmAberto: Math.round(projMesAtual.rec), despesasEmAberto: Math.round(projMesAtual.desp), saldoProjetadoFimDoMes: Math.round(projMesAtual.fim) },
        atrasados: { receber: Math.round(atrasadoIn), pagar: Math.round(atrasadoOut) },
        porMes: monthly.map((m) => ({ mes: m.nome, receitas: Math.round(m.inSum), despesas: Math.round(m.outSum), saldoProjetadoFim: Math.round(m.saldo) })),
        lancamentosManuais: extras,
      };
      const instr =
        "Você é o copiloto financeiro da DR Marketing — consultoria e aceleração de vendas em Recife, sociedade de Demian Paes Barreto e Rodrigo Castro — dentro do Cockpit DR. " +
        "Responda em português do Brasil, curto e prático. Contexto atual: " + JSON.stringify(ctx) + ". " +
        "PRODUTOS DA DR: Escalada no Digital, Plano 45, Consultoria e Mentoria, Trade Marketing, IA para Executivos, Palestras/Workshops. " +
        "REGRAS DA CASA: nunca informe preços de produtos; nunca cite casos ou resultados de clientes; o método da DR tem exatamente 6 passos; consórcio é segmento de cliente e tema de palestra, nunca produto. " +
        "CATEGORIAS DE RECEITA: " + cats.in.join(", ") + ". CATEGORIAS DE DESPESA: " + cats.out.join(", ") + ". " +
        "MODELO FINANCEIRO: o saldo atual dos bancos já inclui tudo que foi baixado; a projeção é saldo atual + (receitas em aberto − despesas em aberto) do período. Lançamento baixado não entra na projeção de novo. " +
        "Se pedirem ALTERAÇÃO, responda SOMENTE JSON puro: {\"reply\":\"...\",\"actions\":[...]}. Ações: " +
        '{"type":"add_extra","name":"...","amount":123,"date":"YYYY-MM-DD","kind":"in|out","freq":"once|mensal|semanal","vezes":0,"cat":"categoria"} | ' +
        '{"type":"remove_extra","name":"parte do nome"} | {"type":"add_bank","name":"...","saldo":0}. ' +
        "Use sempre uma categoria da lista acima no campo cat. Datas entre " + ISO_START + " e " + ISO_END + ". " +
        "Para VÁRIOS lançamentos devolva TODAS as ações no mesmo array actions e mantenha reply curto. " +
        "Dúvida ou análise: responda texto normal. Nunca invente números fora do contexto.";
      const apiMessages = hist.map((m, i) => (i === hist.length - 1 ? { role: m.role, content: instr + "\n\nMensagem do Demian: " + m.content } : m));
      const res = await fetch("/.netlify/functions/claude", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: apiMessages }) });
      const data = await res.json();
      const text = (data.text || "").trim();
      let reply = text || "Sem resposta.";
      const clean = text.replace(/```json|```/g, "").trim();
      let parsed = null;
      try { if (clean.startsWith("{")) parsed = JSON.parse(clean); } catch (e) {}
      if (!parsed && clean.includes('"type"')) {
        const acts = []; const re = /\{[^{}]*"type"\s*:\s*"(?:add_extra|remove_extra|set_eupet|add_bank)"[^{}]*\}/g; let m;
        while ((m = re.exec(clean))) { try { acts.push(JSON.parse(m[0])); } catch (e) {} }
        if (acts.length) { const rm = clean.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/); parsed = { reply: rm ? rm[1].replace(/\\"/g, '"') : null, actions: acts }; }
      }
      try {
        if (parsed) {
          const nAct = (parsed.actions || []).length;
          reply = parsed.reply || (nAct ? `✓ ${nAct} alteração(ões) aplicada(s).` : reply);
          (parsed.actions || []).forEach((a) => {
            if (a.type === "add_extra" && a.name && a.amount && a.date)
              setExtras((prev) => [...prev, { name: a.name, amount: Number(a.amount), date: a.date, type: a.kind === "in" ? "in" : "out", freq: ["mensal", "semanal"].includes(a.freq) ? a.freq : "once", vezes: Number(a.vezes) || "", cat: a.cat || (a.kind === "in" ? "Outros" : "Diversos"), id: Date.now() + Math.random() }]);
            if (a.type === "remove_extra" && a.name)
              setExtras((prev) => prev.filter((x) => !x.name.toLowerCase().includes(String(a.name).toLowerCase())));
            if (a.type === "add_bank" && a.name) setBanks((prev) => [...prev, { id: "b" + Date.now(), nome: a.name, saldo: Number(a.saldo) || 0 }]);
          });
        }
      } catch (e) {}
      setChat([...hist, { role: "assistant", content: reply }]);
    } catch (e) { setChat([...hist, { role: "assistant", content: "⚠ Não consegui conectar agora." }]); }
    setChatBusy(false);
  };

  const tooltipStyle = { background: C.cardSoft, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12 };
  const tabs = [["saude", "Saúde"], ["mov", "Movimentações"], ["bancos", "Bancos"], ["diario", "Diário"], ["semanal", "Semanal"], ["mensal", "Mensal"], ["receitas", "Receitas"], ["despesas", "Despesas"], ["cenarios", "Cenários"], ["cat", "Categorias"], ["lanc", "Cadastro"]];
  const NAV = [["saude", "Saúde", "💚"], ["mov", "Movim.", "🔁"], ["receitas", "Receitas", "📈"], ["despesas", "Despesas", "📉"], ["mensal", "Mensal", "📊"]];
  /* campo de período com botão Aplicar — só confirma ao clicar */
  const filtroDatas = (deD, ateD, setDeD, setAteD, setDe, setAte, deAtual, ateAtual) => {
    const pendente = deD !== deAtual || ateD !== ateAtual;
    const aplicar = (d1, d2) => { setDeD(d1); setAteD(d2); setDe(d1); setAte(d2); };
    const addD = (n) => { const d = new Date(hoje0); d.setDate(d.getDate() + n); return iso(d); };
    const opts = [
      ["Este mês", iso(mDate(MI_HOJE, 1)), iso(mDate(MI_HOJE, mLast(MI_HOJE)))],
      ["Próx. 30 dias", iso(hoje0), addD(30)],
      ["Próx. 90 dias", iso(hoje0), addD(90)],
      ["Vencidos", ISO_START, iso(new Date(hoje0.getTime() - 86400000))],
      ["Tudo", ISO_START, ISO_END],
    ];
    return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ color: C.dim, fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>De
          <input type="date" value={deD} min={ISO_START} max={ISO_END} onChange={(e) => setDeD(e.target.value)}
            style={{ ...inputSt, borderColor: pendente ? C.accent : C.border }} /></label>
        <label style={{ color: C.dim, fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>Até
          <input type="date" value={ateD} min={ISO_START} max={ISO_END} onChange={(e) => setAteD(e.target.value)}
            style={{ ...inputSt, borderColor: pendente ? C.accent : C.border }} /></label>
        <button onClick={() => { setDe(deD); setAte(ateD); }} disabled={!pendente}
          style={{ background: pendente ? C.accent : C.cardSoft, color: pendente ? "#1A1205" : FAINT,
            border: `1px solid ${pendente ? C.accent : C.border}`, borderRadius: 8, padding: "8px 16px",
            fontWeight: 800, fontSize: 12, cursor: pendente ? "pointer" : "default" }}>
          {pendente ? "🔎 Aplicar filtro" : "✓ Aplicado"}
        </button>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {opts.map(([l, d1, d2]) => (
            <button key={l} onClick={() => aplicar(d1, d2)}
              style={{ ...chip(deAtual === d1 && ateAtual === d2, C.blue), padding: "5px 10px", fontSize: 11 }}>{l}</button>
          ))}
        </div>
        {pendente && <span style={{ color: C.accent, fontSize: 10.5, width: "100%" }}>⚠ Datas alteradas — clique em Aplicar filtro para atualizar os valores.</span>}
      </div>
    );
  };

  const fIni = () => (fluxoModo === "mes" ? mDate(mesFiltro, 1) : pdate(fluxoDe));
  const fFim = () => (fluxoModo === "mes" ? mDate(mesFiltro, mLast(mesFiltro)) : pdate(fluxoAte));

  /* ===== linha de movimentação (função inline: preserva o foco) ===== */
  const movRow = (e) => {
    const st = stOf(e), pago = isPaid(e), s = settle[e.id];
    const cor = e.type === "in" ? C.income : C.expense;
    const banco = pago ? bancoDe(s.bankId) : null;
    const atrasado = !pago && e.date < hoje0;
    return (
      <div key={e.id} style={{ borderTop: `1px solid ${C.border}`, padding: "8px 0", opacity: pago ? 0.8 : 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: atrasado ? C.expense : C.text, background: C.cardSoft, border: `1px solid ${atrasado ? C.expense : C.border}`, borderRadius: 6, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>{dKey(e.date)}</span>
          <span style={{ flex: 1, minWidth: 120, fontSize: 12.5, color: C.text }}>
            {e.name}
            {e.editado && <span style={{ color: C.accent, fontSize: 9, marginLeft: 4 }}>editado</span>}
            <span style={{ color: FAINT, fontSize: 10, marginLeft: 6 }}>{catOf(e)}</span>
            {pago && banco && <span style={{ color: C.blue, fontSize: 10, marginLeft: 6 }}>· {banco.nome}</span>}
            {atrasado && <span style={{ color: C.expense, fontSize: 10, marginLeft: 6, fontWeight: 700 }}>· atrasado</span>}
          </span>
          {!pago ? (
            <select value={st} onChange={(ev) => setStItem({ ...stItem, [e.id]: ev.target.value })} title="Status"
              style={{ ...inputSt, padding: "4px 6px", fontSize: 11, fontWeight: 700, borderColor: STATUS[st].color, color: STATUS[st].color }}>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k} style={{ color: C.text }}>{v.label}</option>)}
            </select>
          ) : (
            <span style={{ background: "rgba(45,212,167,0.12)", border: `1px solid ${C.income}`, color: C.income, borderRadius: 7, padding: "3px 8px", fontSize: 10, fontWeight: 800 }}>✓ NO SALDO</span>
          )}
          <span style={{ color: cor, fontWeight: 700, fontSize: 13, minWidth: 86, textAlign: "right" }}>
            {e.type === "in" ? "+" : "−"}{fmt2(valOf(e))}
          </span>
          <div style={{ display: "flex", gap: 5 }}>
            {pago ? (
              <button onClick={() => estornar(e)} title="Desfaz a baixa e devolve o valor ao banco"
                style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, borderRadius: 7, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>Estornar</button>
            ) : (
              <button onClick={() => abrirBaixa(e)} style={{ background: cor, border: "none", color: "#0E1420", borderRadius: 7, padding: "4px 12px", fontSize: 11, fontWeight: 800, cursor: "pointer" }}>
                {e.type === "in" ? "Receber" : "Pagar"}
              </button>
            )}
            <button onClick={() => { setBaixaOpen(null); setEditOpen(editOpen === e.id ? null : e.id); setEditForm({ name: e.name, amount: String(e.amount.toFixed(2)), date: iso(e.date), cat: catOf(e) }); }}
              title="Editar" style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, borderRadius: 7, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}>✎</button>
            <button onClick={() => { if (confirm(`Excluir "${e.name}" de ${dKey(e.date)}?`)) { if (settle[e.id]) estornar(e); setOvr({ ...ovr, [e.id]: { ...(ovr[e.id] || {}), deleted: true } }); } }}
              title="Excluir" style={{ background: "none", border: `1px solid ${C.border}`, color: C.expense, borderRadius: 7, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}>🗑</button>
          </div>
        </div>

        {baixaOpen === e.id && (() => {
          const bk = bancoDe(baixaForm.bankId);
          const v = Number(baixaForm.valor) || e.amount;
          const antes = Number(bk?.saldo || 0);
          const depois = antes + (e.type === "in" ? v : -v);
          return (
            <div style={{ marginTop: 8, background: C.cardSoft, borderRadius: 10, padding: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select value={baixaForm.bankId} onChange={(ev) => setBaixaForm({ ...baixaForm, bankId: ev.target.value })} style={inputSt}>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
              </select>
              <input type="number" step="0.01" value={baixaForm.valor} onChange={(ev) => setBaixaForm({ ...baixaForm, valor: ev.target.value })} style={{ ...inputSt, width: 110 }} />
              <input type="date" value={baixaForm.data} onChange={(ev) => setBaixaForm({ ...baixaForm, data: ev.target.value })} style={inputSt} />
              <span style={{ fontSize: 11.5, color: C.dim }}>
                {bk ? <>Saldo <b style={{ color: C.text }}>{bk.nome}</b>: {fmt2(antes)} → <b style={{ color: depois < 0 ? C.expense : C.income }}>{fmt2(depois)}</b></> : "Cadastre um banco"}
              </span>
              <button onClick={() => confirmarBaixa(e)} style={{ background: C.income, border: "none", color: "#08201A", borderRadius: 8, padding: "8px 16px", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>Confirmar</button>
              <button onClick={() => setBaixaOpen(null)} style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, borderRadius: 8, padding: "8px 14px", fontSize: 12, cursor: "pointer" }}>Cancelar</button>
            </div>
          );
        })()}

        {editOpen === e.id && (
          <div style={{ marginTop: 8, background: C.cardSoft, borderRadius: 10, padding: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input value={editForm.name} onChange={(ev) => setEditForm({ ...editForm, name: ev.target.value })} placeholder="Descrição" style={{ ...inputSt, flex: 1, minWidth: 140 }} />
            <input type="number" step="0.01" value={editForm.amount} onChange={(ev) => setEditForm({ ...editForm, amount: ev.target.value })} style={{ ...inputSt, width: 110 }} />
            <input type="date" value={editForm.date} onChange={(ev) => setEditForm({ ...editForm, date: ev.target.value })} style={inputSt} />
            <select value={editForm.cat} onChange={(ev) => setEditForm({ ...editForm, cat: ev.target.value })} style={inputSt}>
              {(cats[e.type] || []).map((c) => <option key={c} value={c}>{c}</option>)}
              {!(cats[e.type] || []).includes(editForm.cat) && <option value={editForm.cat}>{editForm.cat}</option>}
            </select>
            <button onClick={() => { setOvr({ ...ovr, [e.id]: { ...(ovr[e.id] || {}), name: editForm.name, amount: Number(editForm.amount), date: editForm.date, cat: editForm.cat } }); setEditOpen(null); }}
              style={{ background: C.accent, border: "none", color: "#1A1205", borderRadius: 8, padding: "8px 16px", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>Salvar</button>
            {ovr[e.id] && <button onClick={() => { const o = { ...ovr }; delete o[e.id]; setOvr(o); setEditOpen(null); }}
              style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, borderRadius: 8, padding: "8px 12px", fontSize: 12, cursor: "pointer" }}>Restaurar original</button>}
            <button onClick={() => setEditOpen(null)} style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, borderRadius: 8, padding: "8px 12px", fontSize: 12, cursor: "pointer" }}>Cancelar</button>
          </div>
        )}
      </div>
    );
  };

  /* ===== controle de período dos fluxos ===== */
  const fluxoCtl = () => (
    <Card style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {[["mes", "Por mês"], ["periodo", "Por período"]].map(([k, l]) => (
          <button key={k} onClick={() => setFluxoModo(k)} style={chip(fluxoModo === k, C.accent)}>{l}</button>
        ))}
      </div>
      {fluxoModo === "mes" ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {MLIST.map((m) => <button key={m} onClick={() => setMesFiltro(m)} style={chip(mesFiltro === m, C.blue)}>{mLabel(m)}</button>)}
        </div>
      ) : (
        filtroDatas(fluxoDeD, fluxoAteD, setFluxoDeD, setFluxoAteD, setFluxoDe, setFluxoAte, fluxoDe, fluxoAte)
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ color: FAINT, fontSize: 11 }}>Considerar:</span>
        {Object.entries(STATUS).map(([k, v]) => (
          <button key={k} onClick={() => setScenClasses({ ...scenClasses, [k]: !scenClasses[k] })} style={chip(scenClasses[k], v.color)}>
            {scenClasses[k] ? "✓ " : ""}{v.label}
          </button>
        ))}
        <button onClick={() => setVerBaixados(!verBaixados)} style={{ ...chip(verBaixados, C.dim), marginLeft: "auto" }}>
          {verBaixados ? "✓ " : ""}Mostrar baixados
        </button>
      </div>
      <div style={{ color: FAINT, fontSize: 10.5 }}>
        A projeção parte do <b style={{ color: C.dim }}>saldo atual dos bancos</b> e soma só o que está <b style={{ color: C.dim }}>em aberto</b>. O que já foi baixado está dentro do saldo e não entra de novo.
      </div>
    </Card>
  );

  /* ===== faixa de saldos (sempre visível) ===== */
  const faixaSaldos = () => (
    <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
      {[
        { l: "Saldo atual (bancos)", v: saldoAtual, c: saldoAtual < 0 ? C.expense : C.text, s: `${banks.length} conta(s)` },
        { l: `Projeção ${mLabel(MI_HOJE)}`, v: projMesAtual.fim, c: projMesAtual.fim < 0 ? C.expense : C.accent, s: `${projMesAtual.res >= 0 ? "+" : ""}${fmt(projMesAtual.res)} em aberto` },
        { l: "Projeção do período", v: projSaude.fim, c: projSaude.fim < 0 ? C.expense : C.blue, s: `${dKey(pdate(saudeDe))} → ${dKey(pdate(saudeAte))}` },
      ].map((k) => (
        <div key={k.l} style={{ flex: 1, minWidth: 150, background: C.cardSoft, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px" }}>
          <div style={{ color: C.dim, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8 }}>{k.l}</div>
          <div style={{ color: k.c, fontSize: 19, fontWeight: 800 }}>{fmt(k.v)}</div>
          <div style={{ color: FAINT, fontSize: 10 }}>{k.s}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "ui-sans-serif, system-ui, sans-serif", padding: isMobile ? 10 : 16, paddingBottom: isMobile ? 78 : 16 }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 800, margin: 0 }}>
              Cockpit <span style={{ color: C.accent }}>DR</span>
            </h1>
            <div style={{ color: C.dim, fontSize: 11 }}>DR Marketing · hoje {dKeyY(hoje0)}</div>
          </div>
          <button onClick={onLogout} style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, borderRadius: 8, padding: "6px 12px", fontSize: 11, cursor: "pointer" }}>Sair</button>
        </div>

        {isMobile ? (
          <select value={tab} onChange={(e) => setTab(e.target.value)} style={{ ...inputSt, width: "100%", marginBottom: 12, padding: "11px 10px", fontSize: 14, fontWeight: 700 }}>
            {tabs.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        ) : (
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={chip(tab === k, C.accent)}>{l}</button>)}
          </div>
        )}

        {faixaSaldos()}

        {/* ===================== SAÚDE ===================== */}
        {tab === "saude" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Card style={{ padding: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.dim }}>📅 Período</span>
              {filtroDatas(saudeDeD, saudeAteD, setSaudeDeD, setSaudeAteD, setSaudeDe, setSaudeAte, saudeDe, saudeAte)}
            </Card>

            <Card style={{ background: "linear-gradient(135deg, rgba(245,165,36,0.08), transparent)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.dim, marginBottom: 8 }}>
                🧮 A CONTA DO PERÍODO ({dKey(pdate(saudeDe))} → {dKey(pdate(saudeAte))})
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 10, flexWrap: "wrap", fontSize: isMobile ? 12 : 13 }}>
                <span style={{ color: C.dim }}>Saldo inicial<br /><b style={{ color: C.text, fontSize: 17 }}>{fmt(projSaude.ini)}</b></span>
                <span style={{ color: FAINT, fontSize: 18 }}>+</span>
                <span style={{ color: C.dim }}>Receitas<br /><b style={{ color: C.income, fontSize: 17 }}>{fmt(projSaude.rec)}</b></span>
                <span style={{ color: FAINT, fontSize: 18 }}>−</span>
                <span style={{ color: C.dim }}>Despesas<br /><b style={{ color: C.expense, fontSize: 17 }}>{fmt(projSaude.desp)}</b></span>
                <span style={{ color: FAINT, fontSize: 18 }}>=</span>
                <span style={{ color: C.dim }}>Saldo final<br /><b style={{ color: projSaude.fim < 0 ? C.expense : C.accent, fontSize: 20 }}>{fmt(projSaude.fim)}</b></span>
              </div>
              <div style={{ color: FAINT, fontSize: 10.5, marginTop: 8 }}>
                Saldo inicial = saldo atual dos bancos {projSaude.ini !== saldoAtual && <>({fmt(saldoAtual)}) ajustado pelo que está em aberto antes de {dKey(pdate(saudeDe))}</>}. Só lançamentos <b style={{ color: C.dim }}>em aberto</b> entram.
              </div>
            </Card>

            {boxesPeriodo(projSaude)}

            {(atrasadoIn > 0 || atrasadoOut > 0) && (
              <Card style={{ borderColor: C.accent, background: "rgba(245,165,36,0.07)" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.accent, marginBottom: 4 }}>⏰ Vencidos e ainda em aberto</div>
                <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.6 }}>
                  {atrasadoOut > 0 && <>A pagar: <b style={{ color: C.expense }}>{fmt2(atrasadoOut)}</b>. </>}
                  {atrasadoIn > 0 && <>A receber: <b style={{ color: C.income }}>{fmt2(atrasadoIn)}</b>. </>}
                  Eles continuam somando na projeção até você dar baixa ou excluir — por isso o número pode parecer alto.
                </div>
              </Card>
            )}

            {projSaude.min.saldo < 0 && (
              <Card style={{ borderColor: C.expense, background: "rgba(240,97,109,0.08)" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.expense, marginBottom: 6 }}>⚠ Déficit no período</div>
                <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.6 }}>
                  O caixa fica negativo em <b style={{ color: C.text }}>{projSaude.min.key}</b>. Para não faltar dinheiro, é preciso um reforço de{" "}
                  <b style={{ color: C.expense, fontSize: 16 }}>{fmt2(-projSaude.min.saldo)}</b>.
                  {projSaude.fim < 0 && <> Para fechar o período no zero: <b style={{ color: C.expense }}>{fmt2(-projSaude.fim)}</b>.</>}
                </div>
              </Card>
            )}

            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Saldo por banco <span style={{ color: FAINT, fontWeight: 400, fontSize: 11 }}>— situação de hoje</span></div>
              {banks.map((b) => (
                <div key={b.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "5px 0", borderTop: `1px solid ${C.border}` }}>
                  <span style={{ color: C.dim }}>{b.nome}</span>
                  <b style={{ color: Number(b.saldo) < 0 ? C.expense : C.text }}>{fmt2(Number(b.saldo || 0))}</b>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "8px 0 0", borderTop: `2px solid ${C.border}`, marginTop: 4 }}>
                <b>Total</b><b style={{ color: C.accent }}>{fmt2(saldoAtual)}</b>
              </div>
            </Card>

            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Saldo projetado dia a dia</div>
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <AreaChart data={chartSaude}>
                    <defs>
                      <linearGradient id="gS" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.accent} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={C.accent} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                    <XAxis dataKey="d" tick={{ fill: FAINT, fontSize: 10 }} interval="preserveStartEnd" minTickGap={28} />
                    <YAxis tick={{ fill: FAINT, fontSize: 10 }} width={52} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(v)} />
                    <ReferenceLine y={0} stroke={C.expense} strokeDasharray="4 4" />
                    <Area type="monotone" dataKey="saldo" stroke={C.accent} strokeWidth={2} fill="url(#gS)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Diagnóstico</div>
              {(() => {
                const porCat = {};
                abertos.filter((e) => e.type === "out" && e.date >= pdate(saudeDe) && e.date <= pdate(saudeAte))
                  .forEach((e) => { const c = catOf(e); porCat[c] = (porCat[c] || 0) + e.amount; });
                const top = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
                const neg = monthly.filter((m) => m.inSum - m.outSum < 0);
                const margem = projSaude.rec ? (projSaude.res / projSaude.rec) * 100 : 0;
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13, color: C.dim, lineHeight: 1.5 }}>
                    <div><span style={{ color: projSaude.res >= 0 ? C.income : C.expense, fontWeight: 700 }}>{projSaude.res >= 0 ? "✓" : "✕"} Margem do período: {margem.toFixed(0)}%.</span> {fmt(projSaude.res)} sobre {fmt(projSaude.rec)} de receita prevista.</div>
                    {top.length > 0 && <div><span style={{ color: C.blue, fontWeight: 700 }}>◎ Maiores despesas:</span> {top.map(([c, v]) => `${c} (${fmt(v)})`).join(" · ")}.</div>}
                    {neg.length > 0 && <div><span style={{ color: C.expense, fontWeight: 700 }}>⚠ Meses com resultado negativo:</span> {neg.map((m) => m.nome).join(", ")}.</div>}
                    {abertos.length === 0 && <div>Nenhum lançamento em aberto — a projeção é igual ao saldo atual.</div>}
                  </div>
                );
              })()}
            </Card>
          </div>
        )}

        {/* ===================== MOVIMENTAÇÕES ===================== */}
        {tab === "mov" && (() => {
          const mDe = movModo === "mes" ? mDate(movMes, 1) : pdate(movDe);
          const mAte = movModo === "mes" ? mDate(movMes, mLast(movMes)) : pdate(movAte);
          const filtrandoRec = movTipo !== "todos" || movCat !== "todas" || !!movBusca.trim();
          const filtrando = filtrandoRec;
          /* UM filtro só — a lista e todos os boxes saem daqui */
          const passa = (e) => {
            if (movTipo !== "todos" && e.type !== movTipo) return false;
            if (movStatus === "pend" && isPaid(e)) return false;
            if (movStatus === "pago" && !isPaid(e)) return false;
            if (!isPaid(e) && !movSt[stOf(e)]) return false;
            if (movCat !== "todas" && catOf(e) !== movCat) return false;
            if (movBusca.trim()) {
              const q = movBusca.trim().toLowerCase();
              if (!(e.name.toLowerCase().includes(q) || catOf(e).toLowerCase().includes(q))) return false;
            }
            return true;
          };
          const passaFluxo = (e) => movSt[stOf(e)];
          const pMov = calcPeriodo(passa, mDe, mAte, filtrandoRec ? passaFluxo : null);
          const lista = pMov.dentro;

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Card style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.dim }}>🔎 Filtros</div>
                <input placeholder="Buscar por descrição ou categoria…" value={movBusca} onChange={(e) => setMovBusca(e.target.value)} style={{ ...inputSt, width: "100%", boxSizing: "border-box" }} />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[["mes", "Por mês"], ["periodo", "Por período"]].map(([k, l]) => <button key={k} onClick={() => setMovModo(k)} style={chip(movModo === k, C.accent)}>{l}</button>)}
                </div>
                {movModo === "mes" ? (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {MLIST.map((m) => <button key={m} onClick={() => setMovMes(m)} style={chip(movMes === m, C.blue)}>{mLabel(m)}</button>)}
                  </div>
                ) : (
                  filtroDatas(movDeD, movAteD, setMovDeD, setMovAteD, setMovDe, setMovAte, movDe, movAte)
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {[["todos", "Tudo"], ["in", "Receitas"], ["out", "Despesas"]].map(([k, l]) => <button key={k} onClick={() => setMovTipo(k)} style={chip(movTipo === k, C.accent)}>{l}</button>)}
                  <div style={{ width: 1, height: 20, background: C.border, margin: "0 2px" }} />
                  {[["pend", "Em aberto"], ["pago", "Baixados"], ["todos", "Todos"]].map(([k, l]) => <button key={k} onClick={() => setMovStatus(k)} style={chip(movStatus === k, C.income)}>{l}</button>)}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <select value={movCat} onChange={(e) => setMovCat(e.target.value)} style={inputSt}>
                    <option value="todas">Todas as categorias</option>
                    {[...new Set([...cats.out, ...cats.in])].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <span style={{ color: FAINT, fontSize: 11 }}>Status:</span>
                  {Object.entries(STATUS).map(([k, v]) => (
                    <button key={k} onClick={() => setMovSt({ ...movSt, [k]: !movSt[k] })} style={chip(movSt[k], v.color)}>{movSt[k] ? "✓ " : ""}{v.label}</button>
                  ))}
                  <button onClick={() => { setMovBusca(""); setMovTipo("todos"); setMovStatus("pend"); setMovSt({ conf: true, aconf: true, prov: true }); setMovModo("mes"); setMovCat("todas"); }}
                    style={{ ...chip(false, C.dim), marginLeft: "auto" }}>↺ Limpar</button>
                </div>
              </Card>
              {boxesPeriodo(pMov)}
              {filtrando && (
                <div style={{ color: FAINT, fontSize: 11, background: C.cardSoft, borderRadius: 8, padding: "7px 10px", lineHeight: 1.5 }}>
                  🔎 Filtro ativo ({movTipo !== "todos" ? (movTipo === "in" ? "só receitas" : "só despesas") : null}{movTipo !== "todos" && (movCat !== "todas" || movBusca.trim()) ? " · " : ""}{movCat !== "todas" ? `categoria ${movCat}` : ""}{movCat !== "todas" && movBusca.trim() ? " · " : ""}{movBusca.trim() ? `busca "${movBusca.trim()}"` : ""}) — <b style={{ color: C.dim }}>Receitas, Despesas e Resultado</b> são só da lista filtrada. <b style={{ color: C.dim }}>Saldo inicial, final e menor</b> continuam sendo os do caixa inteiro, porque o dinheiro na conta não depende do filtro.
                </div>
              )}
              <Card>
                <div style={{ fontSize: 11.5, color: FAINT, marginBottom: 4, lineHeight: 1.5 }}>
                  <b style={{ color: C.text }}>Receber / Pagar</b> dá baixa e altera o saldo do banco na hora · <b style={{ color: C.text }}>Estornar</b> desfaz · <b style={{ color: C.text }}>✎</b> edita · <b style={{ color: C.text }}>🗑</b> exclui.
                  {nExcluidos > 0 && <span style={{ color: C.expense }}> · {nExcluidos} excluído(s) — restaure em Cadastro.</span>}
                </div>
                {lista.length === 0 && <div style={{ color: FAINT, fontSize: 12, padding: "10px 0" }}>Nenhum lançamento com esses filtros.</div>}
                {lista.map((e) => movRow(e))}
              </Card>
            </div>
          );
        })()}

        {/* ===================== BANCOS ===================== */}
        {tab === "bancos" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Card style={{ borderColor: C.accent }}>
              <div style={{ color: C.dim, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Saldo atual total</div>
              <div style={{ color: saldoAtual < 0 ? C.expense : C.income, fontSize: 30, fontWeight: 800 }}>{fmt2(saldoAtual)}</div>
              <div style={{ color: FAINT, fontSize: 11, marginTop: 4 }}>
                Este é o número que manda. Toda baixa altera ele, e toda projeção parte dele.
              </div>
            </Card>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Contas</div>
              {banks.map((b) => (
                <div key={b.id} style={{ borderTop: `1px solid ${C.border}`, padding: "10px 0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input value={b.nome} onChange={(ev) => setBanks(banks.map((x) => (x.id === b.id ? { ...x, nome: ev.target.value } : x)))} style={{ ...inputSt, flex: 1, minWidth: 130 }} />
                  <label style={{ color: FAINT, fontSize: 10 }}>saldo atual</label>
                  <input type="number" step="0.01" value={b.saldo} onChange={(ev) => setBanks(banks.map((x) => (x.id === b.id ? { ...x, saldo: ev.target.value } : x)))} style={{ ...inputSt, width: 130, fontWeight: 700, color: Number(b.saldo) < 0 ? C.expense : C.income }} />
                  {banks.length > 1 && <button onClick={() => setBanks(banks.filter((x) => x.id !== b.id))} style={{ background: "none", border: "none", color: FAINT, cursor: "pointer", fontSize: 15 }}>✕</button>}
                </div>
              ))}
              <div style={{ color: FAINT, fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
                ✏️ Editar o saldo aqui é um <b style={{ color: C.dim }}>ajuste</b>: corrige o saldo atual e recalcula toda a previsão na hora. Use quando o extrato do banco não bater com o app.
              </div>
            </Card>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Cadastrar banco / conta</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input placeholder="Nome do banco / conta" value={novoBanco.nome} onChange={(e) => setNovoBanco({ ...novoBanco, nome: e.target.value })} style={{ ...inputSt, flex: 1, minWidth: 160 }} />
                <input type="number" step="0.01" placeholder="Saldo atual" value={novoBanco.saldo} onChange={(e) => setNovoBanco({ ...novoBanco, saldo: e.target.value })} style={{ ...inputSt, width: 140 }} />
                <button onClick={addBanco} style={{ background: C.accent, color: "#1A1205", border: "none", borderRadius: 8, padding: "8px 18px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>Adicionar</button>
              </div>
            </Card>
          </div>
        )}

        {/* ===================== DIÁRIO ===================== */}
        {tab === "diario" && (() => {
          const de = fIni(), ate = fFim();
          const p = calcPeriodo(passaAberto, de, ate);
          let sAcc = p.ini;
          const rows = p.dentro.map((e) => { sAcc += e.type === "in" ? e.amount : -e.amount; return { e, rec: e.type === "in" ? e.amount : 0, desp: e.type === "out" ? e.amount : 0, saldo: sAcc }; });
          const baix = verBaixados ? events.filter((e) => isPaid(e) && e.date >= de && e.date <= ate) : [];
          const fs = isMobile ? 10.5 : 12;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {fluxoCtl()}
              {boxesPeriodo(p, <KpiBox label="Lançamentos" value={String(rows.length)} sub="em aberto no período" />)}
              <Card style={{ padding: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto auto", gap: isMobile ? 4 : 8, fontSize: fs, alignItems: "center" }}>
                  <div style={{ color: FAINT, fontWeight: 700 }}>Data</div>
                  <div style={{ color: FAINT, fontWeight: 700 }}>Descrição</div>
                  <div style={{ color: FAINT, fontWeight: 700, textAlign: "right" }}>Receita</div>
                  <div style={{ color: FAINT, fontWeight: 700, textAlign: "right" }}>Despesa</div>
                  <div style={{ color: FAINT, fontWeight: 700, textAlign: "right" }}>Saldo</div>
                  <div style={{ gridColumn: "1 / -1", borderTop: `2px solid ${C.border}`, paddingTop: 5, display: "grid", gridTemplateColumns: "subgrid" }} />
                  <div style={{ color: C.dim, fontWeight: 700 }}>—</div>
                  <div style={{ color: C.dim }}>Saldo inicial do período</div>
                  <div /><div />
                  <div style={{ textAlign: "right", fontWeight: 800, color: C.text }}>{fmt2(p.ini)}</div>
                  {rows.map((r) => [
                    <div key={r.e.id + "a"} style={{ color: r.e.date < hoje0 ? C.expense : C.text, fontWeight: 700, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>{dKey(r.e.date)}</div>,
                    <div key={r.e.id + "b"} style={{ color: C.dim, borderTop: `1px solid ${C.border}`, paddingTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.e.name}
                      <span style={{ color: STATUS[stOf(r.e)].color, fontSize: 9, fontWeight: 800, marginLeft: 4 }}>{STATUS[stOf(r.e)].short}</span>
                      {!isMobile && <span style={{ color: FAINT, fontSize: 9.5, marginLeft: 6 }}>{catOf(r.e)}</span>}
                    </div>,
                    <div key={r.e.id + "c"} style={{ textAlign: "right", color: C.income, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>{r.rec ? fmt2(r.rec) : "—"}</div>,
                    <div key={r.e.id + "d"} style={{ textAlign: "right", color: C.expense, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>{r.desp ? fmt2(r.desp) : "—"}</div>,
                    <div key={r.e.id + "e"} style={{ textAlign: "right", fontWeight: 800, color: r.saldo < 0 ? C.expense : C.accent, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>{fmt2(r.saldo)}</div>,
                  ])}
                  {rows.length > 0 && [
                    <div key="tt1" style={{ borderTop: `2px solid ${C.accent}`, paddingTop: 6, fontWeight: 800, color: C.accent }}>TOTAL</div>,
                    <div key="tt2" style={{ borderTop: `2px solid ${C.accent}`, paddingTop: 6, color: C.dim }}>{rows.length} lançamento(s) · resultado {p.res >= 0 ? "+" : ""}{fmt2(p.res)}</div>,
                    <div key="tt3" style={{ borderTop: `2px solid ${C.accent}`, paddingTop: 6, textAlign: "right", fontWeight: 800, color: C.income }}>{fmt2(p.rec)}</div>,
                    <div key="tt4" style={{ borderTop: `2px solid ${C.accent}`, paddingTop: 6, textAlign: "right", fontWeight: 800, color: C.expense }}>{fmt2(p.desp)}</div>,
                    <div key="tt5" style={{ borderTop: `2px solid ${C.accent}`, paddingTop: 6, textAlign: "right", fontWeight: 800, color: p.fim < 0 ? C.expense : C.accent }}>{fmt2(p.fim)}</div>,
                  ]}
                </div>
                {rows.length === 0 && <div style={{ color: FAINT, fontSize: 12, paddingTop: 8 }}>Nenhum lançamento em aberto no período.</div>}
                {baix.length > 0 && (
                  <div style={{ marginTop: 14, borderTop: `2px solid ${C.border}`, paddingTop: 8 }}>
                    <div style={{ color: C.income, fontSize: 11, fontWeight: 700, marginBottom: 4 }}>✓ Já baixados — dentro do saldo atual, não entram na projeção</div>
                    {baix.map((e) => (
                      <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: fs, color: FAINT, padding: "2px 0" }}>
                        <span>{dKey(e.date)} · {e.name}</span>
                        <span>{e.type === "in" ? "+" : "−"}{fmt2(valOf(e))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          );
        })()}

        {/* ===================== SEMANAL ===================== */}
        {tab === "semanal" && (() => {
          const de = fIni(), ate = fFim();
          const p = calcPeriodo(passaAberto, de, ate);
          const wmap = new Map(); let sAcc = p.ini;
          p.dentro.forEach((e) => {
            sAcc += e.type === "in" ? e.amount : -e.amount;
            const mo = mondayOf(e.date), k = dKeyY(mo);
            if (!wmap.has(k)) wmap.set(k, { key: k, dt: mo, inSum: 0, outSum: 0, saldo: 0 });
            const w = wmap.get(k);
            if (e.type === "in") w.inSum += e.amount; else w.outSum += e.amount;
            w.saldo = sAcc;
          });
          const rows = [...wmap.values()];
          const fs = isMobile ? 10.5 : 12;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {fluxoCtl()}
              {boxesPeriodo(p, <KpiBox label="Semanas" value={String(rows.length)} sub="com movimento" />)}
              <Card>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Semanas (segunda a domingo)</div>
                <div style={{ display: "grid", gridTemplateColumns: "auto auto auto auto auto", gap: isMobile ? 4 : 6, fontSize: fs }}>
                  <div style={{ color: FAINT }}>Semana</div>
                  <div style={{ color: FAINT, textAlign: "right" }}>Saldo ini.</div>
                  <div style={{ color: FAINT, textAlign: "right" }}>Receitas</div>
                  <div style={{ color: FAINT, textAlign: "right" }}>Despesas</div>
                  <div style={{ color: FAINT, textAlign: "right" }}>Saldo fim</div>
                  {rows.map((w) => {
                    const res = w.inSum - w.outSum, si = w.saldo - res;
                    return [
                      <div key={w.key + "a"} style={{ fontWeight: 700, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>{w.key}</div>,
                      <div key={w.key + "b"} style={{ textAlign: "right", color: C.dim, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>{fmt(si)}</div>,
                      <div key={w.key + "c"} style={{ textAlign: "right", color: C.income, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>{fmt(w.inSum)}</div>,
                      <div key={w.key + "d"} style={{ textAlign: "right", color: C.expense, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>{fmt(w.outSum)}</div>,
                      <div key={w.key + "e"} style={{ textAlign: "right", color: w.saldo < 0 ? C.expense : C.accent, fontWeight: 700, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>{fmt(w.saldo)}</div>,
                    ];
                  })}
                  {rows.length > 0 && linhaTotal(p, 5, "sem")}
                </div>
                {rows.length === 0 && <div style={{ color: FAINT, fontSize: 12, paddingTop: 8 }}>Nenhum lançamento em aberto no período.</div>}
              </Card>
            </div>
          );
        })()}

        {/* ===================== MENSAL ===================== */}
        {tab === "mensal" && (() => {
          const de = fIni(), ate = fFim();
          const p = calcPeriodo(passaAberto, de, ate);
          const mmap = new Map(); let sAcc = p.ini;
          p.dentro.forEach((e) => {
            sAcc += e.type === "in" ? e.amount : -e.amount;
            const k = MIDX(e.date);
            if (!mmap.has(k)) mmap.set(k, { m: k, nome: mLabel(k), inSum: 0, outSum: 0, saldo: 0 });
            const g = mmap.get(k);
            if (e.type === "in") g.inSum += e.amount; else g.outSum += e.amount;
            g.saldo = sAcc;
          });
          const rows = [...mmap.values()].sort((a, b) => a.m - b.m);
          const fs = isMobile ? 10.5 : 12;
          const cm = rows.map((m) => ({ nome: m.nome, Receitas: Math.round(m.inSum), Despesas: Math.round(m.outSum), Saldo: Math.round(m.saldo) }));
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {fluxoCtl()}
              {boxesPeriodo(p, <KpiBox label="Meses" value={String(rows.length)} sub="com movimento" />)}
              <Card>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Receitas × Despesas e saldo projetado</div>
                <div style={{ color: FAINT, fontSize: 10.5, marginBottom: 8 }}>Barras = movimento em aberto do mês · Linha = saldo projetado no fim do mês</div>
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={cm}>
                      <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                      <XAxis dataKey="nome" tick={{ fill: FAINT, fontSize: 11 }} />
                      <YAxis tick={{ fill: FAINT, fontSize: 10 }} width={52} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(v)} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <ReferenceLine y={0} stroke={C.expense} strokeDasharray="4 4" />
                      <Bar dataKey="Receitas" fill={C.income} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Despesas" fill={C.expense} radius={[4, 4, 0, 0]} />
                      <Line type="monotone" dataKey="Saldo" stroke={C.accent} strokeWidth={2.5} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card>
                <div style={{ display: "grid", gridTemplateColumns: "auto auto auto auto auto", gap: isMobile ? 4 : 6, fontSize: fs }}>
                  <div style={{ color: FAINT }}>Mês</div>
                  <div style={{ color: FAINT, textAlign: "right" }}>Saldo ini.</div>
                  <div style={{ color: FAINT, textAlign: "right" }}>Receitas</div>
                  <div style={{ color: FAINT, textAlign: "right" }}>Despesas</div>
                  <div style={{ color: FAINT, textAlign: "right" }}>Saldo fim</div>
                  {rows.map((m) => {
                    const res = m.inSum - m.outSum, si = m.saldo - res;
                    return [
                      <div key={m.m + "a"} style={{ fontWeight: 700, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>{m.nome}</div>,
                      <div key={m.m + "b"} style={{ textAlign: "right", color: C.dim, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>{fmt(si)}</div>,
                      <div key={m.m + "c"} style={{ textAlign: "right", color: C.income, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>{fmt(m.inSum)}</div>,
                      <div key={m.m + "d"} style={{ textAlign: "right", color: C.expense, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>{fmt(m.outSum)}</div>,
                      <div key={m.m + "e"} style={{ textAlign: "right", color: m.saldo < 0 ? C.expense : C.accent, fontWeight: 700, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>{fmt(m.saldo)}</div>,
                    ];
                  })}
                  {rows.length > 0 && linhaTotal(p, 5, "men")}
                </div>
                {rows.length === 0 && <div style={{ color: FAINT, fontSize: 12, paddingTop: 8 }}>Nenhum lançamento em aberto no período.</div>}
              </Card>
            </div>
          );
        })()}

        {/* ===================== RECEITAS / DESPESAS ===================== */}
        {(tab === "receitas" || tab === "despesas") && (() => {
          const tipo = tab === "receitas" ? "in" : "out";
          const cor = tipo === "in" ? C.income : C.expense;
          const evs = abertos.filter((e) => e.type === tipo && (mesFiltro2 === -1 || MIDX(e.date) === mesFiltro2));
          const total = evs.reduce((s, e) => s + e.amount, 0);
          const map = new Map();
          evs.forEach((e) => {
            let k, ord;
            if (gran === "dia") { k = dKey(e.date); ord = e.date.getTime(); }
            else if (gran === "semana") { const mo = mondayOf(e.date); k = "Sem. de " + dKey(mo); ord = mo.getTime(); }
            else { k = mLabel(MIDX(e.date)); ord = MIDX(e.date); }
            if (!map.has(k)) map.set(k, { k, ord, total: 0, items: [], cats: new Map() });
            const g = map.get(k);
            g.total += e.amount; g.items.push(e);
            g.cats.set(catOf(e), (g.cats.get(catOf(e)) || 0) + e.amount);
          });
          const groups = [...map.values()].sort((a, b) => a.ord - b.ord);
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {[["dia", "Dia"], ["semana", "Semana"], ["mes", "Mês"]].map(([g, l]) => <button key={g} onClick={() => setGran(g)} style={chip(gran === g, cor)}>{l}</button>)}
                <div style={{ width: 1, height: 22, background: C.border, margin: "0 4px" }} />
                <button onClick={() => setMesFiltro2(-1)} style={chip(mesFiltro2 === -1, C.blue)}>Todos</button>
                {MLIST.map((m) => <button key={m} onClick={() => setMesFiltro2(m)} style={chip(mesFiltro2 === m, C.blue)}>{mLabel(m)}</button>)}
              </div>
              {(() => {
                const dR = mesFiltro2 === -1 ? START : mDate(mesFiltro2, 1);
                const aR = mesFiltro2 === -1 ? END : mDate(mesFiltro2, mLast(mesFiltro2));
                const pR = calcPeriodo((e) => passaAberto(e) && e.type === tipo, dR, aR, passaAberto);
                const outro = abertos.filter((e) => e.type !== tipo && e.date >= dR && e.date <= aR).reduce((t, e) => t + e.amount, 0);
                const res = tipo === "in" ? total - outro : outro - total;
                const nMes = new Set(evs.map((e) => MIDX(e.date))).size || 1;
                const porCat = {};
                evs.forEach((e) => { const c = catOf(e); porCat[c] = (porCat[c] || 0) + e.amount; });
                const topCat = Object.entries(porCat).sort((a, b) => b[1] - a[1])[0];
                return (
                  <>
                    <div style={{ color: FAINT, fontSize: 11 }}>
                      Subtotais de <b style={{ color: C.dim }}>{dKeyY(dR)}</b> a <b style={{ color: C.dim }}>{dKeyY(aR)}</b> · só lançamentos em aberto
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <KpiBox label={`Total de ${tab} no período`} value={fmt(total)} sub={`${evs.length} lançamento(s)`} color={cor} big />
                      <KpiBox label={tipo === "in" ? "Despesas no período" : "Receitas no período"} value={fmt(outro)} color={tipo === "in" ? C.expense : C.income} />
                      <KpiBox label="Resultado no período" value={`${res >= 0 ? "+" : ""}${fmt(res)}`} color={res >= 0 ? C.income : C.expense} big />
                      <KpiBox label="Média por mês" value={fmt(total / nMes)} sub={`${nMes} mês(es)`} />
                      <KpiBox label="Maior categoria" value={topCat ? topCat[0] : "—"} sub={topCat ? fmt(topCat[1]) : ""} color={cor} />
                      <KpiBox label="Saldo final do período" value={fmt(pR.fim)} sub={`de ${fmt(pR.ini)}`} color={pR.fim < 0 ? C.expense : C.accent} />
                    </div>
                  </>
                );
              })()}
              {groups.map((g) => {
                const ek = tab + gran + g.k;
                const isOpen = gran === "dia" ? true : !!expanded[ek];
                return (
                  <Card key={g.k} style={{ padding: 12 }}>
                    <div onClick={() => gran !== "dia" && setExpanded({ ...expanded, [ek]: !isOpen })}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, cursor: gran !== "dia" ? "pointer" : "default", userSelect: "none" }}>
                      <div style={{ fontWeight: 800, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
                        {gran !== "dia" && <span style={{ color: cor, fontSize: 11, display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none" }}>▶</span>}
                        {g.k}
                        {gran !== "dia" && <span style={{ color: FAINT, fontSize: 10, fontWeight: 400 }}>{isOpen ? "recolher" : `${g.items.length} itens`}</span>}
                      </div>
                      <div style={{ color: cor, fontWeight: 800, fontSize: 14 }}>{fmt2(g.total)}</div>
                    </div>
                    {gran !== "dia" && !isOpen && [...g.cats.entries()].sort((a, b) => b[1] - a[1]).map(([cat, v], i) => (
                      <div key={cat} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderTop: i ? `1px solid ${C.border}` : "none" }}>
                        <span style={{ color: C.dim }}>{cat}</span><span style={{ color: cor, fontWeight: 600 }}>{fmt2(v)}</span>
                      </div>
                    ))}
                    {isOpen && g.items.slice().sort((a, b) => a.date - b.date).map((e, i) => (
                      <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "4px 0", borderTop: i ? `1px solid ${C.border}` : "none" }}>
                        <span style={{ color: C.dim, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <span style={{ color: C.text, background: C.cardSoft, border: `1px solid ${C.border}`, borderRadius: 6, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>{dKey(e.date)}</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <span style={{ color: FAINT, fontSize: 10, marginRight: 6 }}>{catOf(e)}</span>{e.name}
                          </span>
                          <span style={{ color: STATUS[stOf(e)].color, fontSize: 9, fontWeight: 800 }}>{STATUS[stOf(e)].short}</span>
                        </span>
                        <span style={{ color: cor, fontWeight: 600, marginLeft: 8 }}>{fmt2(e.amount)}</span>
                      </div>
                    ))}
                  </Card>
                );
              })}
            </div>
          );
        })()}

        {/* ===================== CENÁRIOS ===================== */}
        {tab === "cenarios" && (() => {
          const inPeriod = (e) => mesFiltro3 === -1 || MIDX(e.date) === mesFiltro3;
          const evPer = events.filter((e) => !isPaid(e) && inPeriod(e));
          const inclPer = evPer.filter((e) => scenClasses[stOf(e)]);
          const recIncl = inclPer.filter((e) => e.type === "in").reduce((s, e) => s + e.amount, 0);
          const despIncl = inclPer.filter((e) => e.type === "out").reduce((s, e) => s + e.amount, 0);
          const recBase = evPer.filter((e) => e.type === "in").reduce((s, e) => s + e.amount, 0);
          const despBase = evPer.filter((e) => e.type === "out").reduce((s, e) => s + e.amount, 0);

          const combo = [];
          let cb = saldoAtual, cs = saldoAtual, curK = null, curMi = null;
          events.filter((e) => !isPaid(e)).forEach((e) => {
            const k = dKey(e.date);
            if (curK && k !== curK) combo.push({ d: curK, mi: curMi, base: Math.round(cb), cenario: Math.round(cs) });
            curK = k; curMi = MIDX(e.date);
            cb += e.type === "in" ? e.amount : -e.amount;
            if (scenClasses[stOf(e)]) cs += e.type === "in" ? e.amount : -e.amount;
          });
          if (curK) combo.push({ d: curK, mi: curMi, base: Math.round(cb), cenario: Math.round(cs) });
          const comboView = mesFiltro3 === -1 ? combo : combo.filter((x) => x.mi === mesFiltro3);

          const mm = new Map();
          inclPer.forEach((e) => {
            const k = MIDX(e.date);
            if (!mm.has(k)) mm.set(k, { ord: k, nome: mLabel(k), Receitas: 0, Despesas: 0 });
            const g = mm.get(k);
            if (e.type === "in") g.Receitas += e.amount; else g.Despesas += e.amount;
          });
          const barData = [...mm.values()].sort((a, b) => a.ord - b.ord).map((v) => ({ nome: v.nome, Receitas: Math.round(v.Receitas), Despesas: Math.round(v.Despesas) }));

          const series = (tipo) => {
            const map = new Map();
            evPer.filter((e) => e.type === tipo).forEach((e) => {
              if (!map.has(e.serie)) map.set(e.serie, { name: e.serie, grp: e.grp, total: 0, items: [] });
              const s = map.get(e.serie); s.total += e.amount; s.items.push(e);
            });
            return [...map.values()].sort((a, b) => b.total - a.total);
          };
          const blocoSerie = (tipo, titulo, cor) => (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{titulo}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: cor }}>
                  {fmt(tipo === "in" ? recIncl : despIncl)}
                  <span style={{ color: FAINT, fontWeight: 400, fontSize: 11 }}> / {fmt(tipo === "in" ? recBase : despBase)}</span>
                </div>
              </div>
              {series(tipo).map((s) => {
                const stSer = stSerie[s.name] || DEF_ST[s.grp] || "conf";
                const ek = "sc" + tipo + s.name;
                const isOpen = !!expanded[ek];
                const inclTotal = s.items.filter((e) => scenClasses[stOf(e)]).reduce((t, e) => t + e.amount, 0);
                const off = !scenClasses[stSer];
                return (
                  <div key={s.name} style={{ borderTop: `1px solid ${C.border}`, padding: "8px 0", opacity: off ? 0.45 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div onClick={() => setExpanded({ ...expanded, [ek]: !isOpen })} style={{ flex: 1, minWidth: 0, cursor: "pointer", userSelect: "none" }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <span style={{ color: cor, fontSize: 9, marginRight: 5, display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none" }}>▶</span>{s.name}
                        </div>
                        <div style={{ fontSize: 10, color: FAINT }}>{s.items.length}x em aberto</div>
                      </div>
                      <select value={stSer} onChange={(ev) => setStSerie({ ...stSerie, [s.name]: ev.target.value })} title="Status da série"
                        style={{ ...inputSt, padding: "4px 6px", fontSize: 11, fontWeight: 700, borderColor: STATUS[stSer].color, color: STATUS[stSer].color }}>
                        {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k} style={{ color: C.text }}>{v.label}</option>)}
                      </select>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: cor, minWidth: 74, textAlign: "right" }}>
                        {off ? <s style={{ color: FAINT }}>{fmt(s.total)}</s> : fmt(inclTotal)}
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ marginTop: 6, marginLeft: 14 }}>
                        {s.items.map((e) => (
                          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, padding: "3px 0" }}>
                            <span style={{ color: C.text, background: C.cardSoft, border: `1px solid ${C.border}`, borderRadius: 5, padding: "0 5px", fontSize: 9.5, fontWeight: 700 }}>{dKey(e.date)}</span>
                            <select value={stOf(e)} onChange={(ev) => setStItem({ ...stItem, [e.id]: ev.target.value })}
                              style={{ ...inputSt, padding: "1px 3px", fontSize: 10, fontWeight: 800, borderColor: STATUS[stOf(e)].color, color: STATUS[stOf(e)].color }}>
                              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k} style={{ color: C.text }}>{v.short}</option>)}
                            </select>
                            <span style={{ flex: 1, color: C.dim }}>{e.name}</span>
                            <span style={{ color: cor, fontWeight: 600 }}>{scenClasses[stOf(e)] ? fmt2(e.amount) : <s style={{ color: FAINT }}>{fmt2(e.amount)}</s>}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </Card>
          );

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={() => setMesFiltro3(-1)} style={chip(mesFiltro3 === -1, C.blue)}>Todos</button>
                {MLIST.map((m) => <button key={m} onClick={() => setMesFiltro3(m)} style={chip(mesFiltro3 === m, C.blue)}>{mLabel(m)}</button>)}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ color: FAINT, fontSize: 11 }}>Incluir:</span>
                {Object.entries(STATUS).map(([k, v]) => (
                  <button key={k} onClick={() => setScenClasses({ ...scenClasses, [k]: !scenClasses[k] })} style={chip(scenClasses[k], v.color)}>
                    {scenClasses[k] ? "✓ " : ""}{v.label}
                  </button>
                ))}
                <button onClick={() => { setStItem({}); setStSerie({}); setScenClasses({ conf: true, aconf: true, prov: true }); }} style={{ ...chip(false, C.dim), marginLeft: "auto" }}>↺ Resetar</button>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <KpiBox label="Saldo atual" value={fmt(saldoAtual)} sub="ponto de partida" />
                <KpiBox label="Receitas do cenário" value={fmt(recIncl)} sub={recIncl !== recBase ? `de ${fmt(recBase)} possíveis` : "tudo incluído"} color={C.income} />
                <KpiBox label="Despesas do cenário" value={fmt(despIncl)} sub={despIncl !== despBase ? `de ${fmt(despBase)} possíveis` : "tudo incluído"} color={C.expense} />
                <KpiBox label="Resultado no período" value={`${recIncl - despIncl >= 0 ? "+" : ""}${fmt(recIncl - despIncl)}`}
                  sub={`${fmt(recIncl)} − ${fmt(despIncl)}`} color={recIncl - despIncl >= 0 ? C.income : C.expense} big />
                <KpiBox label="Saldo final do cenário" value={fmt(saldoAtual + recIncl - despIncl)} color={saldoAtual + recIncl - despIncl < 0 ? C.expense : C.accent} big />
                {(() => { const d = (recIncl - despIncl) - (recBase - despBase);
                  return <KpiBox label="Diferença vs tudo" value={`${d >= 0 ? "+" : ""}${fmt(d)}`} sub={d === 0 ? "nada excluído" : "efeito dos filtros"} color={d === 0 ? C.dim : d > 0 ? C.income : C.expense} />; })()}
              </div>
              <Card>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                  Saldo projetado — <span style={{ color: C.accent }}>tudo</span> × <span style={{ color: C.blue }}>cenário</span>{mesFiltro3 !== -1 ? ` · ${mLabel(mesFiltro3)}` : ""}
                </div>
                <div style={{ width: "100%", height: 200 }}>
                  <ResponsiveContainer>
                    <AreaChart data={comboView}>
                      <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                      <XAxis dataKey="d" tick={{ fill: FAINT, fontSize: 10 }} interval="preserveStartEnd" minTickGap={28} />
                      <YAxis tick={{ fill: FAINT, fontSize: 10 }} width={52} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmt(v), n === "base" ? "Tudo" : "Cenário"]} />
                      <ReferenceLine y={0} stroke={C.expense} strokeDasharray="4 4" />
                      <Area type="monotone" dataKey="base" stroke={C.accent} strokeWidth={1.5} strokeDasharray="5 4" fill="none" />
                      <Area type="monotone" dataKey="cenario" stroke={C.blue} strokeWidth={2.5} fill="rgba(91,156,245,0.12)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Receitas × Despesas do cenário{mesFiltro3 !== -1 ? ` · ${mLabel(mesFiltro3)}` : ""}</div>
                <div style={{ width: "100%", height: 230 }}>
                  <ResponsiveContainer>
                    <BarChart data={barData}>
                      <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                      <XAxis dataKey="nome" tick={{ fill: FAINT, fontSize: 11 }} />
                      <YAxis tick={{ fill: FAINT, fontSize: 10 }} width={52} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(v)} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Receitas" fill={C.income} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Despesas" fill={C.expense} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              {blocoSerie("in", "💰 Receitas em aberto", C.income)}
              {blocoSerie("out", "💸 Despesas em aberto", C.expense)}
            </div>
          );
        })()}

        {/* ===================== CATEGORIAS ===================== */}
        {tab === "cat" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Cadastrar categoria</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select value={novaCat.tipo} onChange={(e) => setNovaCat({ ...novaCat, tipo: e.target.value })} style={inputSt}>
                  <option value="out">Despesa</option><option value="in">Receita</option>
                </select>
                <input placeholder="Nome da categoria" value={novaCat.nome} onChange={(e) => setNovaCat({ ...novaCat, nome: e.target.value })} style={{ ...inputSt, flex: 1, minWidth: 150 }} />
                <button onClick={() => {
                  const n = novaCat.nome.trim();
                  if (!n || cats[novaCat.tipo].includes(n)) return;
                  setCats({ ...cats, [novaCat.tipo]: [...cats[novaCat.tipo], n] });
                  setNovaCat({ nome: "", tipo: novaCat.tipo });
                }} style={{ background: C.accent, color: "#1A1205", border: "none", borderRadius: 8, padding: "8px 18px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>Adicionar</button>
              </div>
            </Card>
            {[["out", "Categorias de despesa", C.expense], ["in", "Categorias de receita", C.income]].map(([tp, titulo, cor]) => {
              const uso = {};
              abertos.filter((e) => e.type === tp).forEach((e) => { const c = catOf(e); uso[c] = (uso[c] || 0) + e.amount; });
              return (
                <Card key={tp}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: cor }}>{titulo} <span style={{ color: FAINT, fontWeight: 400, fontSize: 11 }}>— valor em aberto</span></div>
                  {cats[tp].map((c) => (
                    <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, borderTop: `1px solid ${C.border}`, padding: "8px 0" }}>
                      <span style={{ flex: 1, fontSize: 13 }}>{c}</span>
                      <span style={{ color: FAINT, fontSize: 11 }}>{uso[c] ? fmt(uso[c]) : "—"}</span>
                      <button onClick={() => setCats({ ...cats, [tp]: cats[tp].filter((x) => x !== c) })} style={{ background: "none", border: "none", color: FAINT, cursor: "pointer", fontSize: 14 }}>✕</button>
                    </div>
                  ))}
                  {Object.keys(uso).filter((c) => !cats[tp].includes(c)).map((c) => (
                    <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, borderTop: `1px solid ${C.border}`, padding: "8px 0", opacity: 0.6 }}>
                      <span style={{ flex: 1, fontSize: 13 }}>{c} <span style={{ color: C.accent, fontSize: 10 }}>(fora da lista)</span></span>
                      <span style={{ color: FAINT, fontSize: 11 }}>{fmt(uso[c])}</span>
                      <button onClick={() => setCats({ ...cats, [tp]: [...cats[tp], c] })} style={{ ...chip(false, C.income), padding: "2px 8px", fontSize: 10 }}>+ incluir</button>
                    </div>
                  ))}
                </Card>
              );
            })}
            <div style={{ color: FAINT, fontSize: 11 }}>Para trocar a categoria de um lançamento, use o ✎ em <b style={{ color: C.dim }}>Movimentações</b>.</div>
          </div>
        )}

        {/* ===================== CADASTRO ===================== */}
        {tab === "lanc" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Novo lançamento</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input placeholder="Descrição" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...inputSt, flex: 2, minWidth: 140 }} />
                <input type="number" placeholder="Valor" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={{ ...inputSt, width: 110 }} />
                <input type="date" value={form.date} min={ISO_START} max={ISO_END} onChange={(e) => setForm({ ...form, date: e.target.value })} style={inputSt} />
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, cat: e.target.value === "in" ? (cats.in[0] || "Outros") : (cats.out[0] || "Diversos") })} style={inputSt}>
                  <option value="in">Receita</option><option value="out">Despesa</option>
                </select>
                <select value={form.cat} onChange={(e) => setForm({ ...form, cat: e.target.value })} style={inputSt}>
                  {(cats[form.type] || []).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={form.freq} onChange={(e) => setForm({ ...form, freq: e.target.value })} style={{ ...inputSt, borderColor: form.freq !== "once" ? C.accent : C.border, color: form.freq !== "once" ? C.accent : C.text }}>
                  <option value="once">Única</option><option value="mensal">🔁 Mensal</option><option value="semanal">🔁 Semanal</option>
                </select>
                {form.freq !== "once" && <input type="number" min={1} max={60} placeholder="x vezes" value={form.vezes} onChange={(e) => setForm({ ...form, vezes: e.target.value })} style={{ ...inputSt, width: 84 }} />}
                <button onClick={addExtra} style={{ background: C.accent, color: "#1A1205", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Adicionar</button>
              </div>
              {extras.length > 0 && (
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                  {extras.map((x) => (
                    <div key={x.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, background: C.cardSoft, borderRadius: 8, padding: "6px 10px" }}>
                      <span style={{ color: C.dim }}>
                        {x.date.split("-").reverse().slice(0, 2).join("/")} · {x.name}
                        {(x.freq === "mensal" || x.freq === "semanal") && (
                          <span style={{ color: C.accent, fontSize: 10, fontWeight: 700, marginLeft: 6, border: `1px solid ${C.accent}`, borderRadius: 5, padding: "0 5px" }}>
                            🔁 {x.freq}{Number(x.vezes) ? ` ×${x.vezes}` : ""}
                          </span>
                        )}
                      </span>
                      <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <b style={{ color: x.type === "in" ? C.income : C.expense }}>{x.type === "in" ? "+" : "−"}{fmt2(Number(x.amount))}</b>
                        <button onClick={() => setExtras(extras.filter((e) => e.id !== x.id))} style={{ background: "none", border: "none", color: FAINT, cursor: "pointer", fontSize: 14 }}>✕</button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Parâmetros</div>
              <div style={{ color: C.dim, fontSize: 12, lineHeight: 1.5 }}>Cadastre os saldos em <b style={{ color: C.text }}>Bancos</b> e as receitas/despesas no formulário acima — ou peça ao Claude no chat.</div>
              {(nExcluidos > 0 || Object.keys(ovr).length > 0) && (
                <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ color: C.dim, fontSize: 12 }}>{nExcluidos} excluído(s) · {Object.values(ovr).filter((o) => !o.deleted).length} editado(s)</span>
                  {nExcluidos > 0 && <button onClick={() => { const o = {}; Object.entries(ovr).forEach(([k, v]) => { if (!v.deleted) o[k] = v; }); setOvr(o); }} style={{ ...chip(false, C.income), color: C.income, borderColor: C.income }}>↺ Restaurar excluídos</button>}
                  <button onClick={() => { if (confirm("Desfazer todas as edições e exclusões?")) setOvr({}); }} style={chip(false, C.dim)}>↺ Restaurar tudo</button>
                </div>
              )}
            </Card>

            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>💬 Falar com o Claude</div>
              <div style={{ color: FAINT, fontSize: 11, marginBottom: 10 }}>
                Dúvidas sobre os números ou alterações — ex: <i>"qual meu pior mês?"</i>, <i>"lança mentoria de 3500 todo dia 10 por 6 meses"</i>, <i>"cadastra o banco Inter com saldo 3000"</i>.
              </div>
              {chat.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto", marginBottom: 10, paddingRight: 4 }}>
                  {chat.map((m, i) => (
                    <div key={i} style={{
                      alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%",
                      background: m.role === "user" ? "rgba(245,165,36,0.14)" : C.cardSoft,
                      border: `1px solid ${m.role === "user" ? "rgba(245,165,36,0.4)" : C.border}`,
                      borderRadius: m.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                      padding: "8px 12px", fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap",
                    }}>
                      {m.role === "assistant" && <span style={{ color: C.accent, fontWeight: 800, fontSize: 10, display: "block", marginBottom: 2 }}>CLAUDE</span>}
                      {m.content}
                    </div>
                  ))}
                  {chatBusy && <div style={{ color: FAINT, fontSize: 12, padding: "4px 8px" }}>Claude está analisando…</div>}
                </div>
              )}
              <textarea value={chatInput}
                onChange={(e) => { setChatInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 220) + "px"; }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                placeholder="Escreva sua pergunta ou comando… (Shift+Enter pula linha)" disabled={chatBusy} rows={3}
                style={{ width: "100%", boxSizing: "border-box", resize: "vertical", minHeight: 76, maxHeight: 220, background: C.cardSoft, border: `1px solid ${C.border}`, color: C.text, borderRadius: 10, padding: "10px 12px", fontSize: 13.5, lineHeight: 1.5, outline: "none", fontFamily: "inherit" }} />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={sendChat} disabled={chatBusy || !chatInput.trim()}
                  style={{ background: chatBusy || !chatInput.trim() ? C.cardSoft : C.accent, color: chatBusy || !chatInput.trim() ? FAINT : "#1A1205", border: "none", borderRadius: 10, padding: "10px 24px", fontWeight: 800, fontSize: 13, cursor: chatBusy ? "wait" : "pointer" }}>
                  {chatBusy ? "Analisando…" : "Enviar ➤"}
                </button>
              </div>
            </Card>
          </div>
        )}
      </div>

      {isMobile && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: C.card, borderTop: `1px solid ${C.border}`, display: "flex", zIndex: 60, boxShadow: "0 -6px 18px rgba(0,0,0,0.45)" }}>
          {NAV.map(([k, l, ic]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ flex: 1, background: "none", border: "none", padding: "9px 2px 11px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: tab === k ? C.accent : C.dim, borderTop: `2px solid ${tab === k ? C.accent : "transparent"}` }}>
              <span style={{ fontSize: 17, lineHeight: 1 }}>{ic}</span>
              <span style={{ fontSize: 9.5, fontWeight: 700 }}>{l}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
