// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · syncManager.js · v3.0                               ║
// ║  Sincronização offline/online — ciclo em cadeia sequencial      ║
// ║  Módulo 06 (Etapas A + B)                                       ║
// ║  ⚠️ CRÍTICO — testar em dispositivo físico iOS antes do M07     ║
// ╚══════════════════════════════════════════════════════════════════╝

import { db }                   from "./firebase-config.js";
import { registrarErro }        from "./utils.js";
import { notificar }            from "./notificacoes.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocFromServer,
  serverTimestamp,
  addDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── CHAVES DE LOCALSTORAGE ────────────────────────────────────────
const LS_KIT_OFFLINE       = "mc_kit_offline";
const LS_SYNC_MANUAL_HOJE  = "mc_sync_manual_hoje";
const LS_ULTIMA_SYNC       = "mc_ultima_sync";
const LS_CONFLITOS         = "mc_conflitos_resolvidos";

// ─── LIMITES ───────────────────────────────────────────────────────
const MAX_TENTATIVAS_VENDA     = 5;
const MAX_SYNC_MANUAL_DIA      = 3;
const INTERVALO_SYNC_MS        = 15 * 60 * 1000; // 15 minutos (Pro)
const LIMITE_HORAS_TRAVA       = 24;

// ─── ESTADO INTERNO (escopo do módulo) ────────────────────────────
let sincronizandoAgora   = false;  // Mutex — RISCO-04
let _empresaId           = null;
let _perfil              = null;
let _plano               = null;
let _ciclosConcluidos    = 0;
let _intervalId          = null;
let _onlineListener      = null;
let _offlineListener     = null;
let _unsubComandos       = null;   // listener de comandos Admin→Operador

// ─── INICIALIZAR SYNC ─────────────────────────────────────────────
/**
 * Inicia o SyncManager: registra listeners de rede, agenda ciclos.
 * Chamado pelo app.html como passo 14 do carregamento.
 *
 * @param {string} empresaId
 * @param {string} perfil  - "admin" | "operador"
 * @param {string} plano   - "standard" | "profissional"
 */
export async function inicializar(empresaId, perfil, plano) {
  _empresaId = empresaId;
  _perfil    = perfil;
  _plano     = plano;

  // Listener: volta online → dispara ciclo imediatamente
  _onlineListener = () => cicloSincronizacao();
  window.addEventListener("online", _onlineListener);

  // Listener: vai offline → atualiza estado
  _offlineListener = () => {
    // Sem ação — Firestore SDK gerencia automaticamente
  };
  window.addEventListener("offline", _offlineListener);

  // Intervalo de 15 minutos (somente Profissional)
  if (plano === "profissional") {
    _intervalId = setInterval(() => {
      if (navigator.onLine) cicloSincronizacao();
    }, INTERVALO_SYNC_MS);
  }

  // Listener de comandos Admin→Operador (somente Profissional + Operador)
  if (plano === "profissional" && perfil === "operador") {
    _iniciarListenerComandos(empresaId);
  }

  // Primeiro ciclo imediato se online
  if (navigator.onLine) {
    await cicloSincronizacao();
  }
}

// ─── PARAR SYNC ────────────────────────────────────────────────────
export function pararSync() {
  if (_intervalId)       clearInterval(_intervalId);
  if (_onlineListener)   window.removeEventListener("online",  _onlineListener);
  if (_offlineListener)  window.removeEventListener("offline", _offlineListener);
  if (_unsubComandos)    _unsubComandos();
  sincronizandoAgora = false;
}

// ─── STATUS DO SYNC ────────────────────────────────────────────────
export function statusSync() {
  return {
    online:          navigator.onLine,
    ultimoSync:      _lerUltimoSync(),
    ciclosCompletos: _ciclosConcluidos,
    pendentes:       obterPendentes().length,
  };
}

// ─── CICLO PRINCIPAL DE SINCRONIZAÇÃO ─────────────────────────────
/**
 * Executa os 5 passos em cadeia sequencial via await.
 * Se qualquer passo falhar, o ciclo para e recomeça do 1 na próxima tentativa.
 * Mutex sincronizandoAgora impede execuções paralelas (RISCO-04, EC-06).
 */
