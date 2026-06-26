// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · modulos/folhaPagamento.js · Módulo 17              ║
// ║  Folha de Pagamento — lançamento mensal, PDF, Pro only         ║
// ╚══════════════════════════════════════════════════════════════════╝

import { db }                                  from "../firebase-config.js";
import {
  collection, getDocs, addDoc, updateDoc, doc,
  query, where, orderBy, getDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { notificar }                           from "../notificacoes.js";
import { formatarMoeda, registrarErro }        from "../utils.js";
import { planGuard }                           from "../planGuard.js";
// CSV inline — sem dependência de csvExport.js (evita conflito de cache de módulo)
function _downloadCSV(lancamentos, mes) {
  const bom  = "﻿";
  const esc  = v => { const s = String(v ?? ""); return s.includes(";") || s.includes('"') ? `"${s.replace(/"/g,'""')}"` : s; };
  const fmtN = v => typeof v === "number" ? v.toFixed(2).replace(".", ",") : "";
  const head = ["Colaborador","Cargo","Mês","Diária (R$)","Dias","Total Bruto (R$)","Adiantamento (R$)","Líquido Final (R$)","Pago"];
  const rows = lancamentos.map(l => [l.nomeColab||"", l.cargo||"", l.mes||"", fmtN(l.valorDiaria), String(l.diasTrabalhados??0), fmtN(l.totalBruto), fmtN(l.adiantamento), fmtN(l.liquidoFinal), l.pago]);
  const csv  = bom + head.map(esc).join(";") + "\r\n" + rows.map(r => r.map(esc).join(";")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: `folha${mes ? "_"+mes : ""}.csv` });
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

let _sessao    = null;
let _empresaId = "";
let _mesAtivo  = "";        // "YYYY-MM"
let _colabs    = [];        // colaboradores ativos
let _lancs     = {};        // { colaboradorId: docData }
let _logoUrl   = "";

// ── Helpers ───────────────────────────────────────────────────────────────────
const _mesAtual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const _mesPtBR = str => {
  if (!str) return "";
  const [a, m] = str.split("-");
  const nomes = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                 "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  return `${nomes[+m - 1]} ${a}`;
};

// ── Entrada ───────────────────────────────────────────────────────────────────
export async function renderizar(sessao, containerEl) {
  _sessao    = sessao;
  _empresaId = sessao.empresaId;
  _mesAtivo  = _mesAtual();

  if (!planGuard("profissional", containerEl)) return;

  containerEl.innerHTML = `
    <div class="fade-up">
      <div class="section-header">
        <h2>Folha de Pagamento</h2>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="fp-mes" type="month" class="input"
            value="${_mesAtivo}" style="width:160px;padding:7px 10px">
          <button id="fp-btn-csv" class="btn btn-secondary btn-sm">↓ CSV</button>
        </div>
      </div>
      <div id="fp-lista">
        <div style="text-align:center;padding:40px;color:#aaa;font-size:14px">Carregando…</div>
      </div>
    </div>`;

  document.getElementById("fp-mes").addEventListener("change", async e => {
    _mesAtivo = e.target.value;
    await _recarregar();
  });
  document.getElementById("fp-btn-csv").addEventListener("click", _exportarCSV);

  // Buscar logoUrl da empresa uma única vez
  try {
    const empSnap = await getDoc(doc(db, "empresas", _empresaId));
    _logoUrl = empSnap.data()?.logoUrl || "";
  } catch { _logoUrl = ""; }

  await _recarregar();
}

// ── Carga ─────────────────────────────────────────────────────────────────────
async function _recarregar() {
  const listaEl = document.getElementById("fp-lista");
  if (listaEl) listaEl.innerHTML =
    `<div style="text-align:center;padding:40px;color:#aaa;font-size:14px">Carregando…</div>`;

  try {
    // Colaboradores ativos ordenados por nome
    const colSnap = await getDocs(query(
      collection(db, "empresas", _empresaId, "colaboradores"),
      orderBy("nome")
    ));
    _colabs = colSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.ativo !== false);

    // Lançamentos do mês
    const lancSnap = await getDocs(query(
      collection(db, "empresas", _empresaId, "folha"),
      where("mes", "==", _mesAtivo)
    ));
    _lancs = {};
    lancSnap.docs.forEach(d => { _lancs[d.data().colaboradorId] = { _id: d.id, ...d.data() }; });
  } catch (e) {
    registrarErro("firestore", e.message, "folhaPagamento.js");
    notificar("erro", "Erro ao carregar", "Não foi possível carregar a folha.");
    return;
  }

  _renderLista();
}

