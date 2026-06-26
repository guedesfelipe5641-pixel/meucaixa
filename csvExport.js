// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · csvExport.js · Módulo 15/16                       ║
// ║  Exportação CSV — separador ";", UTF-8 com BOM, blob download  ║
// ╚══════════════════════════════════════════════════════════════════╝

// ── Helpers internos ──────────────────────────────────────────────────────────
function _esc(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function _gerarCSV(headers, rows) {
  const bom  = "﻿";
  const head = headers.map(_esc).join(";");
  const body = rows.map(r => r.map(_esc).join(";")).join("\r\n");
  return bom + head + "\r\n" + body;
}

function _download(conteudo, nomeArquivo) {
  const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function _fmtVal(v) {
  return typeof v === "number" ? v.toFixed(2).replace(".", ",") : "";
}

function _fmtTs(ts) {
  if (!ts) return "";
  const d = ts?.toDate ? ts.toDate() : new Date(ts?.seconds ? ts.seconds * 1000 : ts);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

// ── Exportações públicas ──────────────────────────────────────────────────────

/**
 * Exporta lista de despesas para CSV.
 * @param {Array<{id:string, dados:Object}>} despesas
 * @param {string} periodo  – rótulo do período para o nome do arquivo
 */
export function exportarDespesas(despesas, periodo = "") {
  const headers = ["Nome", "Categoria", "Valor (R$)", "Vencimento", "Status", "Pago em", "Recorrente", "Dia Recorr."];
  const rows    = despesas.map(({ dados: d }) => [
    d.nome        || "",
    d.categoria   || "",
    _fmtVal(d.valor),
    d.dataVenc    ? d.dataVenc.replace(/\//g, ".")        : "",
    d.pago ? "Paga" : _statusLabel(d),
    d.pagoEm      ? _fmtTs(d.pagoEm).replace(/\//g, ".") : "",
    d.recorrente  ? "Sim" : "Não",
    d.diaRecorr   ?? "",
  ]);
  const sufixo  = periodo ? `_${periodo.replace(/\//g, "-")}` : "";
  _download(_gerarCSV(headers, rows), `despesas${sufixo}.csv`);
}

/**
 * Exporta lista de vendas para CSV.
 * @param {Array<Object>} vendas  – documentos Firestore (dados brutos)
 * @param {string} periodo
 */
export function exportarVendas(vendas, periodo = "") {
  const headers = ["Código", "Data/Hora", "Total Bruto (R$)", "Desconto (R$)", "Total Líquido (R$)", "Forma Pgto.", "Cancelada", "Operador"];
  const rows    = vendas.map(v => [
    v.codigo          || "",
    _fmtTs(v.createdAt),
    _fmtVal(v.totalBruto),
    _fmtVal(v.descontoValor || 0),
    _fmtVal(v.totalLiquido),
    v.formaPagamento  || "",
    v.cancelada       ? "Sim" : "Não",
    v.operadorNome    || v.operadorId || "",
  ]);
  const sufixo = periodo ? `_${periodo.replace(/\//g, "-")}` : "";
  _download(_gerarCSV(headers, rows), `vendas${sufixo}.csv`);
}

/**
 * Exporta resumo DRE para CSV.
 * @param {{ receitaBruta, descontos, custo, margemBruta, despesasTotal, lucroReal }} dre
 * @param {string} periodo
 */
export function exportarFluxo(dre, periodo = "") {
  const headers = ["Indicador", "Valor (R$)"];
  const rows = [
    ["Receita Bruta",         _fmtVal(dre.receitaBruta)],
    ["(-) Descontos",         _fmtVal(dre.descontos)],
    ["(-) Custo dos Produtos",_fmtVal(dre.custo)],
    ["(=) Margem Bruta",      _fmtVal(dre.margemBruta)],
    ["(-) Despesas Oper.",    _fmtVal(dre.despesasTotal)],
    ["(=) Lucro Real",        _fmtVal(dre.lucroReal)],
  ];
  const sufixo = periodo ? `_${periodo.replace(/\//g, "-")}` : "";
  _download(_gerarCSV(headers, rows), `dre${sufixo}.csv`);
}

/**
 * Exporta folha de pagamento mensal para CSV.
 * @param {Array<Object>} lancamentos
 * @param {string} mes  – "YYYY-MM"
 */
export function exportarFolha(lancamentos, mes = "") {
  const headers = ["Colaborador", "Cargo", "Mês", "Diária (R$)", "Dias", "Total Bruto (R$)", "Adiantamento (R$)", "Líquido Final (R$)", "Pago"];
  const rows = lancamentos.map(l => [
    l.nomeColab      || "",
    l.cargo          || "",
    l.mes            || "",
    _fmtVal(l.valorDiaria),
    String(l.diasTrabalhados ?? ""),
    _fmtVal(l.totalBruto),
    _fmtVal(l.adiantamento),
    _fmtVal(l.liquidoFinal),
    l.pago           || "Não",
  ]);
  const sufixo = mes ? `_${mes}` : "";
  _download(_gerarCSV(headers, rows), `folha${sufixo}.csv`);
}

// ── Helper interno de label ───────────────────────────────────────────────────
function _statusLabel(dep) {
  if (!dep.dataVenc) return "Pendente";
  const [d, m, a] = dep.dataVenc.split("/");
  const venc = new Date(+a, +m - 1, +d);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const diff = Math.round((venc - hoje) / 86400000);
  if (diff < 0)  return "Vencida";
  if (diff <= 3) return "Vence em breve";
  return "Pendente";
}
