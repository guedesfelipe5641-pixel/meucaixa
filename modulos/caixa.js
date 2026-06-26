// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · modulos/caixa.js · Etapa A                         ║
// ║  Caixa do Dia — abertura, movimentações, fechamento            ║
// ║  Módulo 07                                                      ║
// ╚══════════════════════════════════════════════════════════════════╝

import { db } from "../firebase-config.js";
import {
  collection, addDoc, getDocs, updateDoc, doc, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { notificar } from "../notificacoes.js";
import { abrirFormulario, registrarErro, formatarMoeda, formatarData } from "../utils.js";

// ── Estado do módulo ─────────────────────────────────────────────────────────

let _unsubscribe        = null;
let _unsubMinhasVendas  = null;
let _empresaId          = "";
let _sessao             = null;
let _caixaId            = null;
let _caixaData          = null;
let _containerEl        = null;
let _resumoAberto       = false;   // controla "Ver detalhes por produto" dentro do Resumo Financeiro
let _resumoSecaoAberta  = false;   // controla visibilidade da seção Resumo Financeiro (toggle externo)
let _ultimosVendaDocs   = [];

// ── Helpers de formatação ────────────────────────────────────────────────────

function _formatarHorario(ts) {
  if (!ts) return "—";
  let d;
  if (ts instanceof Timestamp) d = ts.toDate();
  else if (ts && typeof ts.seconds === "number") d = new Date(ts.seconds * 1000);
  else d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function _formatarDataHora(ts) {
  if (!ts) return "—";
  let d;
  if (ts instanceof Timestamp) d = ts.toDate();
  else if (ts && typeof ts.seconds === "number") d = new Date(ts.seconds * 1000);
  else d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function _tipoLabel(tipo) {
  switch (tipo) {
    case "venda":                return { label: "Venda",             cls: "tag-success"  };
    case "recebimento_crediario": return { label: "Receb. Crediário", cls: "tag-accent"   };
    case "saque":                return { label: "Saque",             cls: "tag-danger"   };
    case "deposito":             return { label: "Depósito",          cls: "tag-success"  };
    case "abertura":             return { label: "Abertura",          cls: "tag-neutral"  };
    case "cancelamento":         return { label: "Cancelamento",      cls: "tag-danger"   };
    default:                     return { label: tipo,                cls: "tag-neutral"  };
  }
}

// ── Cancelar listener ativo ──────────────────────────────────────────────────

function _limparUnsubscribe() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  if (_unsubMinhasVendas) { _unsubMinhasVendas(); _unsubMinhasVendas = null; }
}

// ── Abertura automática ──────────────────────────────────────────────────────

async function _tentarAberturaAutomatica(config) {
  if (!config?.autoAbrir) return false;
  const agora      = new Date();
  const diaSemana  = agora.getDay();
  const hora       = agora.getHours().toString().padStart(2, "0") + ":" +
                     agora.getMinutes().toString().padStart(2, "0");
  if (!config.diasSemana?.includes(diaSemana)) return false;
  if (hora !== config.horaAbertura)            return false;

  try {
    const caixaRef = await addDoc(
      collection(db, "empresas", _empresaId, "caixa"),
      {
        valorInicial:         0,
        abertaEm:             serverTimestamp(),
        fechadoEm:            null,
        operadorAbertura:     _sessao.uid,
        operadorFechamento:   null,
        valorFinal:           null,
        abertaAutomaticamente: true,
      }
    );
    await addDoc(
      collection(db, "empresas", _empresaId, "caixa", caixaRef.id, "movimentacoes"),
      {
        tipo:        "abertura",
        valor:       0,
        descricao:   "Abertura automática do caixa",
        operadorId:  _sessao.uid,
        sincronizado: false,
        createdAt:   serverTimestamp(),
      }
    );
    return true;
  } catch (err) {
    await registrarErro("firestore", err.message, "caixa.js");
    return false;
  }
}

// ── Tela: Nenhum caixa aberto ────────────────────────────────────────────────

function _renderizarTelaAbertura() {
  const isAdmin = _sessao.perfil === "admin";
  _containerEl.innerHTML = `
    <div class="section-header" style="margin-bottom:24px">
      <h2>Caixa do Dia</h2>
      <span style="font-size:14px;color:#aaa">${formatarData(new Date())}</span>
    </div>
    <div class="card fade-up" style="max-width:480px;margin:0 auto;text-align:center;padding:40px 32px">
      <div style="font-size:48px;margin-bottom:16px">🔴</div>
      <h3 style="margin:0 0 8px;font-size:20px;color:var(--text)">Nenhum caixa aberto hoje</h3>
      <p style="color:#888;margin:0 0 24px;font-size:15px">
        ${isAdmin
          ? "Informe o valor inicial e abra o caixa para iniciar as operações."
          : "Aguarde um administrador abrir o caixa."}
      </p>
      ${isAdmin ? `
        <form id="form-abertura" style="text-align:left">
          <div class="form-group" style="margin-bottom:16px">
            <label class="lbl">Valor Inicial (R$)</label>
            <input class="input" type="number" id="cxa-valor-inicial" min="0" step="0.01" placeholder="0,00" value="0">
          </div>
          <button class="btn btn-primary" type="submit" id="btn-abrir-caixa" data-acao="escrita" style="width:100%;justify-content:center">
            Abrir Caixa
          </button>
        </form>
      ` : ""}
    </div>`;

  if (!isAdmin) return;

  const form = document.getElementById("form-abertura");
  const btn  = document.getElementById("btn-abrir-caixa");

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const valorStr = document.getElementById("cxa-valor-inicial").value.trim();
    const valor    = parseFloat(valorStr);
    if (isNaN(valor) || valor < 0) {
      notificar("aviso", "Valor inválido", "Informe um valor inicial igual ou maior que zero.");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Abrindo…";
    try {
      const caixaRef = await addDoc(
        collection(db, "empresas", _empresaId, "caixa"),
        {
          valorInicial:         valor,
          abertaEm:             serverTimestamp(),
          fechadoEm:            null,
          operadorAbertura:     _sessao.uid,
          operadorFechamento:   null,
          valorFinal:           null,
          abertaAutomaticamente: false,
        }
      );
      await addDoc(
        collection(db, "empresas", _empresaId, "caixa", caixaRef.id, "movimentacoes"),
        {
          tipo:        "abertura",
          valor:       valor,
          descricao:   "Abertura do caixa",
          operadorId:  _sessao.uid,
          sincronizado: false,
          createdAt:   serverTimestamp(),
        }
      );
      notificar("sucesso", "Caixa aberto", "Caixa aberto com sucesso!");
      await renderizar(_sessao, _containerEl);
    } catch (err) {
      await registrarErro("firestore", err.message, "caixa.js");
      notificar("erro", "Erro ao abrir caixa", "Não foi possível abrir o caixa. Tente novamente.");
      btn.disabled = false;
      btn.textContent = "Abrir Caixa";
    }
  });
}

// ── Cards de resumo ──────────────────────────────────────────────────────────

function _atualizarCards({ saldoAtual, totalEntradas, totalSaques, resultado }) {
  const fmt = v => formatarMoeda ? formatarMoeda(v) : `R$ ${v.toFixed(2)}`;

  const elSaldo     = document.getElementById("cxa-card-saldo");
  const elEntradas  = document.getElementById("cxa-card-entradas");
  const elSaques    = document.getElementById("cxa-card-saques");
  const elResultado = document.getElementById("cxa-card-resultado");

  if (elSaldo)     elSaldo.textContent     = fmt(saldoAtual);
  if (elEntradas)  elEntradas.textContent  = fmt(totalEntradas);
  if (elSaques)    elSaques.textContent    = fmt(totalSaques);
  if (elResultado) {
    elResultado.textContent = fmt(resultado);
    elResultado.style.color = resultado >= 0 ? "#2E7D32" : "#C62828";
  }
}

// ── Lista de movimentações ───────────────────────────────────────────────────

function _renderizarMovimentacoes(movs) {
  const container = document.getElementById("cxa-lista-mov");
  if (!container) return;

  if (movs.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:#aaa;padding:24px">Nenhuma movimentação registrada.</p>`;
    return;
  }

  if (window._layoutMobile) {
    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">` +
      movs.map(m => {
        const { label, cls } = _tipoLabel(m.tipo);
        const isNeg    = m.tipo === "saque" || m.tipo === "cancelamento";
        const cor      = isNeg ? "#C62828" : "#2E7D32";
        const absValor = Math.abs(Number(m.valor || 0)).toFixed(2);
        return `
          <div class="card fade-up" style="padding:14px 16px;border:1px solid rgba(0,0,0,.04)">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
              <div style="flex:1;min-width:0">
                <span class="tag ${cls}" style="margin-bottom:6px;display:inline-block">${label}</span>
                <div style="font-size:14px;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.descricao || "—"}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:16px;font-weight:700;color:${cor}">${isNeg ? "−" : "+"}R$ ${absValor}</div>
                <div style="font-size:11px;color:#bbb;margin-top:2px">${_formatarHorario(m.createdAt)}</div>
              </div>
            </div>
          </div>`;
      }).join("") +
      `</div>`;
  } else {
    container.innerHTML = `
      <div class="table-responsive">
        <table class="table" style="margin-top:4px">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Descrição</th>
              <th style="text-align:right">Valor</th>
              <th style="text-align:right">Horário</th>
            </tr>
          </thead>
          <tbody>
            ${movs.map(m => {
              const { label, cls } = _tipoLabel(m.tipo);
              const isNeg    = m.tipo === "saque" || m.tipo === "cancelamento";
              const cor      = isNeg ? "#C62828" : "#2E7D32";
              const absValor = Math.abs(Number(m.valor || 0)).toFixed(2);
              return `
                <tr>
                  <td><span class="tag ${cls}">${label}</span></td>
                  <td>${m.descricao || "—"}</td>
                  <td style="text-align:right;font-weight:600;color:${cor}">${isNeg ? "−" : "+"}R$ ${absValor}</td>
                  <td style="text-align:right;color:#aaa;font-size:13px">${_formatarHorario(m.createdAt)}</td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
  }
}

// ── Tabela de produtos vendidos (Admin) ──────────────────────────────────────

function _gerarTabelaProdutos(vendaDocs) {
  // Agrupar itens de todas as vendas por produtoId
  const mapa = new Map();
  vendaDocs.forEach(d => {
    const v = d.data();
    if (!Array.isArray(v.itens)) return;
    v.itens.forEach(item => {
      const key = item.produtoId || item.nome;
      if (!mapa.has(key)) mapa.set(key, { nome: item.nome, qtd: 0, faturamento: 0, custo: 0 });
      const entry = mapa.get(key);
      entry.qtd         += (item.quantidade || 0);
      entry.faturamento += (item.subtotal || (item.quantidade * item.precoUnitario) || 0);
      entry.custo       += (item.custo || 0) * (item.quantidade || 0);
    });
  });

  if (mapa.size === 0) {
    return '<p style="color:#aaa;font-size:13px;margin-top:8px">Nenhum produto vendido no período.</p>';
  }

  const linhas = Array.from(mapa.values()).map(p => {
    const lucro = p.faturamento - p.custo;
    return `<tr>
      <td>${p.nome}</td>
      <td style="text-align:center">${p.qtd}</td>
      <td style="text-align:right">${formatarMoeda(p.faturamento)}</td>
      <td style="text-align:right;color:#C62828">${formatarMoeda(p.custo)}</td>
      <td style="text-align:right;color:${lucro >= 0 ? "#2E7D32" : "#C62828"};font-weight:600">${formatarMoeda(lucro)}</td>
    </tr>`;
  }).join("");

  return `
    <div class="table-responsive" style="margin-top:12px">
      <table class="table">
        <thead>
          <tr>
            <th>Produto</th>
            <th style="text-align:center">Qtd</th>
            <th style="text-align:right">Faturamento</th>
            <th style="text-align:right">Custo</th>
            <th style="text-align:right">Lucro</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  `;
}

// ── Resumo financeiro (Admin) ────────────────────────────────────────────────

async function _atualizarResumo(movDocs) {
  const el = document.getElementById("cxa-resumo-financeiro");
  if (!el) return;

  // Calcular cancelamentos e saques a partir das movimentações
  let totalCancelamentos = 0;
  let qtdCancelamentos   = 0;
  movDocs.forEach(m => {
    if (m.tipo === "cancelamento") {
      totalCancelamentos += Math.abs(m.valor || 0);
      qtdCancelamentos++;
    }
  });

  // Buscar docs de venda para calcular bruto, desconto, custo, lucro
  let totalBruto    = 0;
  let totalDesconto = 0;
  let totalCusto    = 0;
  let totalLiquido  = 0;
  let qtdVendas     = 0;
  try {
    const qVendas = query(
      collection(db, "empresas", _empresaId, "vendas"),
      where("createdAt", ">=", _caixaData.abertaEm)
    );
    const snapVendas = await getDocs(qVendas);
    const vendaDocs = snapVendas.docs.filter(d => !d.data().cancelada);
    _ultimosVendaDocs = vendaDocs;
    qtdVendas = vendaDocs.length;
    vendaDocs.forEach(d => {
      const v = d.data();
      totalBruto    += (v.totalBruto    || 0);
      totalDesconto += (v.descontoValor || 0);
      totalLiquido  += (v.totalLiquido  || 0);
      if (Array.isArray(v.itens)) {
        v.itens.forEach(item => {
          totalCusto += (item.custo || 0) * (item.quantidade || 0);
        });
      }
    });
  } catch (err) {
    registrarErro("firestore", err.message, "caixa.js");
  }

  const lucroReal = totalLiquido - totalCusto;

  // Atualizar HTML do resumo — manter cabeçalho/toggle; reescrever apenas o corpo
  const corpo = el.querySelector("#cxa-resumo-corpo");
  if (!corpo) return;

  corpo.innerHTML = `
    <div style="display:grid;gap:8px;font-size:14px">
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee">
        <span style="color:#555">Vendas realizadas</span>
        <span style="font-weight:600">${qtdVendas}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee">
        <span style="color:#555">Faturamento bruto</span>
        <span style="font-weight:600">${formatarMoeda(totalBruto)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee">
        <span style="color:#C62828">Descontos concedidos</span>
        <span style="font-weight:600;color:#C62828">- ${formatarMoeda(totalDesconto)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee">
        <span style="color:#C62828">Custo dos produtos</span>
        <span style="font-weight:600;color:#C62828">- ${formatarMoeda(totalCusto)}</span>
      </div>
      ${qtdCancelamentos > 0 ? `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee">
        <span style="color:#C62828">Cancelamentos (${qtdCancelamentos})</span>
        <span style="font-weight:600;color:#C62828">- ${formatarMoeda(totalCancelamentos)}</span>
      </div>
      ` : ""}
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #1A1A1A;margin-top:4px">
        <span style="font-weight:700">Lucro real</span>
        <span style="font-weight:700;font-size:16px;color:${lucroReal >= 0 ? "#2E7D32" : "#C62828"}">${formatarMoeda(lucroReal)}</span>
      </div>
    </div>
    <button id="btn-ver-detalhes" class="btn btn-secondary btn-sm" style="margin-top:12px;width:100%">
      ${_resumoAberto ? "▲ Ocultar detalhes" : "▼ Ver detalhes por produto"}
    </button>
    ${_resumoAberto ? _gerarTabelaProdutos(_ultimosVendaDocs) : ""}
  `;

  // Re-bind do toggle de detalhes por produto
  document.getElementById("btn-ver-detalhes")?.addEventListener("click", () => {
    _resumoAberto = !_resumoAberto;
    _atualizarResumo(movDocs).catch(err => registrarErro("firestore", err.message, "caixa.js"));
  });
}

// ── Registrar saque / depósito ───────────────────────────────────────────────

function _abrirFormMovimentacao(tipo) {
  const isNeg   = tipo === "saque";
  const titulo  = isNeg ? "Registrar Saque" : "Registrar Depósito";
  const idForm  = isNeg ? "form-saque"    : "form-deposito";
  const idBtn   = isNeg ? "btn-salvar-saque" : "btn-salvar-deposito";
  const btnCls  = isNeg ? "btn-danger"    : "btn-primary";
  const btnTxt  = isNeg ? "Confirmar Saque" : "Confirmar Depósito";

  abrirFormulario({
    titulo,
    conteudo: `
      <form id="${idForm}">
        <div class="form-group" style="margin-bottom:14px">
          <label class="lbl">Valor (R$)*</label>
          <input class="input" type="number" name="valor" id="cxa-mov-valor" min="0.01" step="0.01" placeholder="0,00" required>
        </div>
        <div class="form-group" style="margin-bottom:18px">
          <label class="lbl">Descrição*</label>
          <input class="input" type="text" name="descricao" id="cxa-mov-descricao" minlength="3" maxlength="200" placeholder="Descreva o motivo" required>
        </div>
        <button class="btn ${btnCls}" type="submit" id="${idBtn}" style="width:100%;justify-content:center">${btnTxt}</button>
      </form>`
  });

  const form = document.getElementById(idForm);
  const btn  = document.getElementById(idBtn);
  if (!form || !btn) return;

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const valor     = parseFloat(document.getElementById("cxa-mov-valor").value);
    const descricao = document.getElementById("cxa-mov-descricao").value.trim();
    if (isNaN(valor) || valor <= 0) {
      notificar("aviso", "Valor inválido", "Informe um valor maior que zero.");
      return;
    }
    if (descricao.length < 3) {
      notificar("aviso", "Descrição inválida", "Descrição deve ter ao menos 3 caracteres.");
      return;
    }
    btn.disabled    = true;
    btn.textContent = "Salvando…";
    try {
      await addDoc(
        collection(db, "empresas", _empresaId, "caixa", _caixaId, "movimentacoes"),
        {
          tipo:        tipo,
          valor:       valor,
          descricao:   descricao,
          operadorId:  _sessao.uid,
          sincronizado: false,
          createdAt:   serverTimestamp(),
        }
      );
      document.querySelector(".mc-modal-overlay, .mc-bs-overlay")?.remove();
      notificar("sucesso", isNeg ? "Saque registrado" : "Depósito registrado", "");
    } catch (err) {
      await registrarErro("firestore", err.message, "caixa.js");
      notificar("erro", "Erro ao registrar", "Não foi possível registrar a movimentação.");
      btn.disabled    = false;
      btn.textContent = btnTxt;
    }
  });
}

