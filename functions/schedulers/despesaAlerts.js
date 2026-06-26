const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const {templateBase, enviarEmail, resendApiKey} =
  require("../emailHelper");
const {version: _versaoApp} = require("../package.json");

const db = admin.firestore();

const formatarMoeda = (v) =>
  Number(v || 0).toLocaleString("pt-BR", {style: "currency", currency: "BRL"});

// Converte "DD/MM/AAAA" → Date (meia-noite local)
const parseDateBR = (str) => {
  if (!str || typeof str !== "string") return null;
  const [d, m, a] = str.split("/");
  if (!d || !m || !a) return null;
  return new Date(`${a}-${m}-${d}T00:00:00`);
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

const _despesasAlertaveis = async (empresaId) => {
  const alvo = new Date();
  alvo.setDate(alvo.getDate() + 3);
  alvo.setHours(23, 59, 59, 999);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const snap = await db.collection("empresas")
      .doc(empresaId).collection("despesas")
      .where("pago", "==", false)
      .get();

  return snap.docs
      .map((doc) => ({id: doc.id, ...doc.data()}))
      .filter((d) => {
        const dt = parseDateBR(d.dataVenc);
        if (!dt) return false;
        return dt >= hoje && dt <= alvo;
      })
      .sort((a, b) => {
        const da = parseDateBR(a.dataVenc);
        const db2 = parseDateBR(b.dataVenc);
        return (da ? da.getTime() : 0) - (db2 ? db2.getTime() : 0);
      });
};

const CATEGORIAS = {
  aluguel: "Aluguel",
  energia: "Energia",
  agua: "Água",
  internet: "Internet",
  fornecedor: "Fornecedor",
  folha: "Folha",
  imposto: "Imposto",
  outro: "Outro",
};

const _htmlTabela = (despesas) => {
  const linhas = despesas.map((d) => `
    <tr>
      <td>${d.nome}</td>
      <td>${CATEGORIAS[d.categoria] || d.categoria || "—"}</td>
      <td>${formatarMoeda(d.valor)}</td>
      <td>${d.dataVenc}</td>
    </tr>`).join("");

  return `
    <h2>📋 Despesas vencendo em breve</h2>
    <p>Você tem <strong>${despesas.length} despesa(s)</strong>
      com vencimento nos próximos 3 dias:</p>
    <table>
      <thead>
        <tr>
          <th>Despesa</th><th>Categoria</th><th>Valor</th><th>Vencimento</th>
        </tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>
    <p style="font-size:13px;color:#666">
      Acesse o app para marcar como pago ou ajustar os lançamentos.
    </p>
    <a href="https://meucaixa.tec.br" class="btn">Abrir MeuCaixa</a>`;
};

exports.despesaAlerts = onSchedule(
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
          const despesas = await _despesasAlertaveis(empresaId);
          if (despesas.length === 0) continue;

          await enviarEmail(
              destino,
              `MeuCaixa · ${despesas.length} despesa(s) vencendo em breve`,
              templateBase(_htmlTabela(despesas)),
          );
        } catch (err) {
          await db.collection("erros_sistema").add({
            tipo: "scheduler",
            mensagem: err.message,
            modulo: "despesaAlerts",
            empresaId,
            usuarioId: null,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            versaoApp: _versaoApp,
          });
        }
      }
    },
);
