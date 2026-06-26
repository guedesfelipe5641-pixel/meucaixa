// modulos/recibos.js — M19 · Recibos e Orçamentos
import { db } from "../firebase-config.js";
import { notificar } from "../notificacoes.js";
import { formatarMoeda, registrarErro, abrirFormulario } from "../utils.js";
import {
  collection, addDoc, getDocs, query, orderBy, limit,
  doc, getDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ─── Estado do módulo ───────────────────────────────────────────────────────
let _sessao = null;
let _empresa = null;   // dados Firestore da empresa (inclui termosGarantia)
let _logoBase64 = null;

// ─── Inicialização ──────────────────────────────────────────────────────────
export async function renderizar(sessao, container) {
  _sessao = sessao;
  container.innerHTML = `<div class="mc-carregando" style="padding:32px;text-align:center">Carregando…</div>`;

  try {
    await _carregarDadosEmpresa();
    _renderListagem(container);
  } catch (err) {
    registrarErro("recibos", err.message, "M19");
    container.innerHTML = `<p style="padding:24px;color:var(--erro)">Erro ao carregar recibos.</p>`;
  }
}

async function _carregarDadosEmpresa() {
  const snap = await getDoc(doc(db, "empresas", _sessao.uid));
  _empresa = snap.exists() ? snap.data() : {};

  // Logo como base64 (Storage)
  if (_empresa.logoUrl && navigator.onLine) {
    try {
      const resp = await fetch(_empresa.logoUrl);
      const blob = await resp.blob();
      _logoBase64 = await _blobParaBase64(blob);
    } catch { _logoBase64 = null; }
  } else {
    _logoBase64 = null;
  }
}

function _blobParaBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

// ─── Listagem ───────────────────────────────────────────────────────────────
async function _renderListagem(container) {
  const isMobile = window._layoutMobile;

  container.innerHTML = `
    <div class="mc-modulo-header" style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px 8px;flex-wrap:wrap;gap:8px">
      <h2 style="font-size:1.1rem;font-weight:700;margin:0">Recibos e Orçamentos</h2>
      <button id="btn-novo-recibo" class="mc-btn mc-btn-primary" data-acao="escrita" style="gap:6px">
        <span style="font-size:1.2rem">+</span> Novo
      </button>
    </div>

    <div class="mc-pills" style="display:flex;gap:8px;padding:0 20px 12px;overflow-x:auto">
      <button class="mc-pill ativo" data-filtro="todos">Todos</button>
      <button class="mc-pill" data-filtro="recibo_eletronicos">Recibo Eletr.</button>
      <button class="mc-pill" data-filtro="orcamento_conserto">Orç. Conserto</button>
      <button class="mc-pill" data-filtro="orcamento_encomenda">Orç. Encomenda</button>
    </div>

    <div id="recibos-lista" style="padding:0 20px 32px">
      <div class="mc-carregando" style="text-align:center;padding:32px;color:#888">Carregando…</div>
    </div>`;

  container.querySelector("#btn-novo-recibo").addEventListener("click", () => _abrirSeletorModelo(container));

  container.querySelectorAll(".mc-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".mc-pill").forEach(b => b.classList.remove("ativo"));
      btn.classList.add("ativo");
      _carregarLista(container, btn.dataset.filtro, isMobile);
    });
  });

  _carregarLista(container, "todos", isMobile);
}

async function _carregarLista(container, filtro, isMobile) {
  const listaEl = container.querySelector("#recibos-lista");
  listaEl.innerHTML = `<div style="text-align:center;padding:32px;color:#888">Carregando…</div>`;

  try {
    const colRef = collection(db, "empresas", _sessao.uid, "recibos");
    const q = query(colRef, orderBy("geradoEm", "desc"), limit(100));
    const snap = await getDocs(q);
    let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (filtro !== "todos") docs = docs.filter(d => d.modelo === filtro);

    if (docs.length === 0) {
      listaEl.innerHTML = `<p style="text-align:center;padding:48px;color:#888">Nenhum documento encontrado.</p>`;
      return;
    }

    listaEl.innerHTML = isMobile ? _htmlCards(docs) : _htmlTabela(docs);

    listaEl.querySelectorAll("[data-baixar]").forEach(btn => {
      btn.addEventListener("click", () => {
        const url = btn.dataset.baixar;
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.click();
      });
    });
  } catch (err) {
    registrarErro("recibos_lista", err.message, "M19");
    listaEl.innerHTML = `<p style="color:var(--erro);padding:24px">Erro ao carregar lista.</p>`;
  }
}

function _labelModelo(modelo) {
  return { recibo_eletronicos: "Recibo Eletr.", orcamento_conserto: "Orç. Conserto", orcamento_encomenda: "Orç. Encomenda" }[modelo] || modelo;
}