export async function cicloSincronizacao() {
  // EC-06 / EC-07: abortado se offline ou mutex ativo
  if (!navigator.onLine)      return;
  if (sincronizandoAgora)     return; // EC-06

  sincronizandoAgora = true; // mutex — liberado no finally (RISCO-04)

  try {
    // PASSO 1: enviar vendas
    await enviarVendasPendentes();

    // PASSO 2: enviar movimentações
    await enviarMovimentacoesPendentes();

    // PASSO 3: enviar demais documentos
    await enviarDemaisPendentes();

    // PASSO 4: baixar kit offline (getDocFromServer — forçar servidor)
    await baixarKitOffline();

    // PASSO 5: verificar permissões offline (NUNCA antes do passo 4 — RISCO-01)
    await verificarPermissaoOffline();

    // PASSO 6: atualizar mc_sessao com dados frescos do kit (Fix T-M06-22)
    _atualizarSessaoComDadosFrescos(_lerKitOffline());

    // Ciclo concluído com sucesso
    _ciclosConcluidos++;
    _salvarUltimoSync(Date.now());

    notificar("sucesso", "Sincronização concluída", "Dados atualizados com sucesso.");

  } catch (e) {
    // Falha em qualquer passo: ciclo para, recomeça do 1 na próxima tentativa
    // Fix T-M06-30: catch sempre chamado, mesmo em timeout silencioso de rede
    await registrarErro("sync", e?.message || String(e), "syncManager.js");
    notificar("erro", "Falha na sincronização", "Tentaremos novamente na próxima oportunidade.");
  } finally {
    // Mutex sempre liberado — mesmo em caso de erro (RISCO-04)
    sincronizandoAgora = false;
  }
}

// ─── PASSO 1: ENVIAR VENDAS PENDENTES ────────────────────────────
/**
 * Busca vendas com sincronizado: false no cache Firestore local.
 * Verifica UUID no servidor antes de gravar (idempotência).
 * Vendas com 5+ tentativas são isoladas (RISCO-05, EC-05).
 */
async function enviarVendasPendentes() {
  if (!_empresaId) return;

  const vendasRef = collection(db, "empresas", _empresaId, "vendas");
  const q         = query(vendasRef, where("sincronizado", "==", false));
  const snap      = await getDocs(q);

  if (snap.empty) return;

  for (const docSnap of snap.docs) {
    const venda   = docSnap.data();
    const vendaId = docSnap.id;

    // EC-05: isolar venda após MAX_TENTATIVAS_VENDA falhas
    const tentativas = venda.tentativasSincronizacao || 0;
    if (tentativas >= MAX_TENTATIVAS_VENDA) {
      // Isolar: marcar como problemática e registrar erro
      try {
        await updateDoc(docSnap.ref, { isolada: true });
        await registrarErro(
          "venda_isolada",
          `Venda ${vendaId} isolada após ${tentativas} tentativas.`,
          "syncManager.js"
        );
      } catch { /* catch independente — não bloqueia demais */ }
      continue; // próxima venda
    }

    try {
      // ── Idempotência: verificar se UUID já existe no servidor ──
      // EC-02: UUID duplicado → ignorado sem erro
      const vendaNoServidor = await getDoc(docSnap.ref);
      if (vendaNoServidor.exists() && vendaNoServidor.data().sincronizado === true) {
        // Já sincronizada (provavelmente por outro dispositivo)
        await updateDoc(docSnap.ref, { sincronizado: true });
        continue;
      }

      // ── Enviar para o servidor ─────────────────────────────────
      await setDoc(docSnap.ref, {
        ...venda,
        sincronizado:            true,
        sincronizadoEm:          serverTimestamp(),
        tentativasSincronizacao: tentativas, // preserva contagem
      }, { merge: true });

    } catch (e) {
      // Incrementar contador de tentativas (não bloqueia próximas vendas)
      try {
        await updateDoc(docSnap.ref, {
          tentativasSincronizacao: tentativas + 1
        });
      } catch { /* silencioso */ }

      // Registrar erro mas continuar com próxima venda
      await registrarErro("enviar_venda", e?.message || String(e), "syncManager.js");

      // Propagar apenas se for problema de rede (abortará o ciclo)
      if (e?.code === "unavailable" || !navigator.onLine) throw e;
    }
  }
}

