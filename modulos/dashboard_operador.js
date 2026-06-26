// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · modulos/dashboard_operador.js · Módulo 13-B        ║
// ║  Dashboard Operador — caixa, vendas, catálogo, estoque         ║
// ╚══════════════════════════════════════════════════════════════════╝

import { db } from "../firebase-config.js";
import {
  collection, doc, getDoc, getDocs,
  query, where, orderBy, limit, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { formatarMoeda } from "../utils.js";

// ── Estado ──────────────────────────────────────────────────────────────────
let _unsubCaixa = null;
let _sessao     = null;
let _empresaId  = "";

function _limparListeners() {
  if (_unsubCaixa) { _unsubCaixa(); _unsubCaixa = null; }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function _tsParaDate(ts) {
  if (!ts) return null;
  if (ts?.toDate)  return ts.toDate();
  if (ts?.seconds) return new Date(ts.seconds * 1000);
  return new Date(ts);
}
function _formatarHorario(ts) {
  const d = _tsParaDate(ts);
  if (!d || isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// ── Bloco 1: Caixa do Turno ─────────────────────────────────────────────────
async function _renderizarCaixa() {
  const el = document.getElementById("op-bloco-caixa");
  if (!el) return;

  let caixaId  = null;
  let caixaData = null;
  try {
    const snap = await getDocs(query(
      collection(db, "empresas", _empresaId, "caixa"),
      where("fechadoEm", "==", null), limit(1)
    ));
    if (!snap.empty) { caixaId = snap.docs[0].id; caixaData = snap.docs[0].data(); }
  } catch { /* silencioso */ }

  const isOnline  = navigator.onLine;
  const statusBadge = caixaData
    ? `<span style="display:inline-flex;align-items:center;gap:6px;background:#E8F5E9;color:#2E7D32;padding:5px 12px;border-radius:20px;font-size:13px;font-weight:600">🟢 Aberto às ${_formatarHorario(caixaData.abertaEm)}</span>`
    : `<span style="display:inline-flex;align-items:center;gap:6px;background:#FFEBEE;color:#C62828;padding:5px 12px;border-radius:20px;font-size:13px;font-weight:600">🔴 Fechado</span>`;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <h3 style="margin:0;font-size:15px;font-weight:700;color:var(--text)">Caixa do Turno</h3>
      ${statusBadge}
    </div>
    <div style="display:grid;grid-template-columns:${window._layoutMobile ? "repeat(2,1fr)" : "repeat(3,1fr)"};gap:12px;margin-bottom:16px">
      <div class="stat-card">
        <div style="font-size:11px;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">Entradas</div>
        <div id="op-cxa-entradas" style="font-size:20px;font-weight:700;color:#2E7D32">—</div>
      </div>
      <div class="stat-card">
        <div style="font-size:11px;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">Saques</div>
        <div id="op-cxa-saques" style="font-size:20px;font-weight:700;color:#C62828">—</div>
      </div>
      <div class="stat-card"${window._layoutMobile ? ` style="grid-column:span 2"` : ""}>
        <div style="font-size:11px;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">Nº de Vendas</div>
        <div id="op-cxa-vendas" style="font-size:20px;font-weight:700;color:var(--text)">—</div>
      </div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      <button id="op-btn-nova-venda" class="btn btn-primary btn-sm">+ Nova Venda</button>
      ${isOnline ? `<button id="op-btn-crediario" class="btn btn-secondary btn-sm">Receb. Crediário</button>` : ""}
    </div>`;

  document.getElementById("op-btn-nova-venda")?.addEventListener("click", () =>
    document.querySelector('[data-rota="vendas"]')?.click());
  document.getElementById("op-btn-crediario")?.addEventListener("click", () =>
    document.querySelector('[data-rota="crediario"]')?.click());

  if (!caixaId) return;

  const movRef = collection(db, "empresas", _empresaId, "caixa", caixaId, "movimentacoes");
  _unsubCaixa = onSnapshot(movRef, (snap) => {
    let totalEntradas = 0, totalSaques = 0, qtdVendas = 0;
    snap.docs.forEach(d => {
      const m   = d.data();
      const val = Number(m.valor || 0);
      if (m.tipo === "saque")             totalSaques   += Math.abs(val);
      else if (m.tipo === "cancelamento") totalSaques   += Math.abs(val);
      else if (m.tipo === "venda")        { totalEntradas += Math.max(0, val); qtdVendas++; }
      else if (m.tipo !== "abertura")     totalEntradas += Math.max(0, val);
    });
    const elE = document.getElementById("op-cxa-entradas");
    const elS = document.getElementById("op-cxa-saques");
    const elV = document.getElementById("op-cxa-vendas");
    if (elE) elE.textContent = formatarMoeda(totalEntradas);
    if (elS) elS.textContent = formatarMoeda(totalSaques);
    if (elV) elV.textContent = String(qtdVendas);
  });
}

// ── Bloco 2: Catálogo Rápido ─────────────────────────────────────────────────
function _renderizarCatalogo() {
  const el = document.getElementById("op-bloco-catalogo");
  if (!el) return;

  el.innerHTML = `
    <h3 style="margin:0 0 12px;font-size:15px;font-weight:700;color:var(--text)">Catálogo Rápido</h3>
    <div style="position:relative;margin-bottom:10px">
      <input id="op-inp-catalogo" class="input" type="search" placeholder="Buscar produto por nome…"
        style="padding-left:34px">
      <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#aaa;pointer-events:none">🔍</span>
    </div>
    <div id="op-catalogo-resultado" style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto">
      <p style="color:#aaa;font-size:13px;text-align:center;padding:12px 0">Digite para buscar</p>
    </div>`;

  const inp = document.getElementById("op-inp-catalogo");
  if (!inp) return;

  let timer;
  inp.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => _buscarCatalogo(inp.value.trim()), 220);
  });
}

function _buscarCatalogo(termo) {
  const lista = document.getElementById("op-catalogo-resultado");
  if (!lista) return;

  if (!termo || termo.length < 2) {
    lista.innerHTML = `<p style="color:#aaa;font-size:13px;text-align:center;padding:12px 0">Digite ao menos 2 letras</p>`;
    return;
  }

  // Kit offline primeiro
  try {
    const kit     = JSON.parse(localStorage.getItem("mc_kit_offline") || "{}");
    const prods   = kit.produtos || [];
    if (prods.length > 0) {
      const t   = termo.toLowerCase();
      const res = prods.filter(p => (p.nome || "").toLowerCase().includes(t)).slice(0, 8);
      _exibirResultadoCatalogo(lista, res);
      return;
    }
  } catch { /* fallback Firestore */ }

  lista.innerHTML = `<p style="color:#aaa;font-size:13px;text-align:center;padding:8px 0">Buscando…</p>`;
  getDocs(query(
    collection(db, "empresas", _empresaId, "produtos"),
    where("ativo", "==", true),
    orderBy("nome"), limit(20)
  )).then(snap => {
    const t   = termo.toLowerCase();
    const res = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(p => (p.nome || "").toLowerCase().includes(t))
      .slice(0, 8);
    _exibirResultadoCatalogo(lista, res);
  }).catch(() => {
    lista.innerHTML = `<p style="color:#aaa;font-size:13px;text-align:center;padding:8px 0">Sem conexão — use o kit offline.</p>`;
  });
}

function _exibirResultadoCatalogo(lista, produtos) {
  if (!produtos.length) {
    lista.innerHTML = `<p style="color:#aaa;font-size:13px;text-align:center;padding:12px 0">Nenhum produto encontrado.</p>`;
    return;
  }
  lista.innerHTML = produtos.map(p => {
    const estoqueAtual = p.estoqueAtual || 0;
    const estoqueTag   = p.controlarEstoque
      ? `<span style="font-size:11px;color:${estoqueAtual === 0 ? "#C62828" : "#888"}">${estoqueAtual === 0 ? "Sem estoque" : `${estoqueAtual} un`}</span>`
      : "";
    return `<div style="display:flex;justify-content:space-between;align-items:center;background:#f9f9f9;border-radius:8px;padding:10px 14px;gap:8px">
      <div style="min-width:0">
        <div style="font-size:14px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.nome}</div>
        ${estoqueTag}
      </div>
      <span style="font-size:15px;font-weight:700;color:var(--primary);white-space:nowrap">${formatarMoeda(p.precoVenda || 0)}</span>
    </div>`;
  }).join("");
}

// ── Bloco 3: Estoque Zerado ───────────────────────────────────────────────────
async function _renderizarEstoqueZerado() {
  const el = document.getElementById("op-bloco-estoque");
  if (!el) return;

  let zerados = [];

  // Kit offline primeiro
  try {
    const kit   = JSON.parse(localStorage.getItem("mc_kit_offline") || "{}");
    const prods = kit.produtos || [];
    if (prods.length > 0) {
      zerados = prods.filter(p => p.controlarEstoque && (p.estoqueAtual || 0) === 0);
    }
  } catch { /* fallback */ }

  // Fallback Firestore
  if (zerados.length === 0) {
    try {
      const snap = await getDocs(query(
        collection(db, "empresas", _empresaId, "produtos"),
        where("ativo", "==", true),
        where("controlarEstoque", "==", true),
        where("estoqueAtual", "==", 0)
      ));
      zerados = snap.docs.map(d => d.data());
    } catch { /* silencioso */ }
  }

  if (zerados.length === 0) {
    el.innerHTML = `
      <h3 style="margin:0 0 8px;font-size:15px;font-weight:700;color:var(--text)">Estoque</h3>
      <p style="color:#aaa;font-size:13px">Nenhum produto sem estoque. ✓</p>`;
    return;
  }

  el.innerHTML = `
    <h3 style="margin:0 0 10px;font-size:15px;font-weight:700;color:var(--text)">Estoque Zerado
      <span class="tag tag-danger" style="margin-left:6px">${zerados.length}</span>
    </h3>
    ${zerados.map(p => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #f0f0f0">
        <span style="font-size:14px;color:var(--text)">${p.nome}</span>
        <span class="tag tag-danger">Sem estoque</span>
      </div>`).join("")}`;
}

// ── Bloco 4: Indicador Offline ────────────────────────────────────────────────
function _renderizarIndicadorOffline() {
  const el = document.getElementById("op-bloco-offline");
  if (!el) return;

  function _atualizar() {
    const online     = navigator.onLine;
    let   ultimaSync = "—";
    let   extra      = "";

    try {
      const kit   = JSON.parse(localStorage.getItem("mc_kit_offline") || "{}");
      const syncMs = kit.sincronizadoEm;
      if (syncMs) {
        ultimaSync = new Date(syncMs).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        const horas = (Date.now() - syncMs) / 3_600_000;
        if (horas >= 24) {
          extra = `<span class="tag tag-danger" style="margin-left:8px">Kit expirado</span>`;
        } else {
          const fechamento = new Date(syncMs + 24 * 3_600_000);
          extra = `<span style="font-size:12px;color:#aaa;margin-left:8px">Trava às ${fechamento.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>`;
        }
      }
    } catch { /* silencioso */ }

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:20px;font-size:13px;font-weight:600;${online ? "background:#E8F5E9;color:#2E7D32" : "background:#FFEBEE;color:#C62828"}">
          ${online ? "🌐 Online" : "📴 Offline"}
        </span>
        <span style="font-size:13px;color:#888">Última sync: <b>${ultimaSync}</b>${extra}</span>
      </div>`;
  }

  _atualizar();
  window.addEventListener("online",  _atualizar);
  window.addEventListener("offline", _atualizar);
}

