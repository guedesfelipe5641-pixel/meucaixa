// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · modulos/despesas.js · Módulo 15                    ║
// ║  Gestão de Despesas — CRUD, filtros e alertas                  ║
// ╚══════════════════════════════════════════════════════════════════╝

import { db } from "../firebase-config.js";
import {
  collection, doc, addDoc, getDocs, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { notificar }                                      from "../notificacoes.js";
import { formatarMoeda, registrarErro, abrirFormulario }  from "../utils.js";
import { exportarDespesas } from "../csvExport.js";

let _sessao    = null;
let _empresaId = "";
let _despesas  = []; // [{ id, dados }]
let _tabAtiva  = "todas";

const CATEGORIAS = [
  "Aluguel", "Água", "Luz", "Internet", "Telefone",
  "Fornecedor", "Salário", "Imposto", "Manutenção", "Marketing", "Outros",
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const _parseData     = str => { const [d,m,a] = str.split("/"); return new Date(+a, +m-1, +d); };
const _diffDias      = str => { const h = new Date(); h.setHours(0,0,0,0); return Math.round((_parseData(str) - h) / 86400000); };
const _inputParaDDMM = v   => { if (!v) return ""; const [a,m,d] = v.split("-"); return `${d}/${m}/${a}`; };
const _ddmmParaInput = s   => { if (!s) return ""; const [d,m,a] = s.split("/"); return `${a}-${m}-${d}`; };

function _status(dep) {
  if (dep.pago) return "paga";
  if (!dep.dataVenc) return "pendente";
  const diff = _diffDias(dep.dataVenc);
  if (diff < 0)  return "vencida";
  if (diff <= 3) return "alerta";
  return "pendente";
}

function _filtrar() {
  if (_tabAtiva === "todas")    return _despesas;
  if (_tabAtiva === "pagas")    return _despesas.filter(d => d.dados.pago);
  if (_tabAtiva === "vencidas") return _despesas.filter(d => _status(d.dados) === "vencida");
  return _despesas.filter(d => !d.dados.pago); // pendentes (inclui alerta)
}

// ── Entrada ───────────────────────────────────────────────────────────────────
export async function renderizar(sessao, containerEl) {
  _sessao    = sessao;
  _empresaId = sessao.empresaId;
  _tabAtiva  = "todas";

  containerEl.innerHTML = `
    <div class="fade-up">
      <div class="section-header">
        <h2>Despesas</h2>
        <div style="display:flex;gap:8px">
          <button id="btn-csv-desp" class="btn btn-secondary">↓ Exportar CSV</button>
          <button id="btn-nova-desp" class="btn btn-primary" data-acao="escrita">+ Nova Despesa</button>
        </div>
      </div>
      <div class="pill-tabs" id="desp-tabs" style="margin-bottom:20px"></div>
      <div id="desp-lista"></div>
    </div>`;

  document.getElementById("btn-nova-desp").addEventListener("click", () => _abrirForm());
  document.getElementById("btn-csv-desp").addEventListener("click", () => exportarDespesas(_despesas));
  await _carregar();
  _renderTabs();
  _renderLista();
}

async function _carregar() {
  try {
    const snap = await getDocs(query(
      collection(db, "empresas", _empresaId, "despesas"),
      orderBy("createdAt", "desc")
    ));
    _despesas = snap.docs.map(d => ({ id: d.id, dados: d.data() }));
  } catch (err) {
    registrarErro("firestore", err.message, "despesas.js");
    notificar("erro", "Erro", "Não foi possível carregar as despesas.");
  }
}

// ── Pill Tabs ─────────────────────────────────────────────────────────────────
function _renderTabs() {
  const el = document.getElementById("desp-tabs");
  if (!el) return;
  const tabs = [
    { id: "todas",     label: "Todas"     },
    { id: "pendentes", label: "Pendentes" },
    { id: "pagas",     label: "Pagas"     },
    { id: "vencidas",  label: "Vencidas"  },
  ];
  el.innerHTML = tabs.map(t =>
    `<button class="pill-tab${_tabAtiva === t.id ? " active" : ""}" data-tab="${t.id}">${t.label}</button>`
  ).join("");
  el.querySelectorAll(".pill-tab").forEach(btn =>
    btn.addEventListener("click", () => { _tabAtiva = btn.dataset.tab; _renderTabs(); _renderLista(); })
  );
}

// ── Lista ─────────────────────────────────────────────────────────────────────
function _renderLista() {
  const el = document.getElementById("desp-lista");
  if (!el) return;
  const lista = _filtrar();

  if (!lista.length) {
    el.innerHTML = `<div style="text-align:center;padding:56px 20px">
      <div style="font-size:44px;margin-bottom:14px">📋</div>
      <p style="color:#aaa;font-size:14px">Nenhuma despesa encontrada.</p>
    </div>`;
    return;
  }

  if (window._layoutMobile) {
    el.innerHTML = lista.map(({ id, dados }) => _htmlCard(id, dados)).join("");
  } else {
    el.innerHTML = `
      <div class="card table-responsive">
        <table class="table">
          <thead><tr>
            <th>Nome</th><th>Categoria</th><th>Vencimento</th>
            <th>Valor</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>${lista.map(({ id, dados }) => _htmlLinha(id, dados)).join("")}</tbody>
        </table>
      </div>`;
  }
  _bindAcoes(el);
}

function _tagStatus(st) {
  const cfg = {
    paga:     { cls: "tag-success", txt: "Paga"           },
    vencida:  { cls: "tag-danger",  txt: "Vencida"        },
    alerta:   { cls: "tag-accent",  txt: "Vence em breve" },
    pendente: { cls: "tag-neutral", txt: "Pendente"       },
  }[st] ?? { cls: "tag-neutral", txt: "—" };
  return `<span class="tag ${cfg.cls}">${cfg.txt}</span>`;
}

function _badgeRecorr(dep) {
  return dep.recorrente
    ? `<span class="tag" style="background:#EDE7F6;color:#5E35B1;margin-left:8px;font-size:11px">↺ Recorrente</span>`
    : "";
}

function _acoes(id, dep) {
  return `<div style="display:flex;gap:6px;flex-wrap:wrap">
    ${!dep.pago ? `<button class="btn btn-success btn-sm" data-acao="pagar" data-id="${id}">✓ Pagar</button>` : ""}
    <button class="btn btn-secondary btn-sm" data-acao="editar"  data-id="${id}">Editar</button>
    <button class="btn btn-danger  btn-sm" data-acao="excluir" data-id="${id}">Excluir</button>
  </div>`;
}

function _htmlLinha(id, dep) {
  const st = _status(dep);
  const bg = st === "vencida" ? "rgba(217,79,58,.04)" : st === "alerta" ? "rgba(240,163,53,.05)" : "transparent";
  return `
    <tr style="background:${bg}">
      <td><strong>${dep.nome}</strong>${_badgeRecorr(dep)}</td>
      <td>${dep.categoria || "—"}</td>
      <td>${dep.dataVenc  || "—"}</td>
      <td style="font-weight:700">${formatarMoeda(dep.valor)}</td>
      <td>${_tagStatus(st)}</td>
      <td>${_acoes(id, dep)}</td>
    </tr>`;
}

function _htmlCard(id, dep) {
  const st     = _status(dep);
  const border = st === "vencida" ? "var(--danger)" : st === "alerta" ? "var(--accent)" : "rgba(0,0,0,.08)";
  return `
    <div class="card" style="padding:16px;margin-bottom:12px;border:1.5px solid ${border}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div>
          <div style="font-weight:700;font-size:15px">${dep.nome}${_badgeRecorr(dep)}</div>
          <div style="font-size:12px;color:#888;margin-top:3px">${dep.categoria || "Sem categoria"}</div>
        </div>
        ${_tagStatus(st)}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:20px;font-weight:700;color:var(--text)">${formatarMoeda(dep.valor)}</div>
        <div style="font-size:13px;color:#777">${dep.dataVenc ? `Vence: ${dep.dataVenc}` : "—"}</div>
      </div>
      ${_acoes(id, dep)}
    </div>`;
}

function _bindAcoes(el) {
  el.querySelectorAll("[data-acao]").forEach(btn =>
    btn.addEventListener("click", () => {
      const { acao, id } = btn.dataset;
      if (acao === "editar")  _abrirForm(id);
      if (acao === "pagar")   _marcarPago(id);
      if (acao === "excluir") _excluirDespesa(id);
    })
  );
}

// ── Formulário ────────────────────────────────────────────────────────────────
function _abrirForm(id = null) {
  const dep    = id ? (_despesas.find(d => d.id === id)?.dados ?? {}) : {};
  const titulo = id ? "Editar Despesa" : "Nova Despesa";
  const opcCat = CATEGORIAS.map(c =>
    `<option value="${c}"${dep.categoria === c ? " selected" : ""}>${c}</option>`
  ).join("");

  const conteudo = `
    <div class="form-grid">
      <div class="form-group">
        <label class="lbl">Nome da Despesa *</label>
        <input id="df-nome" class="input" type="text" placeholder="Ex: Conta de luz" value="${dep.nome || ""}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="lbl">Valor (R$) *</label>
          <input id="df-valor" class="input" type="number" step="0.01" min="0" placeholder="0,00" value="${dep.valor || ""}">
        </div>
        <div class="form-group">
          <label class="lbl">Data de Vencimento</label>
          <input id="df-venc" class="input" type="date" value="${_ddmmParaInput(dep.dataVenc)}">
        </div>
      </div>
      <div class="form-group">
        <label class="lbl">Categoria</label>
        <select id="df-cat" class="input select">
          <option value="">Selecionar...</option>${opcCat}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <input id="df-recorr" type="checkbox" style="width:16px;height:16px;cursor:pointer" ${dep.recorrente ? "checked" : ""}>
        <label for="df-recorr" style="font-size:14px;cursor:pointer;color:var(--text)">Despesa recorrente mensal</label>
      </div>
      <div id="df-dia-wrap" style="display:${dep.recorrente ? "block" : "none"}">
        <div class="form-group">
          <label class="lbl">Dia de vencimento mensal (1–31)</label>
          <input id="df-dia" class="input" type="number" min="1" max="31" placeholder="Ex: 10" value="${dep.diaRecorr || ""}">
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:4px">
        <button id="df-cancelar" class="btn btn-secondary">Cancelar</button>
        <button id="df-salvar" class="btn btn-primary" data-acao="escrita">Salvar</button>
      </div>
    </div>`;

  abrirFormulario({ titulo, conteudo });

  document.getElementById("df-recorr").addEventListener("change", e => {
    document.getElementById("df-dia-wrap").style.display = e.target.checked ? "block" : "none";
  });
  document.getElementById("df-cancelar").addEventListener("click", () => {
    document.querySelector(".mc-modal-overlay")?.remove();
    document.querySelector(".mc-bs-overlay")?.remove();
  });
  document.getElementById("df-salvar").addEventListener("click", () => _salvar(id));
}

async function _salvar(id) {
  const nome      = document.getElementById("df-nome")?.value.trim();
  const valor     = parseFloat(document.getElementById("df-valor")?.value);
  const vencInput = document.getElementById("df-venc")?.value;
  const categoria = document.getElementById("df-cat")?.value;
  const recorr    = document.getElementById("df-recorr")?.checked ?? false;
  const diaRecorr = recorr ? (parseInt(document.getElementById("df-dia")?.value) || null) : null;

  if (!nome)            { notificar("aviso", "Campo obrigatório", "Informe o nome da despesa."); return; }
  if (!valor || valor <= 0) { notificar("aviso", "Campo obrigatório", "Informe um valor válido."); return; }

  const dados = { nome, valor, dataVenc: _inputParaDDMM(vencInput), categoria, recorrente: recorr, diaRecorr };

  const btn = document.getElementById("df-salvar");
  if (btn) { btn.textContent = "Salvando…"; btn.disabled = true; }

  try {
    if (id) {
      await updateDoc(doc(db, "empresas", _empresaId, "despesas", id), dados);
      notificar("sucesso", "Despesa atualizada", `"${nome}" foi salva.`);
    } else {
      await addDoc(collection(db, "empresas", _empresaId, "despesas"), {
        ...dados, pago: false, pagoEm: null, createdAt: serverTimestamp(),
      });
      notificar("sucesso", "Despesa adicionada", `"${nome}" registrada com sucesso.`);
    }
    document.querySelector(".mc-modal-overlay")?.remove();
    document.querySelector(".mc-bs-overlay")?.remove();
    await _carregar();
    _renderTabs();
    _renderLista();
  } catch (err) {
    registrarErro("firestore", err.message, "despesas.js");
    notificar("erro", "Erro ao salvar", "Tente novamente.");
    if (btn) { btn.textContent = "Salvar"; btn.disabled = false; }
  }
}

async function _marcarPago(id) {
  const dep = _despesas.find(d => d.id === id);
  if (!dep) return;
  try {
    await updateDoc(doc(db, "empresas", _empresaId, "despesas", id), {
      pago: true, pagoEm: serverTimestamp(),
    });
    notificar("sucesso", "Despesa paga", `"${dep.dados.nome}" marcada como paga.`);
    await _carregar();
    _renderTabs();
    _renderLista();
  } catch (err) {
    registrarErro("firestore", err.message, "despesas.js");
    notificar("erro", "Erro", "Não foi possível registrar o pagamento.");
  }
}

async function _excluirDespesa(id) {
  const dep = _despesas.find(d => d.id === id);
  if (!dep || !confirm(`Excluir "${dep.dados.nome}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await deleteDoc(doc(db, "empresas", _empresaId, "despesas", id));
    notificar("sucesso", "Despesa excluída", "Registro removido.");
    await _carregar();
    _renderTabs();
    _renderLista();
  } catch (err) {
    registrarErro("firestore", err.message, "despesas.js");
    notificar("erro", "Erro ao excluir", "Tente novamente.");
  }
}