// ─── PASSO 2: ENVIAR MOVIMENTAÇÕES PENDENTES ─────────────────────
async function enviarMovimentacoesPendentes() {
  if (!_empresaId) return;

  // Busca todas as sessões de caixa abertas com movimentações não sincronizadas
  const caixaRef = collection(db, "empresas", _empresaId, "caixa");
  const caixaSnap = await getDocs(caixaRef);

  for (const caixaDoc of caixaSnap.docs) {
    const movRef = collection(db, "empresas", _empresaId, "caixa", caixaDoc.id, "movimentacoes");
    const qMov   = query(movRef, where("sincronizado", "==", false));
    const movSnap = await getDocs(qMov);

    for (const movDoc of movSnap.docs) {
      try {
        // Idempotência por ID do documento
        await setDoc(movDoc.ref, {
          ...movDoc.data(),
          sincronizado:   true,
          sincronizadoEm: serverTimestamp(),
        }, { merge: true });
      } catch (e) {
        await registrarErro("enviar_mov", e?.message || String(e), "syncManager.js");
        if (e?.code === "unavailable" || !navigator.onLine) throw e;
      }
    }
  }
}

// ─── PASSO 3: ENVIAR DEMAIS PENDENTES ────────────────────────────
/**
 * Envia documentos de outras coleções (estoque, etc.) com sincronizado: false.
 */
async function enviarDemaisPendentes() {
  if (!_empresaId) return;

  const COLECOES_PENDENTES = ["estoque"];

  for (const colecao of COLECOES_PENDENTES) {
    try {
      const colRef  = collection(db, "empresas", _empresaId, colecao);
      const qPend   = query(colRef, where("sincronizado", "==", false));
      const snap    = await getDocs(qPend);

      for (const docSnap of snap.docs) {
        try {
          await setDoc(docSnap.ref, {
            ...docSnap.data(),
            sincronizado:   true,
            sincronizadoEm: serverTimestamp(),
          }, { merge: true });
        } catch (e) {
          await registrarErro("enviar_doc", e?.message || String(e), "syncManager.js");
          if (e?.code === "unavailable" || !navigator.onLine) throw e;
        }
      }
    } catch (e) {
      // Erro na coleção — continua para próxima coleção se for recuperável
      if (e?.code === "unavailable" || !navigator.onLine) throw e;
      await registrarErro("enviar_colecao", e?.message || String(e), "syncManager.js");
    }
  }
}

// ─── PASSO 4: BAIXAR KIT OFFLINE ─────────────────────────────────
/**
 * Leitura forçada do servidor via getDocFromServer.
 * NUNCA usa cache Firestore — garante dados frescos de controle de acesso.
 * (Decisão 2: getDocFromServer obrigatório — RISCO-02)
 */
