// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · utils.js · v3.0                                     ║
// ║  Utilitários globais — toast, modais, erros, formatação         ║
// ║  Módulo 03                                                      ║
// ╚══════════════════════════════════════════════════════════════════╝

import { db } from "./firebase-config.js";
import { collection, addDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { notificar } from "./notificacoes.js";
import { VERSAO_APP } from "./auth.js";

// ─── GERAR UUID ────────────────────────────────────────────────────
/**
 * Gera um UUID usando crypto.randomUUID() com fallback para iOS antigo.
 * Fallback: combinação de timestamp + Math.random (EC-05).
 */
export function gerarUUID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback baseado em timestamp + Math.random para iOS < 15.4
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Date.now() * Math.random() * 16) % 16 | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── GERAR ID DO DISPOSITIVO ───────────────────────────────────────
/**
 * Retorna o UUID persistido no localStorage para este dispositivo.
 * Gera e persiste um novo UUID na primeira chamada (FR-008).
 * Chamadas subsequentes retornam sempre o mesmo valor (SC-007).
 */
export function gerarDispositivoId() {
  const CHAVE = "mc_dispositivo_id";
  let id = localStorage.getItem(CHAVE);
  if (!id) {
    id = gerarUUID();
    try {
      localStorage.setItem(CHAVE, id);
    } catch {
      // EC-02: localStorage cheio — retorna o id gerado na memória mesmo sem persistir
    }
  }
  return id;
}

// ─── REGISTRAR ERRO ────────────────────────────────────────────────
/**
 * Grava erro no Firestore na coleção erros_sistema/.
 * Inclui: tipo, mensagem, modulo, empresaId, usuarioId, timestamp, versaoApp.
 * Fallback offline: Firestore SDK enfileira localmente (EC-04).
 * Nunca propaga erro — catch é totalmente silencioso.
 *
 * @param {string} tipo      - Categoria do erro (ex: "auth", "sync", "firestore")
 * @param {string} mensagem  - Descrição do erro ou e.message
 * @param {string} modulo    - Nome do módulo onde ocorreu (ex: "vendas.js")
 */
export async function registrarErro(tipo, mensagem, modulo) {
  // Lê sessão do localStorage para obter empresaId e usuarioId sem importar auth.js
  // (evita dependência circular e funciona mesmo sem sessão ativa)
  let empresaId  = null;
  let usuarioId  = null;

  try {
    const raw = localStorage.getItem("mc_sessao");
    if (raw) {
      const sessao = JSON.parse(raw);
      empresaId = sessao.empresaId || null;
      usuarioId = sessao.uid       || null;
    }
  } catch {
    // Ignorar: pode continuar sem empresaId
  }

  const payload = {
    tipo:       String(tipo    || "desconhecido"),
    mensagem:   String(mensagem || ""),
    modulo:     String(modulo  || ""),
    empresaId,
    usuarioId,
    timestamp:  serverTimestamp(),
    versaoApp:  VERSAO_APP,
  };

  try {
    // addDoc gera ID único automático (sem colisão de erros simultâneos)
    await addDoc(collection(db, "erros_sistema"), payload);
  } catch {
    // EC-04: falha silenciosa; não bloquear UI, não propagar erro
    // Fallback: registra em localStorage para diagnóstico offline
    try {
      const CHAVE   = "mc_erros_offline";
      const existentes = JSON.parse(localStorage.getItem(CHAVE) || "[]");
      existentes.push({ ...payload, timestamp: Date.now() });
      // Manter no máximo 50 erros offline
      localStorage.setItem(CHAVE, JSON.stringify(existentes.slice(-50)));
    } catch {
      // Se o localStorage também falhar, silencia completamente
    }
  }
}

// ─── FORMATAR MOEDA ────────────────────────────────────────────────
/**
 * Formata número para o formato BRL (ex: 1234.5 → "R$ 1.234,50").
 */
