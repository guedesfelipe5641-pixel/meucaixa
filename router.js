// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · router.js · v3.0                                    ║
// ║  Roteamento de módulos — permissões por perfil e plano          ║
// ║  Módulo 05-B                                                    ║
// ╚══════════════════════════════════════════════════════════════════╝

import { notificar, renderSino } from "./notificacoes.js";
import { planGuard, verificarModoLeitura } from "./planGuard.js";
import { logout, calcularAcesso } from "./auth.js";
import { registrarErro }         from "./utils.js";

// ─── MAPA DE ROTAS ─────────────────────────────────────────────────
// adminOnly: somente perfil "admin" pode acessar
// proOnly:   requer plano "profissional"
// onlineOnly: bloqueado se navigator.onLine === false
// group:     separador visual na sidebar (string ou null)
// tab:       true = exibe na tab bar fixa do mobile
// drawerOnly: somente no drawer mobile (não na tab bar)
const ROTAS = {
  dashboard: {
    label:      "Dashboard",
    icon:       "🏠",
    modulo:     () => import("./modulos/dashboard_admin.js"),
    moduloOp:   () => import("./modulos/dashboard_operador.js"),
    adminOnly:  false,
    proOnly:    false,
    onlineOnly: false,
    group:      null,
    tab:        true,
  },
  caixa: {
    label:      "Caixa do Dia",
    icon:       "💰",
    modulo:     () => import("./modulos/caixa.js"),
    adminOnly:  false,
    proOnly:    false,
    onlineOnly: false,
    group:      null,
    tab:        true,
  },
  vendas: {
    label:      "Vendas",
    icon:       "🛒",
    modulo:     () => import("./vendas.js"),
    adminOnly:  false,
    proOnly:    false,
    onlineOnly: false,
    group:      null,
    tab:        true,
  },
  estoque: {
    label:      "Estoque",
    icon:       "📦",
    modulo:     () => import("./modulos/estoque.js"),
    adminOnly:  false,
    proOnly:    false,
    onlineOnly: false,
    group:      "Inventário",
    tab:        true,
    drawerOnly: false,
  },
  produtos: {
    label:       "Produtos",
    icon:        "🏷️",
    modulo:      () => import("./modulos/produtos.js"),
    adminOnly:   false,
    proOnly:     false,
    onlineOnly:  false,
    group:       "Inventário",
    drawerOnly:  true,
    // Operador: somente leitura (lógica implementada no módulo)
  },
  clientes: {
    label:      "Clientes",
    icon:       "👥",
    modulo:     () => import("./modulos/clientes.js"),
    adminOnly:  true,
    proOnly:    false,
    onlineOnly: false,
    group:      "Cadastros",
    drawerOnly: true,
  },
  fornecedores: {
    label:      "Fornecedores",
    icon:       "🏭",
    modulo:     () => import("./modulos/fornecedores.js"),
    adminOnly:  true,
    proOnly:    false,
    onlineOnly: false,
    group:      null,
    drawerOnly: true,
  },
  colaboradores: {
    label:      "Colaboradores",
    icon:       "👤",
    modulo:     () => import("./modulos/colaboradores.js"),
    adminOnly:  true,
    proOnly:    false,
    onlineOnly: false,
    group:      null,
    drawerOnly: true,
  },
  crediario: {
    label:      "Crediário",
    icon:       "💳",
    modulo:     () => import("./modulos/crediario.js"),
    adminOnly:  false,
    proOnly:    true,
    onlineOnly: true,
    group:      "Financeiro",
    drawerOnly: true,
  },
  despesas: {
    label:      "Despesas",
    icon:       "💸",
    modulo:     () => import("./modulos/despesas.js"),
    adminOnly:  true,
    proOnly:    false,
    onlineOnly: false,
    group:      null,
    drawerOnly: true,
  },
  fluxo: {
    label:      "Fluxo de Caixa",
    icon:       "📈",
    modulo:     () => import("./modulos/fluxo.js"),
    adminOnly:  true,
    proOnly:    false,
    onlineOnly: false,
    group:      null,
    drawerOnly: true,
  },
  folhaPagamento: {
    label:      "Folha de Pagamento",
    icon:       "📋",
    modulo:     () => import("./modulos/folhaPagamento.js"),
    adminOnly:  true,
    proOnly:    true,
    onlineOnly: false,
    group:      "Pessoal",
    drawerOnly: true,
  },
  recibos: {
    label:      "Recibos",
    icon:       "🧾",
    modulo:     () => import("./modulos/recibos.js"),
    adminOnly:  true,
    proOnly:    false,
    onlineOnly: false,
    group:      null,
    drawerOnly: true,
  },
  configuracoes: {
    label:      "Configurações",
    icon:       "⚙️",
    modulo:     () => import("./modulos/configuracoes.js"),
    adminOnly:  true,
    proOnly:    false,
    onlineOnly: false,
    group:      "Sistema",
    drawerOnly: true,
  },
};