async function baixarKitOffline() {
  if (!_empresaId) return;

  // EC-03: se getDocFromServer falhar (timeout), o erro propaga e o ciclo para
  // Fix T-M06-30: Promise.race com timeout 10s evita hang silencioso de rede
  const empRef  = doc(db, "empresas", _empresaId);
  const _timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timeout_kit_offline")), 10000)
  );
  const empSnap = await Promise.race([getDocFromServer(empRef), _timeout]);

  if (!empSnap.exists()) {
    throw new Error("Documento de empresa não encontrado no servidor.");
  }

  const empresa = empSnap.data();

  // ── Construir kit offline ─────────────────────────────────────
  // vendasOfflineHoje: resetado APENAS pelo servidor (RISCO-02)
  // Lemos o contador atual do kit local e só zeramos se o servidor confirmar
  const kitAtual = _lerKitOffline();

  // Verificar se o servidor confirma reset do contador
  // (servidor envia vendasOfflineHoje: 0 quando reinicia o dia)
  const vendasHojeServidor = empresa.vendasOfflineHoje ?? 0;
  const dataContadorServidor = empresa.dataContador || "";

  const kit = {
    produtos:             [],          // preenchido por módulos de produtos
    clientes:             [],          // preenchido por módulos de clientes
    limiteVendasOffline:  empresa.limiteVendasOffline ?? (_plano === "profissional" ? 30 : 8),
    descontoPermitido:    empresa.descontoPermitido   || "ambos",
    configuracaoCaixa:    empresa.configuracaoCaixa   || {},
    permiteVendaOffline:  empresa.permiteVendaOffline !== false,
    // RISCO-02: contador vem do servidor, não do relógio local
    vendasOfflineHoje:    vendasHojeServidor,
    dataContador:         dataContadorServidor,
    plano:                empresa.plano,
    temaVisual:           empresa.temaVisual,
    layoutForcado:        empresa.layoutForcado,
    atualizadoEm:         new Date().toISOString(),
    // Fix T-M06-22: campos voláteis para atualizar mc_sessao entre logins
    trialExpira:          empresa.trialExpira?.toMillis?.() ?? empresa.trialExpira ?? null,
    status:               empresa.status,
    assinaturaAtiva:      empresa.assinaturaAtiva || false,
  };

  // Popular kit com produtos e clientes para uso offline
  // Sem orderBy para evitar índice composto — ordenação feita client-side
  try {
    const [prodSnap, cliSnap] = await Promise.all([
      getDocs(query(collection(db, "empresas", _empresaId, "produtos"), where("ativo", "==", true))),
      getDocs(query(collection(db, "empresas", _empresaId, "clientes"), where("ativo", "==", true))),
    ]);
    kit.produtos = prodSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
    kit.clientes = cliSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
  } catch (err) {
    console.warn("Kit: falha ao carregar produtos/clientes:", err.message);
  }

  _salvarKitOffline(kit);

  // SC-008: timestamp de atualização verificável
  window._kitOfflineAtualizadoEm = kit.atualizadoEm;
}

// ─── PASSO 5: VERIFICAR PERMISSÃO OFFLINE ────────────────────────
/**
 * Verifica permissões com dados FRESCOS do Passo 4.
 * NUNCA é executado antes do Passo 4 (RISCO-01).
 * EC-10: kit ausente → exige sync antes de vender offline.
 */
async function verificarPermissaoOffline() {
  const kit = _lerKitOffline();
  if (!kit) {
    // EC-10: iOS limpou IndexedDB/localStorage — bloqueia venda offline
    window._kitOfflineValido = false;
    return;
  }
  window._kitOfflineValido = true;
}

// ─── PODE VENDER OFFLINE? ─────────────────────────────────────────
/**
 * Retorna { pode: boolean, motivo: string } avaliando 4 condições em ordem.
 * EC-08: campo ausente no kit → trata como false (fail-safe).
 *
 * @returns {{ pode: boolean, motivo: string }}
 */
export function podeVenderOffline() {
  // Admin: sempre pode
  if (_perfil === "admin") return { pode: true, motivo: "" };

  const kit = _lerKitOffline();

  // EC-10: sem kit offline (iOS limpou dados)
  if (!kit) return { pode: false, motivo: "kit_ausente" };

  // 1. Verificar permissão do Operador (EC-08: ausente = false)
  // Fix T-M06-19: campo ausente/undefined deve bloquear (fail-safe), não passar adiante
  if (kit.permiteVendaOffline !== true) {
    return { pode: false, motivo: "sem_permissao" };
  }

  // 2. Trava 24h (SC-004)
  const ultimoSync = _lerUltimoSync();
  if (ultimoSync) {
    const horasDesdeSync = (Date.now() - ultimoSync) / (1000 * 60 * 60);
    if (horasDesdeSync > LIMITE_HORAS_TRAVA) {
      return { pode: false, motivo: "sync_expirada" };
    }
  } else {
    // Nunca sincronizou neste dispositivo → bloqueio preventivo
    return { pode: false, motivo: "sync_expirada" };
  }

  // 3. Limite diário (SC-005, SC-006)
  const vendas  = kit.vendasOfflineHoje   ?? 0;
  const limite  = kit.limiteVendasOffline ?? (_plano === "profissional" ? 30 : 8);
  if (vendas >= limite) {
    return { pode: false, motivo: "limite_atingido" };
  }

  return { pode: true, motivo: "" };
}

