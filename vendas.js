// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · vendas.js · v3.0                                    ║
// ║  Módulo de Vendas — carrinho, pagamento, offline, cupom         ║
// ╚══════════════════════════════════════════════════════════════════╝

import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, updateDoc, doc, query, where, orderBy, limit,
  serverTimestamp, runTransaction, getDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { notificar } from "./notificacoes.js";
import {
  abrirFormulario, registrarErro, formatarMoeda, formatarData,
  debounce, gerarDispositivoId
} from "./utils.js";
import { podeVenderOffline, incrementarVendaOffline } from "./syncManager.js";
import { VERSAO_APP } from "./auth.js";

// ─── ESTADO DO MÓDULO ──────────────────────────────────────────────
let _sessao        = null;
let _vendas        = [];
let _filtroAtivo   = "hoje";
let _carrinhoItens = [];
let _clientesSugest = [];

// Sem injeção de estilos de impressão — cupom usa iframe isolado

// ─── HELPERS DE DATA ──────────────────────────────────────────────
function _inicioHoje() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function _inicioSemana() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const dia = d.getDay();
  d.setDate(d.getDate() - (dia === 0 ? 6 : dia - 1));
  return d;
}

function _inicioMes() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d;
}

function _tsParaMs(ts) {
  if (!ts) return 0;
  if (ts?.toMillis) return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  return Number(ts);
}