// ─── ÍCONES SVG POR ROTA ───────────────────────────────────────────
const ICONS = {
  dashboard:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`,
  caixa:          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8a2 2 0 0 0-2 2v2h12V5a2 2 0 0 0-2-2z"/><circle cx="12" cy="14" r="2"/></svg>`,
  vendas:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`,
  estoque:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
  produtos:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  clientes:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  fornecedores:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 6v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  colaboradores:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  crediario:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
  despesas:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
  fluxo:          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
  folhaPagamento: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  recibos:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  configuracoes:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
};

// ─── ROTA PADRÃO ───────────────────────────────────────────────────
const ROTA_PADRAO = "dashboard";

// ─── ESTADO INTERNO ────────────────────────────────────────────────
let _rotaAtual   = null;
let _sessao      = null;
let _layoutMobile = false;

// ─── VERIFICAR ACESSO A UMA ROTA ───────────────────────────────────
/**
 * Verifica se o usuário pode acessar a rota.
 *
 * @param {string}  routeId - ID da rota
 * @param {string}  perfil  - "admin" | "operador"
 * @param {string}  plano   - "standard" | "profissional"
 * @param {boolean} isOnline - navigator.onLine
 * @returns {boolean}
 */
export function canAccess(routeId, perfil, plano, isOnline) {
  const rota = ROTAS[routeId];
  if (!rota) return false;

  // Admin only
  if (rota.adminOnly && perfil !== "admin") return false;

  // Pro only
  if (rota.proOnly && plano !== "profissional") return false;

  // Online only
  if (rota.onlineOnly && !isOnline) return false;

  return true;
}

// ─── RETORNAR ITENS DO MENU ────────────────────────────────────────
/**
 * Retorna array de itens de menu filtrados por perfil e plano.
 * Usado pelo router para gerar a navegação.
 *
 * @param {string} perfil - "admin" | "operador"
 * @param {string} plano  - "standard" | "profissional"
 * @returns {Array<{ id, label, icon, proOnly, onlineOnly, group, tab, drawerOnly }>}
 */
export function getMenuItems(perfil, plano) {
  return Object.entries(ROTAS)
    .filter(([, rota]) => {
      // Filtro de acesso: operador não vê adminOnly
      if (rota.adminOnly && perfil !== "admin") return false;
      return true;
    })
    .map(([id, rota]) => ({
      id,
      label:      rota.label,
      icon:       rota.icon,
      proOnly:    rota.proOnly,
      onlineOnly: rota.onlineOnly,
      group:      rota.group,
      tab:        rota.tab     || false,
      drawerOnly: rota.drawerOnly || false,
      // Indica se o usuário pode acessar (para estilo visual)
      bloqueado:  rota.proOnly && plano !== "profissional",
    }));
}

// ─── ROTA ATUAL ─────────────────────────────────────────────────────
export function getCurrentRoute() {
  return _rotaAtual;
}

// ─── NAVEGAR PARA UMA ROTA ─────────────────────────────────────────
/**
 * Navega para a rota especificada:
 * 1. Valida existência da rota
 * 2. Verifica permissão de acesso
 * 3. Injeta placeholder ou módulo real no #conteudo-principal
 * 4. Atualiza URL hash
 * 5. Atualiza item ativo no menu
 *
 * @param {string} routeId
 * @returns {Promise<void>}
 */
export async function navigate(routeId) {
  const perfil  = _sessao?.perfil   || "operador";
  const plano   = _sessao?.plano    || "standard";
  const isOnline = navigator.onLine;

  // Rota não existe → fallback para dashboard
  if (!ROTAS[routeId]) {
    if (routeId !== ROTA_PADRAO) {
      return navigate(ROTA_PADRAO);
    }
    return;
  }

  const rota = ROTAS[routeId];

  // ── Verificar online-only (crediário) ─────────────────────────
  if (rota.onlineOnly && !isOnline) {
    notificar(
      "bloqueio",
      "Sem conexão",
      `O módulo "${rota.label}" requer conexão com a internet. Conecte-se e tente novamente.`
    );
    return;
  }

  // ── Verificar permissão ───────────────────────────────────────
  if (!canAccess(routeId, perfil, plano, isOnline)) {
    // Operador tentando rota adminOnly → redireciona silenciosamente
    if (rota.adminOnly && perfil !== "admin") {
      return navigate(ROTA_PADRAO);
    }
    // Rota pro-only → mostrar card de upgrade in-place
    if (rota.proOnly && plano !== "profissional") {
      const container = document.getElementById("conteudo-principal");
      if (container) {
        _rotaAtual = routeId;
        _atualizarMenuAtivo(routeId);
        window.location.hash = routeId;
        planGuard("profissional", container);
      }
      return;
    }
    return navigate(ROTA_PADRAO);
  }

  // ── Atualizar estado e URL ────────────────────────────────────
  _rotaAtual = routeId;
  window.location.hash = routeId;
  _atualizarMenuAtivo(routeId);

  // ── Fechar drawer mobile se aberto ───────────────────────────
  _fecharDrawer();

  // ── Renderizar módulo ─────────────────────────────────────────
  const container = document.getElementById("conteudo-principal");
  if (!container) return;

  // Indicador de carregamento
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:200px;
                font-family:'DM Sans',sans-serif;color:#bbb;font-size:14px;">
      Carregando ${rota.label}...
    </div>
  `;

  try {
    // Dashboard: módulos separados por perfil
    let mod;
    if (routeId === "dashboard" && perfil !== "admin" && ROTAS.dashboard.moduloOp) {
      mod = await ROTAS.dashboard.moduloOp();
    } else {
      mod = await rota.modulo();
    }

    if (typeof mod?.renderizar === "function") {
      await mod.renderizar(_sessao, container);
    } else {
      _renderizarPlaceholder(container, rota.label);
    }

    // Aplicar modo somente leitura após cada render (trial expirado, suspensão)
    if (calcularAcesso({
      status:          _sessao?.status,
      assinaturaAtiva: _sessao?.assinaturaAtiva,
      trialExpira:     _sessao?.trialExpira,
      suspensaoEm:     _sessao?.suspensaoEm,
    }) === "somente_leitura") {
      verificarModoLeitura();
    }
  } catch {
    // Módulo ainda não implementado → placeholder
    _renderizarPlaceholder(container, rota.label);
  }
}

