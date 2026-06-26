// ╔══════════════════════════════════════════════════════════════════╗
// ║  MeuCaixa · modulos/crediario.js · Módulo 14 - Etapas A+B     ║
// ║  Registro, carry-over, listagem, histórico e sino              ║
// ╚══════════════════════════════════════════════════════════════════╝

import { db } from "../firebase-config.js";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc,
  query, where, orderBy, limit, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { notificar }                    from "../notificacoes.js";
import { formatarMoeda, registrarErro } from "../utils.js";

let _sessao    = null;
let _empresaId = "";
let _caixaId   = null;

// ── Helpers de data ──────────────────────────────────────────────────────────
const _ddmmaaaa  = d => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
const _parseData = str => { const [d,m,a] = str.split("/"); return new Date(+a,+m-1,+d); };
const _diffDias  = str => { const h=new Date(); h.setHours(0,0,0,0); return Math.round((_parseData(str)-h)/86400000); };
const _fmtDtHr   = ts => {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${_ddmmaaaa(d)} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

// ── Status efetivo (sem N+1) ──────────────────────────────────────────────────
function _statusEfetivo(cred) {
  if (cred.status === "quitado") return "quitado";
  if (!cred.proximaDataVencimento) return "em_dia";
  const diff = _diffDias(cred.proximaDataVencimento);
  if (diff < 0)  return "vencido";
  if (diff <= 3) return "vencendo";
  return "em_dia";
}

// ── Entrada ──────────────────────────────────────────────────────────────────
export async function renderizar(sessao, containerEl) {
  _sessao    = sessao;
  _empresaId = sessao.empresaId;
  _caixaId   = null;

  if (!navigator.onLine) {
    containerEl.innerHTML = `
      <div class="fade-up" style="text-align:center;padding:60px 20px">
        <div style="font-size:48px;margin-bottom:16px">📵</div>
        <h2 style="margin:0 0 8px">Crediário indisponível offline</h2>
        <p style="color:#888;font-size:14px">Conecte-se à internet para acessar o crediário.</p>
      </div>`;
    return;
  }

  try {
    const snap = await getDocs(query(
      collection(db, "empresas", _empresaId, "caixa"),
      where("fechadoEm", "==", null), limit(1)
    ));
    if (!snap.empty) _caixaId = snap.docs[0].id;
  } catch { /* sem caixa aberto */ }

  await _renderizarShell(containerEl);
  _verificarAlertasSino(); // background — sem await
}

// ── Shell ─────────────────────────────────────────────────────────────────────
async function _renderizarShell(containerEl) {
  const isAdmin = _sessao.perfil === "admin";
  const isOp    = _sessao.perfil === "operador";

  const PILLS = { todos:"Todos", em_dia:"Em Dia", vencendo:"Vencendo", vencido:"Vencido", quitado:"Quitado" };

  const pillsHtml = isAdmin
    ? `<div class="pill-tabs" id="cred-pills" style="margin-bottom:20px">
        ${Object.entries(PILLS).map(([k,label],i) =>
          `<button class="pill-tab${i===0?" active":""}" data-pill="${k}">${label}</button>`
        ).join("")}
      </div>` : "";

  containerEl.innerHTML = `
    <div class="fade-up">
      <div class="section-header" style="margin-bottom:16px">
        <h2>Crediário</h2>
        ${isAdmin ? `<button id="cred-btn-novo" class="btn btn-primary btn-sm" data-acao="escrita">+ Novo</button>` : ""}
      </div>
      ${pillsHtml}
      ${isOp ? `<div style="font-size:13px;color:#888;margin-bottom:12px">Vencimentos hoje e em atraso</div>` : ""}
      <div id="cred-lista-wrap"><p style="color:#aaa;font-size:13px">Carregando…</p></div>
    </div>`;

  document.getElementById("cred-btn-novo")?.addEventListener("click", _abrirFormNovo);

  document.getElementById("cred-pills")?.querySelectorAll("[data-pill]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#cred-pills .pill-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      _carregarLista(btn.dataset.pill);
    });
  });

  await _carregarLista(isOp ? "operador" : "todos");
}