function _formatarHora(ts) {
  const ms = _tsParaMs(ts);
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// ─── CÓDIGO SEQUENCIAL ────────────────────────────────────────────
async function _proximoCodigo() {
  try {
    const snap = await getDocs(collection(db, `empresas/${_sessao.empresaId}/vendas`));
    let max = 0;
    snap.forEach(d => {
      const c = parseInt(d.data().codigo || 0, 10);
      if (!isNaN(c) && c > max) max = c;
    });
    return max + 1;
  } catch {
    return Date.now() % 100000;
  }
}

// ─── CARREGAR VENDAS ──────────────────────────────────────────────
async function _carregarVendas(filtro) {
  _filtroAtivo = filtro;
  let inicio;
  if (filtro === "hoje")   inicio = _inicioHoje();
  else if (filtro === "semana") inicio = _inicioSemana();
  else                     inicio = _inicioMes();

  const iTs = Timestamp.fromDate(inicio);
  const q = query(
    collection(db, `empresas/${_sessao.empresaId}/vendas`),
    where("createdAt", ">=", iTs),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  _vendas = [];
  snap.forEach(d => _vendas.push({ id: d.id, ...d.data() }));
}

// ─── RENDERIZAÇÃO LISTA ───────────────────────────────────────────
function _labelPagamento(forma) {
  return {
    dinheiro: "Dinheiro",
    pix: "Pix",
    debito: "Cartão Débito",
    credito: "Cartão Crédito",
    misto: "Misto",
  }[forma] || forma || "—";
}

function _badgeStatus(venda) {
  if (venda.cancelada) return `<span class="tag tag-danger">Cancelada</span>`;
  return `<span class="tag tag-success">Pago</span>`;
}

function _podeCancel(venda) {
  if (venda.cancelada) return false;
  if (_sessao?.acesso === "somente_leitura") return false;
  if (_sessao.perfil === "admin") return true;
  return venda.operadorId === _sessao.uid;
}

function _botoesAcao(venda) {
  const cupom = `<button class="btn btn-sm btn-secondary" data-cupom="${venda.id}" style="margin-right:6px">Cupom</button>`;
  const cancel = _podeCancel(venda)
    ? `<button class="btn btn-sm btn-danger" data-cancelar="${venda.id}">Cancelar</button>`
    : "";
  return cupom + cancel;
}

function _renderizarTabela(lista, container) {
  container.innerHTML = `
    <div class="table-responsive">
      <table class="table" style="margin-top:4px">
        <thead>
          <tr>
            <th>#</th>
            <th>Data/Hora</th>
            <th>Cliente</th>
            <th>Itens</th>
            <th>Total</th>
            <th>Pagamento</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          ${lista.length === 0
            ? `<tr><td colspan="8" style="text-align:center;color:#aaa;padding:32px">Nenhuma venda encontrada.</td></tr>`
            : lista.map(v => `
              <tr style="${v.cancelada ? "opacity:.6" : ""}">
                <td><span class="tag tag-neutral">${v.codigo || "—"}</span></td>
                <td>${formatarData(v.createdAt)} ${_formatarHora(v.createdAt)}</td>
                <td>${v.nomeCliente || "Consumidor Final"}</td>
                <td>${(v.itens || []).length} item(s)</td>
                <td style="font-weight:700">${formatarMoeda(v.totalLiquido)}</td>
                <td>${_labelPagamento(v.formaPagamento)}${v.parcelas > 1 ? ` ${v.parcelas}x` : ""}</td>
                <td>${_badgeStatus(v)}</td>
                <td>${_botoesAcao(v)}</td>
              </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function _renderizarCards(lista, container) {
  if (lista.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:#aaa;padding:32px">Nenhuma venda encontrada.</p>`;
    return;
  }
  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;margin-top:4px">` +
    lista.map(v => `
      <div class="card fade-up" style="overflow:hidden;${v.cancelada ? "opacity:.65" : ""}">
        <div style="padding:16px 16px 10px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div>
            <div style="font-size:16px;font-weight:700;color:var(--text)">${v.nomeCliente || "Consumidor Final"}</div>
            <div style="margin-top:4px;font-size:13px;color:#888">${formatarData(v.createdAt)} ${_formatarHora(v.createdAt)}</div>
            <div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span class="tag tag-neutral">#${v.codigo || "—"}</span>
              ${_badgeStatus(v)}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:20px;font-weight:800;color:var(--primary)">${formatarMoeda(v.totalLiquido)}</div>
            <div style="font-size:12px;color:#aaa;margin-top:2px">${_labelPagamento(v.formaPagamento)}${v.parcelas > 1 ? ` ${v.parcelas}x` : ""}</div>
          </div>
        </div>
        <div style="padding:0 16px 10px;font-size:13px;color:#666">${(v.itens || []).length} item(s)</div>
        <div style="border-top:1px solid rgba(0,0,0,.05);padding:10px 16px;display:flex;gap:8px">
          <button class="btn btn-sm btn-secondary" data-cupom="${v.id}" style="flex:1;justify-content:center">Cupom</button>
          ${_podeCancel(v) ? `<button class="btn btn-sm btn-danger" data-cancelar="${v.id}" style="flex:1;justify-content:center">Cancelar</button>` : ""}
        </div>
      </div>`).join("") +
    `</div>`;
}

function _renderizarLista(lista, container) {
  if (window._layoutMobile) {
    _renderizarCards(lista, container);
  } else {
    _renderizarTabela(lista, container);
  }
}

// ─── BUSCA DE PRODUTOS ────────────────────────────────────────────
function _buscarProdutosKit(termo) {
  try {
    const kit = JSON.parse(localStorage.getItem("mc_kit_offline") || "{}");
    const produtos = kit.produtos || [];
    if (!termo) return produtos.slice(0, 8);
    const t = termo.toLowerCase();
    return produtos.filter(p =>
      (p.nome || "").toLowerCase().includes(t) ||
      (p.codigo || "").toLowerCase().includes(t) ||
      (p.codigoInterno || "").toLowerCase().includes(t)
    ).slice(0, 8);
  } catch {
    return [];
  }
}

async function _buscarProdutosFirestore(termo) {
  try {
    // Sem orderBy para evitar exigência de índice composto (ativo+nome) no Firestore
    const q = query(
      collection(db, `empresas/${_sessao.empresaId}/produtos`),
      where("ativo", "==", true),
      limit(50)
    );
    const snap = await getDocs(q);
    let lista = [];
    snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
    lista.sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
    if (!termo) return lista.slice(0, 8);
    const t = termo.toLowerCase();
    return lista.filter(p =>
      (p.nome || "").toLowerCase().includes(t) ||
      (p.codigo || "").toLowerCase().includes(t)
    ).slice(0, 8);
  } catch (err) {
    await registrarErro("firestore", err.message, "vendas.js");
    return [];
  }
}

async function _buscarProdutos(termo) {
  const kit = JSON.parse(localStorage.getItem("mc_kit_offline") || "{}");
  if (kit.produtos && kit.produtos.length > 0) {
    return _buscarProdutosKit(termo);
  }
  return _buscarProdutosFirestore(termo);
}

// ─── BUSCA DE CLIENTES ────────────────────────────────────────────
function _buscarClientesKit(termo) {
  try {
    const kit = JSON.parse(localStorage.getItem("mc_kit_offline") || "{}");
    const clientes = kit.clientes || [];
    if (!termo || termo.length < 2) return [];
    const t = termo.toLowerCase();
    return clientes.filter(c =>
      (c.nome || "").toLowerCase().includes(t) ||
      (c.telefone || "").includes(t)
    ).slice(0, 6);
  } catch { return []; }
}

async function _buscarClientes(termo) {
  if (!termo || termo.length < 2) return [];
  try {
    const kit = JSON.parse(localStorage.getItem("mc_kit_offline") || "{}");
    if (kit.clientes && kit.clientes.length > 0) {
      return _buscarClientesKit(termo);
    }
  } catch { /* silencioso */ }
  try {
    const snap = await getDocs(
      query(
        collection(db, `empresas/${_sessao.empresaId}/clientes`),
        where("ativo", "==", true),
        orderBy("nome"),
        limit(6)
      )
    );
    const lista = [];
    const t = termo.toLowerCase();
    snap.forEach(d => {
      const data = d.data();
      if (
        (data.nome || "").toLowerCase().includes(t) ||
        (data.telefone || "").includes(t)
      ) {
        lista.push({ id: d.id, ...data });
      }
    });
    return lista;
  } catch {
    return [];
  }
}

// ─── DESCONTO ─────────────────────────────────────────────────────
function _obterPermissaoDesconto() {
  if (_sessao.perfil === "admin" && _sessao.plano === "profissional") return "livre";
  if (_sessao.plano === "standard") return "livre";
  // Operador profissional — lê do kit
  try {
    const kit = JSON.parse(localStorage.getItem("mc_kit_offline") || "{}");
    return kit.descontoPermitido || "livre";
  } catch {
    return "livre";
  }
}

// ─── CALCULAR TOTAIS ──────────────────────────────────────────────
function _calcularTotais(itens, descontoTipo, descontoValor) {
  const totalBruto = itens.reduce((s, i) => s + i.subtotal, 0);
  let desconto = 0;
  if (descontoTipo === "percentual") {
    desconto = totalBruto * (descontoValor / 100);
  } else if (descontoTipo === "valor") {
    desconto = descontoValor;
  }
  desconto = Math.min(Math.max(desconto, 0), totalBruto);
  return { totalBruto, desconto, totalLiquido: totalBruto - desconto };
}

// ─── CARRINHO HTML ─────────────────────────────────────────────────
function _htmlCarrinho(permDesconto) {
  const mostraDesconto = permDesconto !== "nenhum";
  const tiposDesconto = {
    livre: `
      <div class="form-row" style="align-items:flex-end;gap:8px">
        <div class="form-group" style="flex:0 0 130px">
          <label class="lbl">Tipo</label>
          <select class="input select" id="vnd-desc-tipo">
            <option value="">Sem desconto</option>
            <option value="percentual">%</option>
            <option value="valor">R$</option>
          </select>
        </div>
        <div class="form-group" style="flex:1">
          <label class="lbl">Valor</label>
          <input class="input" type="number" id="vnd-desc-valor" min="0" step="0.01" placeholder="0" disabled>
        </div>
      </div>`,
    percentual: `
      <div class="form-group">
        <label class="lbl">Desconto (%)</label>
        <input class="input" type="number" id="vnd-desc-valor" min="0" max="100" step="0.01" placeholder="0">
        <input type="hidden" id="vnd-desc-tipo" value="percentual">
      </div>`,
    valor_fixo: `
      <div class="form-group">
        <label class="lbl">Desconto (R$)</label>
        <input class="input" type="number" id="vnd-desc-valor" min="0" step="0.01" placeholder="0,00">
        <input type="hidden" id="vnd-desc-tipo" value="valor">
      </div>`,
  };
  const htmlDesconto = tiposDesconto[permDesconto] || tiposDesconto.livre;

  return `
    <div style="display:flex;flex-direction:column;gap:16px">

      <!-- Busca de produto -->
      <div class="form-group" style="position:relative">
        <label class="lbl">Adicionar Produto</label>
        <input class="input" type="search" id="vnd-busca-prod" placeholder="Buscar produto por nome…" autocomplete="off">
        <div id="vnd-sugest-prod" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #e0e0e0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:200;max-height:220px;overflow-y:auto"></div>
      </div>

      <!-- Lista de itens -->
      <div>
        <label class="lbl">Itens do Carrinho</label>
        <div id="vnd-itens" style="display:flex;flex-direction:column;gap:8px;min-height:40px;max-height:240px;overflow-y:auto;margin-top:6px"></div>
        <div id="vnd-itens-vazio" style="text-align:center;color:#bbb;padding:20px;font-size:14px">Nenhum item adicionado</div>
      </div>

      <!-- Desconto -->
      ${mostraDesconto ? `<div><label class="lbl" style="display:block;margin-bottom:8px">Desconto</label>${htmlDesconto}</div>` : ""}

      <!-- Painel de totais -->
      <div id="vnd-totais" style="background:#f9f9f9;border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;font-size:14px">
        <div style="display:flex;justify-content:space-between"><span>Subtotal</span><span id="vnd-tot-bruto">R$ 0,00</span></div>
        <div style="display:flex;justify-content:space-between" id="vnd-row-desc"><span>Desconto</span><span id="vnd-tot-desc">R$ 0,00</span></div>
        <div style="display:flex;justify-content:space-between;font-weight:700;font-size:16px;border-top:1px solid #e0e0e0;padding-top:8px;margin-top:4px"><span>Total</span><span id="vnd-tot-liq" style="color:var(--primary)">R$ 0,00</span></div>
      </div>

      <!-- Cliente (opcional) -->
      <div class="form-group" style="position:relative">
        <label class="lbl">Cliente (opcional)</label>
        <input class="input" type="search" id="vnd-busca-cli" placeholder="Buscar por nome ou telefone…" autocomplete="off">
        <div id="vnd-sugest-cli" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #e0e0e0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:200;max-height:180px;overflow-y:auto"></div>
        <input type="hidden" id="vnd-cliente-id" value="">
      </div>

      <!-- Forma de pagamento -->
      <div>
        <label class="lbl" style="display:block;margin-bottom:8px">Forma de Pagamento</label>
        <div class="pill-tabs" id="vnd-forma-tabs">
          <button class="pill-tab active" data-forma="dinheiro">Dinheiro</button>
          <button class="pill-tab" data-forma="pix">Pix</button>
          <button class="pill-tab" data-forma="debito">Débito</button>
          <button class="pill-tab" data-forma="credito">Crédito</button>
          <button class="pill-tab" data-forma="misto">Misto</button>
        </div>
      </div>

      <!-- Dinheiro: troco -->
      <div id="vnd-troco-area" class="form-group">
        <label class="lbl">Valor Recebido (R$)</label>
        <input class="input" type="number" id="vnd-valor-recebido" min="0" step="0.01" placeholder="0,00">
        <div id="vnd-troco-display" style="margin-top:6px;font-size:15px;font-weight:700;color:var(--primary);min-height:22px"></div>
      </div>

      <!-- Crédito: parcelas -->
      <div id="vnd-parcelas-area" class="form-group" style="display:none">
        <label class="lbl">Parcelas</label>
        <select class="input select" id="vnd-parcelas">
          ${Array.from({length: 12}, (_, i) => `<option value="${i+1}">${i+1}x</option>`).join("")}
        </select>
      </div>

      <!-- Misto: duas formas -->
      <div id="vnd-misto-area" style="display:none">
        <div class="form-row">
          <div class="form-group">
            <label class="lbl">1ª Forma</label>
            <select class="input select" id="vnd-misto-forma1">
              <option value="dinheiro">Dinheiro</option>
              <option value="pix">Pix</option>
              <option value="debito">Débito</option>
              <option value="credito">Crédito</option>
            </select>
          </div>
          <div class="form-group">
            <label class="lbl">Valor (R$)</label>
            <input class="input" type="number" id="vnd-misto-valor1" min="0" step="0.01" placeholder="0,00">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="lbl">2ª Forma</label>
            <select class="input select" id="vnd-misto-forma2">
              <option value="pix">Pix</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="debito">Débito</option>
              <option value="credito">Crédito</option>
            </select>
          </div>
          <div class="form-group">
            <label class="lbl">Restante (R$)</label>
            <input class="input" type="number" id="vnd-misto-valor2" readonly placeholder="0,00" style="background:#f5f5f5">
          </div>
        </div>
      </div>

      <!-- Botão finalizar -->
      <button id="btn-finalizar-venda" class="btn btn-primary" data-acao="escrita" style="width:100%;justify-content:center;padding:14px;font-size:16px;margin-top:4px">
        Finalizar Venda
      </button>

    </div>`;
}

// ─── EXIBIR SUGESTÕES DE PRODUTO ──────────────────────────────────
function _exibirSugestoes(lista) {
  const el = document.getElementById("vnd-sugest-prod");
  if (!el) return;
  if (!lista || lista.length === 0) {
    el.innerHTML = "";
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  el.innerHTML = lista.map(p => {
    const id         = p.id || p.produtoId || "";
    const nome       = p.nome || "";
    const preco      = Number(p.precoVenda || p.precoCusto || 0);
    const custo      = Number(p.precoCusto || 0);
    const estoque    = Number(p.estoqueAtual ?? 99);
    const controla   = p.controlarEstoque !== false;
    const prodJson   = JSON.stringify({
      id,
      nome,
      precoUnitario: preco,
      custo,
      controlarEstoque: controla,
      estoqueAtual: estoque,
    }).replace(/'/g, "&#39;");
    const codigoSpan = p.codigo
      ? ` <span style="color:#aaa;font-size:12px">(${p.codigo})</span>`
      : "";
    return `<div data-prod-id="${id}" data-prod-json='${prodJson}' style="padding:10px 14px;cursor:pointer;font-size:14px;border-bottom:1px solid #f5f5f5;display:flex;justify-content:space-between;align-items:center">
      <span>${nome}${codigoSpan}</span>
      <span style="color:var(--primary);font-weight:700">${formatarMoeda(preco)}</span>
    </div>`;
  }).join("");

  // Bind click em cada item — executado aqui para cobrir a carga inicial E o debounce
  el.querySelectorAll("[data-prod-json]").forEach(item => {
    item.addEventListener("click", () => {
      try {
        const prod = JSON.parse(item.dataset.prodJson);
        if (prod.controlarEstoque && prod.estoqueAtual <= 0) {
          notificar("aviso", "Sem estoque", `"${prod.nome}" está sem estoque.`);
          return;
        }
        const idx = _carrinhoItens.findIndex(i => i.id === prod.id);
        if (idx >= 0) {
          _carrinhoItens[idx].quantidade++;
          _carrinhoItens[idx].subtotal = _carrinhoItens[idx].quantidade * _carrinhoItens[idx].precoUnitario;
        } else {
          _carrinhoItens.push({ ...prod, quantidade: 1, subtotal: prod.precoUnitario });
        }
        _atualizarItensUI();
        el.style.display = "none";
        const inputProd = document.getElementById("vnd-busca-prod");
        if (inputProd) inputProd.value = "";
      } catch { /* silencioso */ }
    });
  });
}

// ─── BIND DO CARRINHO ─────────────────────────────────────────────
function _atualizarItensUI() {
  const cont   = document.getElementById("vnd-itens");
  const vazio  = document.getElementById("vnd-itens-vazio");
  if (!cont) return;

  if (_carrinhoItens.length === 0) {
    cont.innerHTML = "";
    if (vazio) vazio.style.display = "block";
  } else {
    if (vazio) vazio.style.display = "none";
    cont.innerHTML = _carrinhoItens.map((item, idx) => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #f0f0f0;border-radius:8px;background:#fff">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.nome}</div>
          <div style="font-size:12px;color:#888;margin-top:2px">${formatarMoeda(item.precoUnitario)} / un</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <input type="number" class="input" id="vnd-qtd-${idx}" value="${item.quantidade}" min="1"
            ${item.controlarEstoque && item.estoqueAtual !== undefined ? `max="${item.estoqueAtual}"` : ""}
            style="width:64px;text-align:center;padding:6px 8px">
          <span style="font-weight:700;font-size:14px;min-width:72px;text-align:right">${formatarMoeda(item.subtotal)}</span>
          <button class="btn btn-sm btn-danger" data-remover="${idx}" style="padding:5px 10px;font-size:14px">×</button>
        </div>
      </div>`).join("");

    // Bind de quantity changes
    _carrinhoItens.forEach((_, idx) => {
      const inp = document.getElementById(`vnd-qtd-${idx}`);
      if (inp) {
        inp.addEventListener("change", () => {
          let qtd = parseInt(inp.value, 10) || 1;
          if (qtd < 1) qtd = 1;
          const item = _carrinhoItens[idx];
          if (item.controlarEstoque && item.estoqueAtual !== undefined) {
            qtd = Math.min(qtd, item.estoqueAtual);
          }
          _carrinhoItens[idx].quantidade = qtd;
          _carrinhoItens[idx].subtotal   = qtd * item.precoUnitario;
          _atualizarItensUI();
          _atualizarTotaisUI();
        });
      }
    });

    cont.addEventListener("click", e => {
      const idx = e.target.dataset.remover;
      if (idx !== undefined) {
        _carrinhoItens.splice(parseInt(idx, 10), 1);
        _atualizarItensUI();
        _atualizarTotaisUI();
      }
    });
  }
  _atualizarTotaisUI();
}

function _obterDesconto() {
  const tipoEl  = document.getElementById("vnd-desc-tipo");
  const valorEl = document.getElementById("vnd-desc-valor");
  if (!tipoEl || !valorEl) return { tipo: null, valor: 0 };
  const tipo  = tipoEl.value || null;
  const valor = parseFloat(valorEl.value) || 0;
  return { tipo: tipo || null, valor };
}

function _atualizarTotaisUI() {
  const { tipo, valor } = _obterDesconto();
  const { totalBruto, desconto, totalLiquido } = _calcularTotais(_carrinhoItens, tipo, valor);

  const elBruto = document.getElementById("vnd-tot-bruto");
  const elDesc  = document.getElementById("vnd-tot-desc");
  const elLiq   = document.getElementById("vnd-tot-liq");
  const elRow   = document.getElementById("vnd-row-desc");
  if (elBruto) elBruto.textContent = formatarMoeda(totalBruto);
  if (elDesc)  elDesc.textContent  = "-" + formatarMoeda(desconto);
  if (elLiq)   elLiq.textContent   = formatarMoeda(totalLiquido);
  if (elRow)   elRow.style.display = desconto > 0 ? "flex" : "none";

  // Atualizar troco
  const recebidoEl = document.getElementById("vnd-valor-recebido");
  const trocoEl    = document.getElementById("vnd-troco-display");
  if (recebidoEl && trocoEl) {
    const recebido = parseFloat(recebidoEl.value) || 0;
    if (recebido > 0 && totalLiquido > 0) {
      const troco = recebido - totalLiquido;
      trocoEl.textContent = troco >= 0
        ? "Troco: " + formatarMoeda(troco)
        : "Valor insuficiente";
      trocoEl.style.color = troco >= 0 ? "var(--primary)" : "#C62828";
    } else {
      trocoEl.textContent = "";
    }
  }
}

function _bindCarrinho(permDesconto) {
  _carrinhoItens = [];

  // Busca de produto com debounce
  const inputProd   = document.getElementById("vnd-busca-prod");
  const sugestProd  = document.getElementById("vnd-sugest-prod");

  const _buscarDebounce = debounce(async (termo) => {
    const lista = await _buscarProdutos(termo);
    _exibirSugestoes(lista); // click handlers attached inside _exibirSugestoes
  }, 300);

  inputProd?.addEventListener("input", e => _buscarDebounce(e.target.value));
  inputProd?.addEventListener("blur", () => setTimeout(() => { if (sugestProd) sugestProd.style.display = "none"; }, 180));

  // Desconto
  const tipoEl  = document.getElementById("vnd-desc-tipo");
  const valorEl = document.getElementById("vnd-desc-valor");
  if (tipoEl && valorEl) {
    if (permDesconto === "livre") {
      tipoEl.addEventListener("change", () => {
        valorEl.disabled = !tipoEl.value;
        if (!tipoEl.value) { valorEl.value = ""; }
        _atualizarTotaisUI();
      });
    }
    valorEl.addEventListener("input", _atualizarTotaisUI);
  }

  // Busca de cliente com debounce
  const inputCli  = document.getElementById("vnd-busca-cli");
  const sugestCli = document.getElementById("vnd-sugest-cli");

  const _buscarCliDebounce = debounce(async (termo) => {
    const lista = await _buscarClientes(termo);
    _clientesSugest = lista;
    if (!sugestCli) return;
    if (lista.length === 0) { sugestCli.style.display = "none"; return; }
    sugestCli.style.display = "block";
    sugestCli.innerHTML = lista.map(c => `
      <div data-cli-id="${c.id}" style="padding:10px 14px;cursor:pointer;font-size:14px;border-bottom:1px solid #f5f5f5">
        <span style="font-weight:600">${c.nome || ""}</span>
        ${c.telefone ? `<span style="color:#aaa;font-size:12px;margin-left:8px">${c.telefone}</span>` : ""}
      </div>`).join("");

    sugestCli.querySelectorAll("[data-cli-id]").forEach(el => {
      el.addEventListener("click", () => {
        const cliId = el.dataset.cliId;
        const cli   = lista.find(c => c.id === cliId);
        if (cli && inputCli) {
          inputCli.value = cli.nome || "";
          const hidEl = document.getElementById("vnd-cliente-id");
          if (hidEl) hidEl.value = cliId;
          sugestCli.style.display = "none";
          inputCli.dataset.clienteNome = cli.nome || "";
          inputCli.dataset.clienteId   = cliId;
        }
      });
    });
  }, 300);

  inputCli?.addEventListener("input", e => {
    const hidEl = document.getElementById("vnd-cliente-id");
    if (hidEl) hidEl.value = "";
    _buscarCliDebounce(e.target.value);
  });
  inputCli?.addEventListener("blur", () => setTimeout(() => { if (sugestCli) sugestCli.style.display = "none"; }, 180));

  // Forma de pagamento
  const formaTabs = document.getElementById("vnd-forma-tabs");
  formaTabs?.addEventListener("click", e => {
    const btn = e.target.closest(".pill-tab");
    if (!btn) return;
    formaTabs.querySelectorAll(".pill-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const forma = btn.dataset.forma;
    const trocoArea    = document.getElementById("vnd-troco-area");
    const parcelasArea = document.getElementById("vnd-parcelas-area");
    const mistoArea    = document.getElementById("vnd-misto-area");
    if (trocoArea)    trocoArea.style.display    = forma === "dinheiro" ? "" : "none";
    if (parcelasArea) parcelasArea.style.display = forma === "credito"  ? "" : "none";
    if (mistoArea)    mistoArea.style.display    = forma === "misto"    ? "" : "none";
    _atualizarTotaisUI();
  });

  document.getElementById("vnd-valor-recebido")?.addEventListener("input", _atualizarTotaisUI);

  // Misto: calcular restante ao digitar o valor da 1ª forma
  document.getElementById("vnd-misto-valor1")?.addEventListener("input", () => {
    const { totalLiquido } = _calcularTotais(
      _carrinhoItens,
      document.getElementById("vnd-desc-tipo")?.value || null,
      parseFloat(document.getElementById("vnd-desc-valor")?.value) || 0
    );
    const v1   = parseFloat(document.getElementById("vnd-misto-valor1")?.value) || 0;
    const rest = Math.max(0, totalLiquido - v1);
    const el2  = document.getElementById("vnd-misto-valor2");
    if (el2) el2.value = rest.toFixed(2);
  });

  // Inicializar UI
  _atualizarItensUI();
}

// ─── CAIXA ABERTO ─────────────────────────────────────────────────
async function _buscarCaixaAberto() {
  try {
    const q = query(
      collection(db, `empresas/${_sessao.empresaId}/caixa`),
      where("fechadoEm", "==", null),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  } catch(err) {
    registrarErro("firestore", err.message, "vendas.js");
    return null;
  }
}

// ─── FINALIZAR VENDA ──────────────────────────────────────────────
async function _finalizarVenda() {
  const btn = document.getElementById("btn-finalizar-venda");

  if (_carrinhoItens.length === 0) {
    notificar("aviso", "Carrinho vazio", "Adicione ao menos um item.");
    return;
  }

  const { tipo: descontoTipo, valor: descontoValor } = _obterDesconto();
  const { totalBruto, desconto, totalLiquido } = _calcularTotais(_carrinhoItens, descontoTipo, descontoValor);

  const formaTabs = document.getElementById("vnd-forma-tabs");
  const formaAtiva = formaTabs?.querySelector(".pill-tab.active")?.dataset.forma || "dinheiro";

  const parcelas = formaAtiva === "credito"
    ? (parseInt(document.getElementById("vnd-parcelas")?.value, 10) || 1)
    : null;

  // Pagamento misto: forma1 + valor1, forma2 + restante
  let pagamentoMisto = null;
  if (formaAtiva === "misto") {
    const forma1  = document.getElementById("vnd-misto-forma1")?.value || "dinheiro";
    const forma2  = document.getElementById("vnd-misto-forma2")?.value || "pix";
    const valor1  = parseFloat(document.getElementById("vnd-misto-valor1")?.value) || 0;
    const { totalLiquido: tl } = _calcularTotais(_carrinhoItens, descontoTipo, descontoValor);
    const valor2  = Math.max(0, tl - valor1);
    pagamentoMisto = { [forma1]: valor1, [forma2]: valor2 };
  }

  const clienteId   = document.getElementById("vnd-cliente-id")?.value || null;
  const nomeCliente = document.getElementById("vnd-busca-cli")?.value?.trim() || "Consumidor Final";

  const vendaId = crypto.randomUUID();
  const codigo  = await _proximoCodigo();
  const dispId  = localStorage.getItem("mc_dispositivo_id") || gerarDispositivoId();

  const dadosVenda = {
    vendaId,
    codigo,
    empresaId: _sessao.empresaId,
    operadorId: _sessao.uid,
    operadorNome: _sessao.nome,
    clienteId: clienteId || null,
    nomeCliente,
    itens: _carrinhoItens.map(i => ({
      produtoId:     i.id || "",
      nome:          i.nome,
      quantidade:    i.quantidade,
      precoUnitario: i.precoUnitario,
      subtotal:      i.subtotal,
      custo:         i.custo || 0,
    })),
    totalBruto,
    descontoTipo: descontoTipo || null,
    descontoValor: desconto,
    totalLiquido,
    formaPagamento: formaAtiva,
    parcelas: parcelas || null,
    pagamentoMisto: pagamentoMisto,
    cancelada: false,
    sincronizado: false,
    criadoOffline: !navigator.onLine,
    dispositivoId: dispId,
    tentativasSincronizacao: 0,
    versaoApp: VERSAO_APP,
    createdAt: serverTimestamp(),
  };

  if (btn) btn.disabled = true;

  try {
    if (navigator.onLine) {
      // ── ONLINE ──────────────────────────────────────────────────
      const vendaRef = await addDoc(
        collection(db, `empresas/${_sessao.empresaId}/vendas`),
        dadosVenda
      );

      // Registrar movimentação no caixa aberto
      const caixa = await _buscarCaixaAberto();
      if (caixa) {
        await addDoc(
          collection(db, `empresas/${_sessao.empresaId}/caixa/${caixa.id}/movimentacoes`),
          {
            tipo: "venda",
            valor: totalLiquido,
            descricao: `Venda #${codigo}`,
            operadorId: _sessao.uid,
            sincronizado: true,
            createdAt: serverTimestamp(),
          }
        );
      }

      // Fechar carrinho e notificar sucesso (independente do estoque)
      document.querySelector(".mc-modal-overlay, .mc-bs-overlay")?.remove();
      notificar("sucesso", "Venda registrada", "Venda salva com sucesso!");
      _exibirCupom({ ...dadosVenda, id: vendaRef.id }, codigo);

      // Baixar estoque: isolado — falha aqui não desfaz a venda
      Promise.all(
        _carrinhoItens
          .filter(i => i.controlarEstoque === true && i.id)
          .map(async i => {
            const novoEst = Math.max(0, (i.estoqueAtual || 0) - i.quantidade);
            await updateDoc(doc(db, `empresas/${_sessao.empresaId}/produtos`, i.id), {
              estoqueAtual: novoEst,
            });
            await addDoc(collection(db, `empresas/${_sessao.empresaId}/estoque`), {
              produtoId:    i.id,
              nomeProduto:  i.nome,
              tipo:         "saida",
              quantidade:   i.quantidade,
              motivo:       `Venda #${codigo}`,
              operadorId:   _sessao.uid,
              criadoOffline: false,
              sincronizado:  true,
              createdAt:    serverTimestamp(),
            });
          })
      ).catch(async estoqueErr => {
        await registrarErro("firestore", estoqueErr?.message, "vendas.js - estoque");
      });

    } else {
      // ── OFFLINE ─────────────────────────────────────────────────
      const check = podeVenderOffline();
      if (!check.pode) {
        const mensagens = {
          kit_ausente:     "Dados offline ausentes. Conecte-se para sincronizar.",
          sem_permissao:   "Você não tem permissão para vender offline.",
          sync_expirada:   "Sincronização expirada. Conecte-se à internet.",
          limite_atingido: "Limite de vendas offline atingido hoje.",
        };
        notificar("bloqueio", "Venda bloqueada", mensagens[check.motivo] || "Venda offline bloqueada.");
        if (btn) btn.disabled = false;
        return;
      }

      // Fire-and-forget: não aguardar confirmação do servidor.
      // persistentLocalCache grava no IndexedDB e sincroniza ao reconectar.
      addDoc(
        collection(db, `empresas/${_sessao.empresaId}/vendas`),
        dadosVenda
      ).catch(async err => registrarErro("firestore", err?.message || "", "vendas.js - offline addDoc"));

      incrementarVendaOffline();

      document.querySelector(".mc-modal-overlay, .mc-bs-overlay")?.remove();
      notificar("aviso", "Venda offline", "Venda salva localmente. Será sincronizada quando online.");

      // Atualizar lista com dado local sem consultar o Firestore
      _vendas.unshift({ id: vendaId, ...dadosVenda, createdAt: { toMillis: () => Date.now() } });
      const listContainerOff = document.getElementById("vnd-lista");
      if (listContainerOff) _renderizarLista(_vendas, listContainerOff);
      if (btn) btn.disabled = false;
      return;
    }

    // Recarregar lista (apenas caminho online)
    await _carregarVendas(_filtroAtivo);
    const listContainer = document.getElementById("vnd-lista");
    if (listContainer) _renderizarLista(_vendas, listContainer);

  } catch (err) {
    await registrarErro("firestore", err.message, "vendas.js");
    notificar("erro", "Erro ao finalizar", "Não foi possível registrar a venda.");
    if (btn) btn.disabled = false;
  }
}

// ─── CANCELAMENTO ─────────────────────────────────────────────────
async function _abrirCancelamento(vendaId) {
  const venda = _vendas.find(v => v.id === vendaId);
  if (!venda) return;

  abrirFormulario({
    titulo: `Cancelar Venda #${venda.codigo}`,
    conteudo: `
      <div style="display:flex;flex-direction:column;gap:16px">
        <p style="color:#555;font-size:14px">Esta ação não pode ser desfeita. A venda ficará marcada como cancelada.</p>
        <div class="form-group">
          <label class="lbl">Motivo do Cancelamento *</label>
          <textarea class="input" id="vnd-cancel-motivo" rows="3" minlength="10" maxlength="300"
            placeholder="Descreva o motivo (mínimo 10 caracteres)…" style="resize:vertical"></textarea>
        </div>
        <button id="btn-confirmar-cancel" class="btn btn-danger" style="width:100%;justify-content:center" disabled>
          Confirmar Cancelamento
        </button>
      </div>`,
  });

  const motivoEl = document.getElementById("vnd-cancel-motivo");
  const btnConf  = document.getElementById("btn-confirmar-cancel");

  motivoEl?.addEventListener("input", () => {
    if (btnConf) btnConf.disabled = (motivoEl.value.trim().length < 10);
  });

  btnConf?.addEventListener("click", async () => {
    const motivo = motivoEl?.value.trim() || "";
    if (motivo.length < 10) return;
    btnConf.disabled = true;
    try {
      const vendaRef = doc(db, `empresas/${_sessao.empresaId}/vendas`, vendaId);

      // Estorno de estoque com transação
      if ((venda.itens || []).some(i => i.produtoId)) {
        await runTransaction(db, async tx => {
          for (const item of venda.itens || []) {
            if (!item.produtoId) continue;
            const prodRef  = doc(db, `empresas/${_sessao.empresaId}/produtos`, item.produtoId);
            const prodSnap = await tx.get(prodRef);
            if (prodSnap.exists() && prodSnap.data().controlarEstoque === true) {
              const estoqueAtual = Number(prodSnap.data().estoqueAtual || 0);
              tx.update(prodRef, { estoqueAtual: estoqueAtual + item.quantidade });
            }
          }
          tx.update(vendaRef, {
            cancelada: true,
            motivoCancelamento: motivo,
            canceladoPor: _sessao.uid,
            canceladoEm: serverTimestamp(),
          });
        });
      } else {
        await updateDoc(vendaRef, {
          cancelada: true,
          motivoCancelamento: motivo,
          canceladoPor: _sessao.uid,
          canceladoEm: serverTimestamp(),
        });
      }

      // Movimentação de cancelamento no caixa aberto
      try {
        const caixa = await _buscarCaixaAberto();
        if (caixa) {
          await addDoc(
            collection(db, `empresas/${_sessao.empresaId}/caixa/${caixa.id}/movimentacoes`),
            {
              tipo: "cancelamento",
              valor: -(venda.totalLiquido || 0),
              descricao: `Cancelamento Venda #${venda.codigo}`,
              operadorId: _sessao.uid,
              sincronizado: true,
              createdAt: serverTimestamp(),
            }
          );
        }
      } catch (caixaErr) {
        await registrarErro("firestore", caixaErr.message, "vendas.js");
      }

      document.querySelector(".mc-modal-overlay, .mc-bs-overlay")?.remove();
      notificar("sucesso", "Venda cancelada", `Venda #${venda.codigo} cancelada.`);

      await _carregarVendas(_filtroAtivo);
      const listContainer = document.getElementById("vnd-lista");
      if (listContainer) _renderizarLista(_vendas, listContainer);

    } catch (err) {
      await registrarErro("firestore", err.message, "vendas.js");
      notificar("erro", "Erro ao cancelar", "Não foi possível cancelar a venda.");
      if (btnConf) btnConf.disabled = false;
    }
  });
}

// ─── CUPOM HTML ───────────────────────────────────────────────────
function gerarHtmlCupom(ctx) {
  const logoHtml = ctx.logoBase64
    ? `<img src="${ctx.logoBase64}" style="max-height:60px;max-width:120px;object-fit:contain;display:block;margin-bottom:8px">`
    : "";

  const itensHtml = (ctx.itens || []).map(i => `
    <tr>
      <td style="padding:6px 8px;border:1px solid #ddd">${i.nome || ""}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:center">${i.quantidade}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:right">${formatarMoeda(i.precoUnitario)}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:right">${formatarMoeda(i.subtotal)}</td>
    </tr>`).join("");

  const pagamentoHtml = [
    ctx.fmtDinheiro  ? `<tr><td style="padding:5px 8px;border:1px solid #eee">Dinheiro</td><td style="padding:5px 8px;border:1px solid #eee;text-align:right">${ctx.fmtDinheiro}</td></tr>` : "",
    ctx.fmtPix       ? `<tr><td style="padding:5px 8px;border:1px solid #eee">Pix</td><td style="padding:5px 8px;border:1px solid #eee;text-align:right">${ctx.fmtPix}</td></tr>` : "",
    ctx.fmtDebito    ? `<tr><td style="padding:5px 8px;border:1px solid #eee">Cartão Débito</td><td style="padding:5px 8px;border:1px solid #eee;text-align:right">${ctx.fmtDebito}</td></tr>` : "",
    ctx.fmtCredito   ? `<tr><td style="padding:5px 8px;border:1px solid #eee">Cartão Crédito${ctx.fmtParcelas ? ` (${ctx.fmtParcelas})` : ""}</td><td style="padding:5px 8px;border:1px solid #eee;text-align:right">${ctx.fmtCredito}</td></tr>` : "",
    ctx.fmtOutros    ? `<tr><td style="padding:5px 8px;border:1px solid #eee">Outros</td><td style="padding:5px 8px;border:1px solid #eee;text-align:right">${ctx.fmtOutros}</td></tr>` : "",
  ].filter(Boolean).join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recibo de Venda</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; font-size: 13px; color: #222; background: #fff; }
  .cupom { max-width: 700px; margin: 20px auto; padding: 30px; border: 1px solid #ddd; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 2px solid #6B3520; }
  .header-logo { }
  .header-empresa { font-size: 18px; font-weight: 700; color: #6B3520; }
  .header-right { text-align: right; font-size: 12px; color: #555; }
  .titulo-recibo { text-align: center; font-size: 20px; font-weight: 700; letter-spacing: 3px; margin: 16px 0; color: #6B3520; text-transform: uppercase; }
  .info-row { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 16px; }
  .info-block { flex: 1; font-size: 12px; }
  .info-block strong { display: block; font-size: 11px; color: #888; text-transform: uppercase; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
  th { background: #6B3520; color: #fff; padding: 8px; text-align: left; }
  th:last-child, td:last-child { text-align: right; }
  .total-row td { font-weight: 700; font-size: 15px; background: #f9f9f9; padding: 10px 8px; border: 1px solid #ddd; }
  .assinaturas { display: flex; gap: 32px; margin-top: 40px; }
  .assinatura { flex: 1; border-top: 1px solid #555; padding-top: 8px; font-size: 11px; color: #555; text-align: center; }
  .rodape { text-align: center; font-size: 11px; color: #aaa; margin-top: 24px; padding-top: 12px; border-top: 1px solid #eee; }
  @media print { .cupom { border: none; margin: 0; padding: 16px; } }
</style>
</head>
<body>
<div class="cupom">
  <div class="header">
    <div class="header-logo">
      ${logoHtml}
      <div class="header-empresa">${ctx.nomeEmpresa || ""}</div>
    </div>
    <div class="header-right">
      <div>Data: ${ctx.dataEmissao || ""}</div>
      <div>Responsável: ${ctx.responsavel || ""}</div>
      ${ctx.codigo ? `<div>Nº ${ctx.codigo}</div>` : ""}
    </div>
  </div>

  <div class="titulo-recibo">Recibo de Venda</div>

  <div class="info-row">
    <div class="info-block">
      <strong>Cliente</strong>
      ${ctx.nomeCliente || "Consumidor Final"}
      ${ctx.cpfCnpj ? `<br>CPF/CNPJ: ${ctx.cpfCnpj}` : ""}
      ${ctx.enderecoCli ? `<br>${ctx.enderecoCli}` : ""}
      ${ctx.contato ? `<br>${ctx.contato}` : ""}
    </div>
    <div class="info-block" style="text-align:right">
      <strong>Empresa</strong>
      ${ctx.nomeEmpresa || ""}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Produto</th>
        <th style="text-align:center">Qtd</th>
        <th style="text-align:right">Unit.</th>
        <th style="text-align:right">Subtotal</th>
      </tr>
    </thead>
    <tbody>
      ${itensHtml}
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="3" style="border:1px solid #ddd">Total</td>
        <td style="border:1px solid #ddd">${ctx.fmtTotal || ""}</td>
      </tr>
    </tfoot>
  </table>

  <table>
    <thead><tr><th colspan="2">Pagamento</th></tr></thead>
    <tbody>
      ${pagamentoHtml}
    </tbody>
  </table>

  <div class="assinaturas">
    <div class="assinatura">Assinatura do Cliente</div>
    <div class="assinatura">Assinatura do Responsável</div>
  </div>

  <div class="rodape">MeuCaixa Digital · Obrigado pela preferência!</div>
</div>
</body>
</html>`;
}

// ─── EXIBIR CUPOM ─────────────────────────────────────────────────
// Usa iframe isolado em AMBAS as plataformas:
// — estilos do cupom ficam no documento do iframe, nunca vazam para o app
// — desktop: abre diálogo de impressão do navegador
// — mobile: iOS abre share sheet (opção "Salvar como PDF"); Android abre print/PDF
function _exibirCupom(venda, codigo) {
  const totalLiquido  = venda.totalLiquido || 0;
  const forma         = venda.formaPagamento || "dinheiro";
  const parcelas      = venda.parcelas || 1;

  const ctx = {
    logoBase64:  _sessao.logoBase64 || null,
    nomeEmpresa: _sessao.nomeEmpresa || _sessao.empresaId,
    responsavel: _sessao.nome || "",
    dataEmissao: formatarData(new Date()),
    codigo:      String(codigo || venda.codigo || ""),
    nomeCliente: venda.nomeCliente || "Consumidor Final",
    cpfCnpj:     venda.cpfCnpj || null,
    enderecoCli: venda.enderecoCli || null,
    contato:     venda.contato || null,
    itens:       venda.itens || [],
    fmtTotal:    formatarMoeda(totalLiquido),
    fmtDinheiro: forma === "dinheiro" ? formatarMoeda(totalLiquido)
               : (forma === "misto" && venda.pagamentoMisto?.dinheiro) ? formatarMoeda(venda.pagamentoMisto.dinheiro)
               : null,
    fmtPix:      forma === "pix"      ? formatarMoeda(totalLiquido)
               : (forma === "misto" && venda.pagamentoMisto?.pix)      ? formatarMoeda(venda.pagamentoMisto.pix)
               : null,
    fmtDebito:   forma === "debito"   ? formatarMoeda(totalLiquido)
               : (forma === "misto" && venda.pagamentoMisto?.debito)   ? formatarMoeda(venda.pagamentoMisto.debito)
               : null,
    fmtCredito:  forma === "credito"  ? formatarMoeda(totalLiquido)
               : (forma === "misto" && venda.pagamentoMisto?.credito)  ? formatarMoeda(venda.pagamentoMisto.credito)
               : null,
    fmtParcelas: (forma === "credito" && parcelas > 1)
      ? `${parcelas}x de ${formatarMoeda(totalLiquido / parcelas)}`
      : null,
    fmtOutros:   null,
  };

  const htmlCupom = gerarHtmlCupom(ctx);

  try {
    const iframe = document.createElement("iframe");
    // Oculto fora da tela — sem interferir no layout do app
    iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
    iframe.srcdoc = htmlCupom;
    document.body.appendChild(iframe);

    iframe.onload = () => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (printErr) {
        notificar("aviso", "Cupom indisponível", "Não foi possível abrir o cupom para impressão.");
        registrarErro("print", printErr?.message || "", "vendas.js");
      }
      // Remove iframe após 3s (tempo suficiente para o diálogo aparecer)
      setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* já removido */ } }, 3000);
    };

    iframe.onerror = () => {
      notificar("aviso", "Cupom indisponível", "Não foi possível carregar o cupom.");
      try { document.body.removeChild(iframe); } catch { /* já removido */ }
    };
  } catch (err) {
    registrarErro("print", err?.message || "", "vendas.js");
    notificar("aviso", "Cupom indisponível", "Não foi possível gerar o cupom.");
  }
}

// ─── NOVA VENDA (ABRIR CARRINHO) ──────────────────────────────────
async function _abrirNovaVenda() {
  const permDesconto = _obterPermissaoDesconto();
  abrirFormulario({ titulo: "Nova Venda", conteudo: _htmlCarrinho(permDesconto) });
  _bindCarrinho(permDesconto);
  _buscarProdutos("").then(lista => _exibirSugestoes(lista)).catch(() => {});

  document.getElementById("btn-finalizar-venda")?.addEventListener("click", _finalizarVenda);
}

// ─── ENTRADA DO MÓDULO ────────────────────────────────────────────
export async function renderizar(sessao, containerEl) {
  _sessao = sessao;

  containerEl.innerHTML = `<p style="color:#aaa;padding:24px">Carregando vendas…</p>`;

  try {
    await _carregarVendas("hoje");
  } catch (err) {
    await registrarErro("firestore", err.message, "vendas.js");
    notificar("erro", "Erro ao carregar", "Não foi possível carregar as vendas.");
    containerEl.innerHTML = `<p style="text-align:center;color:#aaa;padding:40px">Erro ao carregar vendas.</p>`;
    return;
  }

  containerEl.innerHTML = `
    <div class="section-header" style="margin-bottom:16px">
      <h2>Vendas</h2>
      <button id="vnd-nova" class="btn btn-primary" data-acao="escrita">+ Nova Venda</button>
    </div>

    <div class="pill-tabs" id="vnd-filtro-tabs" style="margin-bottom:16px">
      <button class="pill-tab active" data-filtro="hoje">Hoje</button>
      <button class="pill-tab" data-filtro="semana">Esta Semana</button>
      <button class="pill-tab" data-filtro="mes">Este Mês</button>
    </div>

    <div id="vnd-lista"></div>`;

  const listContainer = document.getElementById("vnd-lista");
  _renderizarLista(_vendas, listContainer);

  // Filtros de período
  document.getElementById("vnd-filtro-tabs")?.addEventListener("click", async e => {
    const btn = e.target.closest(".pill-tab");
    if (!btn) return;
    document.querySelectorAll("#vnd-filtro-tabs .pill-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    try {
      await _carregarVendas(btn.dataset.filtro);
      _renderizarLista(_vendas, listContainer);
    } catch (err) {
      await registrarErro("firestore", err.message, "vendas.js");
      notificar("erro", "Erro", "Não foi possível filtrar as vendas.");
    }
  });

  // Nova venda
  document.getElementById("vnd-nova")?.addEventListener("click", _abrirNovaVenda);

  // Ações na lista (delegação)
  listContainer.addEventListener("click", e => {
    const idCupom    = e.target.dataset.cupom;
    const idCancelar = e.target.dataset.cancelar;

    if (idCupom) {
      const venda = _vendas.find(v => v.id === idCupom);
      if (venda) _exibirCupom(venda, venda.codigo);
    }
    if (idCancelar) {
      _abrirCancelamento(idCancelar);
    }
  });
}
