// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · auth.js · v4.2                                      ║
// ║  Autenticação Firebase · Sessão · Trial · Acesso                ║
// ╚══════════════════════════════════════════════════════════════════╝

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  deleteUser,
  sendPasswordResetEmail,
  sendEmailVerification,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { auth, db } from "./firebase-config.js";

// ─── VERSÃO DO APP ─────────────────────────────────────────────────
export const VERSAO_APP = "3.0.0";

// ─── SESSÃO LOCAL ──────────────────────────────────────────────────
let _sessao = null;

export function getSessao() {
  if (_sessao) return _sessao;
  const raw = localStorage.getItem("mc_sessao");
  if (!raw) return null;
  try { _sessao = JSON.parse(raw); return _sessao; } catch { return null; }
}

function salvarSessao(dados) {
  _sessao = dados;
  localStorage.setItem("mc_sessao", JSON.stringify(dados));
}

function limparSessao() {
  _sessao = null;
  localStorage.removeItem("mc_sessao");
  localStorage.removeItem("mc_kit_offline");
}

// ─── CALCULAR ACESSO ───────────────────────────────────────────────
// Retorna: "ativo" | "somente_leitura"
// Cenários cobertos conforme cronograma v4.2
export function calcularAcesso(empresa) {
  if (!empresa) return "somente_leitura";

  const agora = Date.now();

  // Status suspenso — 48h de carência (verificado ANTES de assinaturaAtiva:
  // uma empresa suspensa não deve ter acesso mesmo com assinatura ativa)
  if (empresa.status === "suspenso") {
    const suspensaoEm = empresa.suspensaoEm?.toMillis
      ? empresa.suspensaoEm.toMillis()
      : (empresa.suspensaoEm || Date.now()); // fallback: assume suspensão agora, iniciando carência de 48h
    const horas = (agora - suspensaoEm) / (1000 * 60 * 60);
    return horas <= 48 ? "ativo" : "somente_leitura";
  }

  // Assinatura ativa — acesso total
  if (empresa.assinaturaAtiva === true) return "ativo";

  // Status cancelado — somente leitura
  if (empresa.status === "cancelado") return "somente_leitura";

  // Trial: verifica se está ativo
  if (empresa.assinaturaAtiva === false) {
    const trialExpira = empresa.trialExpira?.toMillis
      ? empresa.trialExpira.toMillis()
      : empresa.trialExpira || 0;
    // trialExpira === 0 significa que ainda não foi inicializado (conta nova antes do 1º onAuthChange)
    if (!trialExpira) return "ativo";
    return agora <= trialExpira ? "ativo" : "somente_leitura";
  }

  return "somente_leitura";
}

// ─── VERIFICAR CPF/CNPJ ÚNICO ──────────────────────────────────────
// Retorna true se já existe no Firestore, false se disponível.
// Fail-open em erros de permissão/rede: o Firestore SDK não propaga o token
// imediatamente após createUserWithEmailAndPassword — a conexão WebSocket
// re-autentica de forma assíncrona. Duplicatas serão validadas atomicamente
// via Cloud Function no Módulo 22 (ALTO-03).
// TODO M22: substituir por Cloud Function com transação atômica.
export async function verificarCpfCnpjUnico(cpfCnpj) {
  try {
    const cpfLimpo = cpfCnpj.replace(/\D/g, "");
    const q = query(
      collection(db, "empresas"),
      where("cpfCnpj", "==", cpfLimpo)
    );
    const snap = await getDocs(q);
    return !snap.empty;
  } catch (e) {
    // Log diagnóstico — visível no console do browser para identificar o código de erro
    console.error("[CPF-CHECK] getDocs falhou — prosseguindo cadastro:", e.code, e.message);
    // Fail-open: não bloquear o cadastro por falha de permissão/timing do SDK
    // Risco aceitável em fase de testes; resolvido em M22 via Cloud Function.
    return false;
  }
}

