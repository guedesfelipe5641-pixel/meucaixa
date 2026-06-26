// modulos/configuracoes.js — M20 · Configurações (Etapas A + B)
// Abas: Empresa · Usuários · Aparência · Caixa · Assinatura · Suporte

import { db } from "../firebase-config.js";
import { notificar } from "../notificacoes.js";
import { registrarErro } from "../utils.js";
import { aplicarTemaDashboard } from "../theme.js";
import {
  doc, getDoc, updateDoc, serverTimestamp,
  collection, getDocs, query, where, addDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import {
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

// ─── Estado ─────────────────────────────────────────────────────────────────
let _sessao = null;
let _empresa = null;   // dados frescos do Firestore
let _unsubscribeAssinatura = null;

// ─── Ponto de entrada ────────────────────────────────────────────────────────
export async function renderizar(sessao, container) {
  _sessao = sessao;
  if (_unsubscribeAssinatura) { _unsubscribeAssinatura(); _unsubscribeAssinatura = null; }
  container.innerHTML = `<div style="padding:32px;text-align:center;color:#888">Carregando…</div>`;

  try {
    const snap = await getDoc(doc(db, "empresas", sessao.uid));
    _empresa = snap.exists() ? snap.data() : {};
    _renderShell(container);
  } catch (err) {
    registrarErro("configuracoes", err.message, "M20");
    container.innerHTML = `<p style="padding:24px;color:var(--erro)">Erro ao carregar configurações.</p>`;
  }
}

// ─── Shell com pill tabs ─────────────────────────────────────────────────────
function _renderShell(container) {
  const isPro = _sessao.plano === "profissional";
  const abaInicial = window._configuracoes_aba_inicial || "empresa";
  window._configuracoes_aba_inicial = null;

  container.innerHTML = `
    <div class="mc-modulo-header" style="padding:16px 20px 8px">
      <h2 style="font-size:1.1rem;font-weight:700;margin:0">Configurações</h2>
    </div>

    <div class="mc-pills" style="display:flex;gap:8px;padding:0 20px 0;overflow-x:auto;border-bottom:1px solid #e8e8e8;padding-bottom:0">
      ${_pill("empresa",    "Empresa",    abaInicial)}
      ${_pill("usuarios",   "Usuários",   abaInicial)}
      ${_pill("aparencia",  "Aparência",  abaInicial)}
      ${_pill("caixa",      "Caixa",      abaInicial)}
      ${_pill("assinatura", "Assinatura", abaInicial)}
      ${_pill("suporte",    "Suporte",    abaInicial)}
    </div>

    <div id="cfg-conteudo" style="padding:20px;max-width:680px"></div>`;

  container.querySelectorAll(".mc-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".mc-pill").forEach(b => b.classList.remove("ativo"));
      btn.classList.add("ativo");
      _abrirAba(btn.dataset.aba, container.querySelector("#cfg-conteudo"));
    });
  });

  _abrirAba(abaInicial, container.querySelector("#cfg-conteudo"));
}

function _pill(aba, label, ativo) {
  return `<button class="mc-pill${aba === ativo ? " ativo" : ""}" data-aba="${aba}"
    style="border-radius:0;border-bottom:2px solid ${aba === ativo ? "var(--primary)" : "transparent"};padding-bottom:10px">${label}</button>`;
}

function _abrirAba(aba, el) {
  const mapa = {
    empresa:    _abaEmpresa,
    usuarios:   _abaUsuarios,
    aparencia:  _abaAparencia,
    caixa:      _abaCaixa,
    assinatura: _abaAssinatura,
    suporte:    _abaSuporte,
  };
  (mapa[aba] || _abaEmpresa)(el);
}

