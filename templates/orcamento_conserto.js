// templates/orcamento_conserto.js
// Exporta gerarHTML(dados) → string HTML completa para jsPDF.html()
// dados: { empresa: { logoBase64, nomeEmpresa, cnpj, responsavel, endereco, cidade, email, telefone },
//          doc:     { numeroOrcamento, dataOrcamento, dataValidade, validadeDias,
//                     nomeCliente, telefoneCliente?, enderecoCliente?,
//                     equipamento, defeitoRelatado, diagnostico,
//                     itens: [{ descricao, qtd, valorUnit, subtotal }],
//                     subtotal, desconto?, total,
//                     percentualSinal?, valorSinal?,
//                     formasPagamento, validadeDias, observacoes? } }

export function gerarHTML(dados) {
  const e = dados.empresa;
  const d = dados.doc;

  const esc = s => String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const linhasItens = (d.itens || []).map(item => `
    <tr>
      <td class="col-desc">${esc(item.descricao)}</td>
      <td class="col-qnt" style="text-align:center">${esc(String(item.qtd))}</td>
      <td class="col-unit" style="text-align:right">${item.valorUnit}</td>
      <td class="col-sub" style="text-align:right">${item.subtotal}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;900&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', Arial, sans-serif; font-size: 10pt; color: #1A1A1A; background: #fff; width: 100%; }

  .logo-block { text-align: center; padding: 26px 20px 8px; }
  .logo-block img { max-height: 64px; max-width: 260px; object-fit: contain; }
  .logo-fallback { font-size: 20pt; font-weight: 700; color: #1A1A1A; }
  .divider { border: none; border-top: 2px solid #1A1A1A; margin: 8px 20px 0; }

  .titulo-bloco {
    display: flex; justify-content: space-between; align-items: flex-end;
    padding: 14px 20px 12px; border-bottom: 2px solid #1A1A1A; margin: 0 20px;
  }
  .titulo-recibo { font-size: 19pt; font-weight: 700; letter-spacing: .5px; }
  .meta-orcamento { text-align: right; font-size: 8.5pt; color: #444; line-height: 1.5; }
  .meta-orcamento strong { color: #1A1A1A; }

  .info-block { display: flex; justify-content: space-between; padding: 16px 20px 8px; gap: 20px; }
  .info-cliente { flex: 1; }
  .info-empresa { text-align: right; flex-shrink: 0; }
  .info-linha { font-size: 9pt; margin-bottom: 3px; }
  .info-linha strong { font-weight: 600; }
  .info-empresa .info-linha { font-size: 8.5pt; color: #333; }
  .info-empresa .empresa-nome { font-weight: 700; font-size: 10pt; color: #1A1A1A; }
  .info-empresa .empresa-email { color: #0066CC; text-decoration: underline; }

  .categoria-section {
    margin: 6px 20px 0; background: #F8F8F8; border-radius: 6px; padding: 12px 16px;
  }
  .categoria-titulo {
    font-size: 8.5pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: .5px; color: #555; margin-bottom: 8px;
  }
  .categoria-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; }
  .categoria-grid .full { grid-column: 1 / -1; }
  .cat-linha { font-size: 9pt; }
  .cat-linha strong { font-weight: 600; }

  .tabela-wrapper { padding: 14px 20px 0; }
  .tabela-itens { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .tabela-itens thead tr { border-bottom: 1.5px solid #1A1A1A; }
  .tabela-itens thead th {
    padding: 8px 6px; text-align: left; font-weight: 600;
    font-size: 8.5pt; text-transform: uppercase; letter-spacing: .3px;
  }
  .tabela-itens tbody tr { border-bottom: 1px solid #EEEEEE; }
  .tabela-itens tbody td { padding: 9px 6px; vertical-align: top; }
  .col-desc  { width: 52%; }
  .col-qnt   { width: 12%; text-align: center; }
  .col-unit  { width: 18%; text-align: right; }
  .col-sub   { width: 18%; text-align: right; }
  .tabela-itens tfoot td { padding: 7px 6px; font-weight: 600; }
  .linha-subtotal td { border-top: 1px solid #DDDDDD; }
  .linha-desconto td { color: #C62828; }
  .linha-total td { border-top: 1.5px solid #1A1A1A; font-size: 12pt; font-weight: 700; padding-top: 10px; }

  .condicoes-section { margin: 16px 20px 0; border: 1px solid #CCCCCC; border-radius: 4px; padding: 14px 16px; }
  .condicoes-titulo { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 8px; }
  .condicoes-body { font-size: 8.5pt; color: #333; line-height: 1.6; }
  .condicoes-body ul { padding-left: 16px; }
  .condicoes-body li { margin-bottom: 3px; }

  .obs-section { margin: 12px 20px 0; }
  .obs-titulo { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: #555; margin-bottom: 4px; }
  .obs-body { font-size: 9pt; color: #333; line-height: 1.55; }

  .assinaturas { display: flex; justify-content: space-between; padding: 40px 40px 6px; gap: 60px; margin-top: 8px; }
  .assinatura-bloco { flex: 1; text-align: center; }
  .assinatura-nome { font-style: italic; font-size: 9pt; font-weight: 500; margin-bottom: 4px; }
  .assinatura-linha { border-top: 1px solid #1A1A1A; margin: 0 0 4px; }
  .assinatura-label { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: #555; }

  .rodape { text-align: right; padding: 6px 20px 22px; font-style: italic; font-size: 8.5pt; color: #555; }
</style>
</head>
<body>

<div class="logo-block">
  ${e.logoBase64
    ? `<img src="${e.logoBase64}" alt="Logo">`
    : `<div class="logo-fallback">${esc(e.nomeEmpresa)}</div>`
  }
</div>
<hr class="divider">

<div class="titulo-bloco">
  <div class="titulo-recibo">ORÇAMENTO</div>
  <div class="meta-orcamento">
    <div><strong>Nº</strong> ${esc(d.numeroOrcamento)}</div>
    <div><strong>Data:</strong> ${esc(d.dataOrcamento)}</div>
    <div><strong>Válido até:</strong> ${esc(d.dataValidade)}</div>
  </div>
</div>

<div class="info-block">
  <div class="info-cliente">
    <div class="info-linha"><strong>CLIENTE:</strong> ${esc(d.nomeCliente)}</div>
    ${d.telefoneCliente ? `<div class="info-linha"><strong>CONTATO:</strong> ${esc(d.telefoneCliente)}</div>` : ""}
    ${d.enderecoCliente ? `<div class="info-linha"><strong>ENDEREÇO:</strong> ${esc(d.enderecoCliente)}</div>` : ""}
  </div>
  <div class="info-empresa">
    <div class="info-linha empresa-nome">${esc(e.nomeEmpresa)}</div>
    ${e.cnpj ? `<div class="info-linha">CNPJ: ${esc(e.cnpj)}</div>` : ""}
    ${e.responsavel ? `<div class="info-linha">${esc(e.responsavel)}</div>` : ""}
    ${e.endereco ? `<div class="info-linha">${esc(e.endereco)}</div>` : ""}
    ${e.email ? `<div class="info-linha empresa-email">${esc(e.email)}</div>` : ""}
    ${e.telefone ? `<div class="info-linha">${esc(e.telefone)}</div>` : ""}
  </div>
</div>

<div class="categoria-section">
  <div class="categoria-titulo">Detalhes do Equipamento</div>
  <div class="categoria-grid">
    <div class="cat-linha"><strong>Equipamento:</strong> ${esc(d.equipamento)}</div>
    <div class="cat-linha"><strong>Defeito relatado:</strong> ${esc(d.defeitoRelatado)}</div>
    <div class="cat-linha full"><strong>Diagnóstico técnico:</strong> ${esc(d.diagnostico)}</div>
  </div>
</div>

<div class="tabela-wrapper">
  <table class="tabela-itens">
    <thead>
      <tr>
        <th class="col-desc">Descrição</th>
        <th class="col-qnt">Qtd</th>
        <th class="col-unit">Valor Unit.</th>
        <th class="col-sub">Subtotal</th>
      </tr>
    </thead>
    <tbody>${linhasItens}</tbody>
    <tfoot>
      <tr class="linha-subtotal">
        <td colspan="3" style="text-align:right">Subtotal</td>
        <td style="text-align:right">${d.subtotal}</td>
      </tr>
      ${d.desconto ? `
      <tr class="linha-desconto">
        <td colspan="3" style="text-align:right">Desconto</td>
        <td style="text-align:right">− ${d.desconto}</td>
      </tr>` : ""}
      <tr class="linha-total">
        <td colspan="3" style="text-align:right">Total</td>
        <td style="text-align:right">${d.total}</td>
      </tr>
    </tfoot>
  </table>
</div>

<div class="condicoes-section">
  <div class="condicoes-titulo">Condições</div>
  <div class="condicoes-body">
    <ul>
      ${d.percentualSinal ? `<li><strong>Sinal/Entrada:</strong> ${esc(d.percentualSinal)} (${d.valorSinal}) para confirmação do serviço</li>` : ""}
      <li><strong>Formas de pagamento aceitas:</strong> ${esc(d.formasPagamento)}</li>
      <li><strong>Validade da proposta:</strong> ${esc(d.validadeDias)} a partir da data de emissão</li>
    </ul>
  </div>
</div>

${d.observacoes ? `
<div class="obs-section">
  <div class="obs-titulo">Observações</div>
  <div class="obs-body">${esc(d.observacoes)}</div>
</div>` : ""}

<div class="assinaturas">
  <div class="assinatura-bloco">
    <div class="assinatura-nome">${esc(d.nomeCliente)}</div>
    <div class="assinatura-linha"></div>
    <div class="assinatura-label">Aceite do Cliente</div>
  </div>
  <div class="assinatura-bloco">
    ${e.responsavel ? `<div class="assinatura-nome">${esc(e.responsavel)}</div>` : ""}
    <div class="assinatura-linha"></div>
    <div class="assinatura-label">Responsável</div>
  </div>
</div>

<div class="rodape">${e.cidade ? esc(e.cidade) + ", " : ""}${esc(d.dataOrcamento)}</div>

</body>
</html>`;
}