// ── Fechar caixa (Admin) ─────────────────────────────────────────────────────

function _abrirFechamentoCaixa() {
  abrirFormulario({
    titulo: "Fechar Caixa",
    conteudo: `
      <form id="form-fechar-caixa">
        <p style="color:#555;margin:0 0 16px;font-size:15px">Confirma o fechamento do caixa de hoje?</p>
        <div class="form-group" style="margin-bottom:18px">
          <label class="lbl">Valor Final em Caixa (R$)*</label>
          <input class="input" type="number" name="valorFinal" id="cxa-valor-final" min="0" step="0.01" placeholder="0,00" required>
        </div>
        <button class="btn btn-danger" type="submit" id="btn-confirmar-fechar" data-acao="escrita" style="width:100%;justify-content:center">Confirmar Fechamento</button>
      </form>`
  });

  const form = document.getElementById("form-fechar-caixa");
  const btn  = document.getElementById("btn-confirmar-fechar");
  if (!form || !btn) return;

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const valorFinal = parseFloat(document.getElementById("cxa-valor-final").value);
    if (isNaN(valorFinal) || valorFinal < 0) {
      notificar("aviso", "Valor inválido", "Informe o valor em caixa no momento do fechamento.");
      return;
    }
    btn.disabled    = true;
    btn.textContent = "Fechando…";
    try {
      await updateDoc(
        doc(db, "empresas", _empresaId, "caixa", _caixaId),
        {
          fechadoEm:          serverTimestamp(),
          valorFinal:         valorFinal,
          operadorFechamento: _sessao.uid,
        }
      );
      document.querySelector(".mc-modal-overlay, .mc-bs-overlay")?.remove();
      notificar("sucesso", "Caixa fechado", "O caixa foi fechado com sucesso.");
      await renderizar(_sessao, _containerEl);
    } catch (err) {
      await registrarErro("firestore", err.message, "caixa.js");
      notificar("erro", "Erro ao fechar caixa", "Não foi possível fechar o caixa. Tente novamente.");
      btn.disabled    = false;
      btn.textContent = "Confirmar Fechamento";
    }
  });
}