// ── Listagem ──────────────────────────────────────────────────────────────────
async function _carregarLista(filtro = "todos") {
  const wrap = document.getElementById("cred-lista-wrap");
  if (!wrap) return;
  try {
    const snap = await getDocs(query(
      collection(db, "empresas", _empresaId, "crediario"),
      orderBy("createdAt", "desc"), limit(100)
    ));

    let items = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

    items = items.filter(c => {
      const st = _statusEfetivo(c);
      if (filtro === "todos")    return st !== "quitado";
      if (filtro === "quitado")  return st === "quitado";
      if (filtro === "operador") {
        if (st === "vencido") return true;
        if (st === "vencendo" && c.proximaDataVencimento) return _diffDias(c.proximaDataVencimento) <= 1;
        return false;
      }
      return st === filtro;
    });

    if (!items.length) {
      const labels = { todos:"em aberto", em_dia:"em dia", vencendo:"vencendo", vencido:"vencido", quitado:"quitado", operador:"vencidos ou vencendo" };
      wrap.innerHTML = `<p style="color:#aaa;font-size:13px;padding:20px 0">Nenhum crediário ${labels[filtro]||"encontrado"}.</p>`;
      return;
    }

    wrap.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px">
      ${items.map(c => {
        const st  = _statusEfetivo(c);
        const cor = { vencido:"#C62828", vencendo:"#E65100", quitado:"#2E7D32", em_dia:"#555" }[st]||"#555";
        const badge = { vencido:"Vencido", vencendo:"Vencendo", quitado:"Quitado", em_dia:"Em Dia" }[st]||"—";
        const proxInfo = c.proximaDataVencimento && st !== "quitado"
          ? `<div style="font-size:11px;color:#888;margin-top:2px">Próx. venc.: ${c.proximaDataVencimento}</div>` : "";
        return `
          <div class="card" style="padding:16px;cursor:pointer"
               data-cred-id="${c._id}" data-cred-parcelado="${c.parcelado?"1":"0"}">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <div>
                <div style="font-size:15px;font-weight:700;color:var(--text)">${c.clienteNome}</div>
                <div style="font-size:12px;color:#888">Total: ${formatarMoeda(c.valorTotal)}</div>
                ${proxInfo}
              </div>
              <div style="text-align:right">
                <div style="font-size:16px;font-weight:700;color:${cor}">${formatarMoeda(c.saldoDevedor)}</div>
                <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px;background:${cor}18;color:${cor}">${badge}</span>
              </div>
            </div>
          </div>`;
      }).join("")}
    </div>`;

    wrap.querySelectorAll("[data-cred-id]").forEach(el =>
      el.addEventListener("click", () => _abrirDetalhe(el.dataset.credId))
    );
  } catch (err) {
    wrap.innerHTML = `<p style="color:#aaa;font-size:13px">Erro ao carregar crediários.</p>`;
    registrarErro("firestore", err.message, "crediario.js");
  }
}

// ── Busca de clientes ─────────────────────────────────────────────────────────
function _buscarClientesKit(termo) {
  try {
    const kit = JSON.parse(localStorage.getItem("mc_kit_offline") || "{}");
    const t   = termo.toLowerCase();
    return (kit.clientes||[]).filter(c =>
      (c.nome||"").toLowerCase().includes(t) || (c.telefone||"").includes(t)
    ).slice(0,6);
  } catch { return []; }
}
async function _buscarClientes(termo) {
  if (!termo || termo.length < 2) return [];
  const kit = _buscarClientesKit(termo);
  if (kit.length) return kit;
  try {
    const snap = await getDocs(query(
      collection(db, "empresas", _empresaId, "clientes"),
      orderBy("nome"), limit(50)
    ));
    const t = termo.toLowerCase();
    return snap.docs.map(d=>({id:d.id,...d.data()}))
      .filter(c => c.ativo!==false && ((c.nome||"").toLowerCase().includes(t)||(c.telefone||"").includes(t)))
      .slice(0,6);
  } catch { return []; }
}

// ── Geração de parcelas ───────────────────────────────────────────────────────
function _gerarParcelas(valorTotal, nParcelas) {
  const base = Math.floor((valorTotal/nParcelas)*100)/100;
  const diff = Math.round((valorTotal-base*nParcelas)*100)/100;
  const hoje = new Date();
  return Array.from({length:nParcelas}, (_,i) => {
    const venc = new Date(hoje.getFullYear(), hoje.getMonth()+i+1, hoje.getDate());
    return {
      numero: i+1,
      valorOriginal: i===nParcelas-1 ? base+diff : base,
      valorAtual:    i===nParcelas-1 ? base+diff : base,
      dataVencimento: _ddmmaaaa(venc),
      status: "aberto",
    };
  });
}

function _tabelaParcelasHtml(parcelas, editavel = false) {
  const isPro   = _sessao?.plano === "profissional";
  const comEdit = editavel && isPro;
  return `<div class="table-responsive"><table class="table" style="font-size:13px;margin-top:4px">
    <thead><tr>
      <th>Nº</th>
      <th>Vencimento</th>
      <th style="text-align:right">Valor</th>
      <th style="text-align:center">Status</th>
      ${comEdit ? `<th style="width:30px"></th>` : ""}
    </tr></thead>
    <tbody>${parcelas.map(p => {
      const corSt = { pago:"#2E7D32", parcial:"#E65100", aberto:"#555" }[p.status]||"#555";
      const diff  = editavel && p.status!=="pago" ? _diffDias(p.dataVencimento) : null;
      const alerta = diff !== null && diff < 0 ? "🔴 " : diff === 0 ? "🟡 " : "";
      return `<tr>
        <td style="color:#888">${p.numero}ª</td>
        <td>${alerta}${p.dataVencimento}</td>
        <td style="text-align:right;font-weight:600">${formatarMoeda(p.valorAtual)}</td>
        <td style="text-align:center">
          <span style="font-size:11px;font-weight:600;padding:2px 7px;border-radius:10px;background:${corSt}18;color:${corSt}">${p.status}</span>
        </td>
        ${comEdit && p.status!=="pago"
          ? `<td style="text-align:center">
              <button class="btn-edit-venc" data-parc-id="${p._id}" data-venc="${p.dataVencimento}" data-acao="escrita"
                style="background:none;border:none;cursor:pointer;font-size:13px;padding:2px;color:#bbb" title="Editar vencimento">✏️</button>
            </td>`
          : comEdit ? `<td></td>` : ""}
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;
}

// ── Formulário: Novo Crediário ────────────────────────────────────────────────
function _abrirFormNovo() {
  const isPro = _sessao.plano === "profissional";

  const modal = document.createElement("div");
  modal.id = "modal-cred-novo";
  modal.className = "mc-modal-overlay";
  modal.innerHTML = `<div class="mc-modal-card" style="max-width:480px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <h3>Novo Crediário</h3>
      <button id="cred-fechar-modal" style="background:none;border:none;font-size:20px;cursor:pointer;color:#888;line-height:1">✕</button>
    </div>
    <form id="form-cred" style="display:flex;flex-direction:column;gap:14px">
      <div class="form-group" style="margin:0">
        <label class="label">Cliente *</label>
        <input class="input" id="cred-busca-cli" type="text" placeholder="Nome ou telefone…" autocomplete="off">
        <div id="cred-drop-cli" style="display:none;background:#fff;border:1px solid #e0e0e0;border-radius:8px;margin-top:4px;max-height:180px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.08)"></div>
        <input type="hidden" id="cred-cli-id">
        <div id="cred-cli-sel" style="display:none;font-size:13px;color:#2E7D32;margin-top:4px;font-weight:600"></div>
      </div>
      <div class="form-group" style="margin:0">
        <label class="label">Valor Total (R$) *</label>
        <input class="input" id="cred-valor" type="number" min="0.01" step="0.01" placeholder="0,00">
      </div>
      ${isPro ? `
      <div style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="cred-parcelado" style="width:16px;height:16px;accent-color:var(--primary);cursor:pointer">
        <label for="cred-parcelado" class="label" style="margin:0;cursor:pointer">Parcelar (Pro)</label>
      </div>
      <div id="cred-wrap-parc" style="display:none;flex-direction:column;gap:10px">
        <div class="form-group" style="margin:0">
          <label class="label">Nº de Parcelas (1–12)</label>
          <input class="input" id="cred-nparc" type="number" min="1" max="12" value="2" style="max-width:120px">
        </div>
        <div id="cred-preview" style="border:1px solid #f0f0f0;border-radius:8px;padding:12px;background:#fafafa"></div>
      </div>` : ""}
      <button type="submit" class="btn btn-primary" data-acao="escrita" style="margin-top:4px">Registrar Crediário</button>
    </form>
  </div>`;
  document.body.appendChild(modal);

  const fechar = () => modal.remove();
  document.getElementById("cred-fechar-modal").addEventListener("click", fechar);
  modal.addEventListener("click", e => { if (e.target === modal) fechar(); });

  let _cliSelecionado = null;
  const inpBusca = document.getElementById("cred-busca-cli");
  const drop     = document.getElementById("cred-drop-cli");
  const cliSel   = document.getElementById("cred-cli-sel");
  let deb;
  inpBusca.addEventListener("input", () => {
    _cliSelecionado = null; document.getElementById("cred-cli-id").value = "";
    cliSel.style.display = "none";
    clearTimeout(deb);
    deb = setTimeout(async () => {
      const res = await _buscarClientes(inpBusca.value.trim());
      if (!res.length) { drop.style.display="none"; return; }
      drop.style.display = "block";
      drop.innerHTML = res.map(c =>
        `<div style="padding:10px 14px;cursor:pointer;font-size:14px;border-bottom:1px solid #f5f5f5"
              data-cli-id="${c.id}" data-cli-nome="${c.nome}">${c.nome}${c.telefone?` <span style="color:#aaa;font-size:12px">· ${c.telefone}</span>`:""}</div>`
      ).join("");
      drop.querySelectorAll("[data-cli-id]").forEach(el =>
        el.addEventListener("click", () => {
          _cliSelecionado = { id:el.dataset.cliId, nome:el.dataset.cliNome };
          document.getElementById("cred-cli-id").value = el.dataset.cliId;
          inpBusca.value = el.dataset.cliNome;
          cliSel.textContent = "✓ " + el.dataset.cliNome + " selecionado";
          cliSel.style.display = "block";
          drop.style.display = "none";
        })
      );
    }, 250);
  });

  if (isPro) {
    const chk  = document.getElementById("cred-parcelado");
    const wrap = document.getElementById("cred-wrap-parc");
    const nInp = document.getElementById("cred-nparc");
    const prev = document.getElementById("cred-preview");
    const atualizar = () => {
      const val = parseFloat(document.getElementById("cred-valor")?.value||"0");
      const n   = Math.min(12,Math.max(1,parseInt(nInp.value||"2")));
      if (!val||val<=0) { prev.innerHTML=`<p style="color:#aaa;font-size:13px">Informe o valor total.</p>`; return; }
      prev.innerHTML = _tabelaParcelasHtml(_gerarParcelas(val,n));
    };
    chk.addEventListener("change", () => { wrap.style.display=chk.checked?"flex":"none"; if(chk.checked)atualizar(); });
    nInp.addEventListener("input", atualizar);
    document.getElementById("cred-valor")?.addEventListener("input", atualizar);
  }

  document.getElementById("form-cred").addEventListener("submit", async e => {
    e.preventDefault();
    const btn   = e.target.querySelector("button[type=submit]");
    const valor = parseFloat(document.getElementById("cred-valor").value);
    if (!_cliSelecionado) { notificar("aviso","Cliente obrigatório","Selecione um cliente."); return; }
    if (!valor||valor<=0) { notificar("aviso","Valor inválido","Informe um valor positivo."); return; }
    btn.disabled=true; btn.textContent="Salvando…";
    try {
      await _salvarCredito(_cliSelecionado, valor);
      fechar();
      notificar("sucesso","Crediário registrado",`${_cliSelecionado.nome} — ${formatarMoeda(valor)}`);
      await _carregarLista();
    } catch (err) {
      registrarErro("firestore",err.message,"crediario.js");
      notificar("erro","Erro ao salvar","Não foi possível registrar o crediário.");
    } finally { btn.disabled=false; btn.textContent="Registrar Crediário"; }
  });
}

async function _salvarCredito(cliente, valorTotal) {
  const isPro     = _sessao.plano === "profissional";
  const parcelado = isPro && document.getElementById("cred-parcelado")?.checked;
  const nParcelas = parcelado ? Math.min(12,Math.max(1,parseInt(document.getElementById("cred-nparc")?.value||"1"))) : 1;
  const parcelas  = parcelado ? _gerarParcelas(valorTotal, nParcelas) : null;

  const credRef = await addDoc(collection(db,"empresas",_empresaId,"crediario"), {
    clienteId:             cliente.id,
    clienteNome:           cliente.nome,
    valorTotal,
    saldoDevedor:          valorTotal,
    parcelado,
    totalParcelas:         parcelado ? nParcelas : 1,
    status:                "aberto",
    proximaDataVencimento: parcelado ? parcelas[0].dataVencimento : null,
    plano:                 _sessao.plano,
    createdAt:             serverTimestamp(),
    empresaId:             _empresaId,
  });

  if (parcelado) {
    for (const p of parcelas)
      await addDoc(collection(db,"empresas",_empresaId,"crediario",credRef.id,"parcelas"), p);
  }
}

// ── Carry-over ───────────────────────────────────────────────────────────────
// Forward-consolidation: pagamento parcial marca parcela como "pago",
// déficit migra para a próxima (P1 R$100 + R$90 → P1 pago, P2 +R$10)
function aplicarPagamento(parcelas, valorPago) {
  const saldoTotal = parcelas.reduce((s,p)=>s+(p.status!=="pago"?(p.valorAtual||0):0),0);
  if (valorPago > saldoTotal+0.001) return { erro:"Valor superior ao saldo devedor." };

  const abertas = parcelas.filter(p=>p.status!=="pago")
    .sort((a,b)=>_parseData(a.dataVencimento)-_parseData(b.dataVencimento));
  const map = Object.fromEntries(parcelas.map(p=>[p._id??p.numero,{...p}]));

  let restante=valorPago, carryover=0;
  for (const p of abertas) {
    const key = p._id??p.numero;
    const ve  = Math.round((p.valorAtual+carryover)*100)/100;
    carryover = 0;
    if (restante<=0)        { map[key].valorAtual=ve; continue; }
    if (restante>=ve-0.001) { map[key].valorAtual=0; map[key].status="pago"; restante=Math.round((restante-ve)*100)/100; }
    else                    { carryover=Math.round((ve-restante)*100)/100; map[key].valorAtual=0; map[key].status="pago"; restante=0; }
  }
  return { ok:true, parcelas:Object.values(map) };
}

// ── Detalhe + Recebimento + Histórico ────────────────────────────────────────
async function _abrirDetalhe(credId) {
  const credSnap = await getDoc(doc(db,"empresas",_empresaId,"crediario",credId));
  if (!credSnap.exists()) return;
  const cred = credSnap.data();

  const isAdmin = _sessao.perfil === "admin";
  const isPro   = _sessao.plano === "profissional";

  const [parcelasSnap, pagamentosSnap] = await Promise.all([
    cred.parcelado
      ? getDocs(query(collection(db,"empresas",_empresaId,"crediario",credId,"parcelas"), orderBy("numero")))
      : Promise.resolve({docs:[]}),
    getDocs(query(collection(db,"empresas",_empresaId,"crediario",credId,"pagamentos"), orderBy("pagoEm","desc"), limit(20))),
  ]);

  let parcelas = parcelasSnap.docs.map(d=>({_id:d.id,...d.data()}));
  const pagamentos = pagamentosSnap.docs.map(d=>({_id:d.id,...d.data()}));

  const st  = _statusEfetivo(cred);
  const cor = { vencido:"#C62828", vencendo:"#E65100", quitado:"#2E7D32", em_dia:"#555" }[st]||"#555";
  const podePagar = isAdmin && _caixaId && cred.saldoDevedor > 0;

  const parcelasSection = cred.parcelado && parcelas.length
    ? `<div>
        <div style="font-size:13px;font-weight:600;color:#555;margin-bottom:6px">Parcelas${isPro&&isAdmin?' <span style="font-size:11px;color:#aaa;font-weight:400">(✏️ editar vencimento)</span>':""}</div>
        <div id="cred-parc-table">${_tabelaParcelasHtml(parcelas, true)}</div>
      </div>` : "";

  const recebSection = podePagar ? `
    <div style="border-top:1px solid #f0f0f0;padding-top:14px">
      <div style="font-size:13px;font-weight:600;color:#555;margin-bottom:8px">Registrar Recebimento</div>
      <div style="display:flex;gap:8px;align-items:flex-end">
        <input class="input" id="inp-pag-valor" type="number" min="0.01" step="0.01"
          placeholder="Valor recebido" max="${cred.saldoDevedor}" style="flex:1">
        <button id="btn-registrar-pag" class="btn btn-primary btn-sm" data-acao="escrita">Receber</button>
      </div>
      <div id="pag-erro" style="color:#C62828;font-size:12px;margin-top:4px;display:none"></div>
      <div id="pag-preview-co" style="margin-top:8px"></div>
    </div>` : "";

  const historicoSection = pagamentos.length ? `
    <div style="border-top:1px solid #f0f0f0;padding-top:14px">
      <div style="font-size:13px;font-weight:600;color:#555;margin-bottom:8px">Histórico de Pagamentos</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${pagamentos.map(p=>`
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f9f9f9;border-radius:8px">
            <div>
              <div style="font-size:13px;font-weight:600;color:#2E7D32">${formatarMoeda(p.valor)}</div>
              <div style="font-size:11px;color:#888">${_fmtDtHr(p.pagoEm)}</div>
            </div>
            <div style="font-size:11px;color:#aaa">${p.registradoPor||"—"}</div>
          </div>`
        ).join("")}
      </div>
    </div>` : "";

  const modal = document.createElement("div");
  modal.id = "modal-cred-det";
  modal.className = "mc-modal-overlay";
  modal.innerHTML = `<div class="mc-modal-card" style="max-width:500px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <h3>Crediário — ${cred.clienteNome}</h3>
      <button id="det-fechar" style="background:none;border:none;font-size:20px;cursor:pointer;color:#888">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div style="background:#f9f9f9;border-radius:8px;padding:12px">
          <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Total</div>
          <div style="font-size:15px;font-weight:700">${formatarMoeda(cred.valorTotal)}</div>
        </div>
        <div style="background:#f9f9f9;border-radius:8px;padding:12px">
          <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Saldo</div>
          <div style="font-size:15px;font-weight:700;color:${cor}">${formatarMoeda(cred.saldoDevedor)}</div>
        </div>
        <div style="background:#f9f9f9;border-radius:8px;padding:12px">
          <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Status</div>
          <div style="font-size:13px;font-weight:700;color:${cor}">${{vencido:"Vencido",vencendo:"Vencendo",quitado:"Quitado",em_dia:"Em Dia"}[st]||"—"}</div>
        </div>
      </div>
      ${parcelasSection}
      ${recebSection}
      ${!_caixaId && isAdmin ? `<p style="color:#aaa;font-size:12px">⚠️ Nenhum caixa aberto — recebimentos indisponíveis.</p>` : ""}
      ${historicoSection}
    </div>
  </div>`;
  document.body.appendChild(modal);

  const fechar = () => modal.remove();
  document.getElementById("det-fechar").addEventListener("click", fechar);
  modal.addEventListener("click", e => { if (e.target === modal) fechar(); });

  // Preview carry-over ao digitar
  if (cred.parcelado && parcelas.length) {
    document.getElementById("inp-pag-valor")?.addEventListener("input", e => {
      const val    = parseFloat(e.target.value||"0");
      const prev   = document.getElementById("pag-preview-co");
      const erroEl = document.getElementById("pag-erro");
      if (!val||val<=0) { if(prev)prev.innerHTML=""; return; }
      const res = aplicarPagamento(parcelas, val);
      if (res.erro) { if(erroEl){erroEl.textContent=res.erro;erroEl.style.display="block";} if(prev)prev.innerHTML=""; }
      else          { if(erroEl)erroEl.style.display="none"; if(prev)prev.innerHTML=`<div style="font-size:12px;color:#555;margin-bottom:4px">Preview após pagamento:</div>`+_tabelaParcelasHtml(res.parcelas); }
    });
  }

  // Botão Receber
  document.getElementById("btn-registrar-pag")?.addEventListener("click", async () => {
    const btn   = document.getElementById("btn-registrar-pag");
    const val   = parseFloat(document.getElementById("inp-pag-valor")?.value||"0");
    const erroEl= document.getElementById("pag-erro");
    if (!val||val<=0)             { if(erroEl){erroEl.textContent="Informe um valor positivo.";erroEl.style.display="block";} return; }
    if (val>cred.saldoDevedor+0.001) { if(erroEl){erroEl.textContent="Valor superior ao saldo devedor.";erroEl.style.display="block";} return; }
    btn.disabled=true; btn.textContent="Salvando…";
    try {
      parcelas = await _registrarPagamento(credId, cred, parcelas, val);
      fechar();
      notificar("sucesso","Pagamento registrado",`${formatarMoeda(val)} de ${cred.clienteNome}`);
      await _carregarLista();
    } catch (err) {
      registrarErro("firestore",err.message,"crediario.js");
      notificar("erro","Erro ao registrar","Não foi possível salvar o pagamento.");
    } finally { btn.disabled=false; btn.textContent="Receber"; }
  });

  // Pro: editar dataVencimento
  if (isPro && isAdmin) {
    modal.querySelectorAll(".btn-edit-venc").forEach(btn =>
      btn.addEventListener("click", () => _editarDataVencimento(btn, credId, parcelas))
    );
  }
}

// ── Pro: editar dataVencimento de parcela ────────────────────────────────────
async function _editarDataVencimento(btnEl, credId, parcelas) {
  const parcId    = btnEl.dataset.parcId;
  const vencAtual = btnEl.dataset.venc;
  const td        = btnEl.closest("tr")?.children[1];
  if (!td) return;
  const original  = td.innerHTML;

  const [d,m,a] = vencAtual.split("/");
  td.innerHTML = `
    <input type="date" value="${a}-${m}-${d}"
      style="border:1.5px solid var(--primary);border-radius:6px;padding:3px 6px;font-size:13px;color:var(--text);background:#fff">
    <button data-ok style="background:var(--primary);color:#fff;border:none;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px;margin-left:4px">✓</button>
    <button data-cancel style="background:none;border:none;cursor:pointer;font-size:14px;color:#888;padding:3px 4px">✕</button>`;

  const inp = td.querySelector("input[type=date]");
  td.querySelector("[data-cancel]").addEventListener("click", () => { td.innerHTML=original; });
  td.querySelector("[data-ok]").addEventListener("click", async () => {
    if (!inp.value) return;
    const [aa,mm,dd] = inp.value.split("-");
    const novaStr    = `${dd}/${mm}/${aa}`;
    try {
      await updateDoc(doc(db,"empresas",_empresaId,"crediario",credId,"parcelas",parcId), { dataVencimento:novaStr });
      const atualizadas = parcelas.map(p=>p._id===parcId?{...p,dataVencimento:novaStr}:p);
      const abertas     = atualizadas.filter(p=>p.status!=="pago")
        .sort((a,b)=>_parseData(a.dataVencimento)-_parseData(b.dataVencimento));
      const proxData    = abertas.length ? abertas[0].dataVencimento : null;
      await updateDoc(doc(db,"empresas",_empresaId,"crediario",credId), { proximaDataVencimento:proxData });
      td.innerHTML = novaStr;
      notificar("sucesso","Vencimento atualizado",`Parcela atualizada para ${novaStr}`);
    } catch (err) {
      registrarErro("firestore",err.message,"crediario.js");
      notificar("erro","Erro ao salvar","Não foi possível atualizar o vencimento.");
      td.innerHTML = original;
    }
  });
}

// ── Registrar pagamento ───────────────────────────────────────────────────────
async function _registrarPagamento(credId, cred, parcelas, valorPago) {
  const novoSaldo = Math.max(0, Math.round((cred.saldoDevedor-valorPago)*100)/100);
  let novoStatus  = novoSaldo<=0.001 ? "quitado" : cred.status;
  let proxData    = cred.proximaDataVencimento;
  let novasParcelas = parcelas;

  if (cred.parcelado && parcelas.length) {
    const res = aplicarPagamento(parcelas, valorPago);
    if (res.ok) {
      novasParcelas = res.parcelas;
      const abertas = res.parcelas.filter(p=>p.status!=="pago")
        .sort((a,b)=>_parseData(a.dataVencimento)-_parseData(b.dataVencimento));
      proxData = abertas.length ? abertas[0].dataVencimento : null;
      if (proxData && novoStatus==="aberto") {
        const diff = _diffDias(proxData);
        if (diff<0) novoStatus="vencido"; else if(diff<=3) novoStatus="vencendo";
      }
    }
  }

  await updateDoc(doc(db,"empresas",_empresaId,"crediario",credId), {
    saldoDevedor: novoSaldo,
    status: novoStatus,
    proximaDataVencimento: novoSaldo<=0.001 ? null : proxData,
  });

  const pagRef = await addDoc(collection(db,"empresas",_empresaId,"crediario",credId,"pagamentos"), {
    valor:         valorPago,
    pagoEm:        serverTimestamp(),
    caixaId:       _caixaId,
    registradoPor: _sessao.nome||_sessao.email||"—",
    empresaId:     _empresaId,
  });

  if (cred.parcelado && novasParcelas.length) {
    for (const p of novasParcelas) {
      if (!p._id) continue;
      await updateDoc(doc(db,"empresas",_empresaId,"crediario",credId,"parcelas",p._id), {
        valorAtual: p.valorAtual, status: p.status,
      });
    }
  }

  await addDoc(collection(db,"empresas",_empresaId,"caixa",_caixaId,"movimentacoes"), {
    tipo:          "recebimento_crediario",
    valor:         valorPago,
    descricao:     `Crediário — ${cred.clienteNome}`,
    credId,
    pagId:         pagRef.id,
    registradoPor: _sessao.nome||_sessao.email||"—",
    createdAt:     serverTimestamp(),
    sincronizado:  false,
  });

  return novasParcelas;
}

// ── Alerta sino: parcelas vencendo amanhã ────────────────────────────────────
async function _verificarAlertasSino() {
  try {
    const hoje  = _ddmmaaaa(new Date());
    const CHAVE = `mc_cred_alerta_${_empresaId}`;
    const ult   = JSON.parse(localStorage.getItem(CHAVE)||"{}");
    if (ult.data === hoje) return;

    const amanha    = new Date(); amanha.setDate(amanha.getDate()+1);
    const amanhaStr = _ddmmaaaa(amanha);

    const snap     = await getDocs(query(
      collection(db,"empresas",_empresaId,"crediario"),
      where("status","in",["aberto","vencendo"]), limit(100)
    ));
    const vencendo = snap.docs.filter(d => d.data().proximaDataVencimento===amanhaStr);

    if (vencendo.length > 0) {
      const nomes = vencendo.slice(0,3).map(d=>d.data().clienteNome).join(", ");
      const extra = vencendo.length>3 ? ` +${vencendo.length-3}` : "";
      notificar("aviso","Crediário vence amanhã",
        `${vencendo.length} vencimento(s): ${nomes}${extra}`);
    }
    localStorage.setItem(CHAVE, JSON.stringify({ data:hoje }));
  } catch { /* silencioso */ }
}
