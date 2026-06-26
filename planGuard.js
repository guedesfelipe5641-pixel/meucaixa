// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · planGuard.js · v3.0                                 ║
// ║  Controle de plano, modo leitura e acesso offline               ║
// ║  Módulo 04                                                      ║
// ╚══════════════════════════════════════════════════════════════════╝

import { calcularAcesso, getSessao } from "./auth.js";
import { notificar }                 from "./notificacoes.js";

// ─── HIERARQUIA DE PLANOS ──────────────────────────────────────────
// standard < profissional
const HIERARQUIA = { standard: 1, profissional: 2 };

// ─── PLAN GUARD ────────────────────────────────────────────────────
/**
 * Verifica se o plano atual do usuário atende ao plano mínimo requerido.
 * Se não atender, renderiza um card de upgrade dentro de `area`.
 * Se atender, não faz nada (area permanece inalterada).
 *
 * EC-102: chamado múltiplas vezes no mesmo `area` — verifica se card já existe.
 *
 * @param {string}      planoMinimo - "standard" | "profissional"
 * @param {HTMLElement} area        - Elemento onde renderizar o card de upgrade
 * @returns {boolean} true se o plano é suficiente, false se bloqueado
 */
export function planGuard(planoMinimo, area) {
  const sessao = getSessao();
  const planoAtual = sessao?.plano || "standard";

  const nivelAtual  = HIERARQUIA[planoAtual]   || 1;
  const nivelMinimo = HIERARQUIA[planoMinimo]  || 1;

  // Plano suficiente — não faz nada
  if (nivelAtual >= nivelMinimo) return true;

  // Plano insuficiente — renderiza card de upgrade (se area válida)
  if (!area || !(area instanceof HTMLElement)) return false;

  // EC-102: evita acumular múltiplos cards de upgrade
  if (area.querySelector(".mc-plan-upgrade-card")) return false;

  _garantirCssPlanGuard();

  const card = document.createElement("div");
  card.className = "mc-plan-upgrade-card";
  card.innerHTML = `
    <div class="mc-plan-upgrade-icone">⭐</div>
    <p class="mc-plan-upgrade-titulo">Funcionalidade Profissional</p>
    <p class="mc-plan-upgrade-texto">
      Este recurso está disponível apenas no plano
      <strong>Profissional</strong>. Faça upgrade para ter acesso.
    </p>
    <a class="mc-plan-upgrade-btn" href="javascript:void(0)"
       onclick="window._irParaConfiguracoes?.('assinatura')">
      Ver Plano
    </a>
  `;

  // Substitui o conteúdo atual pelo card de upgrade
  area.innerHTML = "";
  area.appendChild(card);

  return false;
}

// ─── VERIFICAR MODO LEITURA ────────────────────────────────────────
/**
 * Consulta calcularAcesso() e, se resultado for "somente_leitura":
 *   (a) desabilita todos os elementos com data-acao="escrita"
 *   (b) exibe banner fixo no topo com o motivo
 *
 * EC-103: se Firestore offline, calcularAcesso() usa cache salvo na sessão.
 *
 * @returns {boolean} true se somente_leitura, false se acesso ativo
 */
export function verificarModoLeitura() {
  const sessao = getSessao();

  // Sem sessão: trata como somente_leitura por segurança
  if (!sessao) {
    _aplicarModoLeitura("Sessão não encontrada. Faça login novamente.");
    return true;
  }

  // calcularAcesso() precisa do objeto empresa. Usa os campos da sessão (cache)
  // para reconstruir o objeto mínimo necessário (EC-103: Firestore offline)
  const empresaCache = {
    status:         sessao.status,
    assinaturaAtiva: sessao.assinaturaAtiva,
    trialExpira:    sessao.trialExpira,
    suspensaoEm:    sessao.suspensaoEm || null,
  };

  const acesso = calcularAcesso(empresaCache);

  if (acesso !== "somente_leitura") return false;

  // Determinar motivo para exibir no banner
  const motivo = _motivoSomenteLeitura(sessao);
  _aplicarModoLeitura(motivo);
  return true;
}

// ─── HELPERS PRIVADOS ──────────────────────────────────────────────