// ─── MONTAR SESSÃO ─────────────────────────────────────────────────
function montarSessao(uid, usuario, empresa) {
  const agora = Date.now();

  const trialExpira = empresa.trialExpira?.toMillis
    ? empresa.trialExpira.toMillis()
    : empresa.trialExpira || 0;

  const diasTrial = Math.max(
    0,
    Math.ceil((trialExpira - agora) / 86400000)
  );

  return {
    uid,
    empresaId:            usuario.empresaId,
    nome:                 usuario.nome,
    email:                usuario.email,
    perfil:               usuario.perfil,            // "admin" | "operador"
    superAdmin:           usuario.superAdmin || false,

    // Empresa
    nomeEmpresa:          empresa.nomeEmpresa,
    plano:                empresa.plano,             // "standard" | "profissional"
    status:               empresa.status,
    assinaturaAtiva:      empresa.assinaturaAtiva || false,
    trialInicio:          empresa.trialInicio || null,
    trialExpira:          trialExpira,
    diasTrialRestantes:   diasTrial,
    acesso:               calcularAcesso(empresa),

    // Estado de suspensão (necessário para recalcular carência 48h sem ir ao Firestore)
    suspensaoEm: empresa.suspensaoEm?.toMillis
      ? empresa.suspensaoEm.toMillis()
      : empresa.suspensaoEm || null,

    // Configurações operacionais
    temaVisual:           empresa.temaVisual || "padrao",
    layoutForcado:        empresa.layoutForcado || "auto",
    // Operadores têm configurações individuais; Admin usa configuração da empresa
    permiteVendaOffline:  usuario.perfil === "operador"
      ? (usuario.permiteVendaOffline !== false)
      : (empresa.permiteVendaOffline !== false),
    limiteVendasOffline:  empresa.limiteVendasOffline || (empresa.plano === "profissional" ? 30 : 8),
    descontoPermitido:    usuario.perfil === "operador"
      ? (usuario.descontoPermitido || empresa.descontoPermitido || "ambos")
      : (empresa.descontoPermitido || "ambos"),
  };
}

// ─── LOGIN ─────────────────────────────────────────────────────────
export async function login(email, senha) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, senha);
    const user = cred.user;

    // Verificação de e-mail obrigatória
    if (!user.emailVerified) {
      await signOut(auth);
      return { ok: false, erro: "EMAIL_NAO_VERIFICADO", uid: user.uid, email };
    }

    const userSnap = await getDoc(doc(db, "usuarios", user.uid));
    if (!userSnap.exists()) {
      await signOut(auth);
      return { ok: false, erro: "Usuário não encontrado. Contate o suporte." };
    }

    const usuario   = userSnap.data();
    const empSnap   = await getDoc(doc(db, "empresas", usuario.empresaId));
    if (!empSnap.exists()) {
      await signOut(auth);
      return { ok: false, erro: "Empresa não encontrada. Contate o suporte." };
    }

    const empresa = empSnap.data();

    // Usuário inativo
    if (usuario.ativo === false) {
      await signOut(auth);
      return { ok: false, erro: "Usuário inativo. Contate o administrador." };
    }

    // Solicita persistência de armazenamento (crítico para iOS)
    if (navigator.storage?.persist) {
      await navigator.storage.persist();
    }

    const sessao = montarSessao(user.uid, usuario, empresa);
    salvarSessao(sessao);

    // SuperAdmin vai para painel FSG
    if (sessao.superAdmin) {
      return { ok: true, sessao, redirecionar: "admin-fsg.html" };
    }

    return { ok: true, sessao, redirecionar: "app.html" };

  } catch (e) {
    const erros = {
      "auth/user-not-found":         "E-mail não cadastrado.",
      "auth/wrong-password":         "Senha incorreta.",
      "auth/invalid-credential":     "E-mail ou senha incorretos.",
      "auth/invalid-email":          "E-mail inválido.",
      "auth/too-many-requests":      "Muitas tentativas. Aguarde alguns minutos.",
      "auth/network-request-failed": "Erro de conexão. Verifique sua internet.",
    };
    return { ok: false, erro: erros[e.code] || "Erro ao entrar. Tente novamente." };
  }
}