// ─── ABA: EMPRESA ───────────────────────────────────────────────────────────
function _abaEmpresa(el) {
  const e = _empresa;
  el.innerHTML = `
    <h3 class="cfg-titulo">Dados da Empresa</h3>
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="mc-campo-grupo">
        <label class="mc-label">Nome da empresa *</label>
        <input id="cfg-nomeEmpresa" class="mc-input" value="${_esc(e.nomeEmpresa || "")}">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="mc-campo-grupo">
          <label class="mc-label">Telefone</label>
          <input id="cfg-telefone" class="mc-input" value="${_esc(e.telefone || "")}">
        </div>
        <div class="mc-campo-grupo">
          <label class="mc-label">E-mail</label>
          <input id="cfg-email" class="mc-input" type="email" value="${_esc(e.email || "")}">
        </div>
      </div>
      <div class="mc-campo-grupo">
        <label class="mc-label">Endereço completo</label>
        <input id="cfg-endereco" class="mc-input" placeholder="Rua, número, bairro, cidade" value="${_esc(e.endereco || "")}">
      </div>
      <div class="mc-campo-grupo">
        <label class="mc-label">Cidade</label>
        <input id="cfg-cidade" class="mc-input" placeholder="Ex: São Paulo - SP" value="${_esc(e.cidade || "")}">
      </div>
      <hr style="border:none;border-top:1px solid #eee">
      <h3 class="cfg-titulo">Alertas e Metas</h3>
      <div class="mc-campo-grupo">
        <label class="mc-label">E-mail para alertas</label>
        <input id="cfg-emailAlerta" class="mc-input" type="email" value="${_esc(e.emailAlerta || "")}">
        <small style="color:#888;font-size:.8rem">Recebe alertas de crediário e despesas vencendo</small>
      </div>
      <div class="mc-campo-grupo">
        <label class="mc-label">Meta mensal (R$)</label>
        <input id="cfg-metaMensal" class="mc-input" type="number" min="0" step="0.01" value="${e.metaMensal || 0}">
      </div>
      <div style="display:flex;justify-content:flex-end">
        <button id="btn-salvar-empresa" class="mc-btn mc-btn-primary">Salvar</button>
      </div>
    </div>`;

  el.querySelector("#btn-salvar-empresa").addEventListener("click", async () => {
    const nome = el.querySelector("#cfg-nomeEmpresa").value.trim();
    if (!nome) { notificar("aviso", "Atenção", "Nome da empresa é obrigatório."); return; }

    const dados = {
      nomeEmpresa:  nome,
      telefone:     el.querySelector("#cfg-telefone").value.trim(),
      email:        el.querySelector("#cfg-email").value.trim(),
      endereco:     el.querySelector("#cfg-endereco").value.trim(),
      cidade:       el.querySelector("#cfg-cidade").value.trim(),
      emailAlerta:  el.querySelector("#cfg-emailAlerta").value.trim(),
      metaMensal:   parseFloat(el.querySelector("#cfg-metaMensal").value) || 0,
    };

    await _salvar(dados);
    // Atualiza nome no header
    const headerNome = document.getElementById("mc-nome-empresa");
    if (headerNome) headerNome.textContent = nome;
  });
}

