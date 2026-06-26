import { db } from "../firebase-config.js";
import {
  collection, getDocs, addDoc, updateDoc, doc,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { abrirFormulario, registrarErro } from "../utils.js";
import { notificar } from "../notificacoes.js";

let _fornecedores         = [];
let _fornecedoresInativos = [];
let _empresaId            = "";
let _somenteLeitura       = false;

// ── Código sequencial ────────────────────────────────────────────────────────

async function _proximoCodigo() {
  const snap = await getDocs(collection(db, `empresas/${_empresaId}/fornecedores`));
  let max = 0;
  snap.forEach(d => {
    const n = parseInt((d.data().codigo || "").replace("FOR", ""), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return "FOR" + String(max + 1).padStart(3, "0");
}

// ── Carregamento ─────────────────────────────────────────────────────────────

async function _carregar() {
  const q = query(
    collection(db, `empresas/${_empresaId}/fornecedores`),
    orderBy("nomeFantasia")
  );
  const snap = await getDocs(q);
  _fornecedores         = [];
  _fornecedoresInativos = [];
  snap.forEach(d => {
    const data = d.data();
    if (data.ativo === false) _fornecedoresInativos.push({ id: d.id, ...data });
    else                      _fornecedores.push({ id: d.id, ...data });
  });
}

// ── Filtro ───────────────────────────────────────────────────────────────────

function _filtrar(lista, termo) {
  if (!termo) return lista;
  const t = termo.toLowerCase();
  return lista.filter(f =>
    (f.nomeFantasia || "").toLowerCase().includes(t) ||
    (f.codigo       || "").toLowerCase().includes(t) ||
    (f.cnpj         || "").toLowerCase().includes(t) ||
    (f.telefone     || "").toLowerCase().includes(t)
  );
}

// ── Renderização ─────────────────────────────────────────────────────────────

function _botoesAcao(f, contexto = "ativo") {
  if (_somenteLeitura) return "";
  if (contexto === "inativo") {
    return `<button class="btn btn-sm btn-success" data-reativar="${f.id}">Reativar</button>`;
  }
  return `
    <button class="btn btn-sm btn-secondary" data-editar="${f.id}" style="margin-right:6px">Editar</button>
    <button class="btn btn-sm btn-danger" data-desativar="${f.id}">Desativar</button>`;
}

function _renderizarTabela(lista, container, contexto) {
  const cols = _somenteLeitura ? 4 : 5;
  container.innerHTML = `
    <div class="table-responsive">
      <table class="table" style="margin-top:4px">
        <thead>
          <tr>
            <th>Código</th>
            <th>Nome Fantasia</th>
            <th>CNPJ</th>
            <th>Telefone</th>
            ${_somenteLeitura ? "" : "<th>Ações</th>"}
          </tr>
        </thead>
        <tbody>
          ${lista.length === 0
            ? `<tr><td colspan="${cols}" style="text-align:center;color:#aaa;padding:32px">Nenhum fornecedor encontrado.</td></tr>`
            : lista.map(f => `
              <tr>
                <td><span class="tag tag-neutral">${f.codigo || ""}</span></td>
                <td>${f.nomeFantasia || ""}</td>
                <td style="color:#888">${f.cnpj || "—"}</td>
                <td>${f.telefone || "—"}</td>
                ${_somenteLeitura ? "" : `<td>${_botoesAcao(f, contexto)}</td>`}
              </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function _renderizarCards(lista, container, contexto) {
  if (lista.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:#aaa;padding:32px">Nenhum fornecedor encontrado.</p>`;
    return;
  }
  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;margin-top:4px">` +
    lista.map(f => `
      <div class="card fade-up" style="overflow:hidden">
        <div style="padding:16px 16px 12px">
          <div style="font-size:17px;font-weight:700;color:var(--text);line-height:1.3;margin-bottom:6px">${f.nomeFantasia || ""}</div>
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-bottom:10px">
            <span class="tag tag-neutral">${f.codigo || ""}</span>
          </div>
          <div style="font-size:15px;color:#666;display:flex;flex-direction:column;gap:4px">
            <span>📞 ${f.telefone || "—"}${f.cnpj ? `  ·  CNPJ: ${f.cnpj}` : ""}</span>
            ${f.prazosPgto ? `<span>Prazos: ${f.prazosPgto}</span>` : ""}
          </div>
        </div>
        ${_somenteLeitura ? "" : `<div style="border-top:1px solid rgba(0,0,0,.05);padding:10px 16px;display:flex;gap:8px">${_botoesAcao(f, contexto)}</div>`}
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
  document.querySelectorAll("#for-tabs .pill-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === aba);
  });

  const countAtivos   = document.getElementById("for-count-ativos");
  const countInativos = document.getElementById("for-count-inativos");
  if (countAtivos)   countAtivos.textContent   = `(${_fornecedores.length})`;
  if (countInativos) countInativos.textContent = `(${_fornecedoresInativos.length})`;

  const busca = document.getElementById("for-busca");
  if (busca) busca.value = "";

  const lista = aba === "inativos" ? _fornecedoresInativos : _fornecedores;
  _renderizarLista(lista, listContainer, aba === "inativos" ? "inativo" : "ativo");
}

// ── Formulário ───────────────────────────────────────────────────────────────

function _htmlFormulario(f) {
  const v = f || {};
  return `
    <form id="form-fornecedor" autocomplete="off">
      <div class="form-grid">
        <div class="form-group">
          <label class="lbl">Nome Fantasia *</label>
          <input class="input" type="text" id="for-nome" value="${v.nomeFantasia || ""}" maxlength="100" placeholder="Nome do fornecedor">
        </div>
        <div class="form-group">
          <label class="lbl">Telefone *</label>
          <input class="input" type="tel" id="for-telefone" value="${v.telefone || ""}" maxlength="20" placeholder="(00) 00000-0000">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="lbl">CNPJ</label>
            <input class="input" type="text" id="for-cnpj" value="${v.cnpj || ""}" maxlength="18" placeholder="00.000.000/0001-00">
          </div>
          <div class="form-group">
            <label class="lbl">E-mail</label>
            <input class="input" type="email" id="for-email" value="${v.email || ""}" maxlength="100" placeholder="email@fornecedor.com">
          </div>
        </div>
        <div class="form-group">
          <label class="lbl">Prazos de Pagamento</label>
          <input class="input" type="text" id="for-prazos" value="${v.prazosPgto || ""}" maxlength="100" placeholder="Ex: 30/60/90 dias">
        </div>
        <div class="form-group">
          <label class="lbl">Observações</label>
          <textarea class="input" id="for-obs" maxlength="300" rows="2" style="resize:vertical">${v.obs || ""}</textarea>
        </div>
        <button type="submit" id="for-salvar" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:4px">Salvar</button>
      </div>
    </form>`;
}

function _coletarDados() {
  return {
    nomeFantasia: document.getElementById("for-nome").value.trim(),
    telefone:     document.getElementById("for-telefone").value.trim(),
    cnpj:         document.getElementById("for-cnpj").value.trim(),
    email:        document.getElementById("for-email").value.trim(),
    prazosPgto:   document.getElementById("for-prazos").value.trim(),
    obs:          document.getElementById("for-obs").value.trim(),
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

async function _abrirCriacao(listContainer) {
  const codigo = await _proximoCodigo();
  abrirFormulario({ titulo: `Novo Fornecedor — ${codigo}`, conteudo: _htmlFormulario(null) });

  const form      = document.getElementById("form-fornecedor");
  const btnSalvar = document.getElementById("for-salvar");
  const validar   = () => {
    btnSalvar.disabled =
      !document.getElementById("for-nome").value.trim() ||
      !document.getElementById("for-telefone").value.trim();
  };
  form.addEventListener("input", validar);
  validar();

  form.addEventListener("submit", async e => {
    e.preventDefault();
    btnSalvar.disabled = true;
    try {
      const dados = _coletarDados();
      await addDoc(collection(db, `empresas/${_empresaId}/fornecedores`), {
        ...dados, codigo, ativo: true, createdAt: serverTimestamp()
      });
      document.querySelector(".mc-modal-overlay, .mc-bs-overlay")?.remove();
      notificar("sucesso", "Fornecedor salvo", `${dados.nomeFantasia} adicionado como ${codigo}.`);
      await _carregar();
      _renderizarAbas(listContainer, "ativos");
    } catch (err) {
      await registrarErro("firestore", err.message, "fornecedores.js");
      notificar("erro", "Erro ao salvar", "Não foi possível salvar o fornecedor.");
      btnSalvar.disabled = false;
    }
  });
}

async function _abrirEdicao(fornecedorId, listContainer) {
  const f = _fornecedores.find(x => x.id === fornecedorId);
  if (!f) return;
  abrirFormulario({ titulo: `Editar — ${f.codigo}`, conteudo: _htmlFormulario(f) });

  const form      = document.getElementById("form-fornecedor");
  const btnSalvar = document.getElementById("for-salvar");
  const validar   = () => {
    btnSalvar.disabled =
      !document.getElementById("for-nome").value.trim() ||
      !document.getElementById("for-telefone").value.trim();
  };
  form.addEventListener("input", validar);

  form.addEventListener("submit", async e => {
    e.preventDefault();
    btnSalvar.disabled = true;
    try {
      const dados = _coletarDados();
      await updateDoc(doc(db, `empresas/${_empresaId}/fornecedores`, fornecedorId), dados);
      document.querySelector(".mc-modal-overlay, .mc-bs-overlay")?.remove();
      notificar("sucesso", "Fornecedor atualizado", `${dados.nomeFantasia} atualizado.`);
      await _carregar();
      _renderizarAbas(listContainer, "ativos");
    } catch (err) {
      await registrarErro("firestore", err.message, "fornecedores.js");
      notificar("erro", "Erro ao salvar", "Não foi possível atualizar o fornecedor.");
      btnSalvar.disabled = false;
    }
  });
}

async function _desativar(fornecedorId, listContainer) {
  const f = _fornecedores.find(x => x.id === fornecedorId);
  if (!f) return;
  if (!window.confirm(`Desativar "${f.nomeFantasia}"? O registro não será apagado.`)) return;
  try {
    await updateDoc(doc(db, `empresas/${_empresaId}/fornecedores`, fornecedorId), { ativo: false });
    notificar("sucesso", "Desativado", `${f.nomeFantasia} foi desativado.`);
    await _carregar();
    _renderizarAbas(listContainer, "ativos");
  } catch (err) {
    await registrarErro("firestore", err.message, "fornecedores.js");
    notificar("erro", "Erro", "Não foi possível desativar o fornecedor.");
  }
}

async function _reativar(fornecedorId, listContainer) {
  const f = _fornecedoresInativos.find(x => x.id === fornecedorId);
  if (!f) return;
  if (!window.confirm(`Reativar "${f.nomeFantasia}"?`)) return;
  try {
    await updateDoc(doc(db, `empresas/${_empresaId}/fornecedores`, fornecedorId), { ativo: true });
    notificar("sucesso", "Reativado", `${f.nomeFantasia} foi reativado.`);
    await _carregar();
    _renderizarAbas(listContainer, "inativos");
  } catch (err) {
    await registrarErro("firestore", err.message, "fornecedores.js");
    notificar("erro", "Erro", "Não foi possível reativar o fornecedor.");
  }
}

// ── Entrada do módulo ────────────────────────────────────────────────────────

export async function renderizar(sessao, containerEl) {
  if (sessao.perfil !== "admin") {
    containerEl.innerHTML = `<p style="text-align:center;color:#aaa;padding:40px">Acesso restrito a administradores.</p>`;
    return;
  }

  _empresaId      = sessao.empresaId;
  _somenteLeitura = sessao.acesso === "somente_leitura";

  containerEl.innerHTML = `<p style="color:#aaa;padding:24px">Carregando fornecedores…</p>`;

  try {
    await _carregar();
  } catch (err) {
    await registrarErro("firestore", err.message, "fornecedores.js");
    notificar("erro", "Erro ao carregar", "Não foi possível carregar a lista de fornecedores.");
    containerEl.innerHTML = `<p style="text-align:center;color:#aaa;padding:40px">Erro ao carregar fornecedores.</p>`;
    return;
  }

  containerEl.innerHTML = `
    <div class="section-header">
      <h2>Fornecedores</h2>
      ${_somenteLeitura ? "" : `<button id="for-novo" class="btn btn-primary">+ Novo Fornecedor</button>`}
    </div>
    <div class="pill-tabs" id="for-tabs" style="margin-bottom:16px">
      <button class="pill-tab active" data-tab="ativos">Ativos <span id="for-count-ativos"></span></button>
      <button class="pill-tab" data-tab="inativos">Inativos <span id="for-count-inativos"></span></button>
    </div>
    <div style="margin-bottom:16px">
      <input type="search" id="for-busca" class="input" placeholder="Buscar por nome, código, CNPJ ou telefone…" style="max-width:360px">
    </div>
    <div id="for-lista"></div>`;

  const listContainer = document.getElementById("for-lista");

  _renderizarAbas(listContainer, "ativos");

  document.getElementById("for-busca").addEventListener("input", e => {
    const abaAtiva = document.querySelector("#for-tabs .pill-tab.active")?.dataset.tab || "ativos";
    const lista = abaAtiva === "inativos" ? _fornecedoresInativos : _fornecedores;
    _renderizarLista(_filtrar(lista, e.target.value), listContainer, abaAtiva === "inativos" ? "inativo" : "ativo");
  });

  document.getElementById("for-tabs").addEventListener("click", e => {
    const tab = e.target.closest(".pill-tab")?.dataset.tab;
    if (tab) _renderizarAbas(listContainer, tab);
  });

  if (!_somenteLeitura) {
    document.getElementById("for-novo").addEventListener("click", () => _abrirCriacao(listContainer));
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
