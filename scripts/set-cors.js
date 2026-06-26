/**
 * set-cors.js — Configura CORS no Firebase Storage para permitir
 * requests de imagens (logo, PDFs) a partir do domínio próprio.
 *
 * Executar: node scripts/set-cors.js
 */

const admin = require("../functions/node_modules/firebase-admin");
const path  = require("path");

const serviceAccount = require(path.join(__dirname, "../serviceAccount.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "meucaixa-prod.firebasestorage.app",
});

const bucket = admin.storage().bucket();

const corsConfig = [
  {
    maxAgeSeconds: 3600,
    method: ["GET", "HEAD"],
    origin: [
      "https://meucaixa.tec.br",
      "https://meucaixa-prod.web.app",
      "http://localhost",
      "http://localhost:5000",
    ],
    responseHeader: ["Content-Type", "Authorization", "Content-Length"],
  },
];

bucket.setCorsConfiguration(corsConfig)
  .then(() => {
    console.log("✅ CORS configurado com sucesso no bucket meucaixa-prod.firebasestorage.app");
    console.log("   Origens permitidas:");
    corsConfig[0].origin.forEach(o => console.log("   •", o));
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Erro ao configurar CORS:", err.message);
    process.exit(1);
  });