// ─── ABA: APARÊNCIA ─────────────────────────────────────────────────────────
function _abaAparencia(el) {
  const e = _empresa;
  const isPro = _sessao.plano === "profissional";
  const temaSalvo = e.temaVisual || "padrao";
  const layoutSalvo = e.layoutForcado || "auto";

  const temaAtualHtml = (nome, label, cor1, cor2) => {
    const selecionado = temaSalvo === nome;
    const bloqueado = !isPro && nome !== "padrao";
    return `<button class="cfg-card-tema${selecionado ? " selecionado" : ""}${bloqueado ? " bloqueado" : ""}"
      data-tema="${nome}" ${bloqueado ? "disabled" : ""} title="${label}">
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <div style="width:24px;height:24px;border-radius:6px;background:${cor1}"></div>
        <div style="width:24px;height:24px;border-radius:6px;background:${cor2}"></div>
      </div>
      <span style="font-size:.8rem;font-weight:500">${label}</span>
      ${bloqueado ? `<span style="font-size:.7rem;color:#f59e0b;display:block">PRO</span>` : ""}
      ${selecionado ? `<span style="font-size:.7rem;color:var(--primary);font-weight:600;display:block">✓ Ativo</span>` : ""}
    </button>`;
  };

  el.innerHTML = `
    <h3 class="cfg-titulo">Layout</h3>
    <div class="mc-campo-grupo">
      <label class="mc-label">Modo de exibição</label>
      <select id="cfg-layout" class="mc-input">
        <option value="auto" ${layoutSalvo === "auto" ? "selected" : ""}>Automático (detecta o dispositivo)</option>
        <option value="desktop" ${layoutSalvo === "desktop" ? "selected" : ""}>Sempre Desktop</option>
        <option value="mobile" ${layoutSalvo === "mobile" ? "selected" : ""}>Sempre Mobile</option>
      </select>
      <small style="color:#888;font-size:.8rem">Aplica no próximo login</small>
    </div>

    <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
    <h3 class="cfg-titulo">Logo da Empresa</h3>
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px">
      ${e.logoUrl
        ? `<img id="cfg-logo-preview" src="${e.logoUrl}" style="width:80px;height:80px;object-fit:contain;border:1px solid #eee;border-radius:8px;background:#f9f9f9">`
        : `<div id="cfg-logo-preview" style="width:80px;height:80px;border:2px dashed #ddd;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:.8rem">Sem logo</div>`
      }
      <div>
        <label class="mc-btn mc-btn-outline" style="cursor:pointer;font-size:.85rem">
          Escolher imagem
          <input id="cfg-logo-input" type="file" accept="image/*" style="display:none">
        </label>
        ${e.logoUrl ? `<button id="btn-remover-logo" class="mc-btn" style="display:block;margin-top:8px;font-size:.8rem;color:#b91c1c;background:none;border:none;cursor:pointer;padding:0">✕ Remover logo</button>` : ""}
        <small style="display:block;color:#888;font-size:.75rem;margin-top:6px">PNG ou JPG · máx. 2 MB · redimensionado para 800px</small>
      </div>
    </div>
    <div id="cfg-logo-status" style="display:none;font-size:.85rem;color:#888;margin-bottom:8px">Enviando…</div>

    <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
    <h3 class="cfg-titulo">Tema Visual ${isPro ? "" : `<span style="font-size:.75rem;color:#f59e0b;font-weight:400">(Lilás e Nude são exclusivos do Profissional)</span>`}</h3>
    <div id="cfg-temas" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      ${temaAtualHtml("padrao",  "Padrão",  "#6B3520", "#F0A335")}
      ${temaAtualHtml("lilas",   "Lilás",   "#7A5A9E", "#B49DCF")}
      ${temaAtualHtml("nude",    "Nude",    "#8B6555", "#ECDCC9")}
    </div>

    <div style="display:flex;justify-content:flex-end">
      <button id="btn-salvar-aparencia" class="mc-btn mc-btn-primary">Salvar</button>
    </div>`;

  // ── Logo upload ──
  el.querySelector("#cfg-logo-input")?.addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      notificar("aviso", "Arquivo grande", "Tamanho máximo: 2 MB."); return;
    }
    const statusEl = el.querySelector("#cfg-logo-status");
    statusEl.style.display = "block";
    statusEl.textContent = "Processando imagem…";

    try {
      const blob = await _redimensionarImagem(file, 800);
      statusEl.textContent = "Enviando para o servidor…";

      const storage = getStorage();
      const fileRef = ref(storage, `empresas/${_sessao.uid}/logo/logo.png`);
      await uploadBytes(fileRef, blob, { contentType: "image/png" });
      const logoUrl = await getDownloadURL(fileRef);

      await updateDoc(doc(db, "empresas", _sessao.uid), { logoUrl });
      _empresa.logoUrl = logoUrl;
      _atualizarSessao({ logoUrl });

      // Preview
      const prev = el.querySelector("#cfg-logo-preview");
      if (prev) { prev.outerHTML = `<img id="cfg-logo-preview" src="${logoUrl}?t=${Date.now()}" style="width:80px;height:80px;object-fit:contain;border:1px solid #eee;border-radius:8px;background:#f9f9f9">`; }

      statusEl.textContent = "✓ Logo salva com sucesso!";
      setTimeout(() => { statusEl.style.display = "none"; }, 3000);
      notificar("sucesso", "Logo atualizada!", "A logo aparecerá nos seus PDFs.");
    } catch (err) {
      registrarErro("logo_upload", err.message, "M20");
      statusEl.textContent = "Erro ao enviar logo.";
      notificar("erro", "Erro ao enviar", err.message);
    }
  });

  el.querySelector("#btn-remover-logo")?.addEventListener("click", async () => {
    await _salvar({ logoUrl: "" });
    _empresa.logoUrl = "";
    _atualizarSessao({ logoUrl: "" });
    _abaAparencia(el);
  });

  // ── Seleção de tema ──
  el.querySelectorAll(".cfg-card-tema").forEach(btn => {
    btn.addEventListener("click", () => {
      el.querySelectorAll(".cfg-card-tema").forEach(b => b.classList.remove("selecionado"));
      btn.classList.add("selecionado");
    });
  });

  // ── Salvar ──
  el.querySelector("#btn-salvar-aparencia").addEventListener("click", async () => {
    const layout = el.querySelector("#cfg-layout").value;
    const tema = el.querySelector(".cfg-card-tema.selecionado")?.dataset.tema || temaSalvo;
    await _salvar({ layoutForcado: layout, temaVisual: tema });
    _atualizarSessao({ layoutForcado: layout, temaVisual: tema });
    aplicarTemaDashboard(tema, _sessao.plano);
    notificar("informacao", "Layout", "A mudança de layout terá efeito no próximo login.");
  });
}

