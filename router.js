// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · router.js · v3.0                                    ║
// ║  Roteamento de módulos — permissões por perfil e plano          ║
// ║  Módulo 05-B                                                    ║
// ╚══════════════════════════════════════════════════════════════════╝

import { notificar, renderSino } from "./notificacoes.js";
import { planGuard }             from "./planGuard.js";
import { logout }                from "./auth.js";
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
    group:       null,
    drawerOnly:  false,
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

  if (elNome)     elNome.textContent   = sessao.nomeEmpresa || "";
  if (avatarBtn)  avatarBtn.textContent = (sessao.nome || "U")[0].toUpperCase();
  if (userNome)   userNome.childNodes[0].textContent = sessao.nome || "";
  if (userPerfil) userPerfil.textContent = sessao.perfil === "admin" ? "Administrador" : "Operador";

  // ── Gerar itens do menu ───────────────────────────────────────
  let htmlMenu = "";
  let grupoAnterior = undefined;

  itens.forEach(item => {
    // Separador de grupo
    if (item.group !== null && item.group !== grupoAnterior) {
      if (grupoAnterior !== undefined) {
        htmlMenu += `<li class="mc-nav-separator" role="separator"></li>`;
      }
      if (item.group) {
        htmlMenu += `<li class="mc-nav-label">${item.group}</li>`;
      }
      grupoAnterior = item.group;
    }

    const badgePro = item.proOnly
      ? `<span class="mc-nav-pro-badge">PRO</span>`
      : "";

    htmlMenu += `
      <li role="none">
        <a class="mc-nav-item"
           href="javascript:void(0)"
           data-rota="${item.id}"
           role="menuitem"
           aria-label="${item.label}${item.proOnly ? ' (Profissional)' : ''}"
           title="${item.label}">
          <span class="mc-nav-icon">${item.icon}</span>
          <span>${item.label}</span>
          ${badgePro}
        </a>
      </li>
    `;
  });

  navMenu.innerHTML = htmlMenu;

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
  window._irParaConfiguracoes = (aba) => navigate("configuracoes");

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
  window._irParaConfiguracoes = () => navigate("configuracoes");
}

// ─── ATUALIZAR ITEM ATIVO NO MENU ──────────────────────────────────
function _atualizarMenuAtivo(routeId) {
  // Desktop: itens .mc-nav-item
  document.querySelectorAll(".mc-nav-item").forEach(el => {
    el.classList.toggle("ativo", el.dataset.rota === routeId);
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