// ─── INICIAR ROUTER ────────────────────────────────────────────────
/**
 * Inicializa o router após o template ser injetado no DOM.
 * - Popula o menu de navegação (#nav-menu / #mc-drawer-menu)
 * - Configura listeners de clique nos itens de menu
 * - Para mobile: configura tab bar e drawer
 * - Configura o avatar/user menu
 *
 * @param {Object} sessao - Objeto de sessão do auth.js
 */
export function iniciarRouter(sessao) {
  _sessao      = sessao;
  _layoutMobile = window._layoutMobile === true;

  const perfil = sessao?.perfil   || "operador";
  const plano  = sessao?.plano    || "standard";
  const itens  = getMenuItems(perfil, plano);

  if (_layoutMobile) {
    _configurarMobile(sessao, itens);
  } else {
    _configurarDesktop(sessao, itens);
  }

  // Configurar evento de volta/avança (popstate)
  window.addEventListener("popstate", () => {
    const rota = window.location.hash.replace("#", "") || ROTA_PADRAO;
    navigate(rota);
  });

  // Reagir a mudanças de sessao (plano/status/acesso) detectadas em background
  window.addEventListener("mc:sessao-atualizada", (e) => {
    if (!e.detail) return;
    const acessoAnterior = calcularAcesso({
      status:          _sessao?.status,
      assinaturaAtiva: _sessao?.assinaturaAtiva,
      trialExpira:     _sessao?.trialExpira,
      suspensaoEm:     _sessao?.suspensaoEm,
    });
    _sessao = e.detail;
    _atualizarMenuPlano(_sessao.plano || "standard");
    const acessoNovo = calcularAcesso({
      status:          _sessao?.status,
      assinaturaAtiva: _sessao?.assinaturaAtiva,
      trialExpira:     _sessao?.trialExpira,
      suspensaoEm:     _sessao?.suspensaoEm,
    });
    if (_rotaAtual) {
      const rota = ROTAS[_rotaAtual];
      // Re-renderiza se: rota proOnly/adminOnly mudou, ou nível de acesso mudou
      // (cobre trial expirado → desabilita, e restauração → reabilita botões)
      if (rota?.proOnly || rota?.adminOnly || acessoAnterior !== acessoNovo) {
        navigate(_rotaAtual);
      }
    }
  });
}

