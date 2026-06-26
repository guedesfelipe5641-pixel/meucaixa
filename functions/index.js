const {setGlobalOptions} = require("firebase-functions");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onDocumentUpdated} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({maxInstances: 10});

const {templateBase, enviarEmail, resendApiKey} = require("./emailHelper");
const {version: _versaoApp} = require("./package.json");

// ─── Stripe ──────────────────────────────────────────────────────────────────
const {stripeWebhook} = require("./stripe/webhookHandler");
const {criarCheckout} = require("./stripe/criarCheckout");
const {criarPortal} = require("./stripe/criarPortal");

exports.stripeWebhook = stripeWebhook;
exports.criarCheckout = criarCheckout;
exports.criarPortal = criarPortal;

// ─── Schedulers ──────────────────────────────────────────────────────────────
const {crediarioAlerts} = require("./schedulers/crediarioAlerts");
const {despesaAlerts} = require("./schedulers/despesaAlerts");
const {recreateDespesasRecorrentes} =
  require("./schedulers/recreateDespesas");

exports.crediarioAlerts = crediarioAlerts;
exports.despesaAlerts = despesaAlerts;
exports.recreateDespesasRecorrentes = recreateDespesasRecorrentes;

// ─── Helpers de e-mail ───────────────────────────────────────────────────────
const _gravarErro = async (mensagem, modulo, empresaId = null) => {
  try {
    await admin.firestore().collection("erros_sistema").add({
      tipo: "email",
      mensagem,
      modulo,
      empresaId,
      usuarioId: null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      versaoApp: _versaoApp,
    });
  } catch (_) {
    // ignore logging errors
  }
};

// ─── cadastrarOperador ───────────────────────────────────────────────────────
exports.cadastrarOperador = onCall(
    {secrets: [resendApiKey]},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Autenticação necessária.");
      }

      const {nome, email, empresaId} = request.data;

      if (!nome || !email || !empresaId) {
        throw new HttpsError(
            "invalid-argument",
            "nome, email e empresaId são obrigatórios.",
        );
      }

      if (request.auth.uid !== empresaId) {
        throw new HttpsError("permission-denied", "Acesso negado.");
      }

      const db = admin.firestore();
      const snap = await db.collection("usuarios")
          .where("empresaId", "==", empresaId)
          .where("perfil", "==", "operador")
          .get();

      if (snap.size >= 2) {
        throw new HttpsError(
            "resource-exhausted",
            "Limite de 2 operadores atingido.",
        );
      }

      try {
        await admin.auth().getUserByEmail(email);
        throw new HttpsError(
            "already-exists",
            "Este e-mail já possui uma conta.",
        );
      } catch (err) {
        if (err.code !== "auth/user-not-found") throw err;
      }

      const userRecord = await admin.auth().createUser({
        email,
        displayName: nome,
        emailVerified: false,
      });

      await db.collection("usuarios").doc(userRecord.uid).set({
        uid: userRecord.uid,
        empresaId,
        nome,
        email,
        perfil: "operador",
        superAdmin: false,
        ativo: true,
        permiteVendaOffline: true,
        descontoPermitido: "ambos",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const resetLink = await admin.auth().generatePasswordResetLink(email);

      await db.collection("empresas").doc(empresaId)
          .collection("convites").add({
            operadorUid: userRecord.uid,
            email,
            nome,
            resetLink,
            enviadoEm: admin.firestore.FieldValue.serverTimestamp(),
          });

      // E-mail de convite para o operador
      try {
        const empresaDoc = await db.collection("empresas").doc(empresaId).get();
        const nomeEmpresa =
          (empresaDoc.data() || {}).nomeEmpresa || "sua loja";

        const html = templateBase(`
          <h2>Você foi convidado para o MeuCaixa!</h2>
          <p>Olá, <strong>${nome}</strong>!</p>
          <p>Você foi adicionado como operador em
            <strong>${nomeEmpresa}</strong>.</p>
          <p>Clique abaixo para criar sua senha e acessar o sistema:</p>
          <a href="${resetLink}" class="btn">Criar minha senha</a>
          <p style="font-size:12px;color:#888;margin-top:24px">
            Este link expira em 24 horas. Se você não solicitou este acesso,
            ignore este e-mail.
          </p>`);

        await enviarEmail(email, "MeuCaixa · Você foi convidado!", html);
      } catch (err) {
        await _gravarErro(err.message, "cadastrarOperador-email", empresaId);
      }

      return {uid: userRecord.uid, resetLink};
    },
);