// ── Comunicado FSG ─────────────────────────────────────────────────────────
async function _renderizarComunicado() {
  const el = document.getElementById("op-bloco-comunicado");
  if (!el) return;
  try {
    const snap = await getDoc(doc(db, "comunicados", _empresaId));
    if (!snap.exists() || !snap.data()?.mensagem) { el.style.display = "none"; return; }
    const c = snap.data();
    el.style.display = "block";
    el.innerHTML = `
      <div style="background:linear-gradient(135deg,#6B3520 0%,#4A2218 100%);border-radius:12px;padding:16px 18px;color:#fff">
        <div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.65;margin-bottom:6px">Comunicado</div>
        <div style="font-size:14px;line-height:1.55">${c.mensagem}</div>
      </div>`;
  } catch { /* offline — silencioso */ }
}

// ── Entrada do módulo ────────────────────────────────────────────────────────
export async function renderizar(sessao, containerEl) {
  _limparListeners();
  _sessao    = sessao;
  _empresaId = sessao.empresaId;

  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const cols = window._layoutMobile ? "1fr" : "repeat(2,1fr)";

  containerEl.innerHTML = `
    <div id="dashboard-area" class="fade-up">
      <div class="section-header" style="margin-bottom:4px">
        <h2>Olá, ${sessao.nome?.split(" ")[0] || "Operador"}</h2>
      </div>
      <p style="color:#aaa;font-size:14px;margin-bottom:20px">${hoje}</p>

      <!-- Comunicado FSG (oculto por padrão) -->
      <div id="op-bloco-comunicado" style="display:none;margin-bottom:16px"></div>

      <!-- Indicador de conexão -->
      <div id="op-bloco-offline" class="card" style="padding:14px 16px;margin-bottom:16px"></div>

      <!-- Caixa do Turno -->
      <div id="op-bloco-caixa" class="card" style="padding:20px;margin-bottom:16px">
        <p style="color:#aaa;font-size:13px">Carregando caixa…</p>
      </div>

      <!-- Grid: Catálogo Rápido + Estoque Zerado -->
      <div style="display:grid;grid-template-columns:${cols};gap:16px">
        <div id="op-bloco-catalogo" class="card" style="padding:20px">
          <p style="color:#aaa;font-size:13px">Carregando…</p>
        </div>
        <div id="op-bloco-estoque" class="card" style="padding:20px">
          <p style="color:#aaa;font-size:13px">Carregando…</p>
        </div>
      </div>
    </div>`;

  // Blocos que precisam de Firestore — em paralelo
  await Promise.allSettled([
    _renderizarCaixa(),
    _renderizarEstoqueZerado(),
    _renderizarComunicado(),
  ]);

  // Síncronos (sem Firestore)
  _renderizarCatalogo();
  _renderizarIndicadorOffline();
}