// ─── CONFIGURAR DESKTOP ────────────────────────────────────────────
function _configurarDesktop(sessao, itens) {
  const navMenu = document.getElementById("nav-menu");
  if (!navMenu) return;

  // Preencher nome e avatar no header
  const elNome    = document.getElementById("mc-nome-empresa");
  const avatarBtn = document.getElementById("mc-avatar-btn");
  const userNome  = document.getElementById("mc-user-nome");
  const userPerfil = document.getElementById("mc-user-perfil");

  if (elNome) elNome.textContent = sessao.nomeEmpresa || "";

  const avatarCircle = document.getElementById("mc-avatar-circle");
  const avatarNome   = document.getElementById("mc-avatar-nome");
  const avatarRole   = document.getElementById("mc-avatar-role");
  if (avatarCircle) avatarCircle.textContent = (sessao.nome || "U")[0].toUpperCase();
  if (avatarNome)   avatarNome.textContent   = sessao.nome || "Usuário";
  if (avatarRole)   avatarRole.textContent   = sessao.perfil === "admin" ? "Administrador" : "Operador";
  if (userNome)   userNome.childNodes[0].textContent = sessao.nome || "";
  if (userPerfil) userPerfil.textContent = sessao.perfil === "admin" ? "Administrador" : "Operador";

  // ── Gerar itens do menu agrupados ─────────────────────────────
  const grupos = [];
  let grupoAtual = { label: null, itens: [] };

  itens.forEach(item => {
    if (item.group !== null && item.group !== grupoAtual.label) {
      if (grupoAtual.itens.length > 0) grupos.push(grupoAtual);
      grupoAtual = { label: item.group, itens: [] };
    }
    grupoAtual.itens.push(item);
  });
  if (grupoAtual.itens.length > 0) grupos.push(grupoAtual);

  navMenu.innerHTML = grupos.map(g => `
    <div class="nav-group">
      ${g.label ? `<p class="nav-group-label">${g.label}</p>` : ""}
      ${g.itens.map(item => `
        <button class="nav-item" data-rota="${item.id}" role="menuitem">
          <span class="nav-chip">${ICONS[item.id] || ""}</span>
          <span class="nav-label">${item.label}</span>
          ${item.bloqueado ? '<span class="pro-badge">PRO</span>' : ""}
        </button>`).join("")}
    </div>`).join("");

  // ── Listeners de clique no menu ───────────────────────────────
  navMenu.addEventListener("click", (e) => {
    const item = e.target.closest("[data-rota]");
    if (item) navigate(item.dataset.rota);
  });

  // ── Avatar dropdown ───────────────────────────────────────────
  const avatarWrap = document.getElementById("mc-avatar-wrap");
  const userMenu   = document.getElementById("mc-user-menu");
  if (avatarBtn && userMenu) {
    avatarBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const aberto = userMenu.classList.toggle("aberto");
      avatarBtn.setAttribute("aria-expanded", String(aberto));
    });
    document.addEventListener("click", () => {
      userMenu.classList.remove("aberto");
      avatarBtn.setAttribute("aria-expanded", "false");
    });
  }

  // ── Botão logout ──────────────────────────────────────────────
  document.getElementById("mc-btn-logout")?.addEventListener("click", () => logout());
  document.getElementById("mc-btn-configuracoes")?.addEventListener("click", () => {
    userMenu?.classList.remove("aberto");
    navigate("configuracoes");
  });
  window._irParaConfiguracoes = (aba) => {
    if (aba) window._configuracoes_aba_inicial = aba;
    navigate("configuracoes");
  };

  // ── Sino de notificações ──────────────────────────────────────
  const sinoContainer = document.getElementById("sino-container");
  if (sinoContainer) renderSino(sinoContainer);
}