// ── Tela: Caixa aberto ───────────────────────────────────────────────────────

function _renderizarTelaAberto() {
  const isAdmin   = _sessao.perfil === "admin";
  const horarioAb = _formatarHorario(_caixaData.abertaEm);
  const autoAbriu = _caixaData.abertaAutomaticamente
    ? `<span class="tag tag-neutral" style="margin-left:8px">Auto</span>` : "";

  _containerEl.innerHTML = `
    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:24px">
      <div>
        <h2 style="margin:0 0 4px">Caixa do Dia</h2>
        <span style="font-size:14px;color:#aaa">${formatarData(new Date())} · Aberto às ${horarioAb}${autoAbriu}</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="display:inline-flex;align-items:center;gap:6px;background:#E8F5E9;color:#2E7D32;padding:6px 14px;border-radius:20px;font-size:14px;font-weight:600">
          🟢 Aberto
        </span>
        ${isAdmin ? `<button id="btn-fechar-caixa" class="btn btn-danger" data-acao="escrita">Fechar Caixa</button>` : ""}
      </div>
    </div>

    <!-- Cards de resumo (4) -->
    <div id="cxa-cards-grid" style="display:grid;grid-template-columns:${window._layoutMobile ? "repeat(2,1fr)" : "repeat(4,1fr)"};gap:14px;margin-bottom:28px">
      <div class="card" style="background:#fff;border-radius:8px;padding:${window._layoutMobile ? "14px 12px" : "20px"};box-shadow:0 2px 8px rgba(0,0,0,.06)">
        <div style="font-size:12px;color:#888;margin-bottom:8px">Saldo Atual</div>
        <div id="cxa-card-saldo" style="font-size:${window._layoutMobile ? "18px" : "26px"};font-weight:700;color:var(--text);word-break:break-word">R$ 0,00</div>
      </div>
      <div class="card" style="background:#fff;border-radius:8px;padding:${window._layoutMobile ? "14px 12px" : "20px"};box-shadow:0 2px 8px rgba(0,0,0,.06)">
        <div style="font-size:12px;color:#888;margin-bottom:8px">Total Entradas</div>
        <div id="cxa-card-entradas" style="font-size:${window._layoutMobile ? "18px" : "26px"};font-weight:700;color:#2E7D32;word-break:break-word">R$ 0,00</div>
      </div>
      <div class="card" style="background:#fff;border-radius:8px;padding:${window._layoutMobile ? "14px 12px" : "20px"};box-shadow:0 2px 8px rgba(0,0,0,.06)">
        <div style="font-size:12px;color:#888;margin-bottom:8px">Total Saques</div>
        <div id="cxa-card-saques" style="font-size:${window._layoutMobile ? "18px" : "26px"};font-weight:700;color:#C62828;word-break:break-word">R$ 0,00</div>
      </div>
      <div class="card" style="background:#fff;border-radius:8px;padding:${window._layoutMobile ? "14px 12px" : "20px"};box-shadow:0 2px 8px rgba(0,0,0,.06)">
        <div style="font-size:12px;color:#888;margin-bottom:8px">Resultado do Dia</div>
        <div id="cxa-card-resultado" style="font-size:${window._layoutMobile ? "18px" : "26px"};font-weight:700;color:#2E7D32;word-break:break-word">R$ 0,00</div>
      </div>
    </div>

    <!-- Minhas Vendas Hoje (Operador only) -->
    ${!isAdmin ? `
    <div class="card" style="margin-top:0;margin-bottom:28px;padding:16px">
      <div style="font-size:12px;color:#888;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Minhas Vendas Hoje</div>
      <div style="display:flex;gap:24px;align-items:flex-end">
        <div>
          <div id="cxa-mv-qtd" style="font-size:26px;font-weight:700">–</div>
          <div style="font-size:12px;color:#888">vendas</div>
        </div>
        <div>
          <div id="cxa-mv-total" style="font-size:22px;font-weight:700;color:#6B3520">–</div>
          <div style="font-size:12px;color:#888">total</div>
        </div>
      </div>
    </div>
    ` : ""}

    <!-- Botões de ação -->
    <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:28px">
      <button id="btn-registrar-saque"    class="btn btn-danger"    data-acao="escrita">Registrar Saque</button>
      <button id="btn-registrar-deposito" class="btn btn-secondary" data-acao="escrita">Registrar Depósito</button>
    </div>

    <!-- Resumo Financeiro (somente Admin) -->
    ${isAdmin ? `
    <div id="cxa-resumo-financeiro" class="card" style="background:#fff;border-radius:8px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.06);margin-bottom:24px">
      <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" id="cxa-toggle-resumo">
        <h3 style="margin:0;font-size:16px;font-weight:700;color:var(--text)">Resumo Financeiro</h3>
        <span id="cxa-toggle-icone" style="font-size:14px;color:var(--primary);font-weight:600">${_resumoSecaoAberta ? "▲ Ocultar" : "▼ Ver Detalhes"}</span>
      </div>
      <div id="cxa-resumo-corpo" style="display:${_resumoSecaoAberta ? "block" : "none"};margin-top:16px">
        <div style="display:grid;grid-template-columns:${window._layoutMobile ? "1fr" : "repeat(3,1fr)"};gap:14px;margin-bottom:16px">
          <div style="padding:14px;background:#F5F5F5;border-radius:8px">
            <div style="font-size:12px;color:#888;margin-bottom:4px">Faturamento Bruto</div>
            <div id="cxa-res-bruto" style="font-size:18px;font-weight:700;color:#2E7D32">R$ 0,00</div>
          </div>
          <div style="padding:14px;background:#F5F5F5;border-radius:8px">
            <div style="font-size:12px;color:#888;margin-bottom:4px">Total de Saques</div>
            <div id="cxa-res-saques" style="font-size:18px;font-weight:700;color:#C62828">R$ 0,00</div>
          </div>
          <div style="padding:14px;background:#F5F5F5;border-radius:8px">
            <div style="font-size:12px;color:#888;margin-bottom:4px">Resultado Líquido</div>
            <div id="cxa-res-liquido" style="font-size:18px;font-weight:700;color:#2E7D32">R$ 0,00</div>
          </div>
        </div>
        <div id="cxa-lista-detalhe"></div>
      </div>
    </div>
    ` : ""}

    <!-- Últimas 20 movimentações -->
    <div>
      <h3 style="margin:0 0 14px;font-size:16px;font-weight:700;color:var(--text)">Últimas Movimentações</h3>
      <div id="cxa-lista-mov"><p style="color:#aaa;padding:12px">Carregando…</p></div>
    </div>`;

  // Listeners de botões de ação
  document.getElementById("btn-registrar-saque")?.addEventListener("click", () => _abrirFormMovimentacao("saque"));
  document.getElementById("btn-registrar-deposito")?.addEventListener("click", () => _abrirFormMovimentacao("deposito"));
  if (isAdmin) {
    document.getElementById("btn-fechar-caixa")?.addEventListener("click", _abrirFechamentoCaixa);
    document.getElementById("cxa-toggle-resumo")?.addEventListener("click", () => {
      _resumoSecaoAberta = !_resumoSecaoAberta;
      const corpo = document.getElementById("cxa-resumo-corpo");
      const icone = document.getElementById("cxa-toggle-icone");
      if (corpo) corpo.style.display = _resumoSecaoAberta ? "block" : "none";
      if (icone) icone.textContent   = _resumoSecaoAberta ? "▲ Ocultar" : "▼ Ver Detalhes";
    });
  }

  // onSnapshot — Minhas Vendas Hoje (Operador only)
  if (!isAdmin) {
    const qMV = query(
      collection(db, "empresas", _empresaId, "vendas"),
      where("operadorId", "==", _sessao.uid),
      where("createdAt", ">=", _caixaData.abertaEm),
      where("cancelada", "==", false)
    );
    _unsubMinhasVendas = onSnapshot(qMV, (snap) => {
      const qtd   = snap.size;
      const total = snap.docs.reduce((s, d) => s + (d.data().totalLiquido || 0), 0);
      const elQtd   = document.getElementById("cxa-mv-qtd");
      const elTotal = document.getElementById("cxa-mv-total");
      if (elQtd)   elQtd.textContent   = qtd;
      if (elTotal) elTotal.textContent = formatarMoeda(total);
    }, (err) => {
      registrarErro("firestore", err.message, "caixa.js");
    });
  }

  // onSnapshot — atualiza cards e lista em tempo real
  const movRef = collection(db, "empresas", _empresaId, "caixa", _caixaId, "movimentacoes");
  const qUltimas = query(movRef, orderBy("createdAt", "desc"), limit(20));

  _unsubscribe = onSnapshot(movRef, (snap) => {
    let totalEntradas = 0;
    let totalSaques   = 0;
    const allMovs     = [];

    snap.docs.forEach(d => {
      const m = d.data();
      allMovs.push(m);
      if (m.tipo === "saque") {
        totalSaques   += Number(m.valor || 0);
      } else if (m.tipo !== "abertura") {
        // "abertura" já está representada em caixaData.valorInicial — não somar novamente
        totalEntradas += Number(m.valor || 0);
      }
    });

    const saldoAtual = (_caixaData.valorInicial || 0) + totalEntradas - totalSaques;
    // resultado = receita operacional do dia (abertura excluída de totalEntradas)
    const resultado  = totalEntradas - totalSaques;
    _atualizarCards({ saldoAtual, totalEntradas, totalSaques, resultado });

    if (isAdmin) {
      _atualizarResumo(allMovs).catch(err => registrarErro("firestore", err.message, "caixa.js"));
    }

    // Atualizar lista principal (ultimas 20, ordenadas desc)
    const ultimas20 = allMovs
      .slice()
      .sort((a, b) => {
        const ta = a.createdAt?.seconds || 0;
        const tb = b.createdAt?.seconds || 0;
        return tb - ta;
      })
      .slice(0, 20);
    _renderizarMovimentacoes(ultimas20);
  }, async (err) => {
    await registrarErro("firestore", err.message, "caixa.js");
    notificar("erro", "Erro em tempo real", "Falha ao receber atualizações do caixa.");
  });
}