function _htmlTabela(docs) {
  const linhas = docs.map(d => {
    const data = d.geradoEm?.toDate ? d.geradoEm.toDate().toLocaleDateString("pt-BR") : "—";
    const baixar = d.downloadUrl
      ? `<button class="mc-btn mc-btn-outline" style="padding:4px 10px;font-size:.8rem" data-baixar="${d.downloadUrl}">↓ Baixar</button>`
      : `<span style="color:#aaa;font-size:.8rem">—</span>`;
    return `<tr>
      <td style="padding:10px 8px;font-weight:600">${d.nomeArquivo || "—"}</td>
      <td style="padding:10px 8px">${_labelModelo(d.modelo)}</td>
      <td style="padding:10px 8px">${d.nomeCliente || "—"}</td>
      <td style="padding:10px 8px;text-align:right">${d.valorTotal || "—"}</td>
      <td style="padding:10px 8px">${data}</td>
      <td style="padding:10px 8px">${baixar}</td>
    </tr>`;
  }).join("");

  return `<table style="width:100%;border-collapse:collapse;font-size:.9rem">
    <thead>
      <tr style="border-bottom:2px solid #e0e0e0">
        <th style="padding:8px;text-align:left;font-size:.8rem;text-transform:uppercase;color:#666">Arquivo</th>
        <th style="padding:8px;text-align:left;font-size:.8rem;text-transform:uppercase;color:#666">Modelo</th>
        <th style="padding:8px;text-align:left;font-size:.8rem;text-transform:uppercase;color:#666">Cliente</th>
        <th style="padding:8px;text-align:right;font-size:.8rem;text-transform:uppercase;color:#666">Total</th>
        <th style="padding:8px;text-align:left;font-size:.8rem;text-transform:uppercase;color:#666">Data</th>
        <th style="padding:8px"></th>
      </tr>
    </thead>
    <tbody>${linhas}</tbody>
  </table>`;
}

function _htmlCards(docs) {
  return docs.map(d => {
    const data = d.geradoEm?.toDate ? d.geradoEm.toDate().toLocaleDateString("pt-BR") : "—";
    const baixar = d.downloadUrl
      ? `<button class="mc-btn mc-btn-outline" style="font-size:.8rem;padding:6px 12px" data-baixar="${d.downloadUrl}">↓ Baixar novamente</button>`
      : "";
    return `<div style="background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:16px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:700;font-size:.95rem">${d.nomeCliente || "—"}</div>
          <div style="font-size:.8rem;color:#666;margin-top:2px">${_labelModelo(d.modelo)} · ${data}</div>
        </div>
        <div style="font-weight:700;font-size:1rem">${d.valorTotal || ""}</div>
      </div>
      ${baixar ? `<div style="margin-top:10px">${baixar}</div>` : ""}
    </div>`;
  }).join("");
}

// ─── Seletor de modelo ──────────────────────────────────────────────────────
function _abrirSeletorModelo(container) {
  const conteudo = `
    <p style="color:#555;margin-bottom:20px">Escolha o tipo de documento:</p>
    <div style="display:flex;flex-direction:column;gap:12px">
      <button class="mc-btn mc-btn-outline" style="text-align:left;padding:16px;border-radius:10px" data-modelo="recibo_eletronicos">
        <strong>🧾 Recibo de Venda (Eletrônicos)</strong>
        <div style="font-size:.85rem;color:#666;margin-top:4px">Comprovante com IMEI, forma de pagamento e termos de garantia</div>
      </button>
      <button class="mc-btn mc-btn-outline" style="text-align:left;padding:16px;border-radius:10px" data-modelo="orcamento_conserto">
        <strong>🔧 Orçamento de Conserto</strong>
        <div style="font-size:.85rem;color:#666;margin-top:4px">Reparo de eletrônicos com peças, mão de obra e diagnóstico</div>
      </button>
      <button class="mc-btn mc-btn-outline" style="text-align:left;padding:16px;border-radius:10px" data-modelo="orcamento_encomenda">
        <strong>📦 Orçamento de Encomenda</strong>
        <div style="font-size:.85rem;color:#666;margin-top:4px">Pedido de produtos com data de entrega/retirada</div>
      </button>
    </div>`;

  abrirFormulario({ titulo: "Novo Documento", conteudo });

  setTimeout(() => {
    document.querySelectorAll("[data-modelo]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelector(".mc-modal, .mc-bottom-sheet")?.remove();
        _abrirFormulario(btn.dataset.modelo, container);
      });
    });
  }, 50);
}

// ─── Formulários ────────────────────────────────────────────────────────────
function _abrirFormulario(modelo, container) {
  if (modelo === "recibo_eletronicos") _formReciboEletronicos(container);
  else if (modelo === "orcamento_conserto") _formOrcamentoConserto(container);
  else if (modelo === "orcamento_encomenda") _formOrcamentoEncomenda(container);
}