// ─── CONFIGURAR MOBILE ─────────────────────────────────────────────
function _configurarMobile(sessao, itens) {
  // Preencher cabeçalho do drawer
  const drawerNome    = document.getElementById("mc-drawer-nome");
  const drawerEmpresa = document.getElementById("mc-drawer-empresa");
  const avatarMobile  = document.getElementById("mc-avatar-mobile");

  if (drawerNome)    drawerNome.textContent    = sessao.nome    || "";
  if (drawerEmpresa) drawerEmpresa.textContent = sessao.nomeEmpresa || "";
  if (avatarMobile)  avatarMobile.textContent  = (sessao.nome || "U")[0].toUpperCase();

  // ── Gerar itens do drawer ─────────────────────────────────────
  const drawerMenu = document.getElementById("mc-drawer-menu");
  if (drawerMenu) {
    let htmlDrawer  = "";
    let grupoAnterior = undefined;

    // Itens que vão no drawer (drawerOnly ou todos exceto os da tab bar fixa)
    const itensDrawer = itens.filter(item => item.drawerOnly);

    itensDrawer.forEach(item => {
      if (item.group !== null && item.group !== grupoAnterior) {
        if (grupoAnterior !== undefined) {
          htmlDrawer += `<li class="mc-drawer-separator" role="separator"></li>`;
        }
        grupoAnterior = item.group;
      }

      const badgePro = item.proOnly
        ? `<span class="mc-drawer-pro-badge">PRO</span>`
        : "";

      htmlDrawer += `
        <li role="none">
          <button class="mc-drawer-item"
                  data-rota="${item.id}"
                  role="menuitem">
            <span class="mc-drawer-icon">${item.icon}</span>
            <span>${item.label}</span>
            ${badgePro}
          </button>
        </li>
      `;
    });

    drawerMenu.innerHTML = htmlDrawer;
    drawerMenu.addEventListener("click", (e) => {
      const item = e.target.closest("[data-rota]");
      if (item) navigate(item.dataset.rota);
    });
  }

  // ── Tab bar: cliques nas 4 abas fixas ────────────────────────
  const tabBar = document.getElementById("mc-tab-bar");
  if (tabBar) {
    tabBar.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-rota]");
      if (!btn) return;
      navigate(btn.dataset.rota);
    });
  }

  // ── Botão "Mais" → abre drawer ───────────────────────────────
  const btnMais = document.getElementById("mc-tab-mais");
  btnMais?.addEventListener("click", _abrirDrawer);

  // ── Avatar mobile → abre drawer ──────────────────────────────
  avatarMobile?.addEventListener("click", _abrirDrawer);

  // ── Fechar drawer ao clicar no overlay ───────────────────────
  const overlay = document.getElementById("mc-drawer-overlay");
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) _fecharDrawer();
  });
  document.getElementById("mc-drawer-fechar")?.addEventListener("click", _fecharDrawer);

  // ── Logout no drawer ─────────────────────────────────────────
  document.getElementById("mc-drawer-logout")?.addEventListener("click", () => logout());

  // ── Sino de notificações ──────────────────────────────────────
  const sinoContainer = document.getElementById("sino-container");
  if (sinoContainer) renderSino(sinoContainer);

  // ── Expor _irParaConfiguracoes ────────────────────────────────
  window._irParaConfiguracoes = (aba) => {
    if (aba) window._configuracoes_aba_inicial = aba;
    navigate("configuracoes");
  };
}

