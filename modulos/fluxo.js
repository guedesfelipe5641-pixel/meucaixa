// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · modulos/fluxo.js · Módulo 16                      ║
// ║  Fluxo de Caixa / DRE — DRE por período + gráfico semanal     ║
// ╚══════════════════════════════════════════════════════════════════╝

import { db } from "../firebase-config.js";
import {
  collection, getDocs, query, where, orderBy, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { notificar }                     from "../notificacoes.js";
import { formatarMoeda, registrarErro }  from "../utils.js";
import { exportarFluxo }                 from "../csvExport.js";

let _sessao       = null;
let _empresaId    = "";
let _periodoAtivo = "mes";
let _customInicio = "";
let _customFim    = "";
let _chart        = null;
let _cache        = { vendas: [], despesas: [], dre: null, label: "" };

// ── Helpers ───────────────────────────────────────────────────────────────────
const _parseData  = str => { const [d,m,a] = str.split("/"); return new Date(+a, +m-1, +d); };
const _ddmmaaaa   = d   => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
const _inputToDt  = s   => { const [a,m,d] = s.split("-"); return new Date(+a, +m-1, +d); };

function _getRange() {
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const fim  = new Date(hoje); fim.setHours(23,59,59,999);

  if (_periodoAtivo === "hoje") {
    return { inicio: hoje, fim, label: `Hoje (${_ddmmaaaa(hoje)})` };
  }
  if (_periodoAtivo === "semana") {
    const ini = new Date(hoje); ini.setDate(hoje.getDate() - hoje.getDay());
    return { inicio: ini, fim, label: `Esta semana (${_ddmmaaaa(ini)} – ${_ddmmaaaa(hoje)})` };
  }
  if (_periodoAtivo === "mes") {
    const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return { inicio: ini, fim, label: `Este mês (${_ddmmaaaa(ini)} – ${_ddmmaaaa(hoje)})` };
  }
  if (_customInicio && _customFim) {
    const ini = _inputToDt(_customInicio);
    const f   = new Date(_inputToDt(_customFim)); f.setHours(23,59,59,999);
    const [ai,mi,di] = _customInicio.split("-");
    const [af,mf,df] = _customFim.split("-");
    return { inicio: ini, fim: f, label: `${di}/${mi}/${ai} – ${df}/${mf}/${af}` };
  }
  const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  return { inicio: ini, fim, label: `Este mês (${_ddmmaaaa(ini)} – ${_ddmmaaaa(hoje)})` };
}

// ── Entrada ───────────────────────────────────────────────────────────────────
export async function renderizar(sessao, containerEl) {
  _sessao       = sessao;
  _empresaId    = sessao.empresaId;
  _periodoAtivo = "mes";
  _customInicio = "";
  _customFim    = "";
  if (_chart) { _chart.destroy(); _chart = null; }

  const isPro = sessao.plano === "profissional";

  containerEl.innerHTML = `
    <div class="fade-up">
      <div class="section-header">
        <h2>Fluxo de Caixa / DRE</h2>
        ${isPro ? `<button id="btn-fluxo-csv" class="btn btn-secondary btn-sm">↓ Exportar CSV</button>` : ""}
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:20px">
        <div class="pill-tabs" id="fluxo-tabs"></div>
        <div id="fluxo-custom-wrap" style="display:none;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="fluxo-ini" class="input" type="date" style="width:148px;padding:7px 10px">
          <span style="color:#aaa;font-size:13px">até</span>
          <input id="fluxo-fim" class="input" type="date" style="width:148px;padding:7px 10px">
          <button id="btn-fluxo-aplicar" class="btn btn-primary btn-sm">Aplicar</button>
        </div>
      </div>

      <div id="fluxo-dre" style="margin-bottom:24px">
        <div style="text-align:center;padding:40px;color:#aaa;font-size:14px">Carregando…</div>
      </div>

      <div class="card" style="padding:20px">
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:16px">
          Entradas × Saídas — últimos 7 dias
        </div>
        <div style="position:relative;height:220px">
          <canvas id="fluxo-chart"></canvas>
        </div>
      </div>
    </div>`;

  _renderTabs();
  document.getElementById("btn-fluxo-aplicar")?.addEventListener("click", _onAplicarCustom);
  document.getElementById("btn-fluxo-csv")?.addEventListener("click",     _onExportarCSV);

  await _recarregar();
}

function _renderTabs() {
  const el = document.getElementById("fluxo-tabs");
  if (!el) return;
  const tabs = [
    { id: "hoje",   label: "Hoje"          },
    { id: "semana", label: "Esta Semana"   },
    { id: "mes",    label: "Este Mês"      },
    { id: "custom", label: "Personalizado" },
  ];
  el.innerHTML = tabs.map(t =>
    `<button class="pill-tab${_periodoAtivo === t.id ? " active" : ""}" data-tab="${t.id}">${t.label}</button>`
  ).join("");
  el.querySelectorAll(".pill-tab").forEach(btn =>
    btn.addEventListener("click", async () => {
      _periodoAtivo = btn.dataset.tab;
      _renderTabs();
      const wrap = document.getElementById("fluxo-custom-wrap");
      if (wrap) wrap.style.display = _periodoAtivo === "custom" ? "flex" : "none";
      if (_periodoAtivo !== "custom") await _recarregar();
    })
  );
}

async function _onAplicarCustom() {
  _customInicio = document.getElementById("fluxo-ini")?.value || "";
  _customFim    = document.getElementById("fluxo-fim")?.value || "";
  if (!_customInicio || !_customFim) {
    notificar("aviso", "Período inválido", "Informe início e fim.");
    return;
  }
  await _recarregar();
}

// ── Carga e cálculo ───────────────────────────────────────────────────────────
async function _recarregar() {
  const dreEl = document.getElementById("fluxo-dre");
  if (dreEl) dreEl.innerHTML = `<div style="text-align:center;padding:40px;color:#aaa;font-size:14px">Calculando…</div>`;

  const { inicio, fim, label } = _getRange();
  let vendas   = [];
  let despesas = [];

  try { vendas   = await _queryVendas(inicio, fim);       } catch (e) { registrarErro("firestore", e.message, "fluxo.js"); }
  try { despesas = await _queryDespesasPeriodo(inicio, fim); } catch (e) { registrarErro("firestore", e.message, "fluxo.js"); }

  const dre = _calcularDRE(vendas, despesas);
  _cache = { vendas, despesas, dre, label };

  _renderDRE(dre, label);
  await _renderGrafico();
}

async function _queryVendas(inicio, fim) {
  const snap = await getDocs(query(
    collection(db, "empresas", _empresaId, "vendas"),
    where("createdAt", ">=", Timestamp.fromDate(inicio)),
    where("createdAt", "<=", Timestamp.fromDate(fim)),
    orderBy("createdAt", "asc")
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function _queryDespesasPeriodo(inicio, fim) {
  const snap = await getDocs(collection(db, "empresas", _empresaId, "despesas"));
  return snap.docs.map(d => d.data()).filter(dep => {
    if (!dep.dataVenc) return false;
    const dt = _parseData(dep.dataVenc);
    return dt >= inicio && dt <= fim;
  });
}

// ── DRE ───────────────────────────────────────────────────────────────────────
function _calcularDRE(vendas, despesas) {
  const ativas       = vendas.filter(v => !v.cancelada);
  const receitaBruta = ativas.reduce((s, v) => s + (v.totalBruto    || 0), 0);
  const descontos    = ativas.reduce((s, v) => s + (v.descontoValor || 0), 0);
  const custo        = ativas.reduce((s, v) => {
    if (!v.itens) return s;
    return s + v.itens.reduce((si, i) => si + (i.custo || 0) * (i.quantidade || 1), 0);
  }, 0);
  const margemBruta   = receitaBruta - descontos - custo;
  const despesasTotal = despesas.reduce((s, d) => s + (d.valor || 0), 0);
  const lucroReal     = margemBruta - despesasTotal;
  return { receitaBruta, descontos, custo, margemBruta, despesasTotal, lucroReal };
}

function _renderDRE(dre, label) {
  const el = document.getElementById("fluxo-dre");
  if (!el) return;

  const verde   = "var(--success)";
  const vermelho = "var(--danger)";
  const corRes  = v => v >= 0 ? verde : vermelho;

  const linhas = [
    { label: "Receita Bruta",           valor: dre.receitaBruta,  sinal: "+", destaque: false },
    { label: "(-) Descontos",           valor: dre.descontos,     sinal: "−", destaque: false },
    { label: "(-) Custo dos Produtos",  valor: dre.custo,         sinal: "−", destaque: false },
    { label: "Margem Bruta",            valor: dre.margemBruta,   sinal: "=", destaque: true  },
    { label: "(-) Despesas Operac.",    valor: dre.despesasTotal, sinal: "−", destaque: false },
    { label: "Lucro Real",              valor: dre.lucroReal,     sinal: "=", destaque: true  },
  ];

  const cols = window._layoutMobile ? "repeat(2,1fr)" : "repeat(3,1fr)";

  el.innerHTML = `
    <div style="margin-bottom:14px;font-size:13px;color:#888;font-weight:600">
      Período: <span style="color:var(--text)">${label}</span>
    </div>
    <div style="display:grid;grid-template-columns:${cols};gap:12px">
      ${linhas.map(l => `
        <div class="card" style="padding:18px${l.destaque ? `;border-left:4px solid ${corRes(l.valor)}` : ""}">
          <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">
            ${l.sinal} ${l.label}
          </div>
          <div style="font-size:${l.destaque ? "22px" : "18px"};font-weight:700;color:${l.destaque ? corRes(l.valor) : "var(--text)"}">
            ${l.destaque && l.valor < 0 ? "−" : ""}${formatarMoeda(Math.abs(l.valor))}
          </div>
        </div>
      `).join("")}
    </div>`;
}

// ── Gráfico ───────────────────────────────────────────────────────────────────
async function _renderGrafico() {
  const canvas = document.getElementById("fluxo-chart");
  if (!canvas) return;

  try {
    if (!window.Chart) {
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src   = "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js";
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
  } catch { return; }

  if (_chart) { _chart.destroy(); _chart = null; }

  // Sempre exibe os últimos 7 dias, independente do seletor de período
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(hoje); d.setDate(hoje.getDate() - (6 - i)); return d;
  });

  let vendas7 = [], desp7 = [];
  try {
    const ini7 = new Date(dias[0]); ini7.setHours(0,0,0,0);
    const fim7 = new Date(hoje);    fim7.setHours(23,59,59,999);
    [vendas7, desp7] = await Promise.all([
      _queryVendas(ini7, fim7),
      _queryDespesasPeriodo(ini7, fim7),
    ]);
  } catch { /* silencioso */ }

  const entradas = dias.map(dia => {
    const prox = new Date(dia); prox.setDate(dia.getDate() + 1);
    return vendas7
      .filter(v => !v.cancelada && v.createdAt)
      .filter(v => {
        const dt = v.createdAt?.toDate ? v.createdAt.toDate() : new Date((v.createdAt?.seconds || 0) * 1000);
        return dt >= dia && dt < prox;
      })
      .reduce((s, v) => s + (v.totalLiquido || 0), 0);
  });

  const saidas = dias.map(dia => {
    const str = _ddmmaaaa(dia);
    return desp7.filter(d => d.dataVenc === str).reduce((s, d) => s + (d.valor || 0), 0);
  });

  const labels = dias.map(d => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`);

  _chart = new window.Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Entradas",  data: entradas, backgroundColor: "rgba(107,53,32,.75)", borderRadius: 5 },
        { label: "Saídas",    data: saidas,   backgroundColor: "rgba(217,79,58,.65)", borderRadius: 5 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "top", labels: { font: { family: "DM Sans", size: 12 } } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: "DM Sans", size: 11 } } },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(0,0,0,.06)" },
          ticks: {
            font: { family: "DM Sans", size: 11 },
            callback: v => v === 0 ? "0" : `R$${(v / 1000).toFixed(1)}k`,
          },
        },
      },
    },
  });
}

// ── Exportação CSV ────────────────────────────────────────────────────────────
function _onExportarCSV() {
  if (_sessao.plano !== "profissional") {
    notificar("bloqueio", "Plano Profissional", "Exportação CSV disponível apenas no plano Profissional.");
    return;
  }
  if (!_cache.dre) {
    notificar("aviso", "Aguarde", "Carregue os dados antes de exportar.");
    return;
  }
  exportarFluxo(_cache.dre, _cache.label);
}