// ─── Formulário: Recibo Eletrônicos ─────────────────────────────────────────
function _formReciboEletronicos(container) {
  const hoje = new Date().toLocaleDateString("pt-BR");
  const termosConfig = _empresa.termosGarantia
    ? `<details style="margin-top:6px"><summary style="cursor:pointer;font-size:.85rem;color:#666">Ver/editar termos de garantia</summary><textarea id="rec-termos" style="width:100%;min-height:80px;margin-top:6px;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:.85rem;resize:vertical">${_empresa.termosGarantia}</textarea></details>`
    : `<div style="display:flex;align-items:center;gap:8px;margin-top:6px"><span style="color:#f59e0b;font-size:.85rem">⚠ Termos de garantia não configurados</span><button id="btn-config-termos" class="mc-btn mc-btn-outline" style="font-size:.8rem;padding:4px 10px">Configurar</button></div>`;

  const html = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="mc-campo-grupo">
        <label class="mc-label">Cliente *</label>
        <input id="rec-cliente" class="mc-input" placeholder="Nome completo" required>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="mc-campo-grupo">
          <label class="mc-label">CPF/CNPJ *</label>
          <input id="rec-cpf" class="mc-input" placeholder="000.000.000-00">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Data de nascimento</label>
          <input id="rec-nasc" class="mc-input" placeholder="dd/mm/aaaa">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="mc-campo-grupo">
          <label class="mc-label">Endereço do cliente</label>
          <input id="rec-end" class="mc-input" placeholder="Opcional">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Contato</label>
          <input id="rec-contato" class="mc-input" placeholder="Telefone/WhatsApp">
        </div>
      </div>
      <div class="mc-campo-grupo">
        <label class="mc-label">Data da venda *</label>
        <input id="rec-data" class="mc-input" value="${hoje}">
      </div>
      <hr style="border:none;border-top:1px solid #eee">
      <div class="mc-campo-grupo">
        <label class="mc-label">Produto *</label>
        <input id="rec-produto" class="mc-input" placeholder="Descrição do produto">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div class="mc-campo-grupo">
          <label class="mc-label">IMEI/MEID</label>
          <input id="rec-imei" class="mc-input" placeholder="Opcional">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Qtd *</label>
          <input id="rec-qtd" class="mc-input" type="number" min="1" value="1">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Garantia *</label>
          <input id="rec-garantia" class="mc-input" placeholder="Ex: 6 meses">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="mc-campo-grupo">
          <label class="mc-label">Valor unitário (R$) *</label>
          <input id="rec-valor-unit" class="mc-input" type="number" min="0" step="0.01" placeholder="0,00">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Total do produto</label>
          <input id="rec-total-produto" class="mc-input" readonly placeholder="Calculado">
        </div>
      </div>
      <hr style="border:none;border-top:1px solid #eee">
      <div style="font-weight:600;font-size:.95rem">Forma de Pagamento</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="mc-campo-grupo">
          <label class="mc-label">Espécie (R$)</label>
          <input id="rec-especie" class="mc-input" type="number" min="0" step="0.01" placeholder="0,00">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">PIX (R$)</label>
          <input id="rec-pix" class="mc-input" type="number" min="0" step="0.01" placeholder="0,00">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Débito (R$)</label>
          <input id="rec-debito" class="mc-input" type="number" min="0" step="0.01" placeholder="0,00">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Crédito (R$)</label>
          <input id="rec-credito" class="mc-input" type="number" min="0" step="0.01" placeholder="0,00">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Parcelas</label>
          <input id="rec-parcelas" class="mc-input" type="number" min="1" placeholder="Ex: 3">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Outro/Troca de celular (R$)</label>
          <input id="rec-outro" class="mc-input" type="number" min="0" step="0.01" placeholder="0,00">
        </div>
      </div>
      <div class="mc-campo-grupo">
        <label class="mc-label">Total geral</label>
        <input id="rec-total" class="mc-input" readonly placeholder="Calculado automaticamente">
      </div>
      ${termosConfig}
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">
        <button id="btn-rec-cancelar" class="mc-btn mc-btn-outline">Cancelar</button>
        <button id="btn-rec-gerar" class="mc-btn mc-btn-primary" data-acao="escrita">Gerar PDF</button>
      </div>
    </div>`;

  abrirFormulario({ titulo: "Recibo de Venda — Eletrônicos", conteudo: html });

  setTimeout(() => {
    // Cálculo automático
    const calcTotais = () => {
      const qtd = parseFloat(document.getElementById("rec-qtd")?.value) || 0;
      const vu = parseFloat(document.getElementById("rec-valor-unit")?.value) || 0;
      const totalProduto = qtd * vu;
      const elTp = document.getElementById("rec-total-produto");
      if (elTp) elTp.value = formatarMoeda(totalProduto);

      const pagamentos = ["rec-especie", "rec-pix", "rec-debito", "rec-credito", "rec-outro"]
        .map(id => parseFloat(document.getElementById(id)?.value) || 0)
        .reduce((a, b) => a + b, 0);
      const elTot = document.getElementById("rec-total");
      if (elTot) elTot.value = formatarMoeda(pagamentos || totalProduto);
    };

    ["rec-qtd","rec-valor-unit","rec-especie","rec-pix","rec-debito","rec-credito","rec-outro"].forEach(id => {
      document.getElementById(id)?.addEventListener("input", calcTotais);
    });

    document.getElementById("btn-config-termos")?.addEventListener("click", () => _configurarTermos());
    document.getElementById("btn-rec-cancelar")?.addEventListener("click", () => {
      document.querySelector(".mc-modal, .mc-bottom-sheet")?.remove();
    });
    document.getElementById("btn-rec-gerar")?.addEventListener("click", () => _gerarReciboEletronicos(container));
  }, 50);
}

async function _gerarReciboEletronicos(container) {
  const g = id => document.getElementById(id)?.value?.trim() || "";
  const gn = id => parseFloat(document.getElementById(id)?.value) || 0;

  const nomeCliente = g("rec-cliente");
  const cpfCnpj = g("rec-cpf");
  const produto = g("rec-produto");
  const garantia = g("rec-garantia");
  const valorUnitario = gn("rec-valor-unit");
  const qtd = parseInt(g("rec-qtd")) || 1;

  if (!nomeCliente || !cpfCnpj || !produto || !garantia || !valorUnitario) {
    notificar("aviso", "Campos obrigatórios", "Preencha os campos marcados com *.");
    return;
  }

  const totalProduto = valorUnitario * qtd;
  const pgtos = {
    especie: gn("rec-especie"), pix: gn("rec-pix"),
    debito: gn("rec-debito"), credito: gn("rec-credito"), outro: gn("rec-outro")
  };
  const totalPago = Object.values(pgtos).reduce((a, b) => a + b, 0);
  const total = totalPago || totalProduto;

  const termosRaw = document.getElementById("rec-termos")?.value || _empresa.termosGarantia || "";
  const termosHTML = termosRaw.replace(/\n/g, "<br>");

  const dados = {
    empresa: _dadosEmpresa(),
    doc: {
      nomeCliente, cpfCnpj,
      nascimento: g("rec-nasc"), enderecoCli: g("rec-end"), contato: g("rec-contato"),
      dataVenda: g("rec-data"),
      descricaoProduto: produto, imei: g("rec-imei"),
      quantidade: qtd, garantia,
      valorUnitario: formatarMoeda(valorUnitario),
      totalProduto: formatarMoeda(totalProduto),
      total: formatarMoeda(total),
      especie: pgtos.especie ? formatarMoeda(pgtos.especie) : null,
      pix: pgtos.pix ? formatarMoeda(pgtos.pix) : null,
      debito: pgtos.debito ? formatarMoeda(pgtos.debito) : null,
      credito: pgtos.credito ? formatarMoeda(pgtos.credito) : null,
      parcelas: g("rec-parcelas") || null,
      outroCelular: pgtos.outro ? formatarMoeda(pgtos.outro) : null,
      termosGarantia: termosHTML || null
    }
  };

  document.querySelector(".mc-modal, .mc-bottom-sheet")?.remove();
  await _gerarEBaixarPDF("recibo_eletronicos", dados, nomeCliente, formatarMoeda(total), container);
}

// ─── Formulário: Orçamento Conserto ─────────────────────────────────────────
function _formOrcamentoConserto(container) {
  const hoje = new Date().toLocaleDateString("pt-BR");

  const html = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="mc-campo-grupo">
        <label class="mc-label">Cliente *</label>
        <input id="orc-cliente" class="mc-input" placeholder="Nome completo" required>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="mc-campo-grupo">
          <label class="mc-label">Contato</label>
          <input id="orc-tel" class="mc-input" placeholder="Telefone">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Endereço</label>
          <input id="orc-end" class="mc-input" placeholder="Opcional">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="mc-campo-grupo">
          <label class="mc-label">Data do orçamento *</label>
          <input id="orc-data" class="mc-input" value="${hoje}">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Validade (dias) *</label>
          <input id="orc-dias" class="mc-input" type="number" min="1" placeholder="Ex: 15">
        </div>
      </div>
      <hr style="border:none;border-top:1px solid #eee">
      <div class="mc-campo-grupo">
        <label class="mc-label">Equipamento *</label>
        <input id="orc-equipamento" class="mc-input" placeholder="Ex: iPhone 13 Pro">
      </div>
      <div class="mc-campo-grupo">
        <label class="mc-label">Defeito relatado *</label>
        <input id="orc-defeito" class="mc-input" placeholder="Descrição do defeito">
      </div>
      <div class="mc-campo-grupo">
        <label class="mc-label">Diagnóstico técnico *</label>
        <textarea id="orc-diagnostico" class="mc-input" style="min-height:64px;resize:vertical" placeholder="Diagnóstico do técnico"></textarea>
      </div>
      <hr style="border:none;border-top:1px solid #eee">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="font-weight:600;font-size:.95rem">Itens</div>
        <button id="orc-add-item" class="mc-btn mc-btn-outline" style="font-size:.85rem;padding:6px 12px">+ Adicionar item</button>
      </div>
      <div id="orc-itens-wrapper">
        ${_htmlLinhaItem(0)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div class="mc-campo-grupo">
          <label class="mc-label">Subtotal</label>
          <input id="orc-subtotal" class="mc-input" readonly placeholder="Calculado">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Desconto (R$)</label>
          <input id="orc-desconto" class="mc-input" type="number" min="0" step="0.01" placeholder="0,00">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Total</label>
          <input id="orc-total" class="mc-input" readonly placeholder="Calculado">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="mc-campo-grupo">
          <label class="mc-label">% Sinal/Entrada</label>
          <input id="orc-perc-sinal" class="mc-input" type="number" min="0" max="100" step="1" placeholder="Ex: 50">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Valor do sinal</label>
          <input id="orc-val-sinal" class="mc-input" readonly placeholder="Calculado">
        </div>
      </div>
      <div class="mc-campo-grupo">
        <label class="mc-label">Formas de pagamento aceitas *</label>
        <input id="orc-formas" class="mc-input" placeholder="Ex: PIX, Cartão, Dinheiro">
      </div>
      <div class="mc-campo-grupo">
        <label class="mc-label">Observações</label>
        <textarea id="orc-obs" class="mc-input" style="min-height:64px;resize:vertical" placeholder="Opcional"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">
        <button id="btn-orc-cancelar" class="mc-btn mc-btn-outline">Cancelar</button>
        <button id="btn-orc-gerar" class="mc-btn mc-btn-primary" data-acao="escrita">Gerar PDF</button>
      </div>
    </div>`;

  abrirFormulario({ titulo: "Orçamento de Conserto", conteudo: html });

  setTimeout(() => {
    _iniciarListenersItens("orc", container);
    document.getElementById("btn-orc-cancelar")?.addEventListener("click", () => {
      document.querySelector(".mc-modal, .mc-bottom-sheet")?.remove();
    });
    document.getElementById("btn-orc-gerar")?.addEventListener("click", () => _gerarOrcamentoConserto(container));
  }, 50);
}

