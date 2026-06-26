// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · modulos/dashboard_admin.js · Módulo 13-A           ║
// ║  Dashboard Admin — 8 blocos em tempo real                      ║
// ╚══════════════════════════════════════════════════════════════════╝

import { db } from "../firebase-config.js";
import {
  collection, doc, getDoc, getDocs, updateDoc,
  query, where, limit, onSnapshot, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { notificar }                              from "../notificacoes.js";
import { formatarMoeda, registrarErro }           from "../utils.js";

// ── Estado ──────────────────────────────────────────────────────────────────
let _unsubCaixa  = null;
let _unsubComun  = null;
let _unsubStatus = null;
let _chart       = null;
let _sessao      = null;
let _empresaId   = "";

function _limparListeners() {
  if (_unsubCaixa)  { _unsubCaixa();  _unsubCaixa  = null; }
  if (_unsubComun)  { _unsubComun();  _unsubComun  = null; }
  if (_unsubStatus) { _unsubStatus(); _unsubStatus = null; }
  if (_chart)       { _chart.destroy(); _chart = null; }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function _tsParaDate(ts) {
  if (!ts) return null;
  if (ts?.toDate) return ts.toDate();
  if (ts?.seconds) return new Date(ts.seconds * 1000);
  return new Date(ts);
}
function _formatarHorario(ts) {
  const d = _tsParaDate(ts);
  if (!d || isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function _inicioHoje()  { const d = new Date(); d.setHours(0,0,0,0); return d; }
function _inicioMes()   { const d = new Date(); d.setHours(0,0,0,0); d.setDate(1); return d; }

// ── Bloco 1: Status do Caixa ─────────────────────────────────────────────────
async function _renderizarCaixa() {
  const el = document.getElementById("dash-bloco-caixa");
  if (!el) return;

  let caixaId = null;
  let caixaData = null;
  try {
    const snap = await getDocs(query(
      collection(db, "empresas", _empresaId, "caixa"),
      where("fechadoEm", "==", null), limit(1)
    ));
    if (!snap.empty) { caixaId = snap.docs[0].id; caixaData = snap.docs[0].data(); }
  } catch (err) { registrarErro("firestore", err.message, "dashboard_admin.js"); }

  const isOnline  = navigator.onLine;
  const isPro     = _sessao.plano === "profissional";
  const abertaStr = caixaData ? `às ${_formatarHorario(caixaData.abertaEm)}` : "";
  const statusBadge = caixaData
    ? `<span style="display:inline-flex;align-items:center;gap:6px;background:#E8F5E9;color:#2E7D32;padding:5px 12px;border-radius:20px;font-size:13px;font-weight:600">🟢 Aberto ${abertaStr}</span>`
    : `<span style="display:inline-flex;align-items:center;gap:6px;background:#FFEBEE;color:#C62828;padding:5px 12px;border-radius:20px;font-size:13px;font-weight:600">🔴 Fechado</span>`;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <h3 style="margin:0;font-size:15px;font-weight:700;color:var(--text)">Caixa do Dia</h3>
      ${statusBadge}
    </div>
    <div style="display:grid;grid-template-columns:${window._layoutMobile ? "repeat(2,1fr)" : "repeat(4,1fr)"};gap:12px;margin-bottom:16px">
      <div class="stat-card">
        <div style="font-size:11px;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">Saldo</div>
        <div id="dash-cxa-saldo" style="font-size:20px;font-weight:700;color:var(--text)">—</div>
      </div>
      <div class="stat-card">
        <div style="font-size:11px;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">Entradas</div>
        <div id="dash-cxa-entradas" style="font-size:20px;font-weight:700;color:#2E7D32">—</div>
      </div>
      <div class="stat-card">
        <div style="font-size:11px;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">Saques</div>
        <div id="dash-cxa-saques" style="font-size:20px;font-weight:700;color:#C62828">—</div>
      </div>
      <div class="stat-card">
        <div style="font-size:11px;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">Resultado</div>
        <div id="dash-cxa-resultado" style="font-size:20px;font-weight:700">—</div>
        <div id="dash-cxa-tendencia" style="font-size:11px;margin-top:4px;color:#aaa"></div>
      </div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      <button id="dash-btn-nova-venda" class="btn btn-primary btn-sm">+ Nova Venda</button>
      ${isOnline ? `<button id="dash-btn-crediario" class="btn btn-secondary btn-sm">Receb. Crediário</button>` : ""}
      ${isPro && isOnline ? `<button id="dash-btn-whatsapp" class="btn btn-sm" style="background:#25D366;border:none;color:#fff;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:600;cursor:pointer">WhatsApp Resumo</button>` : ""}
    </div>`;

  document.getElementById("dash-btn-nova-venda")?.addEventListener("click", () =>
    document.querySelector('[data-rota="vendas"]')?.click());
  document.getElementById("dash-btn-crediario")?.addEventListener("click", () =>
    document.querySelector('[data-rota="crediario"]')?.click());

  if (!caixaId) return;

  // onSnapshot nas movimentações para atualizar cards em tempo real
  const movRef = collection(db, "empresas", _empresaId, "caixa", caixaId, "movimentacoes");
  _unsubCaixa = onSnapshot(movRef, async (snap) => {
    let totalEntradas = 0, totalSaques = 0;
    snap.docs.forEach(d => {
      const m   = d.data();
      const val = Number(m.valor || 0);
      if (m.tipo === "saque")          totalSaques   += Math.abs(val);
      else if (m.tipo === "cancelamento") totalSaques += Math.abs(val);
      else if (m.tipo !== "abertura")  totalEntradas += Math.max(0, val);
    });
    const saldo    = (caixaData.valorInicial || 0) + totalEntradas - totalSaques;
    const resultado = totalEntradas - totalSaques;

    const elS = document.getElementById("dash-cxa-saldo");
    const elE = document.getElementById("dash-cxa-entradas");
    const elSq = document.getElementById("dash-cxa-saques");
    const elR = document.getElementById("dash-cxa-resultado");
    const elT = document.getElementById("dash-cxa-tendencia");
    if (elS)  elS.textContent  = formatarMoeda(saldo);
    if (elE)  elE.textContent  = formatarMoeda(totalEntradas);
    if (elSq) elSq.textContent = formatarMoeda(totalSaques);
    if (elR) { elR.textContent = formatarMoeda(resultado); elR.style.color = resultado >= 0 ? "#2E7D32" : "#C62828"; }

    // Tendência vs mesmo dia semana passada
    if (elT) {
      try {
        const semPassada    = new Date(); semPassada.setDate(semPassada.getDate() - 7); semPassada.setHours(0,0,0,0);
        const semPassadaFim = new Date(semPassada); semPassadaFim.setHours(23,59,59,999);
        const qSem = query(
          collection(db, "empresas", _empresaId, "vendas"),
          where("createdAt", ">=", Timestamp.fromDate(semPassada)),
          where("createdAt", "<=", Timestamp.fromDate(semPassadaFim))
        );
        let totalSem = 0;
        (await getDocs(qSem)).docs.forEach(d => {
          if (!d.data().cancelada) totalSem += (d.data().totalLiquido || 0);
        });
        if (totalSem > 0) {
          const diff = totalEntradas - totalSem;
          const pct  = Math.round(Math.abs(diff / totalSem) * 100);
          elT.textContent = diff >= 0 ? `▲ ${pct}% vs semana passada` : `▼ ${pct}% vs semana passada`;
          elT.style.color = diff >= 0 ? "#2E7D32" : "#C62828";
        } else { elT.textContent = ""; }
      } catch { elT.textContent = ""; }
    }

    // WhatsApp (reconfigura listener a cada update de movimentação, sem acumular)
    const btnWA = document.getElementById("dash-btn-whatsapp");
    if (btnWA) {
      const novoBtn = btnWA.cloneNode(true);
      btnWA.replaceWith(novoBtn);
      novoBtn.addEventListener("click", () => {
        const msg = `*Resumo do Dia — ${new Date().toLocaleDateString("pt-BR")}*\n`
          + `Saldo: ${formatarMoeda(saldo)}\n`
          + `Entradas: ${formatarMoeda(totalEntradas)}\n`
          + `Saques: ${formatarMoeda(totalSaques)}\n`
          + `Resultado: ${formatarMoeda(resultado)}`;
        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
      });
    }
  }, err => registrarErro("firestore", err.message, "dashboard_admin.js"));
}

// ── Bloco 2: Status dos Dispositivos (Pro) ───────────────────────────────────
async function _renderizarDispositivos() {
  if (_sessao.plano !== "profissional") return;
  const el = document.getElementById("dash-bloco-dispositivos");
  if (!el) return;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h3 style="margin:0;font-size:15px;font-weight:700;color:var(--text)">Status dos Dispositivos</h3>
      <button id="dash-btn-sync" class="btn btn-sm btn-secondary">↻ Forçar Sync</button>
    </div>
    <div id="dash-disp-lista" style="display:flex;flex-direction:column;gap:8px">
      <p style="color:#aaa;font-size:13px">Aguardando operadores…</p>
    </div>`;

  document.getElementById("dash-btn-sync")?.addEventListener("click", async () => {
    try {
      const { sincronizarManual } = await import("../syncManager.js");
      const res = await sincronizarManual();
      if (res.ok) notificar("sucesso", "Sync executado", "Dados sincronizados com sucesso.");
      else        notificar("aviso",   "Sync",           res.erro || "Não foi possível sincronizar agora.");
    } catch (err) { registrarErro("sync", err.message, "dashboard_admin.js"); }
  });

  const statusRef = collection(db, "empresas", _empresaId, "status");
  _unsubStatus = onSnapshot(statusRef, (snap) => {
    const lista = document.getElementById("dash-disp-lista");
    if (!lista) return;
    if (snap.empty) {
      lista.innerHTML = `<p style="color:#aaa;font-size:13px">Nenhum operador conectado.</p>`;
      return;
    }
    lista.innerHTML = snap.docs.map(d => {
      const s      = d.data();
      const ultima = _formatarHorario(s.executadoEm);
      const ok     = s.resultado?.ok;
      return `<div style="display:flex;justify-content:space-between;align-items:center;background:#f9f9f9;border-radius:8px;padding:10px 14px">
        <div>
          <div style="font-size:14px;font-weight:600;color:var(--text)">${s.nome || d.id}</div>
          <div style="font-size:12px;color:#888">Última sync: ${ultima}</div>
        </div>
        <span class="tag ${ok ? "tag-success" : "tag-neutral"}">${s.resultado?.msg || "—"}</span>
      </div>`;
    }).join("");
  }, err => registrarErro("firestore", err.message, "dashboard_admin.js"));
}

// ── Bloco 3: Estoque Baixo ───────────────────────────────────────────────────
async function _renderizarEstoque() {
  const el = document.getElementById("dash-bloco-estoque");
  if (!el) return;
  try {
    const snap = await getDocs(query(
      collection(db, "empresas", _empresaId, "produtos"),
      where("ativo", "==", true),
      where("controlarEstoque", "==", true)
    ));
    const criticos = snap.docs.filter(d => {
      const p = d.data();
      return (p.estoqueAtual || 0) <= (p.estoqueMinimo || 0) && (p.estoqueMinimo || 0) > 0;
    });

    if (criticos.length === 0) {
      el.innerHTML = `
        <h3 style="margin:0 0 10px;font-size:15px;font-weight:700;color:var(--text)">Estoque</h3>
        <p style="color:#aaa;font-size:13px">Todos os produtos estão com estoque adequado.</p>`;
      return;
    }
    el.innerHTML = `
      <h3 style="margin:0 0 10px;font-size:15px;font-weight:700;color:var(--text)">Estoque Baixo
        <span class="tag tag-danger" style="margin-left:6px">${criticos.length}</span>
      </h3>
      ${criticos.map(d => {
        const p      = d.data();
        const isZero = (p.estoqueAtual || 0) === 0;
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0">
          <span style="font-size:14px;color:var(--text)">${p.nome}</span>
          <span class="tag ${isZero ? "tag-danger" : "tag-warning"}">${isZero ? "Sem estoque" : `${p.estoqueAtual} un`}</span>
        </div>`;
      }).join("")}`;
  } catch (err) { registrarErro("firestore", err.message, "dashboard_admin.js"); }
}

// ── Bloco 4: Aniversários do Dia ─────────────────────────────────────────────
async function _renderizarAniversarios() {
  const el = document.getElementById("dash-bloco-aniversarios");
  if (!el) return;
  try {
    const snap   = await getDocs(query(collection(db, "empresas", _empresaId, "clientes"), where("ativo", "==", true)));
    const hoje   = new Date();
    const diaH   = String(hoje.getDate()).padStart(2, "0");
    const mesH   = String(hoje.getMonth() + 1).padStart(2, "0");
    const anivs  = snap.docs
      .map(d => d.data())
      .filter(c => {
        const p = (c.dataNascimento || "").split("/");
        return p.length >= 2 && p[0] === diaH && p[1] === mesH;
      });

    if (anivs.length === 0) {
      el.innerHTML = `
        <h3 style="margin:0 0 10px;font-size:15px;font-weight:700;color:var(--text)">Aniversários</h3>
        <p style="color:#aaa;font-size:13px">Nenhum aniversariante hoje.</p>`;
      return;
    }
    el.innerHTML = `
      <h3 style="margin:0 0 10px;font-size:15px;font-weight:700;color:var(--text)">🎂 Aniversários
        <span class="tag tag-accent" style="margin-left:6px">${anivs.length}</span>
      </h3>
      ${anivs.map(c => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0f0f0">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0">${(c.nome || "?")[0].toUpperCase()}</div>
          <div>
            <div style="font-size:14px;font-weight:600;color:var(--text)">${c.nome}</div>
            ${c.telefone ? `<div style="font-size:12px;color:#888">${c.telefone}</div>` : ""}
          </div>
        </div>`).join("")}`;
  } catch (err) { registrarErro("firestore", err.message, "dashboard_admin.js"); }
}

// ── Bloco 5: Alertas Inteligentes ────────────────────────────────────────────
async function _renderizarAlertas() {
  const el = document.getElementById("dash-bloco-alertas");
  if (!el) return;
  const alertas = [];

  // Despesas vencendo em até 3 dias
  try {
    const hoje   = new Date(); hoje.setHours(0,0,0,0);
    const em3    = new Date(hoje); em3.setDate(em3.getDate() + 3);
    const snap   = await getDocs(query(collection(db, "empresas", _empresaId, "despesas"), where("pago", "==", false)));
    snap.docs.forEach(d => {
      const dep = d.data();
      if (!dep.dataVenc) return;
      const p = dep.dataVenc.split("/");
      if (p.length < 3) return;
      const venc = new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0]));
      if (venc >= hoje && venc <= em3) alertas.push({ ico: "⚠️", cor: "#F57F17", texto: `Despesa "${dep.nome}" vence em ${dep.dataVenc}` });
    });
  } catch { /* silencioso */ }

  // Parcelas crediário vencendo amanhã
  try {
    const amanha     = new Date(); amanha.setDate(amanha.getDate() + 1);
    const amanhaStr  = `${String(amanha.getDate()).padStart(2,"0")}/${String(amanha.getMonth()+1).padStart(2,"0")}`;
    const credSnap   = await getDocs(query(collection(db, "empresas", _empresaId, "crediario"), where("status", "!=", "quitado")));
    for (const credDoc of credSnap.docs) {
      try {
        const parcSnap = await getDocs(query(
          collection(db, "empresas", _empresaId, "crediario", credDoc.id, "parcelas"),
          where("status", "==", "aberto")
        ));
        parcSnap.docs.forEach(p => {
          const venc = (p.data().dataVencimento || "").slice(0, 5);
          if (venc === amanhaStr) alertas.push({ ico: "📅", cor: "#1565C0", texto: `Crediário ${credDoc.data().clienteNome || ""} vence amanhã` });
        });
      } catch { /* silencioso */ }
    }
  } catch { /* silencioso */ }

  if (alertas.length === 0) {
    el.innerHTML = `
      <h3 style="margin:0 0 10px;font-size:15px;font-weight:700;color:var(--text)">Alertas</h3>
      <p style="color:#aaa;font-size:13px">Nenhum alerta pendente.</p>`;
    return;
  }
  el.innerHTML = `
    <h3 style="margin:0 0 10px;font-size:15px;font-weight:700;color:var(--text)">Alertas
      <span class="tag tag-warning" style="margin-left:6px">${alertas.length}</span>
    </h3>
    ${alertas.map(a => `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid #f0f0f0">
        <span>${a.ico}</span>
        <span style="font-size:13px;color:${a.cor}">${a.texto}</span>
      </div>`).join("")}`;
}

