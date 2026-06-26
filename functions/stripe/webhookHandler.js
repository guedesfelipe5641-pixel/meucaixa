const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const Stripe = require("stripe");
const {templateBase, enviarEmail, resendApiKey} =
  require("../emailHelper");
const {version: _versaoApp} = require("../package.json");

const stripeSecret = defineSecret("STRIPE_SECRET");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

const db = admin.firestore();

const gravarErro = async (mensagem) => {
  try {
    await db.collection("erros_sistema").add({
      tipo: "webhook",
      mensagem,
      modulo: "stripe-webhook",
      empresaId: null,
      usuarioId: null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      versaoApp: _versaoApp,
    });
  } catch (_) {
    // ignore logging errors
  }
};

const buscarEmpresa = async (subscriptionId) => {
  const snap = await db.collection("empresas")
      .where("stripeSubscriptionId", "==", subscriptionId)
      .limit(1)
      .get();
  return snap.empty ? null : snap.docs[0];
};

// Tenta enviar e-mail sem lançar erro — falha de email não bloqueia o webhook
const tentarEmail = async (to, subject, html) => {
  try {
    await enviarEmail(to, subject, html);
  } catch (err) {
    await gravarErro(`email-send: ${err.message}`);
  }
};

exports.stripeWebhook = onRequest(
    {secrets: [stripeSecret, stripeWebhookSecret, resendApiKey]},
    async (req, res) => {
      const stripe = new Stripe(stripeSecret.value());
      const sig = req.headers["stripe-signature"];
      let event;

      try {
        event = stripe.webhooks.constructEvent(
            req.rawBody, sig, stripeWebhookSecret.value(),
        );
      } catch (err) {
        return res.status(400).send(`Webhook error: ${err.message}`);
      }

      try {
        switch (event.type) {
          case "checkout.session.completed": {
            const session = event.data.object;
            const empresaId = session.metadata.empresaId;
            const sub = await stripe.subscriptions.retrieve(
                session.subscription,
            );
            const dataVenc = new admin.firestore.Timestamp(
                sub.current_period_end, 0,
            );
            await db.collection("empresas").doc(empresaId).update({
              assinaturaAtiva: true,
              plano: session.metadata.plano,
              stripeCustomerId: session.customer,
              stripeSubscriptionId: session.subscription,
              stripeFormaPagamento: session.payment_method_types[0],
              dataVencimento: dataVenc,
              status: "ativo",
            });
            break;
          }

          case "invoice.paid": {
            const invoice = event.data.object;
            const doc = await buscarEmpresa(invoice.subscription);
            if (!doc) break;

            const periodEnd = invoice.lines.data[0].period.end;
            await doc.ref.update({
              dataVencimento: new admin.firestore.Timestamp(periodEnd, 0),
              assinaturaAtiva: true,
              status: "ativo",
            });

            const d = doc.data();
            const destino = d.emailAlerta || d.email;
            const venc = new Date(periodEnd * 1000).toLocaleDateString("pt-BR");
            const planoLabel = d.plano === "profissional" ?
              "Profissional" : "Standard";
            const valor = invoice.amount_paid ?
              (invoice.amount_paid / 100).toLocaleString("pt-BR", {
                style: "currency", currency: "BRL",
              }) : null;

            if (destino) {
              await tentarEmail(
                  destino,
                  "MeuCaixa · Pagamento confirmado ✅",
                  templateBase(`
                    <h2>✅ Pagamento confirmado!</h2>
                    <p>Olá, <strong>${d.nomeEmpresa || "lojista"}</strong>!</p>
                    <p>Recebemos seu pagamento
                      ${valor ? `de <strong>${valor}</strong> ` : ""}
                      . Sua assinatura <strong>${planoLabel}</strong>
                      está ativa até <strong>${venc}</strong>.</p>
                    <a href="https://meucaixa.tec.br" class="btn">
                      Acessar o app
                    </a>`),
              );
            }
            break;
          }

          case "invoice.payment_failed": {
            const invoice = event.data.object;
            const doc = await buscarEmpresa(invoice.subscription);
            if (!doc) break;

            await doc.ref.update({
              status: "suspenso",
              suspensaoEm: admin.firestore.FieldValue.serverTimestamp(),
            });

            const d = doc.data();
            const destino = d.emailAlerta || d.email;

            if (destino) {
              await tentarEmail(
                  destino,
                  "MeuCaixa · Falha no pagamento ⚠️",
                  templateBase(`
                    <h2>⚠️ Falha no pagamento</h2>
                    <p>Olá, <strong>${d.nomeEmpresa || "lojista"}</strong>!</p>
                    <p>Não conseguimos processar o pagamento da sua assinatura
                      MeuCaixa.</p>
                    <div class="alert danger">
                      Você tem <strong>48 horas</strong> de carência. Após esse
                      período, o acesso às operações será bloqueado até a
                      regularização.
                    </div>
                    <p>Atualize seu método de pagamento diretamente no portal
                      do Stripe:</p>
                    <a href="https://meucaixa.tec.br" class="btn">
                      Regularizar pagamento
                    </a>
                    <p style="font-size:12px;color:#888;margin-top:24px">
                      Dúvidas? WhatsApp
                      <a href="https://wa.me/5522988183651">+55 22 98818-3651</a>
                    </p>`),
              );
            }
            break;
          }

          case "customer.subscription.deleted": {
            const sub = event.data.object;
            const doc = await buscarEmpresa(sub.id);
            if (!doc) break;

            await doc.ref.update({
              assinaturaAtiva: false,
              status: "cancelado",
              dataInicioContagem90Dias:
                admin.firestore.FieldValue.serverTimestamp(),
              stripeSubscriptionId: null,
            });

            const d = doc.data();
            const destino = d.emailAlerta || d.email;

            if (destino) {
              await tentarEmail(
                  destino,
                  "MeuCaixa · Assinatura cancelada",
                  templateBase(`
                    <h2>Sua assinatura foi cancelada</h2>
                    <p>Olá, <strong>${d.nomeEmpresa || "lojista"}</strong>.</p>
                    <p>Sua assinatura do MeuCaixa foi cancelada. Seus dados
                      ficam disponíveis por <strong>90 dias</strong>,
                      após os quais serão removidos.</p>
                    <div class="alert">
                      Quer continuar usando o MeuCaixa? Assine novamente a
                      qualquer momento — seus dados ainda estão salvos.
                    </div>
                    <a href="https://meucaixa.tec.br" class="btn">
                      Assinar novamente
                    </a>
                    <p style="font-size:12px;color:#888;margin-top:24px">
                      Dúvidas? WhatsApp
                      <a href="https://wa.me/5522988183651">+55 22 98818-3651</a>
                    </p>`),
              );
            }
            break;
          }

          default:
            break;
        }
        res.status(200).json({received: true});
      } catch (err) {
        await gravarErro(err.message);
        res.status(200).json({received: true, error: "internal"});
      }
    },
);
