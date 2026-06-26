import { db } from "../firebase-config.js";
import {
  collection, getDocs, addDoc, updateDoc, doc,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { abrirFormulario, registrarErro } from "../utils.js";
import { notificar } from "../notificacoes.js";
import { planGuard } from "../planGuard.js";

// ── Estado do módulo ──────────────────────────────────────────────────────────

let _empresaId      = "";
let _uid            = "";
let _plano          = "standard";
let _somenteLeitura = false;

let _produtos       = [];   // lista de produtos ativos (aba Por Produto)
let _historico      = [];   // movimentações da aba Histórico
let _pagina         = 1;    // paginação do histórico (50 por página)
const _POR_PAGINA   = 50;

// ── Helpers de badge ─────────────────────────────────────────────────────────

function _badgeProduto(p) {
  const atual = Number(p.estoqueAtual ?? 0);
  const min   = Number(p.estoqueMinimo ?? 0);
  const ctrl  = p.controlarEstoque === true;

  if (ctrl && atual <= 0) {
    return `<span class="tag tag-danger" style="margin-left:6px">Sem estoque</span>`;
  }
  if (atual <= min && min > 0 && atual > 0) {
    return `<span class="tag tag-accent" style="margin-left:6px">Estoque baixo</span>`;
  }
  return "";
}

// ── Carregamento ─────────────────────────────────────────────────────────────

async function _carregarProdutos() {
  const snap = await getDocs(collection(db, `empresas/${_empresaId}/produtos`));
  _produtos = [];
  snap.forEach(d => {
    const data = d.data();
    if (data.ativo !== false) _produtos.push({ id: d.id, ...data });
  });
  _produtos.sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
}

async function _carregarHistorico() {
  const q = query(
    collection(db, `empresas/${_empresaId}/estoque`),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  _historico = [];
  snap.forEach(d => _historico.push({ id: d.id, ...d.data() }));
}

// ── Filtro ───────────────────────────────────────────────────────────────────

function _filtrarProdutos(lista, termo) {
  if (!termo) return lista;
  const t = termo.toLowerCase();
  return lista.filter(p =>
    (p.nome || "").toLowerCase().includes(t) ||
    (p.codigo || "").toLowerCase().includes(t)
  );
}

function _filtrarHistorico(lista, nomeProduto, diasPeriodo) {
  let result = lista;
  if (nomeProduto && nomeProduto !== "todos") {
    result = result.filter(m => m.nomeProduto === nomeProduto);
  }
  if (diasPeriodo) {
    const limite = Date.now() - diasPeriodo * 24 * 60 * 60 * 1000;
    result = result.filter(m => {
      const ts = m.createdAt?.toMillis?.() ?? m.createdAt?.seconds * 1000 ?? 0;
      return ts >= limite;
    });
  }
  return result;
}

// ── Formatação de data ────────────────────────────────────────────────────────

function _formatarData(createdAt) {
  if (!createdAt) return "—";
  const ms = createdAt?.toMillis?.() ?? (createdAt?.seconds ? createdAt.seconds * 1000 : null);
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("pt-BR");
}

// ── Renderização — Aba "Por Produto" ─────────────────────────────────────────

function _botoesAjuste(p) {
  if (_somenteLeitura || _plano !== "profissional") return "";
  return `<button class="btn btn-sm btn-secondary" data-ajuste="${p.id}" data-nome="${(p.nome || "").replace(/"/g, "&quot;")}" data-estoque="${Number(p.estoqueAtual ?? 0)}">Ajuste Manual</button>`;
}

function _renderizarTabelaProdutos(lista, container) {
  const temAcoes = !_somenteLeitura && _plano === "profissional";
  const cols = temAcoes ? 5 : 4;
  container.innerHTML = `
    <div class="table-responsive">
      <table class="table" style="margin-top:4px">
        <thead>
          <tr>
            <th>Código</th>
            <th>Nome</th>
            <th>Estoque Atual</th>
            <th>Estoque Mínimo</th>
            ${temAcoes ? "<th>Ações</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${lista.length === 0
            ? `<tr><td colspan="${cols}" style="text-align:center;color:#aaa;padding:32px">Nenhum produto encontrado.</td></tr>`
            : lista.map(p => `
              <tr>
                <td><span class="tag tag-neutral">${p.codigo || "—"}</span></td>
                <td>${p.nome || ""}${_badgeProduto(p)}</td>
                <td>${Number(p.estoqueAtual ?? 0)}</td>
                <td>${Number(p.estoqueMinimo ?? 0)}</td>
                ${temAcoes ? `<td>${_botoesAjuste(p)}</td>` : ""}
              </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function _renderizarCardsProdutos(lista, container) {
  if (lista.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:#aaa;padding:32px">Nenhum produto encontrado.</p>`;
    return;
  }
  const temAcoes = !_somenteLeitura && _plano === "profissional";
  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;margin-top:4px">` +
    lista.map(p => `
      <div class="card fade-up" style="overflow:hidden">
        <div style="padding:16px 16px 12px">
          <div style="font-size:17px;font-weight:700;color:var(--text);line-height:1.3;margin-bottom:6px">${p.nome || ""}</div>
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-bottom:10px">
            <span class="tag tag-neutral">${p.codigo || "—"}</span>${_badgeProduto(p)}
          </div>
          <div style="font-size:15px;color:#666">
            Atual: <strong>${Number(p.estoqueAtual ?? 0)}</strong>&nbsp;·&nbsp;Mínimo: ${Number(p.estoqueMinimo ?? 0)}
          </div>
        </div>
        ${temAcoes ? `<div style="border-top:1px solid rgba(0,0,0,.05);padding:10px 16px;display:flex;gap:8px">${_botoesAjuste(p)}</div>` : ""}
      </div>`).join("") +
    `</div>`;
}

function _renderizarListaProdutos(lista, container) {
  if (window._layoutMobile) {
    _renderizarCardsProdutos(lista, container);
  } else {
    _renderizarTabelaProdutos(lista, container);
  }
}

// ── Renderização — Aba "Histórico" ────────────────────────────────────────────

function _labelTipo(tipo) {
  if (tipo === "entrada") return `<span class="tag tag-success">Entrada</span>`;
  if (tipo === "saida")   return `<span class="tag tag-danger">Saída</span>`;
  return `<span class="tag tag-neutral">Ajuste</span>`;
}

function _renderizarTabelaHistorico(lista, container, verMais) {
  const pagina = lista.slice(0, _pagina * _POR_PAGINA);
  container.innerHTML = `
    <div class="table-responsive">
      <table class="table" style="margin-top:4px">
        <thead>
          <tr>
            <th>Produto</th>
            <th>Tipo</th>
            <th>Quantidade</th>
            <th>Motivo</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody>
          ${pagina.length === 0
            ? `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:32px">Nenhuma movimentação encontrada.</td></tr>`
            : pagina.map(m => `
              <tr>
                <td>${m.nomeProduto || "—"}</td>
                <td>${_labelTipo(m.tipo)}</td>
                <td>${Number(m.quantidade ?? 0)}</td>
                <td style="color:#888">${m.motivo || "—"}</td>
                <td style="color:#aaa">${_formatarData(m.createdAt)}</td>
              </tr>`).join("")}
        </tbody>
      </table>
    </div>
    ${verMais ? `<div style="text-align:center;margin-top:16px"><button id="est-ver-mais" class="btn btn-secondary">Ver mais 50</button></div>` : ""}`;
}

function _renderizarCardsHistorico(lista, container, verMais) {
  const pagina = lista.slice(0, _pagina * _POR_PAGINA);
  if (pagina.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:#aaa;padding:32px">Nenhuma movimentação encontrada.</p>`;
    return;
  }
  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;margin-top:4px">` +
    pagina.map(m => `
      <div class="card fade-up" style="padding:16px">
        <div style="font-size:17px;font-weight:700;color:var(--text);line-height:1.3;margin-bottom:6px">${m.nomeProduto || "—"}</div>
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-bottom:10px">
          ${_labelTipo(m.tipo)}
        </div>
        <div style="font-size:15px;color:#666">
          Qtd: <strong>${Number(m.quantidade ?? 0)}</strong>
          ${m.motivo ? `&nbsp;·&nbsp;${m.motivo}` : ""}
          &nbsp;·&nbsp;${_formatarData(m.createdAt)}
        </div>
      </div>`).join("") +
    `</div>` +
    (verMais ? `<div style="text-align:center;margin-top:16px"><button id="est-ver-mais" class="btn btn-secondary">Ver mais 50</button></div>` : "");
}

function _renderizarHistorico(listaFiltrada, container) {
  const verMais = listaFiltrada.length > _pagina * _POR_PAGINA;
  if (window._layoutMobile) {
    _renderizarCardsHistorico(listaFiltrada, container, verMais);
  } else {
    _renderizarTabelaHistorico(listaFiltrada, container, verMais);
  }
}

// ── HTML dos filtros do histórico ─────────────────────────────────────────────

function _htmlFiltrosHistorico() {
  const nomes = [...new Set(_historico.map(m => m.nomeProduto).filter(Boolean))].sort();
  return `
    <div class="form-row" style="max-width:420px;margin-bottom:16px">
      <div class="form-group">
        <label class="lbl">Produto</label>
        <select class="input select" id="est-filtro-produto">
          <option value="todos">Todos</option>
          ${nomes.map(n => `<option value="${n.replace(/"/g, "&quot;")}">${n}</option>`).join("")}
        </select>
      </div>
      <div class="form-group">
        <label class="lbl">Período</label>
        <select class="input select" id="est-filtro-periodo">
          <option value="30">Últimos 30 dias</option>
          <option value="60">Últimos 60 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="">Todos</option>
        </select>
      </div>
    </div>`;
}

// ── Formulário de ajuste ─────────────────────────────────────────────────────

function _htmlFormularioAjuste(nomeProduto) {
  return `
    <form id="form-ajuste" autocomplete="off">
      <div class="form-grid">
        <div class="form-group">
          <label class="lbl">Produto</label>
          <input class="input" type="text" value="${nomeProduto}" disabled style="opacity:.7">
        </div>
        <div class="form-group">
          <label class="lbl">Tipo *</label>
          <select class="select" id="est-tipo">
            <option value="entrada">Entrada</option>
            <option value="saida">Saída</option>
            <option value="ajuste">Ajuste</option>
          </select>
        </div>
        <div class="form-group">
          <label class="lbl">Quantidade *</label>
          <input class="input" type="number" id="est-qtd" min="1" step="1" placeholder="Ex: 10">
        </div>
        <div class="form-group">
          <label class="lbl" id="est-motivo-lbl">Motivo <span id="est-motivo-obrig" style="color:#e74c3c;display:none">*</span></label>
          <input class="input" type="text" id="est-motivo" maxlength="200" placeholder="Opcional">
        </div>
        <button type="submit" id="est-salvar" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:4px" disabled>Salvar</button>
      </div>
    </form>`;
}

// ── Lógica do formulário de ajuste ────────────────────────────────────────────

async function _abrirAjuste(produtoId, nomeProduto, estoqueAtual, listContainer) {
  abrirFormulario({ titulo: `Ajuste de Estoque — ${nomeProduto}`, conteudo: _htmlFormularioAjuste(nomeProduto) });

  const form      = document.getElementById("form-ajuste");
  const selTipo   = document.getElementById("est-tipo");
  const inputQtd  = document.getElementById("est-qtd");
  const inputMot  = document.getElementById("est-motivo");
  const obrigSpan = document.getElementById("est-motivo-obrig");
  const btnSalvar = document.getElementById("est-salvar");

  function _atualizarObrigatoriedade() {
    const tipoAjuste = selTipo.value === "ajuste";
    obrigSpan.style.display = tipoAjuste ? "inline" : "none";
    inputMot.placeholder    = tipoAjuste ? "Obrigatório para ajuste" : "Opcional";
  }

  function _validar() {
    const tipo   = selTipo.value;
    const qtd    = parseInt(inputQtd.value, 10);
    const motivo = inputMot.value.trim();
    const qtdOk  = !isNaN(qtd) && qtd >= 1;
    const motOk  = tipo !== "ajuste" || motivo.length > 0;
    btnSalvar.disabled = !(qtdOk && motOk);
  }

  selTipo.addEventListener("change", () => {
    _atualizarObrigatoriedade();
    _validar();
  });
  inputQtd.addEventListener("input", _validar);
  inputMot.addEventListener("input", _validar);
  _atualizarObrigatoriedade();

  form.addEventListener("submit", async e => {
    e.preventDefault();
    btnSalvar.disabled = true;

    const tipo     = selTipo.value;
    const qtd      = parseInt(inputQtd.value, 10);
    const motivo   = inputMot.value.trim();

    // Validação: motivo obrigatório para ajuste
    if (tipo === "ajuste" && !motivo) {
      notificar("erro", "Campo obrigatório", "Informe o motivo para ajuste manual.");
      btnSalvar.disabled = false;
      return;
    }

    // Validação: saída não pode negativar estoque
    if (tipo === "saida" && (estoqueAtual - qtd) < 0) {
      notificar("erro", "Estoque insuficiente", `Estoque atual é ${estoqueAtual}. Não é possível retirar ${qtd} unidades.`);
      btnSalvar.disabled = false;
      return;
    }

    try {
      // 1. Registrar movimentação
      await addDoc(collection(db, `empresas/${_empresaId}/estoque`), {
        produtoId,
        nomeProduto,
        tipo,
        quantidade:    qtd,
        motivo:        motivo || "",
        operadorId:    _uid,
        criadoOffline: false,
        sincronizado:  true,
        createdAt:     serverTimestamp()
      });

      // 2. Atualizar estoqueAtual no produto
      let novoEstoque;
      if (tipo === "entrada") {
        novoEstoque = estoqueAtual + qtd;
      } else if (tipo === "saida") {
        novoEstoque = estoqueAtual - qtd;
      } else {
        // ajuste: substituição direta
        novoEstoque = qtd;
      }

      await updateDoc(doc(db, `empresas/${_empresaId}/produtos`, produtoId), {
        estoqueAtual: novoEstoque
      });

      // 3. Fechar modal/bottom sheet
      document.querySelector(".mc-modal-overlay, .mc-bs-overlay")?.remove();

      notificar("sucesso", "Estoque atualizado", "Movimentação registrada com sucesso.");

      // 4. Recarregar lista
      await _carregarProdutos();
      _renderizarListaProdutos(_filtrarProdutos(_produtos, document.getElementById("est-busca")?.value || ""), listContainer);
    } catch (err) {
      await registrarErro("firestore", err.message, "estoque.js");
      notificar("erro", "Erro ao salvar", "Não foi possível registrar a movimentação.");
      btnSalvar.disabled = false;
    }
  });
}

// ── Renderização das abas ─────────────────────────────────────────────────────

function _renderizarAbas(conteudoContainer, aba) {
  document.querySelectorAll("#est-tabs .pill-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === aba);
  });
  conteudoContainer.dataset.abaAtiva = aba;
}

// ── Montagem do conteúdo de cada aba ─────────────────────────────────────────

function _montarAbaPorProduto(conteudoContainer, listContainer) {
  listContainer.innerHTML = "";
  const termo = document.getElementById("est-busca")?.value || "";
  _renderizarListaProdutos(_filtrarProdutos(_produtos, termo), listContainer);
}

async function _montarAbaHistorico(conteudoContainer) {
  // Standard → upgrade
  if (_plano !== "profissional") {
    const guardEl = document.createElement("div");
    conteudoContainer.innerHTML = "";
    conteudoContainer.appendChild(guardEl);
    planGuard("profissional", guardEl);
    return;
  }

  conteudoContainer.innerHTML = `<p style="color:#aaa;padding:24px">Carregando histórico…</p>`;

  try {
    await _carregarHistorico();
  } catch (err) {
    await registrarErro("firestore", err.message, "estoque.js");
    notificar("erro", "Erro ao carregar", "Não foi possível carregar o histórico de movimentações.");
    conteudoContainer.innerHTML = `<p style="text-align:center;color:#aaa;padding:40px">Erro ao carregar histórico.</p>`;
    return;
  }

  _pagina = 1;

  conteudoContainer.innerHTML = _htmlFiltrosHistorico() + `<div id="est-hist-lista"></div>`;
  const histLista = document.getElementById("est-hist-lista");

  function _aplicarFiltros() {
    const nomeProd  = document.getElementById("est-filtro-produto")?.value || "todos";
    const diasStr   = document.getElementById("est-filtro-periodo")?.value || "";
    const dias      = diasStr ? parseInt(diasStr, 10) : null;
    const filtrado  = _filtrarHistorico(_historico, nomeProd, dias);
    _renderizarHistorico(filtrado, histLista);

    // Listener "Ver mais" — delegado no histLista para evitar acúmulo
    histLista.addEventListener("click", function _verMais(e) {
      if (e.target.id !== "est-ver-mais") return;
      histLista.removeEventListener("click", _verMais);
      _pagina++;
      _renderizarHistorico(filtrado, histLista);
      _aplicarFiltros();
    });
  }

  document.getElementById("est-filtro-produto")?.addEventListener("change", () => {
    _pagina = 1;
    _aplicarFiltros();
  });
  document.getElementById("est-filtro-periodo")?.addEventListener("change", () => {
    _pagina = 1;
    _aplicarFiltros();
  });

  _aplicarFiltros();
}

// ── Entrada do módulo ────────────────────────────────────────────────────────

export async function renderizar(sessao, containerEl) {
  // Admin only
  if (sessao.perfil !== "admin") {
    containerEl.innerHTML = `<p style="text-align:center;color:#aaa;padding:40px">Acesso restrito a administradores.</p>`;
    return;
  }

  _empresaId      = sessao.empresaId;
  _uid            = sessao.uid;
  _plano          = sessao.plano || "standard";
  _somenteLeitura = sessao.acesso === "somente_leitura";

  containerEl.innerHTML = `<p style="color:#aaa;padding:24px">Carregando estoque…</p>`;

  try {
    await _carregarProdutos();
  } catch (err) {
    await registrarErro("firestore", err.message, "estoque.js");
    notificar("erro", "Erro ao carregar", "Não foi possível carregar os produtos.");
    containerEl.innerHTML = `<p style="text-align:center;color:#aaa;padding:40px">Erro ao carregar estoque.</p>`;
    return;
  }

  containerEl.innerHTML = `
    <div class="section-header">
      <h2>Estoque</h2>
    </div>
    <div class="pill-tabs" id="est-tabs" style="margin-bottom:16px">
      <button class="pill-tab active" data-tab="por-produto">Por Produto</button>
      <button class="pill-tab" data-tab="historico">Histórico</button>
    </div>
    <div style="margin-bottom:16px">
      <input type="search" id="est-busca" class="input" placeholder="Buscar por nome ou código…" style="max-width:360px">
    </div>
    <div id="est-conteudo"></div>`;

  const conteudoContainer = document.getElementById("est-conteudo");

  // ── Montar aba inicial: Por Produto ───────────────────────────────────────
  conteudoContainer.innerHTML = `<div id="est-lista"></div>`;
  const listContainer = document.getElementById("est-lista");
  _renderizarAbas(conteudoContainer, "por-produto");
  _renderizarListaProdutos(_produtos, listContainer);

  // ── Busca ─────────────────────────────────────────────────────────────────
  document.getElementById("est-busca").addEventListener("input", e => {
    const abaAtiva = conteudoContainer.dataset.abaAtiva || "por-produto";
    if (abaAtiva !== "por-produto") return;
    _renderizarListaProdutos(_filtrarProdutos(_produtos, e.target.value), listContainer);
  });

  // ── Troca de aba ─────────────────────────────────────────────────────────
  document.getElementById("est-tabs").addEventListener("click", async e => {
    const tab = e.target.closest(".pill-tab")?.dataset.tab;
    if (!tab) return;
    _renderizarAbas(conteudoContainer, tab);

    if (tab === "por-produto") {
      conteudoContainer.innerHTML = `<div id="est-lista"></div>`;
      const lc = document.getElementById("est-lista");
      _renderizarListaProdutos(_filtrarProdutos(_produtos, document.getElementById("est-busca")?.value || ""), lc);
      // Re-registrar delegação para nova listContainer
      _delegarCliquesLista(lc);
    } else if (tab === "historico") {
      await _montarAbaHistorico(conteudoContainer);
    }
  });

  // ── Delegação de cliques na lista de produtos ─────────────────────────────
  _delegarCliquesLista(listContainer);
}

// ── Delegação de eventos da lista ─────────────────────────────────────────────

function _delegarCliquesLista(listContainer) {
  listContainer.addEventListener("click", e => {
    const btn = e.target.closest("[data-ajuste]");
    if (!btn) return;
    const produtoId    = btn.dataset.ajuste;
    const nomeProduto  = btn.dataset.nome || "";
    const estoqueAtual = parseInt(btn.dataset.estoque ?? "0", 10);
    _abrirAjuste(produtoId, nomeProduto, estoqueAtual, listContainer);
  });
}