// ── Bloco 6: Meta do Mês ─────────────────────────────────────────────────────
async function _renderizarMeta() {
  const el = document.getElementById("dash-bloco-meta");
  if (!el) return;
  try {
    const empSnap = await getDoc(doc(db, "empresas", _empresaId));
    const meta    = Number(empSnap.data()?.metaMensal || 0);

    const qVendas = query(
      collection(db, "empresas", _empresaId, "vendas"),
      where("createdAt", ">=", Timestamp.fromDate(_inicioMes()))
    );
    let faturamento = 0;
    (await getDocs(qVendas)).docs.forEach(d => {
      if (!d.data().cancelada) faturamento += (d.data().totalLiquido || 0);
    });

    if (!meta) {
      el.innerHTML = `
        <h3 style="margin:0 0 10px;font-size:15px;font-weight:700;color:var(--text)">Meta do Mês</h3>
        <p style="color:#aaa;font-size:13px;margin-bottom:10px">Meta não configurada.</p>
        <form id="form-meta-inline" style="display:flex;gap:8px;align-items:stretch">
          <input class="input" type="number" id="inp-meta-inline" min="1" step="0.01" placeholder="Ex: 5000,00" style="flex:1">
          <button class="btn btn-primary btn-sm" type="submit" data-acao="escrita">Salvar</button>
        </form>`;
      document.getElementById("form-meta-inline")?.addEventListener("submit", async e => {
        e.preventDefault();
        const val = parseFloat(document.getElementById("inp-meta-inline")?.value);
        if (!val || val <= 0) return;
        try {
          await updateDoc(doc(db, "empresas", _empresaId), { metaMensal: val });
          notificar("sucesso", "Meta salva", "Meta do mês definida.");
          _renderizarMeta();
        } catch (err) { registrarErro("firestore", err.message, "dashboard_admin.js"); }
      });
      return;
    }

    const pct = Math.min(100, Math.round((faturamento / meta) * 100));
    const cor = pct >= 100 ? "#2E7D32" : pct >= 60 ? "#F57F17" : "#C62828";
    el.innerHTML = `
      <h3 style="margin:0 0 12px;font-size:15px;font-weight:700;color:var(--text)">Meta do Mês</h3>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px">
        <span style="color:#555">${formatarMoeda(faturamento)} / ${formatarMoeda(meta)}</span>
        <span style="font-weight:700;color:${cor}">${pct}%</span>
      </div>
      <div style="height:10px;border-radius:6px;background:#f0f0f0;overflow:hidden">
        <div style="height:100%;width:${pct}%;border-radius:6px;background:${cor};transition:width .5s ease"></div>
      </div>
      <p style="font-size:12px;color:#888;margin-top:8px">
        ${pct >= 100 ? "🎉 Meta atingida!" : `Faltam ${formatarMoeda(meta - faturamento)}`}
      </p>`;
  } catch (err) { registrarErro("firestore", err.message, "dashboard_admin.js"); }
}

