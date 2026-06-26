import { db } from "../firebase-config.js";
import {
  collection, getDocs, addDoc, updateDoc, doc,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { abrirFormulario, registrarErro } from "../utils.js";
import { notificar } from "../notificacoes.js";

let _colaboradores        = [];
let _colaboradoresInativos = [];
let _empresaId            = "";
let _somenteLeitura       = false;

// ── Código sequencial ────────────────────────────────────────────────────────

async function _proximoCodigo() {
  const snap = await getDocs(collection(db, `empresas/${_empresaId}/colaboradores`));
  let max = 0;
  snap.forEach(d => {
    const n = parseInt((d.data().codigo || "").replace("COL", ""), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return "COL" + String(max + 1).padStart(3, "0");
}

// ── Data (conversão entre YYYY-MM-DD e DD/MM/AAAA) ──────────────────────────

function _toInputDate(str) {
  if (!str) return "";
  if (str.includes("-")) return str;
  const [dd, mm, aaaa] = str.split("/");
  return aaaa && mm && dd ? `${aaaa}-${mm}-${dd}` : "";
}

function _fromInputDate(str) {
  if (!str) return "";
  if (str.includes("/")) return str;
  const [aaaa, mm, dd] = str.split("-");
  return aaaa && mm && dd ? `${dd}/${mm}/${aaaa}` : "";
}

// ── Carregamento ─────────────────────────────────────────────────────────────

async function _carregar() {
  const q = query(
    collection(db, `empresas/${_empresaId}/colaboradores`),
    orderBy("nome")
  );
  const snap = await getDocs(q);
  _colaboradores         = [];
  _colaboradoresInativos = [];
  snap.forEach(d => {
    const data = d.data();
    if (data.ativo === false) _colaboradoresInativos.push({ id: d.id, ...data });
    else                      _colaboradores.push({ id: d.id, ...data });
  });
}

// ── Filtro ───────────────────────────────────────────────────────────────────

function _filtrar(lista, termo) {
  if (!termo) return lista;
  const t = termo.toLowerCase();
  return lista.filter(c =>
    (c.nome || "").toLowerCase().includes(t) ||
    (c.codigo || "").toLowerCase().includes(t) ||
    (c.cpf || "").toLowerCase().includes(t) ||
    (c.cargo || "").toLowerCase().includes(t)
  );
}

// ── Renderização ─────────────────────────────────────────────────────────────

function _botoesAcao(c, contexto = "ativo") {
  if (_somenteLeitura) return "";
  if (contexto === "inativo") {
    return `<button class="btn btn-sm btn-success" data-reativar="${c.id}">Reativar</button>`;
  }
  return `
    <button class="btn btn-sm btn-secondary" data-editar="${c.id}" style="margin-right:6px">Editar</button>
    <button class="btn btn-sm btn-danger" data-desativar="${c.id}">Desativar</button>`;
}

function _renderizarTabela(lista, container, contexto) {
  const cols = _somenteLeitura ? 4 : 5;
  container.innerHTML = `
    <div class="table-responsive">
      <table class="table" style="margin-top:4px">
        <thead>
          <tr>
            <th>Código</th>
            <th>Nome</th>
            <th>CPF</th>
            <th>Cargo</th>
            ${_somenteLeitura ? "" : "<th>Ações</th>"}
          </tr>
        </thead>
        <tbody>
          ${lista.length === 0
            ? `<tr><td colspan="${cols}" style="text-align:center;color:#aaa;padding:32px">Nenhum colaborador encontrado.</td></tr>`
            : lista.map(c => `
              <tr>
                <td><span class="tag tag-neutral">${c.codigo || ""}</span></td>
                <td>${c.nome || ""}</td>
                <td style="color:#aaa">${c.cpf || "—"}</td>
                <td>${c.cargo || ""}</td>
                ${_somenteLeitura ? "" : `<td>${_botoesAcao(c, contexto)}</td>`}
              </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function _renderizarCards(lista, container, contexto) {
  if (lista.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:#aaa;padding:32px">Nenhum colaborador encontrado.</p>`;
    return;
  }
  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;margin-top:4px">` +
    lista.map(c => `
      <div class="card fade-up" style="overflow:hidden">
        <div style="padding:16px 16px 12px">
          <div style="font-size:17px;font-weight:700;color:var(--text);line-height:1.3;margin-bottom:6px">${c.nome || ""}</div>
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-bottom:10px">
            <span class="tag tag-neutral">${c.codigo || ""}</span>
          </div>
          <div style="font-size:15px;color:#666;display:flex;flex-direction:column;gap:4px">
            <span>💼 ${c.cargo || "—"}${c.cpf ? `  ·  ${c.cpf}` : ""}</span>
            ${c.telefone ? `<span>📞 ${c.telefone}</span>` : ""}
            ${c.valorDiaria ? `<span>💵 R$ ${c.valorDiaria}/dia</span>` : ""}
          </div>
        </div>
        ${_somenteLeitura ? "" : `<div style="border-top:1px solid rgba(0,0,0,.05);padding:10px 16px;display:flex;gap:8px">${_botoesAcao(c, contexto)}</div>`}
      </div>`).join("") +
    `</div>`;
}

function _renderizarLista(lista, container, contexto) {
  if (window._layoutMobile) {
    _renderizarCards(lista, container, contexto);
  } else {
    _renderizarTabela(lista, container, contexto);
  }
}

function _renderizarAbas(listContainer, aba) {
  document.querySelectorAll("#col-tabs .pill-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === aba);
  });

  const countAtivos   = document.getElementById("col-count-ativos");
  const countInativos = document.getElementById("col-count-inativos");
  if (countAtivos)   countAtivos.textContent   = `(${_colaboradores.length})`;
  if (countInativos) countInativos.textContent = `(${_colaboradoresInativos.length})`;

  const busca = document.getElementById("col-busca");
  if (busca) busca.value = "";

  const lista = aba === "inativos" ? _colaboradoresInativos : _colaboradores;
  _renderizarLista(lista, listContainer, aba === "inativos" ? "inativo" : "ativo");
}

// ── Formulário ───────────────────────────────────────────────────────────────

function _htmlFormulario(colaborador) {
  const v = colaborador || {};
  return `
    <form id="form-colaborador" autocomplete="off">
      <div class="form-grid">
        <div class="form-group">
          <label class="lbl">Nome *</label>
          <input class="input" type="text" id="col-nome" value="${v.nome || ""}" maxlength="100" placeholder="Nome completo">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="lbl">CPF *</label>
            <input class="input" type="text" id="col-cpf" value="${v.cpf || ""}" maxlength="14" placeholder="000.000.000-00">
          </div>
          <div class="form-group">
            <label class="lbl">Cargo *</label>
            <input class="input" type="text" id="col-cargo" value="${v.cargo || ""}" maxlength="60" placeholder="Ex: Auxiliar de loja">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="lbl">Valor Diária (R$)</label>
            <input class="input" type="number" id="col-valorDiaria" value="${v.valorDiaria || ""}" min="0" step="0.01" placeholder="0,00">
          </div>
          <div class="form-group">
            <label class="lbl">Data de Admissão</label>
            <input class="input" type="date" id="col-dataAdmissao" value="${_toInputDate(v.dataAdmissao || "")}">
          </div>
        </div>
        <div class="form-group">
          <label class="lbl">Telefone</label>
          <input class="input" type="tel" id="col-telefone" value="${v.telefone || ""}" maxlength="20" placeholder="(00) 00000-0000">
        </div>
        <button type="submit" id="col-salvar" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:4px">Salvar</button>
      </div>
    </form>`;
}

function _coletarDados() {
  return {
    nome:         document.getElementById("col-nome").value.trim(),
    cpf:          document.getElementById("col-cpf").value.trim(),
    cargo:        document.getElementById("col-cargo").value.trim(),
    tipoContrato: "diarista",
    valorDiaria:  document.getElementById("col-valorDiaria").value.trim(),
    dataAdmissao: _fromInputDate(document.getElementById("col-dataAdmissao").value.trim()),
    telefone:     document.getElementById("col-telefone").value.trim(),
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

async function _abrirCriacao(listContainer) {
  const codigo = await _proximoCodigo();
  abrirFormulario({ titulo: `Novo Colaborador — ${codigo}`, conteudo: _htmlFormulario(null) });

  const form      = document.getElementById("form-colaborador");
  const btnSalvar = document.getElementById("col-salvar");
  const validar   = () => {
    btnSalvar.disabled =
      !document.getElementById("col-nome").value.trim() ||
      !document.getElementById("col-cpf").value.trim() ||
      !document.getElementById("col-cargo").value.trim();
  };
  form.addEventListener("input", validar);
  validar();

  form.addEventListener("submit", async e => {
    e.preventDefault();
    btnSalvar.disabled = true;
    try {
      const dados = _coletarDados();
      await addDoc(collection(db, `empresas/${_empresaId}/colaboradores`), {
        ...dados, codigo, ativo: true, createdAt: serverTimestamp()
      });
      document.querySelector(".mc-modal-overlay, .mc-bs-overlay")?.remove();
      notificar("sucesso", "Colaborador salvo", `${dados.nome} adicionado como ${codigo}.`);
      await _carregar();
      _renderizarAbas(listContainer, "ativos");
    } catch (err) {
      await registrarErro("firestore", err.message, "colaboradores.js");
      notificar("erro", "Erro ao salvar", "Não foi possível salvar o colaborador.");
      btnSalvar.disabled = false;
    }
  });
}

async function _abrirEdicao(colaboradorId, listContainer) {
  const colaborador = _colaboradores.find(c => c.id === colaboradorId);
  if (!colaborador) return;
  abrirFormulario({ titulo: `Editar — ${colaborador.codigo}`, conteudo: _htmlFormulario(colaborador) });

  const form      = document.getElementById("form-colaborador");
  const btnSalvar = document.getElementById("col-salvar");
  const validar   = () => {
    btnSalvar.disabled =
      !document.getElementById("col-nome").value.trim() ||
      !document.getElementById("col-cpf").value.trim() ||
      !document.getElementById("col-cargo").value.trim();
  };
  form.addEventListener("input", validar);

  form.addEventListener("submit", async e => {
    e.preventDefault();
    btnSalvar.disabled = true;
    try {
      const dados = _coletarDados();
      await updateDoc(doc(db, `empresas/${_empresaId}/colaboradores`, colaboradorId), dados);
      document.querySelector(".mc-modal-overlay, .mc-bs-overlay")?.remove();
      notificar("sucesso", "Colaborador atualizado", `${dados.nome} atualizado.`);
      await _carregar();
      _renderizarAbas(listContainer, "ativos");
    } catch (err) {
      await registrarErro("firestore", err.message, "colaboradores.js");
      notificar("erro", "Erro ao salvar", "Não foi possível atualizar o colaborador.");
      btnSalvar.disabled = false;
    }
  });
}

async function _desativar(colaboradorId, listContainer) {
  const colaborador = _colaboradores.find(c => c.id === colaboradorId);
  if (!colaborador) return;
  if (!window.confirm(`Desativar "${colaborador.nome}"? O registro não será apagado.`)) return;
  try {
    await updateDoc(doc(db, `empresas/${_empresaId}/colaboradores`, colaboradorId), { ativo: false });
    notificar("sucesso", "Desativado", `${colaborador.nome} foi desativado.`);
    await _carregar();
    _renderizarAbas(listContainer, "ativos");
  } catch (err) {
    await registrarErro("firestore", err.message, "colaboradores.js");
    notificar("erro", "Erro", "Não foi possível desativar o colaborador.");
  }
}

async function _reativar(colaboradorId, listContainer) {
  const colaborador = _colaboradoresInativos.find(c => c.id === colaboradorId);
  if (!colaborador) return;
  if (!window.confirm(`Reativar "${colaborador.nome}"?`)) return;
  try {
    await updateDoc(doc(db, `empresas/${_empresaId}/colaboradores`, colaboradorId), { ativo: true });
    notificar("sucesso", "Reativado", `${colaborador.nome} foi reativado.`);
    await _carregar();
    _renderizarAbas(listContainer, "inativos");
  } catch (err) {
    await registrarErro("firestore", err.message, "colaboradores.js");
    notificar("erro", "Erro", "Não foi possível reativar o colaborador.");
  }
}

// ── Entrada do módulo ────────────────────────────────────────────────────────

export async function renderizar(sessao, containerEl) {
  if (sessao.perfil !== "admin") {
    containerEl.innerHTML = `<div style="text-align:center;color:#aaa;padding:40px">Acesso restrito a administradores.</div>`;
    return;
  }

  _empresaId      = sessao.empresaId;
  _somenteLeitura = sessao.acesso === "somente_leitura";

  containerEl.innerHTML = `<p style="color:#aaa;padding:24px">Carregando colaboradores…</p>`;

  try {
    await _carregar();
  } catch (err) {
    await registrarErro("firestore", err.message, "colaboradores.js");
    notificar("erro", "Erro ao carregar", "Não foi possível carregar a lista de colaboradores.");
    containerEl.innerHTML = `<p style="text-align:center;color:#aaa;padding:40px">Erro ao carregar colaboradores.</p>`;
    return;
  }

  containerEl.innerHTML = `
    <div class="section-header">
      <h2>Colaboradores</h2>
      ${_somenteLeitura ? "" : `<button id="col-novo" class="btn btn-primary" data-acao="escrita">+ Novo Colaborador</button>`}
    </div>
    <div class="pill-tabs" id="col-tabs" style="margin-bottom:16px">
      <button class="pill-tab active" data-tab="ativos">Ativos <span id="col-count-ativos"></span></button>
      <button class="pill-tab" data-tab="inativos">Inativos <span id="col-count-inativos"></span></button>
    </div>
    <div style="margin-bottom:16px">
      <input type="search" id="col-busca" class="input" placeholder="Buscar por nome, código, CPF ou cargo…" style="max-width:360px">
    </div>
    <div id="col-lista"></div>`;

  const listContainer = document.getElementById("col-lista");

  _renderizarAbas(listContainer, "ativos");

  document.getElementById("col-busca").addEventListener("input", e => {
    const abaAtiva = document.querySelector("#col-tabs .pill-tab.active")?.dataset.tab || "ativos";
    const lista = abaAtiva === "inativos" ? _colaboradoresInativos : _colaboradores;
    _renderizarLista(_filtrar(lista, e.target.value), listContainer, abaAtiva === "inativos" ? "inativo" : "ativo");
  });

  document.getElementById("col-tabs").addEventListener("click", e => {
    const tab = e.target.closest(".pill-tab")?.dataset.tab;
    if (tab) _renderizarAbas(listContainer, tab);
  });

  if (!_somenteLeitura) {
    document.getElementById("col-novo").addEventListener("click", () => _abrirCriacao(listContainer));
  }

  listContainer.addEventListener("click", e => {
    const idEditar    = e.target.dataset.editar;
    const idDesativar = e.target.dataset.desativar;
    const idReativar  = e.target.dataset.reativar;
    if (idEditar)    _abrirEdicao(idEditar, listContainer);
    if (idDesativar) _desativar(idDesativar, listContainer);
    if (idReativar)  _reativar(idReativar, listContainer);
  });
}
