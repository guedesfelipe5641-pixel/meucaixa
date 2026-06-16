// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · theme.js · v3.0                                     ║
// ║  Sistema de temas visuais via CSS custom properties             ║
// ║  Módulo 04                                                      ║
// ╚══════════════════════════════════════════════════════════════════╝

// ─── PALETAS DE TEMA ───────────────────────────────────────────────
// padrao: ambos os planos
// lilas / nude: exclusivo Profissional (FR-102: Standard recebe Padrão silenciosamente)
const PALETAS = {
  padrao: { primary: "#6B3520", accent: "#F0A335" },
  lilas:  { primary: "#7A5A9E", accent: "#B49DCF" },
  nude:   { primary: "#8B6555", accent: "#ECDCC9" },
};

// ─── GET TEMA ──────────────────────────────────────────────────────
/**
 * Retorna a paleta { primary, accent } do tema solicitado.
 * Se temaVisual for inválido ou inexistente, retorna Padrão (FR-103, SC-104).
 *
 * @param {string} temaVisual - "padrao"|"lilas"|"nude"
 * @returns {{ primary: string, accent: string }}
 */
export function getTema(temaVisual) {
  return PALETAS[temaVisual] || PALETAS.padrao;
}

// ─── APLICAR TEMA GLOBAL ───────────────────────────────────────────
/**
 * Aplica o tema Padrão nas variáveis CSS do :root.
 * Deve ser chamada UMA VEZ durante o carregamento do app (passo 5 em app.html).
 * Garante que header, sidebar e todos os elementos fora do dashboard
 * usem as cores primária e accent do Padrão (FR-101, SC-101).
 */
export function aplicarTemaGlobal() {
  const { primary, accent } = PALETAS.padrao;
  const root = document.documentElement;
  root.style.setProperty("--primary", primary);
  root.style.setProperty("--accent",  accent);
}

// ─── APLICAR TEMA DASHBOARD ────────────────────────────────────────
/**
 * Aplica o tema escolhido SOMENTE no elemento #dashboard-area.
 * O :root mantém sempre o Padrão (isolamento de tema — FR-102, SC-102, SC-103).
 *
 * Regras:
 * - Standard: sempre recebe Padrão, independente do temaVisual (silencioso, sem erro)
 * - Profissional: aplica o tema configurado
 *
 * EC-101: se #dashboard-area ainda não existir no DOM ao ser chamada,
 * a função registra um listener para DOMContentLoaded e reaaplica.
 *
 * @param {string} temaVisual - "padrao"|"lilas"|"nude"
 * @param {string} plano      - "standard"|"profissional"
 */
export function aplicarTemaDashboard(temaVisual, plano) {
  // Standard sempre recebe Padrão silenciosamente
  const temaEfetivo = plano === "profissional" ? temaVisual : "padrao";
  const { primary, accent } = getTema(temaEfetivo);

  const area = document.getElementById("dashboard-area");

  if (!area) {
    // EC-101: elemento ainda não existe — reaaplica após carregamento do DOM
    const aplicarQuandoPronto = () => {
      const areaRetry = document.getElementById("dashboard-area");
      if (areaRetry) {
        areaRetry.style.setProperty("--primary", primary);
        areaRetry.style.setProperty("--accent",  accent);
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", aplicarQuandoPronto, { once: true });
    } else {
      // DOM já carregado mas elemento não encontrado — pode ser injetado depois
      // Registra observer leve para detectar quando #dashboard-area aparecer
      const observer = new MutationObserver(() => {
        const el = document.getElementById("dashboard-area");
        if (el) {
          el.style.setProperty("--primary", primary);
          el.style.setProperty("--accent",  accent);
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    return;
  }

  area.style.setProperty("--primary", primary);
  area.style.setProperty("--accent",  accent);
}