export function formatarMoeda(valor) {
  const num = Number(valor);
  if (isNaN(num)) return "R$ 0,00";
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ─── FORMATAR DATA ─────────────────────────────────────────────────
/**
 * Formata timestamp (ms) ou Date para dd/mm/aaaa.
 * Aceita Firestore Timestamp (com .toMillis()), Date, número ou string.
 */
export function formatarData(timestamp) {
  if (!timestamp) return "";
  let ms;

  if (timestamp?.toMillis) {
    ms = timestamp.toMillis();
  } else if (timestamp instanceof Date) {
    ms = timestamp.getTime();
  } else {
    ms = Number(timestamp);
  }

  if (isNaN(ms)) return "";
  const d = new Date(ms);
  const dd   = String(d.getDate()).padStart(2, "0");
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const aaaa = d.getFullYear();
  return `${dd}/${mm}/${aaaa}`;
}

// ─── DEBOUNCE ──────────────────────────────────────────────────────
/**
 * Utilitário padrão de debounce.
 * @param {Function} fn    - Função a ser debounceada
 * @param {number}   delay - Tempo em ms
 */
export function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ─── TOAST (WRAPPER DE COMPATIBILIDADE) ────────────────────────────
/**
 * Wrapper mantendo assinatura original toast(mensagem, tipo).
 * Internamente chama notificar() do módulo de notificações (FR-007).
 * Preserva compatibilidade com callers existentes.
 *
 * @param {string} mensagem - Texto da mensagem
 * @param {string} tipo     - "sucesso"|"aviso"|"erro"|"informacao"|"bloqueio"
 */
export function toast(mensagem, tipo = "informacao") {
  const titulos = {
    sucesso:    "Sucesso",
    aviso:      "Atenção",
    erro:       "Erro",
    informacao: "Informação",
    bloqueio:   "Acesso bloqueado",
  };
  const titulo = titulos[tipo] || "Informação";
  notificar(tipo, titulo, mensagem);
}

// ─── ABRIR MODAL (DESKTOP) ─────────────────────────────────────────
/**
 * Exibe modal centralizado para desktop.
 * Retorna o elemento do modal para que o caller possa manipulá-lo.
 *
 * @param {Object} opcoes
 * @param {string}      opcoes.titulo   - Título do modal
 * @param {string|Node} opcoes.conteudo - HTML string ou elemento DOM
 */
export function abrirModal({ titulo, conteudo }) {
  _garantirCssModal();

  // Remove modal anterior se existir (evita acúmulo)
  document.querySelector(".mc-modal-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "mc-modal-overlay";
  overlay.innerHTML = `
    <div class="mc-modal-card" role="dialog" aria-modal="true">
      <div class="mc-modal-header">
        <span class="mc-modal-titulo">${_esc(titulo)}</span>
        <button class="mc-modal-fechar" aria-label="Fechar">✕</button>
      </div>
      <div class="mc-modal-corpo"></div>
    </div>
  `;

  // Injeta conteúdo (string HTML ou elemento DOM)
  const corpo = overlay.querySelector(".mc-modal-corpo");
  if (typeof conteudo === "string") {
    corpo.innerHTML = conteudo;
  } else if (conteudo instanceof Node) {
    corpo.appendChild(conteudo);
  }

  document.body.appendChild(overlay);

  // Fechar ao clicar no botão ou no overlay (fora do card)
  const fechar = () => overlay.remove();
  overlay.querySelector(".mc-modal-fechar").addEventListener("click", fechar);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) fechar();
  });

  return overlay;
}

// ─── ABRIR BOTTOM SHEET (MOBILE) ──────────────────────────────────
/**
 * Exibe painel que sobe da parte inferior da tela (FR-009).
 * Suporta swipe down para fechar.
 * Não oculta conteúdo com teclado virtual (env safe-area-inset-bottom).
 * Scroll interno habilitado para conteúdo maior que a tela (EC-06).
 *
 * @param {Object} opcoes
 * @param {string}      opcoes.titulo        - Título do bottom sheet
 * @param {string|Node} opcoes.conteudo      - Conteúdo HTML ou elemento DOM
 * @param {string}      [opcoes.alturaPadrao] - Altura inicial (ex: "60vh")
 */
export function abrirBottomSheet({ titulo, conteudo, alturaPadrao = "85dvh" }) {
  _garantirCssBottomSheet();

  // Remove sheet anterior se existir
  document.querySelector(".mc-bs-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "mc-bs-overlay";
  overlay.innerHTML = `
    <div class="mc-bs-sheet" style="max-height:${alturaPadrao}" role="dialog" aria-modal="true">
      <div class="mc-bs-handle-wrap">
        <div class="mc-bs-handle"></div>
      </div>
      <div class="mc-bs-header">
        <span class="mc-bs-titulo">${_esc(titulo)}</span>
        <button class="mc-bs-fechar" aria-label="Fechar">✕</button>
      </div>
      <div class="mc-bs-corpo"></div>
    </div>
  `;

  const corpo = overlay.querySelector(".mc-bs-corpo");
  if (typeof conteudo === "string") {
    corpo.innerHTML = conteudo;
  } else if (conteudo instanceof Node) {
    corpo.appendChild(conteudo);
  }

  document.body.appendChild(overlay);

  const sheet  = overlay.querySelector(".mc-bs-sheet");
  const fechar = () => {
    sheet.classList.add("saindo");
    setTimeout(() => overlay.remove(), 280);
  };

  overlay.querySelector(".mc-bs-fechar").addEventListener("click", fechar);
  // Clicar no fundo fecha
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) fechar();
  });

  // ── Swipe down para fechar ─────────────────────────
  let startY = 0;
  let dragging = false;

  sheet.addEventListener("touchstart", (e) => {
    startY   = e.touches[0].clientY;
    dragging = true;
  }, { passive: true });

  sheet.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    const delta = e.touches[0].clientY - startY;
    if (delta > 0) {
      sheet.style.transform = `translateY(${delta}px)`;
    }
  }, { passive: true });

  sheet.addEventListener("touchend", (e) => {
    if (!dragging) return;
    dragging = false;
    const delta = e.changedTouches[0].clientY - startY;
    sheet.style.transform = "";
    // Se arrastou mais de 80px para baixo, fecha
    if (delta > 80) {
      fechar();
    }
  }, { passive: true });

  return overlay;
}