// ─── ABA: CAIXA ─────────────────────────────────────────────────────────────
function _abaCaixa(el) {
  const e = _empresa;
  const cfg          = e.configuracaoCaixa || {};
  const autoAbrir    = cfg.autoAbrir    ?? false;
  const autoFechar   = cfg.autoFechar   ?? false;
  const horaAbertura = cfg.horaAbertura || "08:00";
  const horaFechamento = cfg.horaFechamento || "18:00";
  const diasSalvos   = cfg.diasSemana   || [1,2,3,4,5]; // seg-sex default

  const DIAS = [
    { idx: 0, label: "Dom" }, { idx: 1, label: "Seg" }, { idx: 2, label: "Ter" },
    { idx: 3, label: "Qua" }, { idx: 4, label: "Qui" }, { idx: 5, label: "Sex" },
    { idx: 6, label: "Sáb" }
  ];

  const diasHtml = DIAS.map(d => `
    <label style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer">
      <input type="checkbox" class="cfg-dia" value="${d.idx}" ${diasSalvos.includes(d.idx) ? "checked" : ""}
        style="width:18px;height:18px;cursor:pointer">
      <span style="font-size:.8rem">${d.label}</span>
    </label>`).join("");

  el.innerHTML = `
    <h3 class="cfg-titulo">Caixa Automático</h3>
    <p style="font-size:.85rem;color:#666;margin-bottom:16px">Configure a abertura e fechamento automático do caixa nos dias e horários escolhidos.</p>

    <div style="display:flex;flex-direction:column;gap:20px">
      <div style="background:#f8f8f8;border-radius:10px;padding:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div>
            <div style="font-weight:600">Abertura automática</div>
            <div style="font-size:.8rem;color:#666">Abre o caixa automaticamente no horário definido</div>
          </div>
          <label class="cfg-toggle">
            <input id="cfg-autoAbrir" type="checkbox" ${autoAbrir ? "checked" : ""}>
            <span class="cfg-toggle-slider"></span>
          </label>
        </div>
        <div id="cfg-abertura-campos" style="${autoAbrir ? "" : "opacity:.5;pointer-events:none"}">
          <div class="mc-campo-grupo" style="margin-bottom:12px">
            <label class="mc-label">Horário de abertura</label>
            <input id="cfg-horaAbertura" class="mc-input" type="time" value="${horaAbertura}" style="max-width:160px">
          </div>
        </div>
      </div>

      <div style="background:#f8f8f8;border-radius:10px;padding:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div>
            <div style="font-weight:600">Fechamento automático</div>
            <div style="font-size:.8rem;color:#666">Fecha o caixa automaticamente no horário definido</div>
          </div>
          <label class="cfg-toggle">
            <input id="cfg-autoFechar" type="checkbox" ${autoFechar ? "checked" : ""}>
            <span class="cfg-toggle-slider"></span>
          </label>
        </div>
        <div id="cfg-fechamento-campos" style="${autoFechar ? "" : "opacity:.5;pointer-events:none"}">
          <div class="mc-campo-grupo">
            <label class="mc-label">Horário de fechamento</label>
            <input id="cfg-horaFechamento" class="mc-input" type="time" value="${horaFechamento}" style="max-width:160px">
          </div>
        </div>
      </div>

      <div style="background:#f8f8f8;border-radius:10px;padding:16px">
        <div style="font-weight:600;margin-bottom:10px">Dias de funcionamento</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap">${diasHtml}</div>
      </div>

      <div style="display:flex;justify-content:flex-end">
        <button id="btn-salvar-caixa" class="mc-btn mc-btn-primary">Salvar</button>
      </div>
    </div>`;

  // Toggles de habilitação de campos
  el.querySelector("#cfg-autoAbrir").addEventListener("change", e => {
    el.querySelector("#cfg-abertura-campos").style.cssText = e.target.checked ? "" : "opacity:.5;pointer-events:none";
  });
  el.querySelector("#cfg-autoFechar").addEventListener("change", e => {
    el.querySelector("#cfg-fechamento-campos").style.cssText = e.target.checked ? "" : "opacity:.5;pointer-events:none";
  });

  el.querySelector("#btn-salvar-caixa").addEventListener("click", async () => {
    const diasSelecionados = [...el.querySelectorAll(".cfg-dia:checked")].map(c => parseInt(c.value));
    const dados = {
      configuracaoCaixa: {
        autoAbrir:     el.querySelector("#cfg-autoAbrir").checked,
        autoFechar:    el.querySelector("#cfg-autoFechar").checked,
        horaAbertura:  el.querySelector("#cfg-horaAbertura").value,
        horaFechamento: el.querySelector("#cfg-horaFechamento").value,
        diasSemana:    diasSelecionados,
      },
    };
    await _salvar(dados);

    // Atualiza kit offline se online
    if (navigator.onLine) {
      try {
        const { baixarKitOffline } = await import("../syncManager.js");
        await baixarKitOffline();
      } catch { /* continua sem kit */ }
    }
  });
}