// ─── CADASTRAR EMPRESA ─────────────────────────────────────────────
export async function cadastrarEmpresa({
  nome, email, senha, nomeEmpresa, telefone, cpfCnpj, plano
}) {
  try {
    const cpfLimpo = cpfCnpj.replace(/\D/g, "");

    // 1. Criar usuário no Firebase Auth PRIMEIRO — necessário para autenticar
    //    a query de CPF/CNPJ (regra Firestore exige isAuth()).
    //    Fix: verificação de CPF movida para após createUserWithEmailAndPassword.
    //    TODO: race condition — mover para Cloud Function com transação atômica (M22)
    const cred = await createUserWithEmailAndPassword(auth, email, senha);
    const uid  = cred.user.uid;

    // 2. Forçar propagação do token antes da query Firestore (evita race condition)
    await cred.user.getIdToken(true);

    // 3. Verificar CPF/CNPJ único — agora com usuário autenticado e token fresco
    // verificarCpfCnpjUnico é fail-open: retorna false em caso de erro do SDK/rede.
    // Duplicatas tratadas por Cloud Function no Módulo 22 (ALTO-03).
    const duplicado = await verificarCpfCnpjUnico(cpfLimpo);
    if (duplicado === true) {
      // Rollback: CPF já existe, remover usuário Auth
      try { await deleteUser(cred.user); } catch { /* ignora erro de rollback */ }
      return {
        ok: false,
        erro: "CPF/CNPJ já cadastrado. Faça login ou recupere sua senha."
      };
    }

    // 3. Enviar e-mail de verificação ANTES de salvar no Firestore
    await sendEmailVerification(cred.user);

    // 5. Criar documento da empresa
    // TODO: criar Cloud Function para limpar cadastros não confirmados após 72h
    await setDoc(doc(db, "empresas", uid), {
      nomeEmpresa,
      cpfCnpj:              cpfLimpo,
      telefone:             telefone || "",
      email,
      plano:                plano || "standard",     // "standard" | "profissional"
      status:               "ativo",
      assinaturaAtiva:      false,
      trialInicio:          null,           // definido em verificarEmailConfirmado()
      trialExpira:          null,           // definido em verificarEmailConfirmado()
      trialConfirmado:      false,
      adminUid:             uid,
      temaVisual:           "padrao",
      layoutForcado:        "auto",
      permiteVendaOffline:  true,
      limiteVendasOffline:  plano === "profissional" ? 30 : 8,
      descontoPermitido:    "ambos",
      emailAlerta:          email,
      metaMensal:           0,
      logoUrl:              "",
      createdAt:            serverTimestamp(),
    });

    // 6. Criar documento do usuário Admin
    await setDoc(doc(db, "usuarios", uid), {
      uid,
      empresaId:   uid,
      nome,
      email,
      perfil:      "admin",
      superAdmin:  false,
      ativo:       true,
      createdAt:   serverTimestamp(),
    });

    // 7. Deslogar — trial inicia após confirmação de e-mail
    await signOut(auth);

    return { ok: true };

  } catch (e) {
    // Rollback: se o usuário Auth foi criado mas o Firestore falhou,
    // deletar o usuário para evitar estado zumbi ("e-mail já cadastrado" falso)
    if (auth.currentUser) {
      try { await deleteUser(auth.currentUser); } catch { /* ignora erro de rollback */ }
    }
    const erros = {
      "auth/email-already-in-use":   "Este e-mail já está cadastrado.",
      "auth/weak-password":          "Senha fraca. Use no mínimo 6 caracteres.",
      "auth/invalid-email":          "E-mail inválido.",
      "auth/network-request-failed": "Erro de conexão. Verifique sua internet.",
    };
    return { ok: false, erro: erros[e.code] || "Erro ao criar conta. Tente novamente." };
  }
}

// ─── REENVIAR VERIFICAÇÃO DE E-MAIL ───────────────────────────────
export async function reenviarVerificacao(email, senha) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, senha);
    await sendEmailVerification(cred.user);
    await signOut(auth);
    return { ok: true };
  } catch {
    return { ok: false, erro: "Não foi possível reenviar. Tente novamente." };
  }
}