// ── Renderização ──────────────────────────────────────────────────────────────
function _renderLista() {
  const el = document.getElementById("fp-lista");
  if (!el) return;

  if (!_colabs.length) {
    el.innerHTML = `<div style="text-align:center;padding:56px 20px">
      <div style="font-size:44px;margin-bottom:14px">👤</div>
      <p style="color:#aaa;font-size:14px">Nenhum colaborador ativo cadastrado.</p>
      <p style="color:#aaa;font-size:12px">Cadastre colaboradores em <strong>Colaboradores</strong>.</p>
    </div>`;
    return;
  }

  if (window._layoutMobile) {
    el.innerHTML = _colabs.map(c => _htmlCard(c)).join("");
  } else {
    el.innerHTML = `
      <div class="card table-responsive" style="overflow:visible">
        <table class="table">
          <thead><tr>
            <th>Colaborador</th>
            <th>Diária (R$)</th>
            <th style="width:80px">Dias</th>
            <th>Total Bruto</th>
            <th style="width:110px">Adiantamento</th>
            <th>Líquido</th>
            <th>Status</th>
            <th></th>
          </tr></thead>
          <tbody>${_colabs.map(c => _htmlLinha(c)).join("")}</tbody>
        </table>
      </div>`;
  }

  _bindAcoes(el);
}

function _lancDe(colab) {
  return _lancs[colab.id] || {
    valorDiaria:     parseFloat(colab.valorDiaria) || 0,
    diasTrabalhados: 0,
    totalBruto:      0,
    adiantamento:    0,
    liquidoFinal:    0,
    pago:            false,
    pdfUrl:          "",
  };
}

function _badgePago(pago) {
  return pago
    ? `<span class="tag tag-success">Pago</span>`
    : `<span class="tag tag-neutral">Pendente</span>`;
}

function _htmlLinha(c) {
  const l = _lancDe(c);
  return `
    <tr data-colab-id="${c.id}">
      <td>
        <div style="font-weight:600">${c.nome}</div>
        <div style="font-size:12px;color:#aaa">${c.cargo || "—"}</div>
      </td>
      <td><input class="input fp-diaria" type="number" min="0" step="0.01"
        value="${l.valorDiaria || ""}" style="width:90px;padding:6px 8px"
        data-colab="${c.id}"></td>
      <td><input class="input fp-dias" type="number" min="0" max="31"
        value="${l.diasTrabalhados || ""}" style="width:64px;padding:6px 8px"
        data-colab="${c.id}"></td>
      <td class="fp-bruto-${c.id}" style="font-weight:600">
        ${formatarMoeda(l.totalBruto || 0)}</td>
      <td><input class="input fp-adian" type="number" min="0" step="0.01"
        value="${l.adiantamento || ""}" style="width:90px;padding:6px 8px"
        data-colab="${c.id}"></td>
      <td class="fp-liquido-${c.id}" style="font-weight:700;color:var(--primary)">
        ${formatarMoeda(l.liquidoFinal || 0)}</td>
      <td>${_badgePago(l.pago)}</td>
      <td>${_acoesHtml(c.id, l)}</td>
    </tr>`;
}

function _htmlCard(c) {
  const l = _lancDe(c);
  return `
    <div class="card" style="padding:16px;margin-bottom:12px" data-colab-id="${c.id}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div>
          <div style="font-weight:700;font-size:15px">${c.nome}</div>
          <div style="font-size:12px;color:#aaa">${c.cargo || "—"}</div>
        </div>
        ${_badgePago(l.pago)}
      </div>
      <div class="form-grid" style="margin-bottom:12px">
        <div class="form-group">
          <label class="lbl">Diária (R$)</label>
          <input class="input fp-diaria" type="number" min="0" step="0.01"
            value="${l.valorDiaria || ""}" data-colab="${c.id}">
        </div>
        <div class="form-group">
          <label class="lbl">Dias trabalhados</label>
          <input class="input fp-dias" type="number" min="0" max="31"
            value="${l.diasTrabalhados || ""}" data-colab="${c.id}">
        </div>
        <div class="form-group">
          <label class="lbl">Adiantamento (R$)</label>
          <input class="input fp-adian" type="number" min="0" step="0.01"
            value="${l.adiantamento || ""}" data-colab="${c.id}">
        </div>
        <div class="form-group">
          <label class="lbl">Líquido Final</label>
          <div class="fp-liquido-${c.id}"
            style="font-size:18px;font-weight:700;color:var(--primary);padding-top:4px">
            ${formatarMoeda(l.liquidoFinal || 0)}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${_acoesHtml(c.id, l)}
      </div>
    </div>`;
}

function _acoesHtml(colabId, l) {
  return `
    <button class="btn btn-primary btn-sm" data-acao="salvar" data-id="${colabId}">Salvar</button>
    ${!l.pago && l._id ? `<button class="btn btn-success btn-sm" data-acao="pagar" data-id="${colabId}">✓ Pagar</button>` : ""}
    <button class="btn btn-secondary btn-sm" data-acao="pdf" data-id="${colabId}">📄 PDF</button>`;
}

