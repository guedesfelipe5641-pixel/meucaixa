// templates/recibo_eletronicos.js
// Exporta gerarHTML(dados) → string HTML completa para jsPDF.html()
// dados: { empresa: { logoBase64, nomeEmpresa, cnpj, responsavel, endereco, cidade, email, telefone },
//          doc:     { nomeCliente, cpfCnpj, nascimento?, enderecoCli?, contato?, dataVenda,
//                     descricaoProduto, imei?, quantidade, garantia,
//                     valorUnitario, totalProduto, total,
//                     outroCelular?, especie?, pix?, debito?, credito?, parcelas?,
//                     termosGarantia? (HTML com <br>) } }

export function gerarHTML(dados) {
  const e = dados.empresa;
  const d = dados.doc;

  const esc = s => String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const pgto = v => (v && v !== "R$ 0,00") ? String(v) : "—";

  const creditoCell = (d.credito && d.credito !== "R$ 0,00")
    ? `${d.credito}${d.parcelas ? `<br><small>(${Number(d.parcelas)}x)</small>` : ""}`
    : "—";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;900&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', Arial, sans-serif; font-size: 10pt; color: #1A1A1A; background: #fff; width: 100%; }

  .logo-block { text-align: center; padding: 28px 20px 10px; }
  .logo-block img { max-height: 64px; max-width: 260px; object-fit: contain; }
  .logo-fallback { font-size: 20pt; font-weight: 700; color: #1A1A1A; }

  .divider { border: none; border-top: 2px solid #1A1A1A; margin: 10px 20px 0; }
  .divider-thin { border: none; border-top: 1px solid #CCCCCC; margin: 0 20px; }

  .titulo-recibo {
    text-align: center; font-size: 20pt; font-weight: 700;
    padding: 14px 20px; letter-spacing: 1px;
    border-bottom: 2px solid #1A1A1A; margin: 0 20px;
  }

  .info-block { display: flex; justify-content: space-between; padding: 16px 20px 12px; gap: 20px; }
  .info-cliente { flex: 1; }
  .info-empresa { text-align: right; flex-shrink: 0; }
  .info-linha { font-size: 9pt; margin-bottom: 3px; color: #1A1A1A; }
  .info-linha strong { font-weight: 600; }
  .info-empresa .info-linha { font-size: 8.5pt; color: #333; }
  .info-empresa .empresa-nome { font-weight: 700; font-size: 10pt; color: #1A1A1A; }
  .info-empresa .empresa-email { color: #0066CC; text-decoration: underline; }
  .data-venda-linha { font-weight: 700; font-size: 9.5pt; margin-top: 4px; }

  .tabela-wrapper { padding: 0 20px; }
  .tabela-produto { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 9pt; }
  .tabela-produto thead tr { border-bottom: 1.5px solid #1A1A1A; }
  .tabela-produto thead th {
    padding: 8px 6px; text-align: left; font-weight: 600;
    font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.3px;
  }
  .tabela-produto tbody tr { border-bottom: 1px solid #EEEEEE; }
  .tabela-produto tbody td { padding: 10px 6px; vertical-align: top; }
  .produto-nome { font-weight: 600; }
  .produto-imei { font-size: 8pt; color: #555; margin-top: 2px; }
  .tabela-produto tfoot td {
    padding: 8px 6px; font-weight: 700;
    border-top: 1.5px solid #1A1A1A; text-align: right;
  }
  .col-produto { width: 45%; }
  .col-qnt     { width: 8%;  text-align: center; }
  .col-garantia{ width: 15%; text-align: center; }
  .col-valor   { width: 16%; text-align: right; }
  .col-total   { width: 16%; text-align: right; }

  .pgto-section { padding: 12px 20px 0; }
  .pgto-title {
    font-size: 8.5pt; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.5px; margin-bottom: 6px; color: #333;
  }
  .tabela-pgto { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .tabela-pgto th {
    padding: 7px 6px; text-align: center; font-weight: 600; font-size: 8pt;
    background: #F5F5F5; border: 1px solid #DDDDDD;
    text-transform: uppercase; letter-spacing: 0.3px;
  }
  .tabela-pgto td { padding: 8px 6px; text-align: center; border: 1px solid #DDDDDD; }
  .tabela-pgto td.total-cell { font-weight: 700; font-size: 10pt; }

  .termos-section {
    margin: 14px 20px 0; border: 1px solid #CCCCCC;
    border-radius: 4px; padding: 14px;
  }
  .termos-title {
    font-size: 10pt; font-weight: 700; text-align: center;
    margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;
  }
  .termos-body { font-size: 7.5pt; color: #333; line-height: 1.55; word-break: break-word; }

  .assinaturas {
    display: flex; justify-content: space-between;
    padding: 52px 40px 6px; gap: 60px; margin-top: 8px;
  }
  .assinatura-bloco { flex: 1; text-align: center; }
  .assinatura-nome { font-style: italic; font-size: 9pt; font-weight: 500; margin-bottom: 4px; }
  .assinatura-linha { border-top: 1px solid #1A1A1A; margin: 0 0 4px; }
  .assinatura-label { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #555; }

  .rodape { text-align: right; padding: 6px 20px 24px; font-style: italic; font-size: 8.5pt; color: #555; }
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

<div class="titulo-recibo">RECIBO DE VENDA</div>

<div class="info-block">
  <div class="info-cliente">
    <div class="info-linha"><strong>CLIENTE:</strong> ${esc(d.nomeCliente)}</div>
    <div class="info-linha"><strong>CPF/CNPJ:</strong> ${esc(d.cpfCnpj)}</div>
    ${d.nascimento ? `<div class="info-linha"><strong>DATA DE NASCIMENTO:</strong> ${esc(d.nascimento)}</div>` : ""}
    ${d.enderecoCli ? `<div class="info-linha"><strong>ENDEREÇO:</strong> ${esc(d.enderecoCli)}</div>` : ""}
    ${d.contato ? `<div class="info-linha"><strong>CONTATO:</strong> ${esc(d.contato)}</div>` : ""}
    <div class="info-linha data-venda-linha"><strong>DATA DE VENDA:</strong> ${esc(d.dataVenda)}</div>
  </div>
  <div class="info-empresa">
    <div class="info-linha empresa-nome">${esc(e.nomeEmpresa)}</div>
    ${e.cnpj ? `<div class="info-linha">CNPJ: ${esc(e.cnpj)}</div>` : ""}
    ${e.responsavel ? `<div class="info-linha">${esc(e.responsavel)}</div>` : ""}
    ${e.endereco ? `<div class="info-linha">${esc(e.endereco)}</div>` : ""}
    ${e.cidade ? `<div class="info-linha">${esc(e.cidade)}</div>` : ""}
    ${e.email ? `<div class="info-linha empresa-email">${esc(e.email)}</div>` : ""}
    ${e.telefone ? `<div class="info-linha">${esc(e.telefone)}</div>` : ""}
  </div>
</div>

<hr class="divider-thin">

<div class="tabela-wrapper">
  <table class="tabela-produto">
    <thead>
      <tr>
        <th class="col-produto">Produto</th>
        <th class="col-qnt">QNT</th>
        <th class="col-garantia">Garantia</th>
        <th class="col-valor">Valor Unit.</th>
        <th class="col-total">Total</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="col-produto">
          <div class="produto-nome">${esc(d.descricaoProduto)}</div>
          ${d.imei ? `<div class="produto-imei">IMEI/MEID: ${esc(d.imei)}</div>` : ""}
        </td>
        <td class="col-qnt" style="text-align:center">${esc(String(d.quantidade))}</td>
        <td class="col-garantia" style="text-align:center">${esc(d.garantia)}</td>
        <td class="col-valor" style="text-align:right">${d.valorUnitario}</td>
        <td class="col-total" style="text-align:right">${d.totalProduto}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3" style="text-align:right;padding-right:12px">Total:</td>
        <td colspan="2" style="text-align:right">${d.totalProduto}</td>
      </tr>
    </tfoot>
  </table>
</div>

<div class="pgto-section">
  <div class="pgto-title">Forma de Pagamento</div>
  <table class="tabela-pgto">
    <thead>
      <tr>
        <th>Outro Celular</th>
        <th>Espécie</th>
        <th>PIX</th>
        <th>Débito</th>
        <th>Crédito</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${pgto(d.outroCelular)}</td>
        <td>${pgto(d.especie)}</td>
        <td>${pgto(d.pix)}</td>
        <td>${pgto(d.debito)}</td>
        <td>${creditoCell}</td>
        <td class="total-cell">${d.total}</td>
      </tr>
    </tbody>
  </table>
</div>

${d.termosGarantia ? `
<div class="termos-section">
  <div class="termos-title">Termos de Garantia</div>
  <div class="termos-body">${d.termosGarantia}</div>
</div>` : ""}

<div class="assinaturas">
  <div class="assinatura-bloco">
    ${d.nomeCliente ? `<div class="assinatura-nome">${esc(d.nomeCliente)}</div>` : ""}
    <div class="assinatura-linha"></div>
    <div class="assinatura-label">Cliente</div>
  </div>
  <div class="assinatura-bloco">
    ${e.responsavel ? `<div class="assinatura-nome">${esc(e.responsavel)}</div>` : ""}
    <div class="assinatura-linha"></div>
    <div class="assinatura-label">Vendedor</div>
  </div>
</div>

<div class="rodape">${e.cidade ? esc(e.cidade) + ", " : ""}${esc(d.dataVenda)}</div>

</body>
</html>`;
}