// ─── ABA: ASSINATURA ────────────────────────────────────────────────────────
function _abaAssinatura(el) {
  if (_unsubscribeAssinatura) { _unsubscribeAssinatura(); _unsubscribeAssinatura = null; }
  const e = _empresa;
  const s = _sessao;

  const statusLabel = {
    ativo:     { txt: "Ativo",     cor: "#15803d" },
    suspenso:  { txt: "Suspenso",  cor: "#b45309" },
    cancelado: { txt: "Cancelado", cor: "#b91c1c" },
  }[e.status] || { txt: e.status || "—", cor: "#666" };

  const planoLabel = { standard: "Standard", profissional: "Profissional" }[s.plano] || s.plano;

  const dataVenc = e.dataVencimento?.toDate
    ? e.dataVencimento.toDate().toLocaleDateString("pt-BR")
    : (e.dataVencimento ? new Date(e.dataVencimento * 1000).toLocaleDateString("pt-BR") : null);

  const temAssinatura = !!e.stripeSubscriptionId;

  el.innerHTML = `
    <h3 class="cfg-titulo">Plano Atual</h3>
    <div style="background:#f8f8f8;border-radius:10px;padding:20px;margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <div style="font-size:1.3rem;font-weight:700">${planoLabel}</div>
          <div style="margin-top:4px">
            <span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:.8rem;font-weight:600;background:${statusLabel.cor}22;color:${statusLabel.cor}">${statusLabel.txt}</span>
          </div>
        </div>
        <div style="text-align:right">
          ${e.assinaturaAtiva && dataVenc ? `<div style="font-size:.85rem;color:#555">Vence em:</div><div style="font-weight:600">${dataVenc}</div>` : ""}
          ${s.diasTrialRestantes > 0 ? `<div style="font-size:.85rem;color:#666">${s.diasTrialRestantes} dias de trial restantes</div>` : ""}
          ${e.stripeFormaPagamento ? `<div style="font-size:.8rem;color:#888;margin-top:4px">${_labelFormaPgto(e.stripeFormaPagamento)}</div>` : ""}
        </div>
      </div>
    </div>

    ${!e.assinaturaAtiva || !temAssinatura ? `
    <div style="margin-bottom:24px">
      <h3 class="cfg-titulo">Assinar agora</h3>
      <p style="font-size:.85rem;color:#666;margin-bottom:16px">Escolha um plano para continuar usando o MeuCaixa após o período de trial.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        ${_cardPlano("standard", "Standard", "R$ 54,90", "R$ 599,00")}
        ${_cardPlano("profissional", "Profissional", "R$ 89,90", "R$ 999,00")}
      </div>
      <div style="display:flex;gap:10px;margin-bottom:16px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.9rem">
          <input type="radio" name="cfg-periodo" value="mensal" checked> Mensal
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.9rem">
          <input type="radio" name="cfg-periodo" value="anual"> Anual (2 meses grátis)
        </label>
      </div>
      <div id="cfg-aviso-downgrade" style="display:none;margin-bottom:16px;padding:14px 16px;border-radius:10px;background:#fffbeb;border:1px solid #f0c040;font-size:.85rem;color:#92400e">
        <strong>⚠ Atenção — ao mudar para Standard você perderá:</strong>
        <ul style="margin:8px 0 0 18px;line-height:1.9">
          <li>💳 Módulo de <strong>Crediário</strong></li>
          <li>📋 Módulo de <strong>Folha de Pagamento</strong></li>
          <li>🎨 Temas visuais exclusivos (Pro)</li>
          <li>🔄 Sincronização manual (3×/dia)</li>
          <li>👥 Gestão avançada de operadores</li>
        </ul>
        <p style="margin-top:10px;font-size:.8rem;color:#b45309">Para voltar ao Profissional será necessária uma nova assinatura.</p>
      </div>
      <button id="btn-assinar" class="mc-btn mc-btn-primary" style="width:100%">Assinar agora →</button>
    </div>` : ""}

    ${temAssinatura ? `
    <div>
      <button id="btn-gerenciar" class="mc-btn mc-btn-outline" style="width:100%">Gerenciar assinatura (Stripe)</button>
      <p style="font-size:.8rem;color:#888;text-align:center;margin-top:8px">Cancele, atualize forma de pagamento ou troque de plano.</p>
    </div>` : ""}

    <div id="cfg-stripe-status" style="display:none;text-align:center;padding:16px;color:#888;font-size:.85rem">Redirecionando para o Stripe…</div>`;

  // Seleção de plano
  el.querySelectorAll(".cfg-card-plano").forEach(btn => {
    btn.addEventListener("click", () => {
      el.querySelectorAll(".cfg-card-plano").forEach(b => {
        b.classList.remove("selecionado");
        b.style.border = "2px solid #e0e0e0";
        b.style.background = "#fff";
      });
      btn.classList.add("selecionado");
      btn.style.border = "2px solid var(--primary)";
      btn.style.background = "#faf3ef";
      _atualizarAvisoBanner(el, btn.dataset.plano);
    });
  });

  // Botão Assinar
  el.querySelector("#btn-assinar")?.addEventListener("click", async () => {
    const plano = el.querySelector(".cfg-card-plano.selecionado")?.dataset.plano || "standard";
    const periodo = el.querySelector("input[name='cfg-periodo']:checked")?.value || "mensal";
    const status = el.querySelector("#cfg-stripe-status");
    status.style.display = "block";

    try {
      const fns = getFunctions();
      const criarCheckout = httpsCallable(fns, "criarCheckout");
      const result = await criarCheckout({ plano, periodo });
      window.location.href = result.data.url;
    } catch (err) {
      status.style.display = "none";
      registrarErro("checkout", err.message, "M20");
      notificar("erro", "Erro ao iniciar pagamento", "Tente novamente ou contate o suporte.");
    }
  });

  // Botão Gerenciar
  el.querySelector("#btn-gerenciar")?.addEventListener("click", async () => {
    const status = el.querySelector("#cfg-stripe-status");
    status.style.display = "block";

    try {
      const fns = getFunctions();
      const criarPortal = httpsCallable(fns, "criarPortal");
      const result = await criarPortal();
      window.location.href = result.data.url;
    } catch (err) {
      status.style.display = "none";
      registrarErro("portal", err.message, "M20");
      notificar("erro", "Erro ao abrir portal", "Tente novamente ou contate o suporte.");
    }
  });

  // Iniciar listener de atualização em tempo real (STRIPE-02)
  _iniciarListenerAssinatura(el);
}

