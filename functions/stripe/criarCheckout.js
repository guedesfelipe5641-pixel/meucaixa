const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const Stripe = require("stripe");

const stripeSecret = defineSecret("STRIPE_SECRET");

const db = admin.firestore();

exports.criarCheckout = onCall(
    {secrets: [stripeSecret]},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Autenticação necessária.");
      }

      const {plano, periodo} = request.data;
      const empresaId = request.auth.uid;

      if (!plano || !periodo) {
        throw new HttpsError(
            "invalid-argument",
            "plano e periodo são obrigatórios.",
        );
      }

      const priceMap = {
        "standard_mensal": process.env.STRIPE_PRICE_STANDARD_MENSAL,
        "standard_anual": process.env.STRIPE_PRICE_STANDARD_ANUAL,
        "profissional_mensal": process.env.STRIPE_PRICE_PRO_MENSAL,
        "profissional_anual": process.env.STRIPE_PRICE_PRO_ANUAL,
      };

      const priceId = priceMap[`${plano}_${periodo}`];
      if (!priceId) {
        throw new HttpsError(
            "invalid-argument",
            "Combinação de plano/período inválida.",
        );
      }

      const empresaDoc = await db.collection("empresas").doc(empresaId).get();
      const empresaData = empresaDoc.data() || {};

      const stripe = new Stripe(stripeSecret.value());
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{price: priceId, quantity: 1}],
        metadata: {empresaId, plano},
        success_url:
        "https://meucaixa-prod.web.app/app.html?checkout=success",
        cancel_url:
        "https://meucaixa-prod.web.app/app.html?checkout=cancel",
        customer_email: empresaData.email || undefined,
      });

      return {url: session.url};
    },
);
