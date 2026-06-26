const {defineSecret} = require("firebase-functions/params");

const resendApiKey = defineSecret("RESEND_API_KEY");

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"
  viewBox="0 0 160 40">
  <rect width="160" height="40" rx="6" fill="#6B3520"/>
  <text x="12" y="27" font-family="DM Sans,Arial,sans-serif"
    font-size="20" font-weight="700" fill="#F0A335">Meu</text>
  <text x="52" y="27" font-family="DM Sans,Arial,sans-serif"
    font-size="20" font-weight="700" fill="#ffffff">Caixa</text>
</svg>`;

const templateBase = (conteudo) => `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body{margin:0;padding:0;background:#f5f5f5;
      font-family:'DM Sans',Arial,sans-serif}
    .wrap{max-width:600px;margin:32px auto;background:#fff;
      border-radius:8px;overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,.08)}
    .header{background:#6B3520;padding:20px 32px}
    .body{padding:32px;color:#333}
    .footer{background:#f9f9f9;border-top:1px solid #eee;
      padding:14px 32px;text-align:center;font-size:12px;color:#888}
    h2{color:#6B3520;margin-top:0}
    p{line-height:1.6}
    table{width:100%;border-collapse:collapse;margin:16px 0}
    th{background:#6B3520;color:#fff;padding:9px 12px;
      text-align:left;font-size:13px}
    td{padding:9px 12px;border-bottom:1px solid #eee;
      font-size:13px;color:#333}
    tr:last-child td{border-bottom:none}
    .btn{display:inline-block;padding:12px 28px;
      background:#6B3520;color:#fff!important;
      text-decoration:none;border-radius:6px;
      font-weight:600;margin-top:20px}
    .alert{background:#FFF3E0;border-left:4px solid #F0A335;
      padding:12px 16px;border-radius:0 6px 6px 0;
      margin:16px 0;font-size:14px}
    .danger{background:#FFEBEE;border-left:4px solid #C62828}
  </style>
</head>
<body><div class="wrap">
  <div class="header">${LOGO_SVG}</div>
  <div class="body">${conteudo}</div>
  <div class="footer">meucaixa.tec.br &nbsp;·&nbsp;
    FSG Soluções Tecnológicas e Serviços</div>
</div></body></html>`;

// Deve ser chamada de funções que declaram secrets: [resendApiKey].
const enviarEmail = async (to, subject, html) => {
  const {Resend} = require("resend");
  const client = new Resend(resendApiKey.value());
  const {error} = await client.emails.send({
    from: "MeuCaixa <noreply@meucaixa.tec.br>",
    to,
    subject,
    html,
  });
  if (error) throw new Error(`Resend error: ${JSON.stringify(error)}`);
};

module.exports = {templateBase, enviarEmail, resendApiKey};