// ─── Trigger: boas-vindas (trialInicio definido pela 1ª vez) ─────────────────
exports.emailBoasVindas = onDocumentUpdated(
    {document: "empresas/{empresaId}", secrets: [resendApiKey]},
    async (event) => {
      const antes = event.data.before.data();
      const depois = event.data.after.data();

      // Dispara apenas quando trialInicio passa de ausente para presente
      if (antes.trialInicio || !depois.trialInicio) return;

      const empresaId = event.params.empresaId;
      const destino = depois.email;
      if (!destino) return;

      const planoLabel = depois.plano === "profissional" ?
        "Profissional" : "Standard";

      const html = templateBase(`
        <h2>🎉 Bem-vindo ao MeuCaixa!</h2>
        <p>Olá, <strong>${depois.nomeEmpresa || "lojista"}</strong>!</p>
        <p>Seu e-mail foi confirmado e seu <strong>período gratuito de
          30 dias</strong> no plano <strong>${planoLabel}</strong> começou
          agora.</p>
        <div class="alert">
          Durante o trial você tem acesso a todos os recursos do plano —
          explore à vontade!
        </div>
        <p>Acesse o app e comece a usar:</p>
        <a href="https://meucaixa.tec.br" class="btn">Abrir MeuCaixa</a>
        <p style="font-size:12px;color:#888;margin-top:24px">
          Dúvidas? Fale conosco pelo WhatsApp
          <a href="https://wa.me/5522988183651">+55 22 98818-3651</a>
        </p>`);

      try {
        await enviarEmail(
            destino,
            "Bem-vindo ao MeuCaixa! Seu período gratuito começou 🎉",
            html,
        );
      } catch (err) {
        await _gravarErro(err.message, "emailBoasVindas", empresaId);
      }
    },
);

// ─── Trigger: suspensão e reativação ─────────────────────────────────────────
exports.emailStatusEmpresa = onDocumentUpdated(
    {document: "empresas/{empresaId}", secrets: [resendApiKey]},
    async (event) => {
      const antes = event.data.before.data();
      const depois = event.data.after.data();

      if (antes.status === depois.status) return;

      const empresaId = event.params.empresaId;
      const destino = depois.email;
      if (!destino) return;

      let assunto = "";
      let html = "";

      if (depois.status === "suspenso" && antes.status !== "suspenso") {
        assunto = "MeuCaixa · Conta suspensa — regularize para continuar";
        html = templateBase(`
          <h2>⚠️ Sua conta foi suspensa</h2>
          <p>Olá, <strong>${depois.nomeEmpresa || "lojista"}</strong>.</p>
          <p>Sua conta no MeuCaixa foi suspensa. Você ainda pode visualizar
            seus dados, mas novas operações estão bloqueadas.</p>
          <div class="alert danger">
            Você tem <strong>48 horas</strong> de carência antes do bloqueio
            total. Regularize sua assinatura para retomar o acesso completo.
          </div>
          <a href="https://meucaixa.tec.br" class="btn">Regularizar agora</a>
          <p style="font-size:12px;color:#888;margin-top:24px">
            Dúvidas? WhatsApp
            <a href="https://wa.me/5522988183651">+55 22 98818-3651</a>
          </p>`);
      } else if (
        depois.status === "ativo" &&
        (antes.status === "suspenso" || antes.status === "cancelado")
      ) {
        assunto = "MeuCaixa · Conta reativada com sucesso!";
        html = templateBase(`
          <h2>✅ Sua conta foi reativada!</h2>
          <p>Olá, <strong>${depois.nomeEmpresa || "lojista"}</strong>!</p>
          <p>Sua conta no MeuCaixa está ativa novamente. Você já pode usar
            todos os recursos normalmente.</p>
          <a href="https://meucaixa.tec.br" class="btn">Acessar o app</a>`);
      }

      if (!assunto) return;

      try {
        await enviarEmail(destino, assunto, html);
      } catch (err) {
        await _gravarErro(err.message, "emailStatusEmpresa", empresaId);
      }
    },
);

// ─── limparDadosCancelados ───────────────────────────────────────────────────
exports.limparDadosCancelados = onSchedule(
    {schedule: "0 3 * * *", timeZone: "America/Sao_Paulo"},
    async () => {
      const db = admin.firestore();
      const limite = new Date();
      limite.setDate(limite.getDate() - 90);

      const snap = await db.collection("empresas")
          .where("status", "==", "cancelado")
          .where("dataInicioContagem90Dias", "<", limite)
          .get();

      if (snap.empty) return;

      const SUBCOLS = [
        "clientes", "fornecedores", "colaboradores", "produtos",
        "estoque", "vendas", "caixa", "crediario", "despesas",
        "folha", "recibos", "comandos", "status", "sync_control",
        "convites",
      ];

      for (const empresaDoc of snap.docs) {
        const empresaRef = empresaDoc.ref;
        for (const sub of SUBCOLS) {
          const subSnap = await empresaRef.collection(sub).get();
          const batch = db.batch();
          subSnap.docs.forEach((d) => batch.delete(d.ref));
          if (!subSnap.empty) await batch.commit();
        }
        await empresaRef.delete();
        try {
          await admin.auth().deleteUser(empresaDoc.id);
        } catch (_) {
          // usuário pode não existir no Auth
        }
        try {
          await db.collection("usuarios").doc(empresaDoc.id).delete();
        } catch (_) {
          // documento pode não existir
        }
      }
    },
);