// ─── INCREMENTAR VENDA OFFLINE ────────────────────────────────────
/**
 * Chamado pelo vendas.js ao finalizar uma venda offline.
 * Incrementa vendasOfflineHoje no localStorage.
 * NUNCA reseta o contador — apenas o Passo 4 faz isso (RISCO-02).
 */
export function incrementarVendaOffline() {
  const kit = _lerKitOffline();
  if (!kit) return;
  kit.vendasOfflineHoje = (kit.vendasOfflineHoje || 0) + 1;
  _salvarKitOffline(kit);
}

// ─── GET VENDAS OFFLINE HOJE ──────────────────────────────────────
export function getVendasOfflineHoje() {
  return _lerKitOffline()?.vendasOfflineHoje ?? 0;
}

// ─── GET ÚLTIMA SINCRONIZAÇÃO ─────────────────────────────────────
export function getUltimaSync() {
  const ts = _lerUltimoSync();
  return ts ? new Date(ts) : null;
}

// ─── SINCRONIZAÇÃO MANUAL (Admin Pro) ────────────────────────────
/**
 * Botão manual do Admin Profissional.
 * Máximo MAX_SYNC_MANUAL_DIA disparos/dia.
 * Contador reset à meia-noite (comparação por dataContador).
 *
 * @returns {Promise<{ ok: boolean, erro?: string }>}
 */
export async function sincronizarManual() {
  if (_plano !== "profissional" || _perfil !== "admin") {
    return { ok: false, erro: "Sincronização manual disponível apenas para Admin Profissional." };
  }

  // ── Verificar limite diário ────────────────────────────────────
  const contadorRaw   = localStorage.getItem(LS_SYNC_MANUAL_HOJE);
  const hoje          = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  let contador        = { data: hoje, usos: 0 };

  try {
    if (contadorRaw) {
      const parsed = JSON.parse(contadorRaw);
      // Reset se mudou o dia
      contador = (parsed.data === hoje) ? parsed : { data: hoje, usos: 0 };
    }
  } catch { contador = { data: hoje, usos: 0 }; }

  if (contador.usos >= MAX_SYNC_MANUAL_DIA) {
    return {
      ok: false,
      erro: `Limite de ${MAX_SYNC_MANUAL_DIA} sincronizações manuais/dia atingido.`
    };
  }

  // Incrementar e salvar
  contador.usos++;
  try { localStorage.setItem(LS_SYNC_MANUAL_HOJE, JSON.stringify(contador)); } catch { /* silencioso */ }

  // ── Executar ciclo imediatamente ──────────────────────────────
  try {
    await cicloSincronizacao();
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e?.message || String(e) };
  }
}

// ─── OBTER PENDENTES ─────────────────────────────────────────────
/**
 * Retorna array de itens pendentes com contagem por coleção.
 * Baseia-se no que o Firestore offline retornou na última consulta local.
 */