async function _gerarOrcamentoConserto(container) {
  const g = id => document.getElementById(id)?.value?.trim() || "";
  const gn = id => parseFloat(document.getElementById(id)?.value) || 0;

  const nomeCliente = g("orc-cliente");
  const equipamento = g("orc-equipamento");
  const defeito = g("orc-defeito");
  const diagnostico = g("orc-diagnostico");
  const formasPagamento = g("orc-formas");
  const dias = parseInt(g("orc-dias"));

  if (!nomeCliente || !equipamento || !defeito || !diagnostico || !formasPagamento || !dias) {
    notificar("aviso", "Campos obrigatórios", "Preencha os campos marcados com *.");
    return;
  }

  const itens = _coletarItens("orc");
  if (!itens.length) {
    notificar("aviso", "Itens", "Adicione ao menos um item.");
    return;
  }

  const subtotalNum = itens.reduce((a, it) => a + it.subtotalNum, 0);
  const descontoNum = gn("orc-desconto");
  const totalNum = subtotalNum - descontoNum;
  const percSinal = g("orc-perc-sinal");
  const valSinal = percSinal ? totalNum * (parseFloat(percSinal) / 100) : 0;

  const dataValidade = _somarDias(g("orc-data"), dias);
  const numero = await _proximoNumero("ORC");

  const dados = {
    empresa: _dadosEmpresa(),
    doc: {
      numeroOrcamento: numero,
      dataOrcamento: g("orc-data"),
      dataValidade,
      validadeDias: `${dias} ${dias === 1 ? "dia" : "dias"}`,
      nomeCliente, telefoneCliente: g("orc-tel"), enderecoCliente: g("orc-end"),
      equipamento, defeitoRelatado: defeito, diagnostico,
      itens: itens.map(it => ({ descricao: it.descricao, qtd: it.qtd, valorUnit: it.valorUnit, subtotal: it.subtotal })),
      subtotal: formatarMoeda(subtotalNum),
      desconto: descontoNum ? formatarMoeda(descontoNum) : null,
      total: formatarMoeda(totalNum),
      percentualSinal: percSinal ? `${percSinal}%` : null,
      valorSinal: valSinal ? formatarMoeda(valSinal) : null,
      formasPagamento,
      observacoes: g("orc-obs") || null
    }
  };

  document.querySelector(".mc-modal, .mc-bottom-sheet")?.remove();
  await _gerarEBaixarPDF("orcamento_conserto", dados, nomeCliente, formatarMoeda(totalNum), container);
}

