const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const {templateBase, enviarEmail, resendApiKey} =
  require("../emailHelper");
const {version: _versaoApp} = require("../package.json");

const db = admin.firestore();

const formatarData = (ts) => {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("pt-BR");
};

const formatarMoeda = (v) =>
  Number(v || 0).toLocaleString("pt-BR", {style: "currency", currency: "BRL"});

const _amanha = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
};

const _amanhaFim = () => {
  const d = _amanha();
  d.setHours(23, 59, 59, 999);
  return d;
};

const _empresasAtivas = async () => {
  const snap = await db.collection("empresas")
      .where("plano", "==", "profissional")
      .get();
  const hoje = Date.now();
  return snap.docs.filter((doc) => {
    const d = doc.data();
    if (d.assinaturaAtiva === true && d.status === "ativo") return true;
    if (!d.assinaturaAtiva && d.trialExpira) {
      const exp = d.trialExpira.toDate ?
        d.trialExpira.toDate() : new Date(d.trialExpira);
      return exp.getTime() > hoje;
    }
    return false;
  });
};

const _alertasParaEmpresa = async (empresaId) => {
  const ini = admin.firestore.Timestamp.fromDate(_amanha());
  const fim = admin.firestore.Timestamp.fromDate(_amanhaFim());

  const credSnap = await db.collection("empresas")
      .doc(empresaId).collection("crediario")
      .where("status", "!=", "quitado")
      .get();

  const alertas = [];
  for (const credDoc of credSnap.docs) {
    const cred = credDoc.data();
    const parcelasSnap = await db
        .collection("empresas").doc(empresaId)
        .collection("crediario").doc(credDoc.id)
        .collection("parcelas")
        .where("status", "!=", "pago")
        .where("dataVencimento", ">=", ini)
        .where("dataVencimento", "<=", fim)
        .get();

    for (const parcelaDoc of parcelasSnap.docs) {
      const p = parcelaDoc.data();
      if (p.avisadoEm) continue;
      alertas.push({
        parcelaRef: parcelaDoc.ref,
        clienteNome: cred.clienteNome || "—",
        numero: p.numero,
        valorAtual: p.valorAtual,
        dataVencimento: p.dataVencimento,
      });
    }
  }
  return alertas;
};

const _htmlTabela = (alertas) => {
  const linhas = alertas.map((a) => `
    <tr>
      <td>${a.clienteNome}</td>
      <td>Parcela ${a.numero}</td>
      <td>${formatarMoeda(a.valorAtual)}</td>
      <td>${formatarData(a.dataVencimento)}</td>
    </tr>`).join("");

  return `
    <h2>⚠️ Alertas de Crediário</h2>
    <p>As seguintes parcelas <strong>vencem amanhã</strong>:</p>
    <table>
      <thead>
        <tr>
          <th>Cliente</th><th>Parcela</th><th>Valor</th><th>Vencimento</th>
        </tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>
    <p style="font-size:13px;color:#666">
      Acesse o app para registrar recebimentos e manter o crediário em dia.
    </p>
    <a href="https://meucaixa.tec.br" class="btn">Abrir MeuCaixa</a>`;
};

exports.crediarioAlerts = onSchedule(
    {
      schedule: "0 8 * * *",
      timeZone: "America/Sao_Paulo",
      secrets: [resendApiKey],
    },
    async () => {
      const empresas = await _empresasAtivas();

      for (const empresaDoc of empresas) {
        const empresaId = empresaDoc.id;
        const data = empresaDoc.data();
        const destino = data.emailAlerta || data.email;
        if (!destino) continue;

        try {
          const alertas = await _alertasParaEmpresa(empresaId);
          if (alertas.length === 0) continue;

          await enviarEmail(
              destino,
              `MeuCaixa · ${alertas.length} parcela(s) vencem amanhã`,
              templateBase(_htmlTabela(alertas)),
          );

          const batch = db.batch();
          alertas.forEach(({parcelaRef}) => {
            batch.update(parcelaRef, {
              avisadoEm: admin.firestore.FieldValue.serverTimestamp(),
            });
          });
          await batch.commit();
        } catch (err) {
          await db.collection("erros_sistema").add({
            tipo: "scheduler",
            mensagem: err.message,
            modulo: "crediarioAlerts",
            empresaId,
            usuarioId: null,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            versaoApp: _versaoApp,
          });
        }
      }
    },
);