// ── Tela: Caixa fechado (somente leitura) ────────────────────────────────────

async function _renderizarTelaFechado() {
  const horarioAb = _formatarHorario(_caixaData.abertaEm);
  const horarioFe = _formatarHorario(_caixaData.fechadoEm);
  const valorFinal = Number(_caixaData.valorFinal || 0);

  _containerEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:24px">
      <div>
        <h2 style="margin:0 0 4px">Caixa do Dia</h2>
        <span style="font-size:14px;color:#aaa">${formatarData(new Date())} · Aberto às ${horarioAb} · Fechado às ${horarioFe}</span>
      </div>
      <span style="display:inline-flex;align-items:center;gap:6px;background:#FFEBEE;color:#C62828;padding:6px 14px;border-radius:20px;font-size:14px;font-weight:600">
        🔴 Fechado
      </span>
    </div>

    <div class="card" style="background:#FFF8F6;border:1.5px solid rgba(198,40,40,.15);border-radius:8px;padding:20px;margin-bottom:24px;max-width:420px">
      <div style="font-size:13px;color:#888;margin-bottom:4px">Valor Final em Caixa</div>
      <div style="font-size:28px;font-weight:700;color:var(--text)">R$ ${valorFinal.toFixed(2)}</div>
    </div>

    <h3 style="margin:0 0 14px;font-size:16px;font-weight:700;color:var(--text)">Movimentações do Dia</h3>
    <div id="cxa-lista-mov"><p style="color:#aaa;padding:12px">Carregando…</p></div>`;

  try {
    const movRef  = collection(db, "empresas", _empresaId, "caixa", _caixaId, "movimentacoes");
    const qOrd    = query(movRef, orderBy("createdAt", "desc"), limit(20));
    const snap    = await getDocs(qOrd);
    const movs    = snap.docs.map(d => d.data());
    _renderizarMovimentacoes(movs);
  } catch (err) {
    await registrarErro("firestore", err.message, "caixa.js");
    notificar("erro", "Erro ao carregar movimentações", "Não foi possível carregar as movimentações.");
  }
}

// ── Entrada do módulo ────────────────────────────────────────────────────────

export async function renderizar(sessao, containerEl) {
  // Limpar listener anterior sempre que re-renderizar
  _limparUnsubscribe();

  _sessao            = sessao;
  _empresaId         = sessao.empresaId;
  _containerEl       = containerEl;
  _caixaId           = null;
  _caixaData         = null;
  _resumoAberto      = false;
  _resumoSecaoAberta = false;
  _ultimosVendaDocs  = [];

  containerEl.innerHTML = `<p style="color:#aaa;padding:24px">Carregando caixa…</p>`;

  try {
    // Verificar se há caixa aberto
    const q    = query(
      collection(db, "empresas", _empresaId, "caixa"),
      where("fechadoEm", "==", null),
      limit(1)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      // Tentar abertura automática
      const config   = sessao.configuracaoCaixa ||
        (JSON.parse(localStorage.getItem("mc_kit_offline") || "{}"))?.configuracaoCaixa;
      const autoAbriu = await _tentarAberturaAutomatica(config);

      if (autoAbriu) {
        // Re-verificar após abertura automática
        const snap2 = await getDocs(q);
        if (!snap2.empty) {
          _caixaId   = snap2.docs[0].id;
          _caixaData = snap2.docs[0].data();
          _renderizarTelaAberto();
          return;
        }
      }

      // Nenhum caixa — exibir tela de abertura
      _renderizarTelaAbertura();
      return;
    }

    _caixaId   = snap.docs[0].id;
    _caixaData = snap.docs[0].data();

    // Verificar se está realmente aberto (fechadoEm pode ser null mas valorFinal preenchido = bug)
    if (_caixaData.fechadoEm !== null && _caixaData.fechadoEm !== undefined) {
      await _renderizarTelaFechado();
    } else {
      _renderizarTelaAberto();
    }
  } catch (err) {
    await registrarErro("firestore", err.message, "caixa.js");
    notificar("erro", "Erro ao carregar caixa", "Não foi possível verificar o status do caixa.");
    containerEl.innerHTML = `<p style="text-align:center;color:#aaa;padding:40px">Erro ao carregar o caixa. Tente novamente.</p>`;
  }
}