// ─── Formulário: Orçamento Encomenda ────────────────────────────────────────
function _formOrcamentoEncomenda(container) {
  const hoje = new Date().toLocaleDateString("pt-BR");

  const html = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="mc-campo-grupo">
        <label class="mc-label">Cliente *</label>
        <input id="enc-cliente" class="mc-input" placeholder="Nome completo">
      </div>
      <div class="mc-campo-grupo">
        <label class="mc-label">Contato</label>
        <input id="enc-tel" class="mc-input" placeholder="Telefone">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="mc-campo-grupo">
          <label class="mc-label">Data do orçamento *</label>
          <input id="enc-data" class="mc-input" value="${hoje}">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Validade (dias) *</label>
          <input id="enc-dias" class="mc-input" type="number" min="1" placeholder="Ex: 7">
        </div>
      </div>
      <hr style="border:none;border-top:1px solid #eee">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="mc-campo-grupo">
          <label class="mc-label">Data de entrega/retirada *</label>
          <input id="enc-data-entrega" class="mc-input" placeholder="dd/mm/aaaa">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Forma *</label>
          <select id="enc-forma" class="mc-input">
            <option value="Retirada">Retirada na loja</option>
            <option value="Entrega">Entrega</option>
          </select>
        </div>
      </div>
      <div id="enc-end-wrapper" style="display:none" class="mc-campo-grupo">
        <label class="mc-label">Endereço de entrega</label>
        <input id="enc-end" class="mc-input" placeholder="Rua, número, bairro">
      </div>
      <hr style="border:none;border-top:1px solid #eee">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="font-weight:600;font-size:.95rem">Itens</div>
        <button id="enc-add-item" class="mc-btn mc-btn-outline" style="font-size:.85rem;padding:6px 12px">+ Adicionar item</button>
      </div>
      <div id="enc-itens-wrapper">
        ${_htmlLinhaItem(0)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div class="mc-campo-grupo">
          <label class="mc-label">Subtotal</label>
          <input id="enc-subtotal" class="mc-input" readonly placeholder="Calculado">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Desconto (R$)</label>
          <input id="enc-desconto" class="mc-input" type="number" min="0" step="0.01" placeholder="0,00">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Total</label>
          <input id="enc-total" class="mc-input" readonly placeholder="Calculado">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="mc-campo-grupo">
          <label class="mc-label">% Sinal/Entrada</label>
          <input id="enc-perc-sinal" class="mc-input" type="number" min="0" max="100" step="1" placeholder="Ex: 50">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">Valor do sinal</label>
          <input id="enc-val-sinal" class="mc-input" readonly placeholder="Calculado">
        </div>
      </div>
      <div class="mc-campo-grupo">
        <label class="mc-label">Formas de pagamento aceitas *</label>
        <input id="enc-formas" class="mc-input" placeholder="Ex: PIX, Cartão, Dinheiro">
      </div>
      <div class="mc-campo-grupo">
        <label class="mc-label">Observações</label>
        <textarea id="enc-obs" class="mc-input" style="min-height:64px;resize:vertical" placeholder="Opcional"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">
        <button id="btn-enc-cancelar" class="mc-btn mc-btn-outline">Cancelar</button>
        <button id="btn-enc-gerar" class="mc-btn mc-btn-primary" data-acao="escrita">Gerar PDF</button>
      </div>
    </div>`;

  abrirFormulario({ titulo: "Orçamento de Encomenda", conteudo: html });

  setTimeout(() => {
    document.getElementById("enc-forma")?.addEventListener("change", e => {
      const wrapper = document.getElementById("enc-end-wrapper");
      if (wrapper) wrapper.style.display = e.target.value === "Entrega" ? "block" : "none";
    });

    _iniciarListenersItens("enc", container);

    document.getElementById("btn-enc-cancelar")?.addEventListener("click", () => {
      document.querySelector(".mc-modal, .mc-bottom-sheet")?.remove();
    });
    document.getElementById("btn-enc-gerar")?.addEventListener("click", () => _gerarOrcamentoEncomenda(container));
  }, 50);
}

async function _gerarOrcamentoEncomenda(container) {
  const g = id => document.getElementById(id)?.value?.trim() || "";
  const gn = id => parseFloat(document.getElementById(id)?.value) || 0;

  const nomeCliente = g("enc-cliente");
  const formasPagamento = g("enc-formas");
  const dataEntrega = g("enc-data-entrega");
  const formaEntrega = g("enc-forma") || "Retirada";
  const dias = parseInt(g("enc-dias"));

  if (!nomeCliente || !formasPagamento || !dataEntrega || !dias) {
    notificar("aviso", "Campos obrigatórios", "Preencha os campos marcados com *.");
    return;
  }

  const itens = _coletarItens("enc");
  if (!itens.length) {
    notificar("aviso", "Itens", "Adicione ao menos um item.");
    return;
  }

  const subtotalNum = itens.reduce((a, it) => a + it.subtotalNum, 0);
  const descontoNum = gn("enc-desconto");
  const totalNum = subtotalNum - descontoNum;
  const percSinal = g("enc-perc-sinal");
  const valSinal = percSinal ? totalNum * (parseFloat(percSinal) / 100) : 0;

  const dataValidade = _somarDias(g("enc-data"), dias);
  const numero = await _proximoNumero("ORC");

  const dados = {
    empresa: _dadosEmpresa(),
    doc: {
      numeroOrcamento: numero,
      dataOrcamento: g("enc-data"),
      dataValidade,
      validadeDias: `${dias} ${dias === 1 ? "dia" : "dias"}`,
      nomeCliente, telefoneCliente: g("enc-tel"),
      dataEntrega, formaEntrega,
      enderecoEntrega: formaEntrega === "Entrega" ? g("enc-end") : null,
      itens: itens.map(it => ({ descricao: it.descricao, qtd: it.qtd, valorUnit: it.valorUnit, subtotal: it.subtotal })),
      subtotal: formatarMoeda(subtotalNum),
      desconto: descontoNum ? formatarMoeda(descontoNum) : null,
      total: formatarMoeda(totalNum),
      percentualSinal: percSinal ? `${percSinal}%` : null,
      valorSinal: valSinal ? formatarMoeda(valSinal) : null,
      formasPagamento,
      observacoes: g("enc-obs") || null
    }
  };

  document.querySelector(".mc-modal, .mc-bottom-sheet")?.remove();
  await _gerarEBaixarPDF("orcamento_encomenda", dados, nomeCliente, formatarMoeda(totalNum), container);
}

// ─── Itens dinâmicos ─────────────────────────────────────────────────────────
let _itemIdx = 0;

function _htmlLinhaItem(idx) {
  return `<div id="item-linha-${idx}" style="display:grid;grid-template-columns:3fr 1fr 1fr 1fr auto;gap:8px;margin-bottom:6px;align-items:center">
    <input class="mc-input item-desc" data-idx="${idx}" placeholder="Descrição">
    <input class="mc-input item-qtd" data-idx="${idx}" type="number" min="1" value="1" placeholder="Qtd">
    <input class="mc-input item-unit" data-idx="${idx}" type="number" min="0" step="0.01" placeholder="R$ unit.">
    <input class="mc-input item-sub" data-idx="${idx}" readonly placeholder="Subtotal">
    <button class="mc-btn" style="padding:6px 10px;background:#fee2e2;color:#b91c1c;border:none;border-radius:6px;cursor:pointer" data-rm="${idx}">✕</button>
  </div>`;
}

function _iniciarListenersItens(prefixo, container) {
  _itemIdx = 0;
  const wrapper = document.getElementById(`${prefixo}-itens-wrapper`);

  const recalcTotais = () => {
    let subtotal = 0;
    wrapper?.querySelectorAll(".item-sub").forEach(el => {
      subtotal += parseFloat(el.value) || 0;
    });
    const subEl = document.getElementById(`${prefixo}-subtotal`);
    if (subEl) subEl.value = formatarMoeda(subtotal);

    const descEl = document.getElementById(`${prefixo}-desconto`);
    const desconto = parseFloat(descEl?.value) || 0;
    const totalEl = document.getElementById(`${prefixo}-total`);
    if (totalEl) totalEl.value = formatarMoeda(subtotal - desconto);

    const percEl = document.getElementById(`${prefixo}-perc-sinal`);
    const perc = parseFloat(percEl?.value) || 0;
    const sinalEl = document.getElementById(`${prefixo}-val-sinal`);
    if (sinalEl && perc) sinalEl.value = formatarMoeda((subtotal - desconto) * perc / 100);
  };

  const addListenersLinha = (idx) => {
    const qtdEl = document.querySelector(`.item-qtd[data-idx="${idx}"]`);
    const unitEl = document.querySelector(`.item-unit[data-idx="${idx}"]`);
    const subEl = document.querySelector(`.item-sub[data-idx="${idx}"]`);

    const calcSub = () => {
      const q = parseFloat(qtdEl?.value) || 0;
      const u = parseFloat(unitEl?.value) || 0;
      if (subEl) subEl.value = formatarMoeda(q * u);
      recalcTotais();
    };

    qtdEl?.addEventListener("input", calcSub);
    unitEl?.addEventListener("input", calcSub);

    // Autocomplete de produtos
    const descEl = document.querySelector(`.item-desc[data-idx="${idx}"]`);
    if (descEl) {
      descEl.addEventListener("input", () => _autocompleteItem(descEl, unitEl));
    }

    document.querySelector(`[data-rm="${idx}"]`)?.addEventListener("click", () => {
      document.getElementById(`item-linha-${idx}`)?.remove();
      recalcTotais();
    });
  };

  document.getElementById(`${prefixo}-add-item`)?.addEventListener("click", () => {
    _itemIdx++;
    const div = document.createElement("div");
    div.innerHTML = _htmlLinhaItem(_itemIdx);
    wrapper?.appendChild(div.firstElementChild);
    addListenersLinha(_itemIdx);
  });

  document.getElementById(`${prefixo}-desconto`)?.addEventListener("input", recalcTotais);
  document.getElementById(`${prefixo}-perc-sinal`)?.addEventListener("input", recalcTotais);

  addListenersLinha(0);
}

async function _autocompleteItem(descEl, unitEl) {
  const termo = descEl.value.trim().toLowerCase();
  if (termo.length < 2) return;

  try {
    const snap = await getDocs(collection(db, "empresas", _sessao.uid, "produtos"));
    const prods = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const match = prods.find(p => (p.nome || "").toLowerCase().includes(termo));
    if (match && unitEl) {
      unitEl.value = match.preco || match.precoVenda || "";
      unitEl.dispatchEvent(new Event("input"));
    }
  } catch { /* offline — sem autocomplete */ }
}

function _coletarItens(prefixo) {
  const wrapper = document.getElementById(`${prefixo}-itens-wrapper`);
  const itens = [];
  wrapper?.querySelectorAll("[id^='item-linha-']").forEach(linha => {
    const idx = linha.id.split("-").pop();
    const descricao = linha.querySelector(`.item-desc`)?.value?.trim();
    const qtd = parseFloat(linha.querySelector(`.item-qtd`)?.value) || 1;
    const valorUnitNum = parseFloat(linha.querySelector(`.item-unit`)?.value) || 0;
    if (descricao && valorUnitNum) {
      const subtotalNum = qtd * valorUnitNum;
      itens.push({
        descricao, qtd, subtotalNum,
        valorUnit: formatarMoeda(valorUnitNum),
        subtotal: formatarMoeda(subtotalNum)
      });
    }
  });
  return itens;
}

// ─── Geração de PDF ──────────────────────────────────────────────────────────
async function _gerarEBaixarPDF(modelo, dados, nomeCliente, valorTotal, container) {
  notificar("informacao", "Gerando PDF…", "Aguarde um momento.");

  try {
    await _lazyLoadPDF();

    const modPath = {
      recibo_eletronicos: "../templates/recibo_eletronicos.js",
      orcamento_conserto: "../templates/orcamento_conserto.js",
      orcamento_encomenda: "../templates/orcamento_encomenda.js"
    }[modelo];

    const { gerarHTML } = await import(modPath);
    const html = gerarHTML(dados);

    const div = document.createElement("div");
    div.style.cssText = "position:fixed;left:-9999px;top:0;width:794px;background:#fff";
    div.innerHTML = html;
    document.body.appendChild(div);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

    await new Promise((resolve, reject) => {
      doc.html(div, {
        callback: d => { d.save(_nomeArquivo(modelo, nomeCliente)); resolve(); },
        x: 0, y: 0, width: 210, windowWidth: 794,
        margin: [0, 0, 0, 0]
      });
    });

    document.body.removeChild(div);

    // Upload + Firestore (online apenas)
    const pdfBlob = doc.output("blob");
    let downloadUrl = null;

    if (navigator.onLine) {
      try {
        const storage = getStorage();
        const timestamp = Date.now();
        const storagePath = `empresas/${_sessao.uid}/recibos/${timestamp}_${modelo}.pdf`;
        const fileRef = ref(storage, storagePath);
        await uploadBytes(fileRef, pdfBlob, { contentType: "application/pdf" });
        downloadUrl = await getDownloadURL(fileRef);

        await addDoc(collection(db, "empresas", _sessao.uid, "recibos"), {
          modelo,
          nomeArquivo: _nomeArquivo(modelo, nomeCliente),
          downloadUrl,
          nomeCliente,
          valorTotal,
          geradoPor: _sessao.uid,
          geradoEm: serverTimestamp()
        });
      } catch (err) {
        registrarErro("recibos_upload", err.message, "M19");
        notificar("aviso", "Upload pendente", "PDF salvo localmente. O registro será feito quando conectar.");
      }
    } else {
      notificar("aviso", "Offline", "PDF gerado sem logo. O upload será feito quando conectar à internet.");
    }

    notificar("sucesso", "PDF gerado!", "Download iniciado automaticamente.");
    _renderListagem(container);
  } catch (err) {
    registrarErro("recibos_gerar", err.message, "M19");
    notificar("erro", "Erro ao gerar PDF", err.message);
  }
}

async function _lazyLoadPDF() {
  if (!window.html2canvas) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
}

// ─── Numeração sequencial ────────────────────────────────────────────────────
async function _proximoNumero(prefixo) {
  try {
    const colRef = collection(db, "empresas", _sessao.uid, "recibos");
    const q = query(colRef, orderBy("geradoEm", "desc"), limit(200));
    const snap = await getDocs(q);
    let maxNum = 0;
    snap.docs.forEach(d => {
      const nome = d.data().nomeArquivo || "";
      const match = nome.match(new RegExp(`${prefixo}(\\d+)`, "i"));
      if (match) {
        const n = parseInt(match[1]);
        if (n > maxNum) maxNum = n;
      }
    });
    return `${prefixo}${String(maxNum + 1).padStart(3, "0")}`;
  } catch {
    return `${prefixo}${String(Date.now()).slice(-4)}`;
  }
}

// ─── Termos de garantia ──────────────────────────────────────────────────────
function _configurarTermos() {
  const modal = document.createElement("div");
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;max-width:480px;width:100%">
      <h3 style="margin:0 0 12px;font-size:1rem">Termos de Garantia</h3>
      <textarea id="termos-input" style="width:100%;min-height:140px;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:.9rem;resize:vertical">${_empresa.termosGarantia || ""}</textarea>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
        <button id="termos-cancelar" class="mc-btn mc-btn-outline">Cancelar</button>
        <button id="termos-salvar" class="mc-btn mc-btn-primary" data-acao="escrita">Salvar</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  modal.querySelector("#termos-cancelar").addEventListener("click", () => modal.remove());
  modal.querySelector("#termos-salvar").addEventListener("click", async () => {
    const texto = modal.querySelector("#termos-input").value.trim();
    try {
      await updateDoc(doc(db, "empresas", _sessao.uid), { termosGarantia: texto });
      _empresa.termosGarantia = texto;
      notificar("sucesso", "Termos salvos!", "Os termos de garantia foram atualizados.");
    } catch (err) {
      registrarErro("termos_garantia", err.message, "M19");
      notificar("erro", "Erro ao salvar", err.message);
    }
    modal.remove();
  });
}

// ─── Utilitários ─────────────────────────────────────────────────────────────
function _dadosEmpresa() {
  const end = _empresa.endereco || "";
  const cidade = _empresa.cidade || end.split(",").pop()?.trim() || "";
  return {
    logoBase64: _logoBase64,
    nomeEmpresa: _empresa.nomeEmpresa || _empresa.nome || "",
    cnpj: _empresa.cpfCnpj || _empresa.cnpj || "",
    responsavel: _empresa.responsavel || _empresa.nomeResponsavel || "",
    endereco: end,
    cidade,
    email: _empresa.email || "",
    telefone: _empresa.telefone || ""
  };
}

function _nomeArquivo(modelo, nomeCliente) {
  const labels = {
    recibo_eletronicos: "Recibo",
    orcamento_conserto: "OrcConserto",
    orcamento_encomenda: "OrcEncomenda"
  };
  const nome = (nomeCliente || "").replace(/\s+/g, "_").slice(0, 20);
  return `${labels[modelo] || "Doc"}_${nome}_${Date.now()}.pdf`;
}

function _somarDias(dataBR, dias) {
  try {
    const [d, m, a] = dataBR.split("/").map(Number);
    const dt = new Date(a, m - 1, d);
    dt.setDate(dt.getDate() + dias);
    return dt.toLocaleDateString("pt-BR");
  } catch { return ""; }
}