function _cardPlano(valor, nome, mensal, anual) {
  const selecionado = _sessao.plano === valor;
  return `<button class="cfg-card-plano${selecionado ? " selecionado" : ""}" data-plano="${valor}"
    style="border:2px solid ${selecionado ? "var(--primary)" : "#e0e0e0"};border-radius:10px;padding:14px;text-align:left;cursor:pointer;background:#fff">
    <div style="font-weight:700;font-size:1rem">${nome}</div>
    <div style="font-size:.85rem;color:#555;margin-top:4px">${mensal}/mês</div>
    <div style="font-size:.75rem;color:#888">ou ${anual}/ano</div>
  </button>`;
}

function _labelFormaPgto(forma) {
  return { card: "Cartão", pix: "PIX", boleto: "Boleto" }[forma] || forma;
}

function _atualizarAvisoBanner(el, planoSelecionado) {
  const aviso = el.querySelector("#cfg-aviso-downgrade");
  if (!aviso) return;
  const isDowngrade = _sessao.plano === "profissional" && planoSelecionado === "standard";
  aviso.style.display = isDowngrade ? "block" : "none";
}

// ─── LISTENER DE ASSINATURA (STRIPE-02) ─────────────────────────────────────
// Atualiza aba automaticamente quando webhook alterar assinaturaAtiva/status
function _iniciarListenerAssinatura(el) {
  _unsubscribeAssinatura = onSnapshot(doc(db, "empresas", _sessao.uid), (snap) => {
    if (!snap.exists()) return;
    const dados = snap.data();
    if (dados.assinaturaAtiva !== _empresa.assinaturaAtiva || dados.status !== _empresa.status) {
      _empresa = { ..._empresa, ...dados };
      _abaAssinatura(el);
    }
  });
}

// ─── ABA: USUÁRIOS ──────────────────────────────────────────────────────────
async function _abaUsuarios(el) {
  const isPro = _sessao.plano === "profissional";

  if (!isPro) {
    el.innerHTML = `
      <div style="text-align:center;padding:40px 20px">
        <div style="font-size:2rem;margin-bottom:12px">👥</div>
        <h3 style="margin-bottom:8px">Gerenciar Operadores</h3>
        <p style="color:#666;font-size:.9rem;margin-bottom:20px">Adicione operadores para que sua equipe acesse o sistema com permissões limitadas. Disponível no plano <strong>Profissional</strong>.</p>
        <button class="mc-btn mc-btn-primary" onclick="window._irParaConfiguracoes?.('assinatura')">Ver planos →</button>
      </div>`;
    return;
  }

  el.innerHTML = `<div style="padding:24px;text-align:center;color:#888">Carregando operadores…</div>`;

  try {
    const q = query(
      collection(db, "usuarios"),
      where("empresaId", "==", _sessao.uid),
      where("perfil", "==", "operador")
    );
    const snap = await getDocs(q);
    const operadores = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const podeAdicionar = operadores.length < 2;

    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h3 class="cfg-titulo" style="margin:0">Operadores</h3>
        ${podeAdicionar
          ? `<button id="btn-add-operador" class="mc-btn mc-btn-primary" style="font-size:.85rem">+ Adicionar Operador</button>`
          : `<span style="font-size:.8rem;color:#888">Limite de 2 operadores atingido</span>`}
      </div>

      ${operadores.length === 0
        ? `<p style="color:#888;text-align:center;padding:32px">Nenhum operador cadastrado.</p>`
        : operadores.map(op => _htmlCardOperador(op)).join("")}`;

    // Listeners dos cards
    operadores.forEach(op => {
      // Toggle offline
      el.querySelector(`#toggle-offline-${op.id}`)?.addEventListener("change", async (ev) => {
        try {
          await updateDoc(doc(db, "usuarios", op.id), { permiteVendaOffline: ev.target.checked });
          notificar("sucesso", "Salvo!", `Venda offline ${ev.target.checked ? "liberada" : "bloqueada"} para ${op.nome || op.email}.`);
        } catch (err) {
          registrarErro("op_toggle_offline", err.message, "M20");
          notificar("erro", "Erro ao salvar", err.message);
        }
      });

      // Desconto
      el.querySelector(`#sel-desconto-${op.id}`)?.addEventListener("change", async (ev) => {
        try {
          await updateDoc(doc(db, "usuarios", op.id), { descontoPermitido: ev.target.value });
          notificar("sucesso", "Salvo!", `Permissão de desconto atualizada.`);
        } catch (err) {
          registrarErro("op_desconto", err.message, "M20");
          notificar("erro", "Erro ao salvar", err.message);
        }
      });

      // Toggle ativo
      el.querySelector(`#toggle-ativo-${op.id}`)?.addEventListener("change", async (ev) => {
        try {
          await updateDoc(doc(db, "usuarios", op.id), { ativo: ev.target.checked });
          notificar("sucesso", "Salvo!", `Operador ${ev.target.checked ? "ativado" : "desativado"}.`);
        } catch (err) {
          registrarErro("op_toggle_ativo", err.message, "M20");
          notificar("erro", "Erro ao salvar", err.message);
        }
      });
    });

    // Botão adicionar
    el.querySelector("#btn-add-operador")?.addEventListener("click", () => _modalAdicionarOperador(el));

  } catch (err) {
    registrarErro("cfg_usuarios", err.message, "M20");
    el.innerHTML = `<p style="color:var(--erro);padding:24px">Erro ao carregar operadores.</p>`;
  }
}