// ─── ABRIR FORMULÁRIO (ADAPTATIVO) ────────────────────────────────
/**
 * Detecta window._layoutMobile e chama abrirBottomSheet() ou abrirModal().
 * Tolera _layoutMobile undefined (default: modal — FR-010, SC-009).
 *
 * @param {Object} opcoes - Mesmas opções de abrirBottomSheet / abrirModal
 */
export function abrirFormulario({ titulo, conteudo, alturaPadrao }) {
  if (window._layoutMobile === true) {
    return abrirBottomSheet({ titulo, conteudo, alturaPadrao });
  }
  return abrirModal({ titulo, conteudo });
}

// ─── HELPERS CSS PRIVADOS ──────────────────────────────────────────

function _esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let _cssModalInjetado = false;
function _garantirCssModal() {
  if (_cssModalInjetado) return;
  _cssModalInjetado = true;
  const s = document.createElement("style");
  s.textContent = `
    .mc-modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 9998;
      background: rgba(0,0,0,.45);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .mc-modal-card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,.2);
      width: 480px;
      max-width: 95vw;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .mc-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid #f0f0f0;
    }
    .mc-modal-titulo {
      font-family: 'DM Sans', sans-serif;
      font-size: 16px;
      font-weight: 700;
      color: #1a1a1a;
    }
    .mc-modal-fechar {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 18px;
      color: #666;
      padding: 0 4px;
      line-height: 1;
    }
    .mc-modal-corpo {
      padding: 20px;
      overflow-y: auto;
      flex: 1;
    }
    @media(max-width:767px){
      .mc-modal-card{width:94vw}
      .mc-modal-header{padding:14px 16px}
      .mc-modal-corpo{padding:16px}
    }
  `;
  document.head.appendChild(s);
}

let _cssBsInjetado = false;
function _garantirCssBottomSheet() {
  if (_cssBsInjetado) return;
  _cssBsInjetado = true;
  const s = document.createElement("style");
  s.textContent = `
    .mc-bs-overlay {
      position: fixed;
      inset: 0;
      z-index: 9998;
      background: rgba(0,0,0,.4);
      display: flex;
      align-items: flex-end;
    }
    .mc-bs-sheet {
      width: 100%;
      background: #fff;
      border-radius: 16px 16px 0 0;
      box-shadow: 0 -4px 24px rgba(0,0,0,.15);
      display: flex;
      flex-direction: column;
      /* EC-06: scroll interno para conteúdo maior que a tela */
      overflow: hidden;
      /* Compatibilidade com iOS home indicator */
      padding-bottom: env(safe-area-inset-bottom, 0px);
      animation: mcBsUp .28s cubic-bezier(.25,.8,.5,1);
      transition: transform .28s ease;
    }
    @keyframes mcBsUp {
      from { transform: translateY(100%) }
      to   { transform: translateY(0) }
    }
    .mc-bs-sheet.saindo {
      animation: mcBsDown .28s ease forwards;
    }
    @keyframes mcBsDown {
      from { transform: translateY(0) }
      to   { transform: translateY(100%) }
    }
    .mc-bs-handle-wrap {
      display: flex;
      justify-content: center;
      padding: 10px 0 4px;
      cursor: grab;
    }
    .mc-bs-handle {
      width: 40px;
      height: 4px;
      background: #ddd;
      border-radius: 2px;
    }
    .mc-bs-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 20px 12px;
    }
    .mc-bs-titulo {
      font-family: 'DM Sans', sans-serif;
      font-size: 16px;
      font-weight: 700;
      color: #1a1a1a;
    }
    .mc-bs-fechar {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 18px;
      color: #666;
      padding: 0 4px;
    }
    .mc-bs-corpo {
      padding: 0 20px 20px;
      overflow-y: auto;
      flex: 1;
      /* SC-008: não ocultar conteúdo com teclado virtual */
      -webkit-overflow-scrolling: touch;
    }
  `;
  document.head.appendChild(s);
}