/**
 * Determina o texto do motivo baseado nos dados da sessão
 */
function _motivoSomenteLeitura(sessao) {
  if (sessao.status === "suspenso") {
    return "Conta suspensa. Regularize sua situação para retomar o acesso completo.";
  }
  if (sessao.status === "cancelado") {
    return "Assinatura cancelada. Seus dados estão preservados.";
  }
  // Trial expirado (assinaturaAtiva false e trialExpira no passado)
  if (sessao.assinaturaAtiva === false) {
    return "Seu período de teste gratuito expirou. Assine um plano para continuar usando.";
  }
  return "Acesso em modo somente leitura.";
}

/**
 * Aplica modo somente leitura:
 * - Desabilita todos os [data-acao="escrita"]
 * - Exibe banner fixo no topo da página
 */
function _aplicarModoLeitura(motivo) {
  // (a) Desabilitar elementos de escrita (SC-106)
  const elementos = document.querySelectorAll('[data-acao="escrita"], [data-acao="salvar"], [data-acao="pagar"]');
  elementos.forEach(el => {
    el.disabled = true;
    el.setAttribute("aria-disabled", "true");
    el.style.opacity = "0.5";
    el.style.cursor  = "not-allowed";
  });

  // (b) Banner fixo — evita duplicatas
  if (document.getElementById("mc-banner-somente-leitura")) return;

  _garantirCssPlanGuard();

  const banner = document.createElement("div");
  banner.id        = "mc-banner-somente-leitura";
  banner.className = "mc-banner-leitura";
  banner.innerHTML = `
    <span class="mc-banner-leitura-icone">🔒</span>
    <span class="mc-banner-leitura-texto">${_esc(motivo)}</span>
    <a href="javascript:void(0)" class="mc-banner-leitura-btn"
       onclick="window._irParaConfiguracoes?.('assinatura')">
      Assinar
    </a>
  `;

  // Insere no início do body (banner fixo no topo)
  document.body.insertBefore(banner, document.body.firstChild);
}

/** Escapa HTML básico */
function _esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let _cssPlanGuardInjetado = false;
function _garantirCssPlanGuard() {
  if (_cssPlanGuardInjetado) return;
  _cssPlanGuardInjetado = true;

  const s = document.createElement("style");
  s.textContent = `
    /* ── Card de upgrade de plano ──────────────────── */
    .mc-plan-upgrade-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 40px 24px;
      background: #fafafa;
      border: 2px dashed #e0d5c0;
      border-radius: 12px;
      gap: 12px;
    }
    .mc-plan-upgrade-icone {
      font-size: 40px;
    }
    .mc-plan-upgrade-titulo {
      font-family: 'DM Sans', sans-serif;
      font-size: 16px;
      font-weight: 700;
      color: #1a1a1a;
      margin: 0;
    }
    .mc-plan-upgrade-texto {
      font-family: 'DM Sans', sans-serif;
      font-size: 14px;
      color: #555;
      margin: 0;
      max-width: 320px;
      line-height: 1.5;
    }
    .mc-plan-upgrade-btn {
      display: inline-block;
      background: #6B3520;
      color: #fff;
      border-radius: 8px;
      padding: 10px 28px;
      font-family: 'DM Sans', sans-serif;
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
      transition: opacity .15s;
    }
    .mc-plan-upgrade-btn:hover { opacity: .85; }

    /* ── Banner de somente leitura ─────────────────── */
    .mc-banner-leitura {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 99990;
      background: #F57F17;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      font-family: 'DM Sans', sans-serif;
      font-size: 13px;
      box-shadow: 0 2px 8px rgba(0,0,0,.18);
    }
    .mc-banner-leitura-icone { font-size: 16px; flex-shrink: 0; }
    .mc-banner-leitura-texto { flex: 1; }
    .mc-banner-leitura-btn {
      background: #fff;
      color: #F57F17;
      border-radius: 6px;
      padding: 5px 14px;
      font-weight: 700;
      text-decoration: none;
      font-size: 12px;
      white-space: nowrap;
      transition: opacity .15s;
    }
    .mc-banner-leitura-btn:hover { opacity: .85; }
  `;
  document.head.appendChild(s);
}
