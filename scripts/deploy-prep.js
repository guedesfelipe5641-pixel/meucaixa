// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · scripts/deploy-prep.js                              ║
// ║  Script de pré-deploy — executa automaticamente via firebase.json║
// ║                                                                  ║
// ║  O que faz:                                                      ║
// ║    1. Lê VERSAO_APP de auth.js                                   ║
// ║    2. Atualiza CACHE_NAME em sw.js com timestamp do deploy       ║
// ║    3. Atualiza sistema/config.versaoAppAtual no Firestore        ║
// ║                                                                  ║
// ║  Pré-requisito: serviceAccount.json na raiz do projeto           ║
// ║  (baixar em Firebase Console → Configurações → Contas de serviço)║
// ╚══════════════════════════════════════════════════════════════════╝

"use strict";

const fs   = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// ── Etapa 1: Ler VERSAO_APP de auth.js ─────────────────────────────
const authPath    = path.join(ROOT, "auth.js");
const authContent = fs.readFileSync(authPath, "utf8");
const matchVersao = authContent.match(/export\s+const\s+VERSAO_APP\s*=\s*["']([^"']+)["']/);

if (!matchVersao) {
  console.error("[deploy-prep] ERRO: VERSAO_APP não encontrado em auth.js. Abortando deploy.");
  process.exit(1);
}

const versao    = matchVersao[1];
const timestamp = Date.now();

console.log(`\n[deploy-prep] ════════════════════════════════════`);
console.log(`[deploy-prep] Versão detectada : ${versao}`);
console.log(`[deploy-prep] Timestamp        : ${timestamp}`);
console.log(`[deploy-prep] ════════════════════════════════════\n`);

// ── Etapa 2: Atualizar CACHE_NAME em sw.js ──────────────────────────
const swPath    = path.join(ROOT, "sw.js");
const swContent = fs.readFileSync(swPath, "utf8");

// Aceita tanto "meucaixa-v3.6" (formato antigo) quanto "meucaixa-<timestamp>"
const swAtualizado = swContent.replace(
  /const CACHE_NAME = "meucaixa-[^"]+"/,
  `const CACHE_NAME = "meucaixa-${timestamp}"`
);

if (swContent === swAtualizado) {
  console.warn("[deploy-prep] AVISO: CACHE_NAME não encontrado em sw.js. Verifique o formato.");
} else {
  fs.writeFileSync(swPath, swAtualizado, "utf8");
  console.log(`[deploy-prep] ✅ sw.js → CACHE_NAME = "meucaixa-${timestamp}"`);
}

// ── Etapa 3: Atualizar Firestore sistema/config ──────────────────────
async function atualizarFirestore() {
  let admin;

  // Tentar carregar firebase-admin do diretório de functions
  try {
    admin = require("../functions/node_modules/firebase-admin");
  } catch {
    console.warn("[deploy-prep] AVISO: firebase-admin não encontrado em functions/node_modules.");
    console.warn(`[deploy-prep] Atualize manualmente: Firestore → sistema/config → versaoAppAtual = "${versao}"`);
    return;
  }

  // Inicializar com serviceAccount.json se existir, senão tentar credenciais padrão
  if (admin.apps.length === 0) {
    const saPath = path.join(ROOT, "serviceAccount.json");
    if (fs.existsSync(saPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(saPath, "utf8"));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log("[deploy-prep] Firebase Admin: credenciais via serviceAccount.json");
    } else {
      try {
        admin.initializeApp();
        console.log("[deploy-prep] Firebase Admin: credenciais padrão do ambiente");
      } catch (e) {
        console.warn("[deploy-prep] AVISO: Não foi possível inicializar o Firebase Admin.");
        console.warn("[deploy-prep] → Crie serviceAccount.json na raiz do projeto (ver DEPLOY.md).");
        console.warn(`[deploy-prep] → Atualize manualmente: sistema/config.versaoAppAtual = "${versao}"`);
        return;
      }
    }
  }

  try {
    const db = admin.firestore();
    await db.doc("sistema/config").update({
      versaoAppAtual: versao,
    });
    console.log(`[deploy-prep] ✅ Firestore sistema/config.versaoAppAtual = "${versao}"`);
  } catch (err) {
    console.warn(`[deploy-prep] AVISO: Firestore não atualizado — ${err.message}`);
    console.warn(`[deploy-prep] → Atualize manualmente: sistema/config.versaoAppAtual = "${versao}"`);
  }
}

atualizarFirestore().then(() => {
  console.log("\n[deploy-prep] ✅ Preparação concluída. Iniciando deploy...\n");
});