function _htmlCardOperador(op) {
  const ativo = op.ativo !== false;
  const permiteOffline = op.permiteVendaOffline !== false;
  const desconto = op.descontoPermitido || "ambos";
  const ultimaSync = op.ultimaSync
    ? new Date(op.ultimaSync).toLocaleString("pt-BR")
    : "Nunca";

  return `
    <div style="background:#f8f8f8;border-radius:10px;padding:16px;margin-bottom:12px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-weight:600">${_esc(op.nome || "—")}</div>
          <div style="font-size:.8rem;color:#666">${_esc(op.email || "")}</div>
          <div style="font-size:.75rem;color:#999;margin-top:2px">Última sync: ${ultimaSync}</div>
        </div>
        <label class="cfg-toggle" title="${ativo ? "Ativo" : "Inativo"}">
          <input id="toggle-ativo-${op.id}" type="checkbox" ${ativo ? "checked" : ""}>
          <span class="cfg-toggle-slider"></span>
        </label>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
        <div>
          <label style="font-size:.8rem;color:#555;display:block;margin-bottom:4px">Venda offline</label>
          <label class="cfg-toggle">
            <input id="toggle-offline-${op.id}" type="checkbox" ${permiteOffline ? "checked" : ""}>
            <span class="cfg-toggle-slider"></span>
          </label>
        </div>
        <div>
          <label style="font-size:.8rem;color:#555;display:block;margin-bottom:4px">Desconto permitido</label>
          <select id="sel-desconto-${op.id}" class="mc-input" style="font-size:.85rem;padding:6px 8px">
            <option value="ambos"      ${desconto === "ambos"      ? "selected" : ""}>Percentual e Fixo</option>
            <option value="percentual" ${desconto === "percentual" ? "selected" : ""}>Só Percentual</option>
            <option value="fixo"       ${desconto === "fixo"       ? "selected" : ""}>Só Fixo</option>
            <option value="nenhum"     ${desconto === "nenhum"     ? "selected" : ""}>Sem desconto</option>
          </select>
        </div>
      </div>
    </div>`;
}

function _modalAdicionarOperador(el) {
  const modal = document.createElement("div");
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;max-width:420px;width:100%">
      <h3 style="margin:0 0 16px;font-size:1rem">Adicionar Operador</h3>
      <div class="mc-campo-grupo" style="margin-bottom:12px">
        <label class="mc-label">Nome completo *</label>
        <input id="op-nome" class="mc-input" placeholder="Nome do operador">
      </div>
      <div class="mc-campo-grupo" style="margin-bottom:16px">
        <label class="mc-label">E-mail *</label>
        <input id="op-email" class="mc-input" type="email" placeholder="email@exemplo.com">
      </div>
      <p style="font-size:.8rem;color:#888;margin-bottom:16px">O operador receberá um e-mail para definir sua senha e acessar o sistema.</p>
      <div id="op-status" style="display:none;font-size:.85rem;color:#888;margin-bottom:12px;text-align:center">Cadastrando…</div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="op-cancelar" class="mc-btn mc-btn-outline">Cancelar</button>
        <button id="op-salvar" class="mc-btn mc-btn-primary">Cadastrar</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  modal.querySelector("#op-cancelar").addEventListener("click", () => modal.remove());

  modal.querySelector("#op-salvar").addEventListener("click", async () => {
    const nome  = modal.querySelector("#op-nome").value.trim();
    const email = modal.querySelector("#op-email").value.trim();
    if (!nome || !email) { notificar("aviso", "Atenção", "Preencha nome e e-mail."); return; }

    const statusEl = modal.querySelector("#op-status");
    statusEl.style.display = "block";
    statusEl.textContent = "Cadastrando operador…";

    try {
      const fns = getFunctions();
      const cadastrarOperador = httpsCallable(fns, "cadastrarOperador");
      await cadastrarOperador({ nome, email, empresaId: _sessao.uid });

      statusEl.textContent = "✓ Operador cadastrado! E-mail enviado.";
      notificar("sucesso", "Operador adicionado!", `${nome} receberá um e-mail para acessar o sistema.`);
      setTimeout(() => {
        modal.remove();
        _abaUsuarios(el);  // recarrega a lista
      }, 1500);
    } catch (err) {
      statusEl.style.display = "none";
      registrarErro("cadastrar_operador", err.message, "M20");
      notificar("erro", "Erro ao cadastrar", err.message);
    }
  });
}

