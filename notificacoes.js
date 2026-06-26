// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · notificacoes.js · v3.0                              ║
// ║  Sistema de notificações visuais + sino de histórico            ║
// ║  Módulo 03 — LocalStorage (sem Firestore; TTL 24h)              ║
// ╚══════════════════════════════════════════════════════════════════╝

// ─── CONSTANTES DE TIPO E COR ──────────────────────────────────────
const TIPOS = {
  sucesso:    { cor: "#2E7D32", icone: "✓", label: "Sucesso" },
  aviso:      { cor: "#F57F17", icone: "⚠", label: "Aviso" },
  erro:       { cor: "#C62828", icone: "✕", label: "Erro" },
  informacao: { cor: "#1565C0", icone: "ℹ", label: "Informação" },
  bloqueio:   { cor: "#E65100", icone: "⊘", label: "Bloqueado" },
};

// Chave do localStorage para lista de notificações
const CHAVE_LS = "mc_notificacoes";

// Duração da barra de progresso em ms
const DURACAO_MS = 7000;

// Referência ao overlay ativo (evita múltiplos sobrepostos — EC-01)
let _overlayAtivo = null;
let _timerAtivo   = null;

// Referência ao listener de mc:notificacao do sino (evita acúmulo ao re-renderizar)
let _sinoNotifListener = null;
// Referência ao listener de click-fora do sino
let _sinoClickListener = null;

