import { db } from "../firebase-config.js";
import {
  collection, getDocs, addDoc, updateDoc, doc,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { abrirFormulario, registrarErro } from "../utils.js";
import { notificar } from "../notificacoes.js";

let _clientes        = [];
let _clientesInativos = [];
let _empresaId       = "";
let _somenteLeitura  = false;

// ── Código sequencial ────────────────────────────────────────────────────────

async function _proximoCodigo() {
  const snap = await getDocs(collection(db, `empresas/${_empresaId}/clientes`));
  let max = 0;
  snap.forEach(d => {
    const n = parseInt((d.data().codigo || "").replace("CLI", ""), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return "CLI" + String(max + 1).padStart(3, "0");
}

// ── Data (conversão entre YYYY-MM-DD e DD/MM/AAAA) ──────────────────────────

function _toInputDate(str) {
  if (!str) return "";
  if (str.includes("-")) return str;           // já é YYYY-MM-DD
  const [dd, mm, aaaa] = str.split("/");
  return aaaa && mm && dd ? `${aaaa}-${mm}-${dd}` : "";
}

function _fromInputDate(str) {
  if (!str) return "";
  if (str.includes("/")) return str;           // já é DD/MM/AAAA
  const [aaaa, mm, dd] = str.split("-");
  return aaaa && mm && dd ? `${dd}/${mm}/${aaaa}` : "";
}

// ── Aniversário (suporta YYYY-MM-DD e DD/MM/AAAA) ───────────────────────────

function _ehAniversario(dataNasc) {
  if (!dataNasc || dataNasc.length < 5) return false;
  const hoje = new Date();
  if (dataNasc.includes("-")) {
    const [, mm, dd] = dataNasc.split("-");
    return parseInt(dd, 10) === hoje.getDate() &&
           parseInt(mm, 10) === (hoje.getMonth() + 1);
  }
  const [dd, mm] = dataNasc.split("/");
  return parseInt(dd, 10) === hoje.getDate() &&
         parseInt(mm, 10) === (hoje.getMonth() + 1);
}

// ── Carregamento ─────────────────────────────────────────────────────────────

async function _carregar() {
  const q = query(
    collection(db, `empresas/${_empresaId}/clientes`),
    orderBy("nome")
  );
  const snap = await getDocs(q);
  _clientes         = [];
  _clientesInativos = [];
  snap.forEach(d => {
    const data = d.data();
    if (data.ativo === false) _clientesInativos.push({ id: d.id, ...data });
    else                      _clientes.push({ id: d.id, ...data });
  });
}

// ── Filtro ───────────────────────────────────────────────────────────────────

function _filtrar(lista, termo) {
  if (!termo) return lista;
  const t = termo.toLowerCase();
  return lista.filter(c =>
    (c.nome || "").toLowerCase().includes(t) ||
    (c.codigo || "").toLowerCase().includes(t) ||
    (c.telefone || "").toLowerCase().includes(t)
  );
}

// ── Renderização ─────────────────────────────────────────────────────────────

function _badgeAniv(c) {
  return _ehAniversario(c.dataNascimento)
    ? `<span class="tag tag-accent" style="margin-left:6px">🎂 Aniversário</span>`
    : "";
}

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
            <th>Telefone</th>
            <th>Aniversário</th>
            ${_somenteLeitura ? "" : "<th>Ações</th>"}
          </tr>
        </thead>
        <tbody>
          ${lista.length === 0
            ? `<tr><td colspan="${cols}" style="text-align:center;color:#aaa;padding:32px">Nenhum cliente encontrado.</td></tr>`
            : lista.map(c => `
              <tr>
                <td><span class="tag tag-neutral">${c.codigo || ""}</span></td>
                <td>${c.nome || ""}${_badgeAniv(c)}</td>
                <td>${c.telefone || ""}</td>
                <td style="color:#aaa">${c.dataNascimento || "—"}</td>
                ${_somenteLeitura ? "" : `<td>${_botoesAcao(c, contexto)}</td>`}
              </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function _renderizarCards(lista, container, contexto) {
  if (lista.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:#aaa;padding:32px">Nenhum cliente encontrado.</p>`;
    return;
  }

  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;margin-top:4px">` +
    lista.map(c => {
      const nomeFormatado = c.nome
        ? c.nome.toLowerCase().replace(/(^\w{1})|(\s+\w{1})/g, l => l.toUpperCase())
        : "";
      const inicial   = (nomeFormatado || "?")[0];
      const anivBadge = _ehAniversario(c.dataNascimento)
        ? `<span class="tag tag-accent" style="font-size:11px;padding:2px 8px">🎂 Aniversário hoje</span>`
        : "";
      const rodape = _somenteLeitura ? "" : contexto === "inativo"
        ? `<div style="border-top:1px solid rgba(0,0,0,.04);padding:12px 16px;display:flex;gap:10px">
             <button class="btn btn-sm btn-success" data-reativar="${c.id}" style="flex:1;justify-content:center;padding:10px;font-weight:600">Reativar</button>
           </div>`
        : `<div style="border-top:1px solid rgba(0,0,0,.04);padding:12px 16px;display:flex;gap:10px">
             <button class="btn btn-sm btn-secondary" data-editar="${c.id}" style="flex:1;justify-content:center;padding:10px;font-weight:600">Editar</button>
             <button class="btn btn-sm btn-danger" data-desativar="${c.id}" style="flex:1;justify-content:center;padding:10px;font-weight:600">Desativar</button>
           </div>`;

      return `
        <div class="card fade-up" style="overflow:hidden;border:1px solid rgba(0,0,0,.03);box-shadow:0 2px 8px rgba(0,0,0,.04)">
          <div style="display:flex;align-items:center;gap:14px;padding:16px 16px 12px">
            <div style="width:46px;height:46px;border-radius:50%;background:rgba(107,53,32,.08);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:var(--primary);flex-shrink:0">${inicial}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:16px;font-weight:700;color:var(--text);line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nomeFormatado}</div>
              <div style="margin-top:4px;display:flex;align-items:center;flex-wrap:wrap;gap:6px">
                <span class="tag tag-neutral" style="font-size:11px;padding:2px 8px">${c.codigo || ""}</span>${anivBadge}
              </div>
            </div>
          </div>
          <div style="padding:0 16px 14px;font-size:14px;color:#555;display:flex;flex-direction:column;gap:6px">
            <span style="display:flex;align-items:center;gap:8px"><span style="font-size:14px;color:var(--primary)">📞</span> ${c.telefone || "—"}</span>
            ${c.dataNascimento ? `<span style="display:flex;align-items:center;gap:8px"><span style="font-size:14px;color:var(--primary)">🗓️</span> ${c.dataNascimento}</span>` : ""}
          </div>
          ${rodape}
        </div>`;
    }).join("") +
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
  // Atualizar estado visual das abas
  document.querySelectorAll("#cli-tabs .pill-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === aba);
  });

  // Atualizar contadores
  const countAtivos   = document.getElementById("cli-count-ativos");
  const countInativos = document.getElementById("cli-count-inativos");
  if (countAtivos)   countAtivos.textContent   = `(${_clientes.length})`;
  if (countInativos) countInativos.textContent = `(${_clientesInativos.length})`;

  // Limpar busca ao trocar de aba
  const busca = document.getElementById("cli-busca");
  if (busca) busca.value = "";

  const lista = aba === "inativos" ? _clientesInativos : _clientes;
  _renderizarLista(lista, listContainer, aba === "inativos" ? "inativo" : "ativo");
}

// ── Formulário ───────────────────────────────────────────────────────────────

function _htmlFormulario(cliente) {
  const v = cliente || {};
  return `
    <form id="form-cliente" autocomplete="off">
      <div class="form-grid">
        <div class="form-group">
          <label class="lbl">Nome *</label>
          <input class="input" type="text" id="cli-nome" value="${v.nome || ""}" maxlength="100" placeholder="Nome completo">
        </div>
        <div class="form-group">
          <label class="lbl">Telefone *</label>
          <input class="input" type="tel" id="cli-telefone" value="${v.telefone || ""}" maxlength="20" placeholder="(00) 00000-0000">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="lbl">E-mail</label>
            <input class="input" type="email" id="cli-email" value="${v.email || ""}" maxlength="100" placeholder="email@exemplo.com">
          </div>
          <div class="form-group">
            <label class="lbl">CPF</label>
            <input class="input" type="text" id="cli-cpf" value="${v.cpf || ""}" maxlength="14" placeholder="000.000.000-00">
          </div>
        </div>
        <div class="form-group">
          <label class="lbl">Endereço</label>
          <input class="input" type="text" id="cli-endereco" value="${v.endereco || ""}" maxlength="200" placeholder="Rua, número, bairro">
        </div>
        <div class="form-group">
          <label class="lbl">Data de Nascimento</label>
          <input class="input" type="date" id="cli-nascimento" value="${_toInputDate(v.dataNascimento || "")}">
        </div>
        <div class="form-group">
          <label class="lbl">Observações</label>
          <textarea class="input" id="cli-obs" maxlength="300" rows="2" style="resize:vertical">${v.obs || ""}</textarea>
        </div>
        <button type="submit" id="cli-salvar" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:4px">Salvar</button>
      </div>
    </form>`;
}

function _coletarDados() {
  return {
    nome:           document.getElementById("cli-nome").value.trim(),
    telefone:       document.getElementById("cli-telefone").value.trim(),
    email:          document.getElementById("cli-email").value.trim(),
    cpf:            document.getElementById("cli-cpf").value.trim(),
    endereco:       document.getElementById("cli-endereco").value.trim(),
    dataNascimento: _fromInputDate(document.getElementById("cli-nascimento").value.trim()),
    obs:            document.getElementById("cli-obs").value.trim(),
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

async function _abrirCriacao(listContainer) {
  const codigo = await _proximoCodigo();
  abrirFormulario({ titulo: `Novo Cliente — ${codigo}`, conteudo: _htmlFormulario(null) });

  const form      = document.getElementById("form-cliente");
  const btnSalvar = document.getElementById("cli-salvar");
  const validar   = () => {
    btnSalvar.disabled =
      !document.getElementById("cli-nome").value.trim() ||
      !document.getElementById("cli-telefone").value.trim();
  };
  form.addEventListener("input", validar);
  validar();

  form.addEventListener("submit", async e => {
    e.preventDefault();
    btnSalvar.disabled = true;
    try {
      const dados = _coletarDados();
      await addDoc(collection(db, `empresas/${_empresaId}/clientes`), {
        ...dados, codigo, ativo: true, createdAt: serverTimestamp()
      });
      document.querySelector(".mc-modal-overlay, .mc-bs-overlay")?.remove();
      notificar("sucesso", "Cliente salvo", `${dados.nome} adicionado como ${codigo}.`);
      await _carregar();
      _renderizarAbas(listContainer, "ativos");
    } catch (err) {
      await registrarErro("firestore", err.message, "clientes.js");
      notificar("erro", "Erro ao salvar", "Não foi possível salvar o cliente.");
      btnSalvar.disabled = false;
    }
  });
}

async function _abrirEdicao(clienteId, listContainer) {
  const cliente = _clientes.find(c => c.id === clienteId);
  if (!cliente) return;
  abrirFormulario({ titulo: `Editar — ${cliente.codigo}`, conteudo: _htmlFormulario(cliente) });

  const form      = document.getElementById("form-cliente");
  const btnSalvar = document.getElementById("cli-salvar");
  const validar   = () => {
    btnSalvar.disabled =
      !document.getElementById("cli-nome").value.trim() ||
      !document.getElementById("cli-telefone").value.trim();
  };
  form.addEventListener("input", validar);

  form.addEventListener("submit", async e => {
    e.preventDefault();
    btnSalvar.disabled = true;
    try {
      const dados = _coletarDados();
      await updateDoc(doc(db, `empresas/${_empresaId}/clientes`, clienteId), dados);
      document.querySelector(".mc-modal-overlay, .mc-bs-overlay")?.remove();
      notificar("sucesso", "Cliente atualizado", `${dados.nome} atualizado.`);
      await _carregar();
      _renderizarAbas(listContainer, "ativos");
    } catch (err) {
      await registrarErro("firestore", err.message, "clientes.js");
      notificar("erro", "Erro ao salvar", "Não foi possível atualizar o cliente.");
      btnSalvar.disabled = false;
    }
  });
}

async function _desativar(clienteId, listContainer) {
  const cliente = _clientes.find(c => c.id === clienteId);
  if (!cliente) return;
  if (!window.confirm(`Desativar "${cliente.nome}"? O registro não será apagado.`)) return;
  try {
    await updateDoc(doc(db, `empresas/${_empresaId}/clientes`, clienteId), { ativo: false });
    notificar("sucesso", "Desativado", `${cliente.nome} foi desativado.`);
    await _carregar();
    _renderizarAbas(listContainer, "ativos");
  } catch (err) {
    await registrarErro("firestore", err.message, "clientes.js");
    notificar("erro", "Erro", "Não foi possível desativar o cliente.");
  }
}

async function _reativar(clienteId, listContainer) {
  const cliente = _clientesInativos.find(c => c.id === clienteId);
  if (!cliente) return;
  if (!window.confirm(`Reativar "${cliente.nome}"?`)) return;
  try {
    await updateDoc(doc(db, `empresas/${_empresaId}/clientes`, clienteId), { ativo: true });
    notificar("sucesso", "Reativado", `${cliente.nome} foi reativado.`);
    await _carregar();
    _renderizarAbas(listContainer, "inativos");
  } catch (err) {
    await registrarErro("firestore", err.message, "clientes.js");
    notificar("erro", "Erro", "Não foi possível reativar o cliente.");
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

  containerEl.innerHTML = `<p style="color:#aaa;padding:24px">Carregando clientes…</p>`;

  try {
    await _carregar();
  } catch (err) {
    await registrarErro("firestore", err.message, "clientes.js");
    notificar("erro", "Erro ao carregar", "Não foi possível carregar a lista de clientes.");
    containerEl.innerHTML = `<p style="text-align:center;color:#aaa;padding:40px">Erro ao carregar clientes.</p>`;
    return;
  }

  containerEl.innerHTML = `
    <div class="section-header">
      <h2>Clientes</h2>
      ${_somenteLeitura ? "" : `<button id="cli-novo" class="btn btn-primary">+ Novo Cliente</button>`}
    </div>
    <div class="pill-tabs" id="cli-tabs" style="margin-bottom:16px">
      <button class="pill-tab active" data-tab="ativos">Ativos <span id="cli-count-ativos"></span></button>
      <button class="pill-tab" data-tab="inativos">Inativos <span id="cli-count-inativos"></span></button>
    </div>
    <div style="margin-bottom:16px">
      <input type="search" id="cli-busca" class="input" placeholder="Buscar por nome, código ou telefone…" style="max-width:360px">
    </div>
    <div id="cli-lista"></div>`;

  const listContainer = document.getElementById("cli-lista");

  // Render inicial na aba Ativos
  _renderizarAbas(listContainer, "ativos");

  // Busca — filtra a aba atual
  document.getElementById("cli-busca").addEventListener("input", e => {
    const abaAtiva = document.querySelector("#cli-tabs .pill-tab.active")?.dataset.tab || "ativos";
    const lista = abaAtiva === "inativos" ? _clientesInativos : _clientes;
    _renderizarLista(_filtrar(lista, e.target.value), listContainer, abaAtiva === "inativos" ? "inativo" : "ativo");
  });

  // Troca de aba
  document.getElementById("cli-tabs").addEventListener("click", e => {
    const tab = e.target.closest(".pill-tab")?.dataset.tab;
    if (tab) _renderizarAbas(listContainer, tab);
  });

  // Botão novo cliente
  if (!_somenteLeitura) {
    document.getElementById("cli-novo").addEventListener("click", () => _abrirCriacao(listContainer));
  }

  // Delegação de cliques na lista (editar / desativar / reativar)
  listContainer.addEventListener("click", e => {
    const idEditar    = e.target.dataset.editar;
    const idDesativar = e.target.dataset.desativar;
    const idReativar  = e.target.dataset.reativar;
    if (idEditar)    _abrirEdicao(idEditar, listContainer);
    if (idDesativar) _desativar(idDesativar, listContainer);
    if (idReativar)  _reativar(idReativar, listContainer);
  });
}