// ── Cálculo em tempo real ─────────────────────────────────────────────────────
function _bindAcoes(el) {
  // Recalcular ao digitar
  el.addEventListener("input", e => {
    const inp = e.target;
    if (!inp.dataset.colab) return;
    const cid  = inp.dataset.colab;
    const dias  = parseFloat(el.querySelector(`.fp-dias[data-colab="${cid}"]`)?.value)  || 0;
    const diar  = parseFloat(el.querySelector(`.fp-diaria[data-colab="${cid}"]`)?.value)|| 0;
    const adian = parseFloat(el.querySelector(`.fp-adian[data-colab="${cid}"]`)?.value) || 0;
    const bruto  = Math.round(diar * dias * 100) / 100;
    const liq    = Math.round((bruto - adian) * 100) / 100;

    const brutoEl  = el.querySelector(`.fp-bruto-${cid}`);
    const liquidoEl = el.querySelector(`.fp-liquido-${cid}`);
    if (brutoEl)  brutoEl.textContent  = formatarMoeda(bruto);
    if (liquidoEl) liquidoEl.textContent = formatarMoeda(liq);
  });

  // Ações
  el.addEventListener("click", async e => {
    const btn = e.target.closest("[data-acao]");
    if (!btn) return;
    const { acao, id } = btn.dataset;
    if (acao === "salvar") await _salvar(id, el);
    if (acao === "pagar")  await _marcarPago(id);
    if (acao === "pdf")    await _gerarPDF(id, el);
  });
}

// ── Salvar lançamento ─────────────────────────────────────────────────────────
async function _salvar(colabId, el) {
  const colab  = _colabs.find(c => c.id === colabId);
  if (!colab) return;

  const dias   = parseFloat(el.querySelector(`.fp-dias[data-colab="${colabId}"]`)?.value)   || 0;
  const diaria = parseFloat(el.querySelector(`.fp-diaria[data-colab="${colabId}"]`)?.value) || 0;
  const adian  = parseFloat(el.querySelector(`.fp-adian[data-colab="${colabId}"]`)?.value)  || 0;
  const bruto  = Math.round(diaria * dias * 100) / 100;
  const liq    = Math.round((bruto - adian) * 100) / 100;

  const dados = {
    colaboradorId:   colabId,
    nomeColab:       colab.nome,
    mes:             _mesAtivo,
    valorDiaria:     diaria,
    diasTrabalhados: dias,
    totalBruto:      bruto,
    adiantamento:    adian,
    liquidoFinal:    liq,
    empresaId:       _empresaId,
  };

  const btn = el.querySelector(`[data-acao="salvar"][data-id="${colabId}"]`);
  if (btn) { btn.textContent = "Salvando…"; btn.disabled = true; }

  try {
    const existente = _lancs[colabId];
    if (existente?._id) {
      await updateDoc(doc(db, "empresas", _empresaId, "folha", existente._id), dados);
      _lancs[colabId] = { ...existente, ...dados };
    } else {
      const ref = await addDoc(
        collection(db, "empresas", _empresaId, "folha"),
        { ...dados, pago: false, pagoEm: null, pdfUrl: "", createdAt: serverTimestamp() }
      );
      _lancs[colabId] = { _id: ref.id, ...dados, pago: false, pagoEm: null, pdfUrl: "" };
    }
    notificar("sucesso", "Lançamento salvo", `${colab.nome} — ${_mesPtBR(_mesAtivo)}`);
    _renderLista();
  } catch (e) {
    registrarErro("firestore", e.message, "folhaPagamento.js");
    notificar("erro", "Erro ao salvar", "Tente novamente.");
    if (btn) { btn.textContent = "Salvar"; btn.disabled = false; }
  }
}

// ── Marcar pago ───────────────────────────────────────────────────────────────
async function _marcarPago(colabId) {
  const lanc = _lancs[colabId];
  if (!lanc?._id) {
    notificar("aviso", "Salve primeiro", "Salve o lançamento antes de marcar como pago.");
    return;
  }
  try {
    await updateDoc(doc(db, "empresas", _empresaId, "folha", lanc._id),
      { pago: true, pagoEm: serverTimestamp() });
    _lancs[colabId] = { ...lanc, pago: true };
    notificar("sucesso", "Pagamento registrado", `${lanc.nomeColab} marcado como pago.`);
    _renderLista();
  } catch (e) {
    registrarErro("firestore", e.message, "folhaPagamento.js");
    notificar("erro", "Erro ao registrar", "Tente novamente.");
  }
}

