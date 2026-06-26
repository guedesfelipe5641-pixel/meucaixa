const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const Stripe = require("stripe");

const stripeSecret = defineSecret("STRIPE_SECRET");

const db = admin.firestore();

exports.criarPortal = onCall(
    {secrets: [stripeSecret]},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Autenticação necessária.");
      }

      const empresaId = request.auth.uid;
      const empresaDoc = await db.collection("empresas").doc(empresaId).get();
      const data = empresaDoc.exists ? empresaDoc.data() : {};
      const stripeCustomerId = data.stripeCustomerId || null;

      if (!stripeCustomerId) {
        throw new HttpsError(
            "failed-precondition",
            "Nenhuma assinatura Stripe encontrada. " +
        "Use o botão 'Assinar agora' para criar uma assinatura.",
        );
      }

      const stripe = new Stripe(stripeSecret.value());
      const session = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: "https://meucaixa-prod.web.app/app.html",
      });

      return {url: session.url};
    },
);