// ── Bloco 7: Gráfico da Semana ───────────────────────────────────────────────
async function _renderizarGrafico() {
  const el = document.getElementById("dash-bloco-grafico");
  if (!el) return;

  el.innerHTML = `
    <h3 style="margin:0 0 12px;font-size:15px;font-weight:700;color:var(--text)">Semana</h3>
    <div style="position:relative;height:${window._layoutMobile ? "180px" : "220px"}">
      <canvas id="dash-chart-canvas"></canvas>
    </div>`;

  try {
    if (!window.Chart) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js";
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    const labels = [], entradasData = [], saquesData = [];
    for (let i = 6; i >= 0; i--) {
      const d   = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
      const fim = new Date(d); fim.setHours(23,59,59,999);
      labels.push(d.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric" }));

      let entradas = 0, saques = 0;
      try {
        const caixaSnap = await getDocs(query(
          collection(db, "empresas", _empresaId, "caixa"),
          where("abertaEm", ">=", Timestamp.fromDate(d)),
          where("abertaEm", "<=", Timestamp.fromDate(fim))
        ));
        for (const caixaDoc of caixaSnap.docs) {
          const movSnap = await getDocs(collection(db, "empresas", _empresaId, "caixa", caixaDoc.id, "movimentacoes"));
          movSnap.docs.forEach(m => {
            const mv = m.data();
            if (mv.tipo === "saque") saques += Number(mv.valor || 0);
            else if (mv.tipo !== "abertura") entradas += Number(mv.valor || 0);
          });
        }
      } catch { /* silencioso */ }

      entradasData.push(Math.max(0, entradas));
      saquesData.push(Math.max(0, saques));
    }

    const ctx = document.getElementById("dash-chart-canvas");
    if (!ctx) return;
    if (_chart) { _chart.destroy(); _chart = null; }

    const isMobile = window._layoutMobile;
    _chart = new window.Chart(ctx, {
      type: isMobile ? "line" : "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Entradas",
            data: entradasData,
            backgroundColor: isMobile ? "rgba(46,125,50,.15)" : "rgba(46,125,50,.7)",
            borderColor: "#2E7D32",
            borderWidth: 2,
            tension: .3,
            fill: isMobile,
            pointRadius: isMobile ? 3 : 0,
          },
          {
            label: "Saques",
            data: saquesData,
            backgroundColor: isMobile ? "rgba(198,40,40,.1)" : "rgba(198,40,40,.5)",
            borderColor: "#C62828",
            borderWidth: 2,
            tension: .3,
            fill: isMobile,
            pointRadius: isMobile ? 3 : 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "top", labels: { font: { size: 11 }, boxWidth: 12 } } },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => "R$" + Number(v).toLocaleString("pt-BR") } },
        },
      },
    });
  } catch (err) {
    registrarErro("grafico", err.message, "dashboard_admin.js");
    const el2 = document.getElementById("dash-bloco-grafico");
    if (el2) el2.innerHTML += `<p style="color:#aaa;font-size:13px;margin-top:8px">Gráfico indisponível.</p>`;
  }
}