// ─── VERIFICAR SE E-MAIL FOI CONFIRMADO ───────────────────────────
// Trial de 30 dias inicia AQUI — somente após confirmação de e-mail.
// trialInicio e trialExpira são gravados no Firestore neste momento.
export async function verificarEmailConfirmado(email, senha) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, senha);
    await cred.user.reload();
    const verificado = cred.user.emailVerified;

    if (!verificado) {
      await signOut(auth);
      return { ok: false };
    }

    // E-mail confirmado: registrar início real do trial no Firestore
    const uid    = cred.user.uid;
    const empRef = doc(db, "empresas", uid);
    const empSnap = await getDoc(empRef);

    if (empSnap.exists() && !empSnap.data().trialConfirmado) {
      const agora      = new Date();
      const expira     = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);

      await updateDoc(empRef, {
        trialInicio:     Timestamp.fromDate(agora),
        trialExpira:     Timestamp.fromDate(expira),
        trialConfirmado: true,  // garante que só conta uma vez
      });
    }

    // NÃO fazer signOut aqui — usuário deve permanecer autenticado para
    // que app.html possa carregar a sessão via onAuthChange sem loop de redirecionamento
    return { ok: true };
  } catch (error) {
    if (error.code === "auth/network-request-failed") {
      return { ok: false, tipo: "rede", erro: "Sem conexão. Verifique sua internet." };
    }
    if (error.code === "auth/too-many-requests") {
      return { ok: false, tipo: "limite", erro: "Muitas tentativas. Aguarde alguns minutos." };
    }
    return { ok: false, tipo: "desconhecido", erro: "Erro ao verificar. Tente novamente." };
  }
}

// ─── ATUALIZAR DADOS DA EMPRESA NA SESSÃO ──────────────────────────
// Chamada pelo onSnapshot de empresas/{uid} no app.html.
// Atualiza plano/status/assinaturaAtiva em memória e localStorage,
// e dispara mc:sessao-atualizada para o router reagir em tempo real.
export function atualizarDadosEmpresa({ plano, status, assinaturaAtiva, trialExpira }) {
  const atual = getSessao();
  if (!atual) return;
  const novoTrialExpira = trialExpira !== undefined ? trialExpira : atual.trialExpira;
  const mudou = plano !== atual.plano ||
                status !== atual.status ||
                assinaturaAtiva !== atual.assinaturaAtiva ||
                (trialExpira !== undefined && trialExpira !== atual.trialExpira);
  if (!mudou) return;
  // Recalcular acesso com os novos valores — módulos usam sessao.acesso diretamente
  const novoAcesso = calcularAcesso({
    status,
    assinaturaAtiva,
    trialExpira:  novoTrialExpira,
    suspensaoEm:  atual.suspensaoEm,
  });
  const nova = { ...atual, plano, status, assinaturaAtiva, trialExpira: novoTrialExpira, acesso: novoAcesso };
  salvarSessao(nova);
  window.dispatchEvent(new CustomEvent("mc:sessao-atualizada", { detail: nova }));
}

// ─── LOGOUT ────────────────────────────────────────────────────────
export async function logout() {
  window._unsubscribeConfig?.();
  window._unsubscribeEmpresa?.();
  window._syncManager?.pararSync?.();
  limparSessao();
  await signOut(auth);
  window.location.href = "login.html";
}

// ─── RECUPERAR SENHA ───────────────────────────────────────────────
export async function recuperarSenha(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    return { ok: true };
  } catch (e) {
    const erros = {
      "auth/user-not-found":         "E-mail não cadastrado.",
      "auth/invalid-email":          "E-mail inválido.",
      "auth/network-request-failed": "Erro de conexão.",
    };
    return { ok: false, erro: erros[e.code] || "Erro ao enviar e-mail." };
  }
}

