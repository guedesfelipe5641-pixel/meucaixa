// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · firebase-config.js                                  ║
// ║  Configuração central do Firebase SDK v10                       ║
// ║  Módulo 01 — persistentLocalCache + SW                          ║
// ╚══════════════════════════════════════════════════════════════════╝

import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getFunctions }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { getAnalytics }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

// ─── CREDENCIAIS DO PROJETO ────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyBarfkKZD1sWDX4YyMAq05RvBopwkPDKFI",
  authDomain:        "meucaixa-prod.firebaseapp.com",
  projectId:         "meucaixa-prod",
  storageBucket:     "meucaixa-prod.firebasestorage.app",
  messagingSenderId: "173189864418",
  appId:             "1:173189864418:web:83abfd1d212a9808e537bb",
  measurementId:     "G-SN0JRRHSV2"
};

// ─── INICIALIZAÇÃO ─────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);

// Analytics — ativo para relatórios de erro nas Cloud Functions
const analytics = getAnalytics(app);

const auth = getAuth(app);

// Firestore com cache persistente offline
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentSingleTabManager()
  })
});

const storage  = getStorage(app);
const functions = getFunctions(app, "southamerica-east1");

// ─── SERVICE WORKER ────────────────────────────────────────────────
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then(reg => {
        console.log("[SW] Registrado. Scope:", reg.scope);
      })
      .catch(err => {
        console.warn("[SW] Falha ao registrar:", err);
      });
  });
}

// ─── EXPORTS ───────────────────────────────────────────────────────
export { app, auth, db, storage, functions, analytics };