// ── Bloco 8: Comunicado Admin FSG ────────────────────────────────────────────
function _escutarComunicado() {
  const el = document.getElementById("dash-bloco-comunicado");
  if (!el) return;
  const refComun = doc(db, "comunicados", _empresaId);
  _unsubComun = onSnapshot(refComun, (snap) => {
    if (!snap.exists() || !snap.data()?.mensagem) { el.style.display = "none"; return; }
    const c = snap.data();
    el.style.display = "block";
    el.innerHTML = `
      <div style="background:linear-gradient(135deg,#6B3520 0%,#4A2218 100%);border-radius:12px;padding:18px 20px;color:#fff">
        <div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.65;margin-bottom:6px">Comunicado · Meu Caixa</div>
        <div style="font-size:14px;line-height:1.55">${c.mensagem}</div>
        ${c.botaoAcao ? `<button class="btn btn-sm" style="margin-top:12px;background:#fff;color:#6B3520;border:none;font-weight:700;cursor:pointer">${c.botaoAcao}</button>` : ""}
      </div>`;
  }, err => registrarErro("firestore", err.message, "dashboard_admin.js"));
}

// ── Exportar CSV (Pro) ───────────────────────────────────────────────────────
async function _exportarCSV() {
  try {
    const qVendas = query(
      collection(db, "empresas", _empresaId, "vendas"),
      where("createdAt", ">=", Timestamp.fromDate(_inicioMes()))
    );
    const snap = await getDocs(qVendas);
    let csv = "﻿";
    csv += "Data;Cliente;Qtd Itens;Forma Pagamento;Total\r\n";
    snap.docs.forEach(d => {
      const v = d.data();
      if (v.cancelada) return;
      const dt    = _tsParaDate(v.createdAt)?.toLocaleDateString("pt-BR") || "";
      const cli   = (v.nomeCliente || "Consumidor Final").replace(/;/g, ",");
      const itens = (v.itens || []).length;
      const forma = v.formaPagamento || "";
      const total = Number(v.totalLiquido || 0).toFixed(2).replace(".", ",");
      csv += `${dt};${cli};${itens};${forma};${total}\r\n`;
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `vendas_${new Date().toISOString().slice(0,7)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notificar("sucesso", "CSV exportado", "Arquivo de vendas do mês gerado com sucesso.");
  } catch (err) {
    registrarErro("csv", err.message, "dashboard_admin.js");
    notificar("erro", "Erro ao exportar", "Não foi possível gerar o CSV.");
  }
}

// ── Entrada do módulo ────────────────────────────────────────────────────────
export async function renderizar(sessao, containerEl) {
  _limparListeners();
  _sessao    = sessao;
  _empresaId = sessao.empresaId;

  const hoje  = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const isPro = sessao.plano === "profissional";
  const cols  = window._layoutMobile ? "1fr" : "repeat(2,1fr)";

  containerEl.innerHTML = `
    <div id="dashboard-area" class="fade-up">
      <div class="section-header" style="margin-bottom:4px">
        <h2>Olá, ${sessao.nome?.split(" ")[0] || "Admin"}</h2>
        ${isPro ? `<button id="dash-btn-csv" class="btn btn-sm btn-secondary">Exportar CSV</button>` : ""}
      </div>
      <p style="color:#aaa;font-size:14px;margin-bottom:20px">${hoje}</p>

      <!-- Bloco 8: Comunicado FSG (oculto até chegar mensagem) -->
      <div id="dash-bloco-comunicado" style="display:none;margin-bottom:16px"></div>

      <!-- Bloco 1: Caixa -->
      <div id="dash-bloco-caixa" class="card" style="padding:20px;margin-bottom:16px">
        <p style="color:#aaa;font-size:13px">Carregando caixa…</p>
      </div>

      <!-- Grid 2×2 -->
      <div style="display:grid;grid-template-columns:${cols};gap:16px;margin-bottom:16px">
        <div id="dash-bloco-meta"         class="card" style="padding:20px"><p style="color:#aaa;font-size:13px">Carregando…</p></div>
        <div id="dash-bloco-estoque"      class="card" style="padding:20px"><p style="color:#aaa;font-size:13px">Carregando…</p></div>
        <div id="dash-bloco-aniversarios" class="card" style="padding:20px"><p style="color:#aaa;font-size:13px">Carregando…</p></div>
        <div id="dash-bloco-alertas"      class="card" style="padding:20px"><p style="color:#aaa;font-size:13px">Carregando…</p></div>
      </div>

      <!-- Bloco 7: Gráfico -->
      <div id="dash-bloco-grafico" class="card" style="padding:20px;margin-bottom:16px">
        <p style="color:#aaa;font-size:13px">Carregando gráfico…</p>
      </div>

      ${isPro ? `
      <!-- Bloco 2: Dispositivos (Pro) -->
      <div id="dash-bloco-dispositivos" class="card" style="padding:20px;margin-bottom:16px">
        <p style="color:#aaa;font-size:13px">Carregando dispositivos…</p>
      </div>` : ""}
    </div>`;

  document.getElementById("dash-btn-csv")?.addEventListener("click", _exportarCSV);

  // Blocos independentes em paralelo
  await Promise.allSettled([
    _renderizarCaixa(),
    _renderizarEstoque(),
    _renderizarAniversarios(),
    _renderizarAlertas(),
    _renderizarMeta(),
    _renderizarGrafico(),
    isPro ? _renderizarDispositivos() : Promise.resolve(),
  ]);

  // Comunicado: listener em tempo real (não bloqueia render)
  _escutarComunicado();
}