// ─── ABA: SUPORTE ────────────────────────────────────────────────────────────
function _abaSuporte(el) {
  el.innerHTML = `
    <h3 class="cfg-titulo">Suporte</h3>
    <div style="background:#f8f8f8;border-radius:10px;padding:20px;margin-bottom:20px">
      <div style="font-weight:600;margin-bottom:4px">MeuCaixa Digital</div>
      <div style="font-size:.85rem;color:#666">Versão 1.0 · FSG Soluções Tecnológicas & Serviços</div>
      <div style="font-size:.8rem;color:#999;margin-top:8px">Para dúvidas urgentes, entre em contato pelo WhatsApp ou e-mail do suporte.</div>
    </div>

    <h3 class="cfg-titulo">Reportar Problema</h3>
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="mc-campo-grupo">
        <label class="mc-label">Tipo de problema</label>
        <select id="sup-tipo" class="mc-input">
          <option value="bug">Bug / Erro no sistema</option>
          <option value="lentidao">Lentidão</option>
          <option value="dado_errado">Dado incorreto / cálculo errado</option>
          <option value="sugestao">Sugestão de melhoria</option>
          <option value="outro">Outro</option>
        </select>
      </div>
      <div class="mc-campo-grupo">
        <label class="mc-label">Descrição *</label>
        <textarea id="sup-descricao" class="mc-input" style="min-height:120px;resize:vertical"
          placeholder="Descreva o que aconteceu, quando ocorreu e o que você estava fazendo…"></textarea>
      </div>
      <div id="sup-status" style="display:none;padding:10px;border-radius:8px;font-size:.85rem;text-align:center"></div>
      <div style="display:flex;justify-content:flex-end">
        <button id="btn-enviar-feedback" class="mc-btn mc-btn-primary">Enviar relatório</button>
      </div>
    </div>`;

  el.querySelector("#btn-enviar-feedback").addEventListener("click", async () => {
    const tipo      = el.querySelector("#sup-tipo").value;
    const descricao = el.querySelector("#sup-descricao").value.trim();
    if (!descricao) { notificar("aviso", "Atenção", "Descreva o problema antes de enviar."); return; }

    const btn = el.querySelector("#btn-enviar-feedback");
    const statusEl = el.querySelector("#sup-status");
    btn.disabled = true;
    statusEl.style.display = "block";
    statusEl.style.background = "#f0f0f0";
    statusEl.textContent = "Enviando…";

    try {
      await addDoc(collection(db, "feedback"), {
        tipo,
        descricao,
        empresaId: _sessao.uid,
        nomeEmpresa: _empresa.nomeEmpresa || "",
        enviadoPor: _sessao.email || "",
        resolvido: false,
        criadoEm: serverTimestamp(),
      });
      statusEl.style.background = "#dcfce7";
      statusEl.style.color = "#15803d";
      statusEl.textContent = "✓ Relatório enviado! Nossa equipe analisará em breve.";
      el.querySelector("#sup-descricao").value = "";
      notificar("sucesso", "Relatório enviado!", "Obrigado pelo feedback.");
    } catch (err) {
      registrarErro("feedback", err.message, "M20");
      statusEl.style.background = "#fee2e2";
      statusEl.style.color = "#b91c1c";
      statusEl.textContent = "Erro ao enviar. Tente novamente.";
      btn.disabled = false;
    }
  });
}

// ─── Utilitários ─────────────────────────────────────────────────────────────
async function _salvar(dados) {
  try {
    await updateDoc(doc(db, "empresas", _sessao.uid), { ...dados, updatedAt: serverTimestamp() });
    Object.assign(_empresa, dados);
    notificar("sucesso", "Configurações salvas!", "");
  } catch (err) {
    registrarErro("configuracoes_salvar", err.message, "M20");
    notificar("erro", "Erro ao salvar", err.message);
    throw err;
  }
}

function _atualizarSessao(delta) {
  try {
    const raw = localStorage.getItem("mc_sessao");
    if (!raw) return;
    const sessao = JSON.parse(raw);
    Object.assign(sessao, delta);
    localStorage.setItem("mc_sessao", JSON.stringify(sessao));
  } catch { /* ok */ }
}

function _esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function _redimensionarImagem(file, maxPx) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w > maxPx || h > maxPx) {
        if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob(resolve, "image/png", 0.92);
    };
    img.onerror = reject;
    img.src = url;
  });
}
