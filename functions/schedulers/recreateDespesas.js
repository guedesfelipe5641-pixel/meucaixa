const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const {version: _versaoApp} = require("../package.json");

const db = admin.firestore();

// Converte "DD/MM/AAAA" → Date
const parseDateBR = (str) => {
  if (!str || typeof str !== "string") return null;
  const [d, m, a] = str.split("/");
  if (!d || !m || !a) return null;
  return new Date(`${a}-${m}-${d}T00:00:00`);
};

// Formata Date → "DD/MM/AAAA"
const formatDateBR = (date) => {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const a = date.getFullYear();
  return `${d}/${m}/${a}`;
};

exports.recreateDespesasRecorrentes = onSchedule(
    {
      schedule: "0 6 1 * *",
      timeZone: "America/Sao_Paulo",
    },
    async () => {
      // Mês anterior: se estamos no dia 1 do mês M, recria as do mês M-1
      const ref = new Date();
      ref.setDate(0); // último dia do mês anterior → mês M-1
      const mesAnteriorNum = ref.getMonth(); // 0-11
      const anoAnterior = ref.getFullYear();

      const empresasSnap = await db.collection("empresas").get();

      for (const empresaDoc of empresasSnap.docs) {
        const empresaId = empresaDoc.id;

        try {
          const snap = await db.collection("empresas")
              .doc(empresaId).collection("despesas")
              .where("recorrente", "==", true)
              .get();

          if (snap.empty) continue;

          const batch = db.batch();
          let count = 0;

          for (const doc of snap.docs) {
            const d = doc.data();

            // Verificar se a despesa é do mês anterior
            const dtOriginal = parseDateBR(d.dataVenc);
            if (!dtOriginal) continue;
            if (
              dtOriginal.getMonth() !== mesAnteriorNum ||
              dtOriginal.getFullYear() !== anoAnterior
            ) continue;

            // Calcular novo vencimento: mesmo diaRecorr no mês atual
            const diaVenc = d.diaRecorr || dtOriginal.getDate();
            const hoje = new Date();
            const novaData = new Date(
                hoje.getFullYear(), hoje.getMonth(), diaVenc,
            );
            // Se o dia não existe no mês (ex: 31 em fevereiro), JS avança
            // automaticamente — comportamento aceitável para recorrentes.

            const novaRef = db.collection("empresas")
                .doc(empresaId).collection("despesas").doc();

            batch.set(novaRef, {
              nome: d.nome,
              valor: d.valor,
              dataVenc: formatDateBR(novaData),
              categoria: d.categoria || "",
              recorrente: true,
              diaRecorr: diaVenc,
              pago: false,
              pagoEm: null,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            count++;
          }

          if (count > 0) await batch.commit();
        } catch (err) {
          await db.collection("erros_sistema").add({
            tipo: "scheduler",
            mensagem: err.message,
            modulo: "recreateDespesas",
            empresaId,
            usuarioId: null,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            versaoApp: _versaoApp,
          });
        }
      }
    },
);