// ── Gerar PDF ─────────────────────────────────────────────────────────────────
async function _gerarPDF(colabId, el) {
  const colab = _colabs.find(c => c.id === colabId);
  const lanc  = _lancs[colabId];
  if (!lanc?._id) {
    notificar("aviso", "Salve primeiro", "Salve o lançamento antes de gerar o PDF.");
    return;
  }

  const btn = el.querySelector(`[data-acao="pdf"][data-id="${colabId}"]`);
  if (btn) { btn.textContent = "Gerando…"; btn.disabled = true; }

  try {
    // Lazy load jsPDF
    if (!window.jspdf) {
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const W = 210, margin = 20;
    let y = margin;

    // Logo (se existir)
    if (_logoUrl) {
      try {
        const img = await _loadImage(_logoUrl);
        pdf.addImage(img, "PNG", margin, y, 30, 15);
        y += 18;
      } catch { /* sem logo — silencioso */ }
    }

    // Cabeçalho
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text(_sessao.nomeEmpresa || "Empresa", W / 2, y, { align: "center" });
    y += 8;
    pdf.setFontSize(12);
    pdf.setFont("helvetica", "normal");
    pdf.text(`Folha de Pagamento — ${_mesPtBR(_mesAtivo)}`, W / 2, y, { align: "center" });
    y += 12;

    // Dados do colaborador
    pdf.setDrawColor(220);
    pdf.line(margin, y, W - margin, y);
    y += 6;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text("Colaborador", margin, y);
    y += 6;
    pdf.setFont("helvetica", "normal");
    pdf.text(`Nome: ${colab.nome}`, margin, y);
    y += 5;
    pdf.text(`Cargo: ${colab.cargo || "—"}   CPF: ${colab.cpf || "—"}`, margin, y);
    y += 10;

    // Tabela de valores
    pdf.line(margin, y, W - margin, y);
    y += 6;
    const cols = [
      ["Dias trabalhados", String(lanc.diasTrabalhados)],
      ["Valor diária",     formatarMoeda(lanc.valorDiaria)],
      ["Total bruto",      formatarMoeda(lanc.totalBruto)],
      ["Adiantamento",     formatarMoeda(lanc.adiantamento)],
    ];
    cols.forEach(([label, val]) => {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.text(label, margin, y);
      pdf.text(val, W - margin, y, { align: "right" });
      y += 7;
    });
    pdf.line(margin, y, W - margin, y);
    y += 7;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.text("Líquido Final", margin, y);
    pdf.text(formatarMoeda(lanc.liquidoFinal), W - margin, y, { align: "right" });
    y += 12;

    // Rodapé
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(150);
    const hoje = new Date();
    pdf.text(
      `Gerado em ${hoje.toLocaleDateString("pt-BR")} às ${hoje.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
      W / 2, 285, { align: "center" }
    );

    // Upload no Storage
    const pdfBlob = pdf.output("blob");
    const storage = getStorage();
    const storagePath = `empresas/${_empresaId}/folha/${_mesAtivo}-${colabId}.pdf`;
    const fileRef = ref(storage, storagePath);
    await uploadBytes(fileRef, pdfBlob, { contentType: "application/pdf" });
    const pdfUrl = await getDownloadURL(fileRef);

    // Salvar URL no lançamento
    await updateDoc(doc(db, "empresas", _empresaId, "folha", lanc._id), { pdfUrl });
    _lancs[colabId] = { ...lanc, pdfUrl };

    // Abrir PDF em nova aba
    window.open(pdfUrl, "_blank");
    notificar("sucesso", "PDF gerado", `Folha de ${colab.nome} salva com sucesso.`);
  } catch (e) {
    registrarErro("storage", e.message, "folhaPagamento.js");
    notificar("erro", "Erro ao gerar PDF", "Tente novamente.");
  } finally {
    if (btn) { btn.textContent = "📄 PDF"; btn.disabled = false; }
  }
}

function _loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

// ── Exportar CSV ──────────────────────────────────────────────────────────────
function _exportarCSV() {
  const dados = _colabs.map(c => {
    const l = _lancs[c.id];
    return {
      nomeColab:       c.nome,
      cargo:           c.cargo || "",
      mes:             _mesPtBR(_mesAtivo),
      valorDiaria:     l?.valorDiaria     ?? 0,
      diasTrabalhados: l?.diasTrabalhados ?? 0,
      totalBruto:      l?.totalBruto      ?? 0,
      adiantamento:    l?.adiantamento    ?? 0,
      liquidoFinal:    l?.liquidoFinal    ?? 0,
      pago:            l?.pago ? "Sim" : "Não",
    };
  });
  if (!dados.length) { notificar("aviso", "Sem dados", "Nenhum colaborador para exportar."); return; }
  _downloadCSV(dados, _mesAtivo);
}