// ─── VERIFICAÇÃO DE SESSÃO EM BACKGROUND ────────────────────────────
// Chamada após o fast-path do cache em onAuthChange.
// Verifica status/assinaturaAtiva (campos voláteis mid-session, ex: suspensão
// via Stripe). Plano NÃO é checado aqui — é atualizado pelo ciclo de sync
// via getDocFromServer, evitando poluição do cache com valores temporários de teste.
async function _verificarSessaoEmBackground(user, cacheAtual) {
  try {
    // getDocFromServer garante leitura direto do servidor, não do IndexedDB local.
    // Crítico para detectar mudanças recentes (ex: webhook Stripe atualizou
    // assinaturaAtiva segundos antes e o cache local ainda não sincronizou).
    const userSnap = await getDocFromServer(doc(db, "usuarios", user.uid));
    if (!userSnap.exists()) return;
    const empSnap = await getDocFromServer(doc(db, "empresas", userSnap.data().empresaId));
    if (!empSnap.exists()) return;
    const empresa = empSnap.data();

    const planoMudou  = empresa.plano           !== cacheAtual.plano;
    const statusMudou = empresa.status          !== cacheAtual.status;
    const ativoMudou  = empresa.assinaturaAtiva !== cacheAtual.assinaturaAtiva;

    if (planoMudou || statusMudou || ativoMudou) {
      const sessaoAtualizada = { ...cacheAtual,
        plano:           empresa.plano,
        status:          empresa.status,
        assinaturaAtiva: empresa.assinaturaAtiva,
      };
      salvarSessao(sessaoAtualizada);
      window.dispatchEvent(new CustomEvent("mc:sessao-atualizada", { detail: sessaoAtualizada }));
    }
  } catch { /* silencioso — background, não bloqueia o app */ }
}

// ─── OBSERVADOR DE AUTENTICAÇÃO ─────────────────────────────────────
// Usado pelo app.html para proteger rotas.
// callback(sessao) autenticado · callback(null) não autenticado
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) { callback(null); return; }

    // E-mail não verificado: tratar como não autenticado
    if (!user.emailVerified) { callback(null); return; }

    // Cache válido: verifica TTL antes de usar sem ir ao Firestore
    const cache = getSessao();
    if (cache && cache.uid === user.uid) {
      // Se trial expirou ou ainda não foi inicializado, invalidar cache e forçar leitura do Firestore
      if (!cache.trialExpira || cache.trialExpira < Date.now()) {
        localStorage.removeItem("mc_sessao");
        _sessao = null;
        // fall through para leitura do Firestore abaixo
      } else {
        if (navigator.storage?.persist) navigator.storage.persist();
        callback(cache);
        _verificarSessaoEmBackground(user, cache);
        return;
      }
    }

    // Sem cache: carrega do Firestore
    try {
      const userSnap = await getDoc(doc(db, "usuarios", user.uid));
      if (!userSnap.exists()) { limparSessao(); await signOut(auth); callback(null); return; }

      const usuario = userSnap.data();
      const empSnap = await getDoc(doc(db, "empresas", usuario.empresaId));
      if (!empSnap.exists()) { limparSessao(); await signOut(auth); callback(null); return; }

      const empresa = empSnap.data();

      // Iniciar trial se e-mail confirmado mas trialConfirmado ainda é false.
      // Feito AQUI (não em verificarEmailConfirmado) porque a conexão Firestore
      // já está autenticada neste ponto — getDoc acabou de funcionar com token
      // válido, eliminando a race condition do persistentLocalCache WebSocket.
      if (!empresa.trialConfirmado && user.emailVerified) {
        try {
          const agora  = new Date();
          const expira = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);
          await updateDoc(doc(db, "empresas", usuario.empresaId), {
            trialInicio:     Timestamp.fromDate(agora),
            trialExpira:     Timestamp.fromDate(expira),
            trialConfirmado: true,
          });
          // Atualizar objeto local para montarSessao refletir os valores corretos
          empresa.trialInicio     = Timestamp.fromDate(agora);
          empresa.trialExpira     = Timestamp.fromDate(expira);
          empresa.trialConfirmado = true;
        } catch {
          // Falha silenciosa — será re-tentado no próximo login
        }
      }

      if (navigator.storage?.persist) await navigator.storage.persist();

      const sessao = montarSessao(user.uid, usuario, empresa);
      salvarSessao(sessao);

      callback(sessao);
    } catch {
      // Offline: tenta usar cache mesmo sem uid igual
      const cache = getSessao();
      if (cache) { callback(cache); return; }
      callback(null);
    }
  });
}

// ─── VERIFICAR PERMISSÃO ───────────────────────────────────────────
export function podeExecutar(acao) {
  const sessao = getSessao();
  if (!sessao) return false;
  if (sessao.perfil === "admin") return true;

  const OPERADOR_PODE = [
    "verDashboard",
    "verEstoque",
    "operarCaixa",
    "registrarVenda",
    "registrarRecebimentoCrediario",
  ];

  return OPERADOR_PODE.includes(acao);
}