// ─── ATUALIZAR BADGES PRO NO MENU ──────────────────────────────────
function _atualizarMenuPlano(plano) {
  // Desktop
  document.querySelectorAll(".nav-item[data-rota]").forEach(el => {
    const rota = ROTAS[el.dataset.rota];
    if (!rota?.proOnly) return;
    const bloqueado = plano !== "profissional";
    let badge = el.querySelector(".pro-badge");
    if (bloqueado && !badge) {
      badge = document.createElement("span");
      badge.className = "pro-badge";
      badge.textContent = "PRO";
      el.appendChild(badge);
    } else if (!bloqueado && badge) {
      badge.remove();
    }
  });
  // Mobile drawer
  document.querySelectorAll(".mc-drawer-item[data-rota]").forEach(el => {
    const rota = ROTAS[el.dataset.rota];
    if (!rota?.proOnly) return;
    const bloqueado = plano !== "profissional";
    let badge = el.querySelector(".mc-drawer-pro-badge");
    if (bloqueado && !badge) {
      badge = document.createElement("span");
      badge.className = "mc-drawer-pro-badge";
      badge.textContent = "PRO";
      el.appendChild(badge);
    } else if (!bloqueado && badge) {
      badge.remove();
    }
  });
}

// ─── ATUALIZAR ITEM ATIVO NO MENU ──────────────────────────────────
function _atualizarMenuAtivo(routeId) {
  // Desktop
  document.querySelectorAll(".nav-item[data-rota]").forEach(el => {
    el.classList.toggle("active", el.dataset.rota === routeId);
  });

  // Mobile: botões do drawer
  document.querySelectorAll(".mc-drawer-item").forEach(el => {
    el.classList.toggle("ativo", el.dataset.rota === routeId);
  });

  // Mobile: tab bar (somente os 4 fixos)
  document.querySelectorAll("#mc-tab-bar .mc-tab-item[data-rota]").forEach(el => {
    el.classList.toggle("ativo", el.dataset.rota === routeId);
  });

  // "Mais" fica ativo se a rota atual é um item do drawer
  const tabMais = document.getElementById("mc-tab-mais");
  if (tabMais) {
    const itensTabBar = ["dashboard", "caixa", "vendas", "estoque"];
    tabMais.classList.toggle("ativo", !itensTabBar.includes(routeId));
  }
}

// ─── ABRIR / FECHAR DRAWER ─────────────────────────────────────────
function _abrirDrawer() {
  const overlay = document.getElementById("mc-drawer-overlay");
  overlay?.classList.add("aberto");
  document.body.style.overflow = "hidden";
}

function _fecharDrawer() {
  const overlay = document.getElementById("mc-drawer-overlay");
  overlay?.classList.remove("aberto");
  document.body.style.overflow = "";
}

// ─── PLACEHOLDER PARA MÓDULOS NÃO IMPLEMENTADOS ────────────────────
function _renderizarPlaceholder(container, label) {
  container.innerHTML = `
    <div style="
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 260px;
      gap: 12px;
      font-family: 'DM Sans', sans-serif;
      color: #bbb;
      text-align: center;
      padding: 40px 24px;
    ">
      <div style="font-size: 48px; opacity: .4;">🚧</div>
      <p style="font-size: 18px; font-weight: 700; color: #888; margin: 0;">
        ${label}
      </p>
      <p style="font-size: 13px; color: #bbb; margin: 0;">
        Módulo em desenvolvimento. Em breve disponível.
      </p>
    </div>
  `;
}

// ─── EXPORTS PADRÃO (objeto router para retrocompatibilidade) ───────
export const router = {
  navigate,
  canAccess,
  getMenuItems,
  getCurrentRoute,
  iniciarRouter,
};