export function obterPendentes() {
  // Como usamos Firestore cache (não localStorage), esta função retorna
  // o estado conhecido do último ciclo de consulta.
  // Em produção, seria preenchida durante o ciclo de sync.
  try {
    const raw = localStorage.getItem("mc_pendentes_count");
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ─── COMUNICAÇÃO ADMIN → OPERADOR (Pro) ──────────────────────────
/**
 * Operador escuta comandos em empresas/{id}/comandos/{operadorId}.
 * Disponível apenas em plano Profissional.
 */
function _iniciarListenerComandos(empresaId) {
  const sessao = (() => {
    try { return JSON.parse(localStorage.getItem("mc_sessao")); } catch { return null; }
  })();
  const usuarioId = sessao?.uid;
  if (!usuarioId) return;

  const cmdRef = doc(db, "empresas", empresaId, "comandos", usuarioId);

  try {
    _unsubComandos = onSnapshot(cmdRef, async (snap) => {
      if (!snap.exists()) return;
      const cmd = snap.data();
      if (!cmd?.acao) return;

      // Executar comando recebido
      const resultado = await _executarComando(cmd.acao, cmd.parametros);

      // Reportar resultado ao Admin em status/{operadorId}
      try {
        const statusRef = doc(db, "empresas", empresaId, "status", usuarioId);
        await setDoc(statusRef, {
          acao:           cmd.acao,
          resultado,
          executadoEm:    serverTimestamp(),
          operadorId:     usuarioId,
        }, { merge: true });
      } catch (e) {
        await registrarErro("status_cmd", e?.message || String(e), "syncManager.js");
      }
    });
  } catch (e) {
    registrarErro("listener_cmd", e?.message || String(e), "syncManager.js");
  }
}

/**
 * Executa um comando recebido do Admin.
 * Retorna o resultado para reportar em status/.
 */
async function _executarComando(acao, parametros) {
  switch (acao) {
    case "revogarVendaOffline": {
      // Admin revogou permissão de venda offline deste operador
      const kit = _lerKitOffline();
      if (kit) {
        kit.permiteVendaOffline = false;
        _salvarKitOffline(kit);
      }
      notificar("aviso", "Permissão alterada", "Sua permissão de venda offline foi alterada pelo administrador.");
      return { ok: true, msg: "permissao_revogada" };
    }
    case "forcarcSync": {
      // Admin solicitou sync imediata
      await cicloSincronizacao();
      return { ok: true, msg: "sync_executada" };
    }
    default:
      return { ok: false, msg: "acao_desconhecida" };
  }
}

// ─── HELPERS PRIVADOS ─────────────────────────────────────────────

/**
 * Fix T-M06-22: após cada ciclo, regrava mc_sessao com dados frescos do kit.
 * Atualiza diasTrialRestantes, status e assinaturaAtiva sem exigir novo login.
 */
function _atualizarSessaoComDadosFrescos(kit) {
  if (!kit) return;
  try {
    const raw = localStorage.getItem("mc_sessao");
    if (!raw) return;
    const sessao = JSON.parse(raw);

    // Recalcular diasTrialRestantes a partir do trialExpira do servidor
    if (kit.trialExpira) {
      const msRestantes = kit.trialExpira - Date.now();
      sessao.diasTrialRestantes = Math.max(0, Math.ceil(msRestantes / (1000 * 60 * 60 * 24)));
    } else {
      sessao.diasTrialRestantes = 0;
    }

    // Atualizar campos voláteis que podem mudar sem novo login
    if (kit.status          !== undefined) sessao.status          = kit.status;
    if (kit.assinaturaAtiva !== undefined) sessao.assinaturaAtiva = kit.assinaturaAtiva;
    if (kit.plano           !== undefined) sessao.plano           = kit.plano;

    localStorage.setItem("mc_sessao", JSON.stringify(sessao));
    window.dispatchEvent(new CustomEvent("mc:sessao-atualizada", { detail: sessao }));
  } catch { /* silencioso — EC-02 */ }
}

function _lerKitOffline() {
  try {
    const raw = localStorage.getItem(LS_KIT_OFFLINE);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function _salvarKitOffline(kit) {
  try { localStorage.setItem(LS_KIT_OFFLINE, JSON.stringify(kit)); } catch { /* silencioso */ }
}

function _lerUltimoSync() {
  const raw = localStorage.getItem(LS_ULTIMA_SYNC);
  return raw ? parseInt(raw, 10) : null;
}

function _salvarUltimoSync(timestamp) {
  try { localStorage.setItem(LS_ULTIMA_SYNC, String(timestamp)); } catch { /* silencioso */ }
}

// ─── EXPORT PADRÃO (objeto syncManager para app.html) ─────────────
export const syncManager = {
  inicializar,
  pararSync,
  statusSync,
  cicloSincronizacao,
  podeVenderOffline,
  incrementarVendaOffline,
  getVendasOfflineHoje,
  getUltimaSync,
  sincronizarManual,
  obterPendentes,
};
