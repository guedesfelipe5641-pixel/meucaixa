// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · sw.js                                               ║
// ║  Service Worker — Módulo 01                                     ║
// ║  Estratégia: cache-first para assets estáticos                  ║
// ║  ⚠️  Atualizar CACHE_NAME a cada deploy importante              ║
// ╚══════════════════════════════════════════════════════════════════╝

const CACHE_NAME = "meucaixa-v3.1";

// Assets que serão cacheados no install.
// Inclui todas as páginas HTML, scripts JS, manifest e ícones.
// As fontes do Google Fonts são cacheadas via fetch (abaixo).
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/app.html",
  "/login.html",
  "/firebase-config.js",
  "/auth.js",
  "/router.js",
  "/utils.js",
  "/theme.js",
  "/planGuard.js",
  "/syncManager.js",
  "/notificacoes.js",
  "/vendas.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// Origens cujos recursos serão cacheados quando encontrados no fetch.
const CACHEABLE_ORIGINS = [
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://www.gstatic.com", // Firebase SDK modules
];

// ─── INSTALL ───────────────────────────────────────────────────────
// Abre o cache e pré-carrega os assets estáticos.
// Usa { cache: "reload" } para forçar busca na rede, ignorando cache HTTP.
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // addAll falha se qualquer asset retornar erro.
      // Usamos Promise.allSettled internamente via loop para que
      // assets opcionais (ainda não criados) não quebrem o install.
      const promises = STATIC_ASSETS.map(url =>
        cache.add(new Request(url, { cache: "reload" })).catch(err => {
          console.warn("[SW] Não foi possível cachear:", url, err.message);
        })
      );
      return Promise.all(promises);
    }).then(() => {
      // Força o SW instalado a ativar imediatamente sem esperar
      // que abas antigas sejam fechadas.
      return self.skipWaiting();
    })
  );
});

// ─── ACTIVATE ──────────────────────────────────────────────────────
// Remove caches antigos (versões anteriores do app).
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log("[SW] Removendo cache antigo:", name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      // Assume controle de todas as abas abertas imediatamente.
      return self.clients.claim();
    })
  );
});

// ─── FETCH ─────────────────────────────────────────────────────────
// Estratégia: cache-first com fallback para rede.
//
// 1. Se o recurso está no cache → retorna do cache (rápido, funciona offline)
// 2. Se não está → busca na rede, salva no cache se for uma origem cacheável
// 3. Se offline E não está no cache → retorna página offline simples
//
// Exceções que vão SEMPRE para a rede (sem cache):
//   - Requisições de autenticação do Firebase
//   - Chamadas à API do Firestore / Functions
//   - Qualquer método não-GET
self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar requisições não-GET (POST, PUT, DELETE...).
  if (request.method !== "GET") return;

  // Ignorar extensões do Chrome e protocolos especiais.
  if (!request.url.startsWith("http")) return;

  // Ignorar chamadas diretas ao Firebase (Auth, Firestore, Functions, Storage).
  // Essas APIs têm seu próprio mecanismo de offline (IndexedDB do SDK).
  const firebasePatterns = [
    "firebaseio.com",
    "googleapis.com/identitytoolkit",
    "googleapis.com/firestore",
    "cloudfunctions.net",
    "firebasestorage.googleapis.com",
    "securetoken.googleapis.com",
  ];
  if (firebasePatterns.some(p => url.href.includes(p))) return;

  // Estratégia cache-first.
  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }

      // Não está no cache: buscar na rede.
      return fetch(request).then(networkResponse => {
        // Cachear apenas respostas válidas de origens conhecidas.
        const shouldCache =
          networkResponse.ok &&
          (url.origin === self.location.origin ||
           CACHEABLE_ORIGINS.some(o => url.origin.startsWith(o)));

        if (shouldCache) {
          // Clone ANTES de retornar — Response só pode ser lida uma vez.
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseToCache).catch(() => {});
          });
        }

        // Retorna a resposta original (não o clone).
        return networkResponse;
      }).catch(() => {
        // Offline e recurso não está no cache.
        // Para navegações (HTML), retorna página offline simples.
        if (request.destination === "document") {
          return new Response(offlineHTML(), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" }
          });
        }
        // Para outros recursos (imagens, scripts): falha silenciosa.
        return new Response("", { status: 408 });
      });
    })
  );
});

// ─── PÁGINA OFFLINE ────────────────────────────────────────────────
function offlineHTML() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meu Caixa Digital — Offline</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #0D3B4F;
      color: #F0A335;
      font-family: sans-serif;
      padding: 2rem;
      text-align: center;
    }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; color: #fff; }
    p  { font-size: 0.9rem; color: rgba(255,255,255,0.7); line-height: 1.6; }
    button {
      margin-top: 1.5rem;
      padding: 0.6rem 1.4rem;
      background: #F0A335;
      color: #0D3B4F;
      border: none;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="icon">📦</div>
  <h1>Você está offline</h1>
  <p>
    Esta página ainda não foi carregada enquanto havia conexão.<br>
    Abra o app pelo atalho instalado para acessar no modo offline.
  </p>
  <button onclick="location.reload()">Tentar novamente</button>
</body>
</html>`;
}