// ─── GERADOR DE ID LOCAL ───────────────────────────────────────────
// Usado para IDs de notificações (sem dependência de utils.js)
function _gerarId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback para ambientes sem crypto.randomUUID (iOS antigo)
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── PERSISTÊNCIA NO LOCALSTORAGE ─────────────────────────────────
function _lerNotificacoes() {
  try {
    const raw = localStorage.getItem(CHAVE_LS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function _salvarNotificacoes(lista) {
  try {
    localStorage.setItem(CHAVE_LS, JSON.stringify(lista));
  } catch {
    // EC-02: localStorage cheio — falha silenciosa, não propagar erro
  }
}

// ─── LIMPAR NOTIFICAÇÕES EXPIRADAS ────────────────────────────────
/**
 * Remove do localStorage toda notificação com expiraEm < Date.now().
 * Deve ser chamada ao inicializar o app (passo 6 em app.html).
 */
export function limparNotificacoesExpiradas() {
  const agora = Date.now();
  const lista  = _lerNotificacoes();
  const vivas  = lista.filter(n => n.expiraEm > agora);
  _salvarNotificacoes(vivas);
}

// ─── INJETAR CSS DO OVERLAY (executado uma única vez) ──────────────
let _cssInjetado = false;
function _garantirCss() {
  if (_cssInjetado) return;
  _cssInjetado = true;

  const style = document.createElement("style");
  style.textContent = `
    /* ── Overlay de notificação ─────────────────────── */
    .mc-notif-overlay {
      position: fixed;
      inset: 0;
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,.45);
      animation: mcFadeIn .18s ease;
    }
    @keyframes mcFadeIn { from { opacity:0 } to { opacity:1 } }
    @keyframes mcFadeOut { from { opacity:1 } to { opacity:0 } }
    .mc-notif-overlay.saindo { animation: mcFadeOut .18s ease forwards; }

    .mc-notif-card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,.22);
      min-width: 300px;
      max-width: 90vw;
      overflow: hidden;
    }
    .mc-notif-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 18px 20px 14px;
    }
    .mc-notif-icone {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: 700;
      color: #fff;
      flex-shrink: 0;
    }
    .mc-notif-titulo {
      font-family: 'DM Sans', sans-serif;
      font-size: 15px;
      font-weight: 700;
      color: #1a1a1a;
      margin: 0;
    }
    .mc-notif-mensagem {
      font-family: 'DM Sans', sans-serif;
      font-size: 14px;
      color: #444;
      margin: 0;
      padding: 0 20px 16px;
      line-height: 1.5;
    }
    .mc-notif-footer {
      padding: 0 20px 18px;
      display: flex;
      justify-content: flex-end;
    }
    .mc-notif-btn {
      background: var(--mc-notif-cor, #1565C0);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 8px 24px;
      font-family: 'DM Sans', sans-serif;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity .15s;
    }
    .mc-notif-btn:hover { opacity: .85; }
    .mc-notif-progresso {
      height: 4px;
      background: var(--mc-notif-cor, #1565C0);
      width: 100%;
      transform-origin: left;
      transition: transform linear;
    }

    /* ── Sino (dropdown) ────────────────────────────── */
    .mc-sino-wrap { position: relative; display: inline-block; }
    .mc-sino-badge {
      position: absolute;
      top: -4px; right: -4px;
      background: #C62828;
      color: #fff;
      border-radius: 50%;
      min-width: 18px;
      height: 18px;
      font-size: 11px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }
    .mc-sino-dropdown {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      width: 320px;
      max-height: 420px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,.18);
      z-index: 9999;
      display: none;
      flex-direction: column;
      overflow: hidden;
    }
    .mc-sino-dropdown.aberto { display: flex; }
    .mc-sino-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid #f0f0f0;
    }
    .mc-sino-header span {
      font-family: 'DM Sans', sans-serif;
      font-size: 13px;
      font-weight: 700;
      color: #1a1a1a;
    }
    .mc-sino-marcar {
      font-family: 'DM Sans', sans-serif;
      font-size: 12px;
      color: #6B3520;
      background: none;
      border: none;
      cursor: pointer;
      text-decoration: underline;
      padding: 0;
    }
    .mc-sino-lista {
      overflow-y: auto;
      flex: 1;
    }
    .mc-sino-item {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 12px 16px;
      border-bottom: 1px solid #fafafa;
      transition: background .1s;
    }
    .mc-sino-item:hover { background: #fafafa; }
    .mc-sino-item.nao-lida { background: #f5f8ff; }
    .mc-sino-item-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-top: 5px;
      flex-shrink: 0;
    }
    .mc-sino-item-corpo { flex: 1; min-width: 0; }
    .mc-sino-item-titulo {
      font-family: 'DM Sans', sans-serif;
      font-size: 13px;
      font-weight: 600;
      color: #1a1a1a;
      margin: 0 0 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mc-sino-item-msg {
      font-family: 'DM Sans', sans-serif;
      font-size: 12px;
      color: #666;
      margin: 0 0 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mc-sino-item-hora {
      font-family: 'DM Sans', sans-serif;
      font-size: 11px;
      color: #aaa;
    }
    .mc-sino-vazio {
      padding: 32px 16px;
      text-align: center;
      font-family: 'DM Sans', sans-serif;
      font-size: 13px;
      color: #aaa;
    }
  `;
  document.head.appendChild(style);
}

// ─── FECHAR OVERLAY ────────────────────────────────────────────────
function _fecharOverlay() {
  if (!_overlayAtivo) return;
  clearTimeout(_timerAtivo);
  _overlayAtivo.classList.add("saindo");
  setTimeout(() => {
    _overlayAtivo?.remove();
    _overlayAtivo = null;
  }, 200);
}

// ─── NOTIFICAR ─────────────────────────────────────────────────────
/**
 * Exibe overlay centralizado com ícone, título, mensagem e barra de progresso.
 * Salva a notificação no localStorage com TTL de 24h.
 * Dispara o evento customizado "mc:notificacao" no document.
 *
 * @param {string} tipo      - "sucesso"|"aviso"|"erro"|"informacao"|"bloqueio"
 * @param {string} titulo    - Título da notificação
 * @param {string} mensagem  - Corpo da mensagem
 */
export function notificar(tipo, titulo, mensagem, opcoes = {}) {
  // Tipo inválido → fallback para informacao
  const cfg = TIPOS[tipo] || TIPOS.informacao;

  _garantirCss();

  // EC-01: se já há overlay visível, remove o anterior (substituição)
  if (_overlayAtivo) {
    clearTimeout(_timerAtivo);
    _overlayAtivo.remove();
    _overlayAtivo = null;
  }

  // ── Montar DOM ────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.className = "mc-notif-overlay";
  overlay.innerHTML = `
    <div class="mc-notif-card" style="--mc-notif-cor:${cfg.cor}">
      <div class="mc-notif-header">
        <div class="mc-notif-icone" style="background:${cfg.cor}">${cfg.icone}</div>
        <p class="mc-notif-titulo">${_escaper(titulo)}</p>
      </div>
      <p class="mc-notif-mensagem">${_escaper(mensagem)}</p>
      <div class="mc-notif-footer">
        <button class="mc-notif-btn" style="--mc-notif-cor:${cfg.cor}">OK</button>
      </div>
      <div class="mc-notif-progresso" id="_mc_prog"></div>
    </div>
  `;

  document.body.appendChild(overlay);
  _overlayAtivo = overlay;

  const autoClose  = opcoes.autoClose !== false;
  const labelBotao = opcoes.labelBotao || "OK";
  const onConfirm  = typeof opcoes.onConfirm === "function" ? opcoes.onConfirm : _fecharOverlay;

  // Atualizar label do botão
  overlay.querySelector(".mc-notif-btn").textContent = labelBotao;

  // ── Barra de progresso e auto-close ──────────────────
  if (autoClose) {
    const barra = overlay.querySelector("#_mc_prog");
    // Força reflow antes de aplicar transition para animação funcionar
    barra.getBoundingClientRect();
    barra.style.transition = `transform ${DURACAO_MS}ms linear`;
    barra.style.transform  = "scaleX(0)";
    _timerAtivo = setTimeout(_fecharOverlay, DURACAO_MS);
  } else {
    const barra = overlay.querySelector("#_mc_prog");
    if (barra) barra.style.display = "none";
  }

  // ── Botão: fecha overlay e executa callback ───────────
  overlay.querySelector(".mc-notif-btn").addEventListener("click", () => {
    if (onConfirm !== _fecharOverlay) _fecharOverlay();
    onConfirm();
  });

  // ── Persistir no localStorage ────────────────────────
  const entrada = {
    id:        _gerarId(),
    tipo,
    titulo,
    mensagem,
    lida:      false,
    criadoEm:  Date.now(),
    expiraEm:  Date.now() + 86400000, // 24h
  };

  try {
    const lista = _lerNotificacoes();
    lista.unshift(entrada);
    // Limita a 100 entradas para não crescer indefinidamente
    _salvarNotificacoes(lista.slice(0, 100));
  } catch {
    // EC-02: falha silenciosa se localStorage cheio
  }

  // ── Evento customizado ────────────────────────────────
  document.dispatchEvent(new CustomEvent("mc:notificacao", { detail: entrada }));
}

// ─── RENDER SINO ───────────────────────────────────────────────────
/**
 * Renderiza o botão do sino com badge de não lidas e dropdown de histórico.
 * Deve ser chamada passando o elemento container do sino no header.
 *
 * @param {HTMLElement} elementoSino - Container onde o sino será renderizado
 */
export function renderSino(elementoSino) {
  if (!elementoSino) return;
  _garantirCss();

  // Limpar notificações expiradas antes de renderizar (SC-006)
  limparNotificacoesExpiradas();

  const lista    = _lerNotificacoes();
  const naoLidas = lista.filter(n => !n.lida).length;

  // ── Montar estrutura do sino ──────────────────────────
  elementoSino.innerHTML = `
    <div class="mc-sino-wrap" id="_mc_sino_wrap">
      <button id="_mc_sino_btn" aria-label="Notificações" style="
        background:none; border:none; cursor:pointer;
        font-size:22px; position:relative; padding:4px;
      ">🔔</button>
      ${naoLidas > 0 ? `<span class="mc-sino-badge">${naoLidas > 99 ? "99+" : naoLidas}</span>` : ""}
      <div class="mc-sino-dropdown" id="_mc_sino_dd">
        <div class="mc-sino-header">
          <span>Notificações</span>
          <button class="mc-sino-marcar" id="_mc_sino_marcar">Marcar todas como lidas</button>
        </div>
        <div class="mc-sino-lista" id="_mc_sino_lista">
          ${_renderItens(lista)}
        </div>
      </div>
    </div>
  `;

  // ── Toggle dropdown ───────────────────────────────────
  const btn = elementoSino.querySelector("#_mc_sino_btn");
  const dd  = elementoSino.querySelector("#_mc_sino_dd");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    dd.classList.toggle("aberto");
  });

  // ── Fechar ao clicar fora (remove listener anterior para evitar acúmulo) ──
  if (_sinoClickListener) {
    document.removeEventListener("click", _sinoClickListener);
  }
  _sinoClickListener = (e) => {
    if (!elementoSino.contains(e.target)) {
      dd.classList.remove("aberto");
    }
  };
  document.addEventListener("click", _sinoClickListener);

  // ── Marcar todas como lidas ───────────────────────────
  elementoSino.querySelector("#_mc_sino_marcar").addEventListener("click", () => {
    const todas = _lerNotificacoes().map(n => ({ ...n, lida: true }));
    _salvarNotificacoes(todas);
    // Re-renderiza o sino com badge zerado
    renderSino(elementoSino);
  });

  // ── Atualiza ao receber nova notificação (remove listener anterior) ──
  if (_sinoNotifListener) {
    document.removeEventListener("mc:notificacao", _sinoNotifListener);
  }
  _sinoNotifListener = () => renderSino(elementoSino);
  document.addEventListener("mc:notificacao", _sinoNotifListener);
}

// ─── HELPERS PRIVADOS ──────────────────────────────────────────────

/** Escapa HTML para evitar XSS nos textos de notificação */
function _escaper(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Formata timestamp para exibição amigável (ex: "há 3 min") */
function _tempoRelativo(ts) {
  const diff = Date.now() - ts;
  const min  = Math.floor(diff / 60000);
  if (min < 1)   return "agora";
  if (min < 60)  return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)    return `há ${h}h`;
  return `há ${Math.floor(h / 24)} dia(s)`;
}

/** Renderiza itens da lista de notificações para o dropdown do sino */
function _renderItens(lista) {
  // EC-03: lista vazia — estado vazio amigável
  if (!lista.length) {
    return `<div class="mc-sino-vazio">Nenhuma notificação</div>`;
  }

  return lista.map(n => {
    const cfg = TIPOS[n.tipo] || TIPOS.informacao;
    return `
      <div class="mc-sino-item ${n.lida ? "" : "nao-lida"}">
        <div class="mc-sino-item-dot" style="background:${cfg.cor}"></div>
        <div class="mc-sino-item-corpo">
          <p class="mc-sino-item-titulo">${_escaper(n.titulo)}</p>
          <p class="mc-sino-item-msg">${_escaper(n.mensagem)}</p>
          <span class="mc-sino-item-hora">${_tempoRelativo(n.criadoEm)}</span>
        </div>
      </div>
    `;
  }).join("");
}
