/* Interface da simulação. Depende de engine.js (window.Distrital). */
(function () {
  "use strict";
  const D = window.Distrital;
  const $ = (s) => document.querySelector(s);
  const el = {
    cargo: $("#cargo"), ano: $("#ano"), uf: $("#uf"), mun: $("#mun"), campoMun: $("#campo-mun"), modelo: $("#modelo"), regra: $("#regra"), pct: $("#pct"),
    resultado: $("#resultado"), dicaModelo: $("#dica-modelo"), dicaRegra: $("#dica-regra"), dicaPct: $("#dica-pct"),
    campoRegra: $("#campo-regra"), campoPct: $("#campo-pct"), rotPct: $("#rot-pct"),
  };
  const NOMES_UF = {
    AC: "Acre", AL: "Alagoas", AM: "Amazonas", AP: "Amapá", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
    ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MG: "Minas Gerais", MS: "Mato Grosso do Sul", MT: "Mato Grosso",
    PA: "Pará", PB: "Paraíba", PE: "Pernambuco", PI: "Piauí", PR: "Paraná", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
    RO: "Rondônia", RR: "Roraima", RS: "Rio Grande do Sul", SC: "Santa Catarina", SE: "Sergipe", SP: "São Paulo", TO: "Tocantins",
  };
  // distritos: usa distritos; pct: a parte majoritária é ajustável
  const MODELOS = {
    paralelo: { nome: "Distrital misto paralelo", distritos: true, pct: true,
      dica: "Parte das cadeiras nos distritos, o resto pelos votos partidários, sem desconto." },
    compensatorio: { nome: "Distrital misto compensatório", distritos: true, pct: true,
      dica: "Cadeiras de cada partido pelos votos partidários; os distritos são descontados delas (PL 9.212/2017)." },
    distritaoMisto: { nome: "Distritão misto", distritos: false, pct: true,
      dica: "Transição de 2030 na PEC: parte das vagas para os mais votados do estado, o resto por lista fechada." },
    distritao: { nome: "Distritão", distritos: false, pct: false,
      dica: "Todas as vagas para os mais votados do estado. Rejeitado pela Câmara em 2015, 2017 e 2021." },
    distrital: { nome: "Distrital puro", distritos: true, pct: false,
      dica: "Todas as vagas em distritos de um deputado só, como no Reino Unido e nos EUA." },
  };
  const DO_ = { AC: "do", AM: "do", AP: "do", CE: "do", DF: "do", ES: "do", MA: "do", MT: "do", MS: "do", PA: "do", PR: "do",
    PI: "do", RJ: "do", RN: "do", RS: "do", TO: "do", BA: "da", PB: "da" };
  const deUF = (uf) => `${DO_[uf] || "de"} ${NOMES_UF[uf]}`;
  const DICAS = {
    partido: "Supõe que quem votou no partido votaria no candidato dele no distrito.",
    candidato: "Conta só os votos pessoais do candidato que o partido lançaria ali.",
  };

  // Cores: algumas fixas para os maiores partidos, o resto por hash da sigla
  const CORES = {
    "PL": 215, "PT/PC do B/PV": 355, "UNIÃO": 180, "UNIÃO/PP": 180, "PP": 275, "PSD": 42, "MDB": 130,
    "REPUBLICANOS": 250, "PSDB/CIDADANIA": 160, "PSB": 18, "PDT": 325, "PSOL/REDE": 300, "PODE": 95, "NOVO": 28, "AVANTE": 70,
  };
  function matiz(sigla) {
    if (sigla in CORES) return CORES[sigla];
    let h = 0;
    for (const ch of sigla) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 360;
  }
  const quad = (sigla, cls = "quad") => `<span class="${cls} cor-p" style="--h:${matiz(sigla)}"></span>`;

  const fmt = (n) => Math.round(n).toLocaleString("pt-BR");
  const pct = (x, casas = 1) => (100 * x).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }) + "%";
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dif = (n) => (n > 0 ? `<span class="mais">+${n}</span>` : n < 0 ? `<span class="menos">−${-n}</span>` : "0");
  const eleitx = (c, m = "eleito", f = "eleita") => (c && c.f ? f : m);

  const cache = {};
  async function carregar(url) {
    if (!cache[url]) cache[url] = fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); });
    return cache[url];
  }

  let indice = null;
  const estado = { cargo: "federal", ano: null, uf: "BR", mun: "todos", modelo: "paralelo", regra: "candidato", pct: "50", distrito: null };
  const CAMPOS = ["cargo", "ano", "uf", "modelo", "regra", "pct"];
  const CARGOS = {
    federal: { chave: "anos", nome: "deputados federais", um: "deputado federal" },
    estadual: { chave: "estadual", nome: "deputados estaduais", um: "deputado estadual" },
    vereador: { chave: "vereador", nome: "vereadores", um: "vereador" },
  };
  const anosDo = (cargo) => Object.keys(indice[CARGOS[cargo].chave] || {}).sort().reverse();
  const ufsDo = () => {
    const l = indice[CARGOS[estado.cargo].chave][estado.ano];
    return Array.isArray(l) ? l : Object.keys(l);
  };
  const munsDo = (uf) => (estado.cargo === "vereador" ? indice.vereador[estado.ano][uf] || [] : []);
  const vagasNome = (dados) => (dados.cargo === "distrital" ? "deputados distritais" : CARGOS[estado.cargo].nome);

  function lerHash() {
    // formato: #2026-federal-SP-todos-paralelo-candidato-50 (só letras, números e hífens, para funcionar também como Artifact)
    // também aceita o formato antigo, sem cargo e município: #2026-SP-paralelo-candidato-50
    let partes = location.hash.replace(/^#\/?/, "").split(/[-/]/);
    if (partes.length > 1 && !(partes[1] in CARGOS)) partes = [partes[0], "federal", partes[1], "todos", ...partes.slice(2)];
    const [ano, cargo, uf, mun, modelo, regra, p] = partes;
    if (cargo in CARGOS && anosDo(cargo).length) estado.cargo = cargo;
    if (ano && anosDo(estado.cargo).includes(ano)) estado.ano = ano;
    else if (!anosDo(estado.cargo).includes(estado.ano)) estado.ano = anosDo(estado.cargo)[0];
    if (uf && (uf === "BR" || NOMES_UF[uf])) estado.uf = uf;
    if (mun) estado.mun = mun;
    if (modelo in MODELOS) estado.modelo = modelo;
    if (regra === "candidato" || regra === "partido") estado.regra = regra;
    if (p && indice.pcts.includes(+p) && +p !== 100) estado.pct = p;
    corrigir();
  }
  /** Mantém o estado coerente (UF que existe no ano/cargo, município que existe na UF) */
  function corrigir() {
    if (!anosDo(estado.cargo).includes(estado.ano)) estado.ano = anosDo(estado.cargo)[0];
    const ufs = ufsDo();
    if (estado.cargo === "vereador") {
      if (!ufs.includes(estado.uf)) estado.uf = ufs.includes("SP") ? "SP" : ufs[0];
      if (estado.mun !== "todos" && !munsDo(estado.uf).some((m) => m[0] === estado.mun)) estado.mun = "todos";
    } else {
      if (estado.uf !== "BR" && !ufs.includes(estado.uf)) estado.uf = "BR";
      estado.mun = "todos";
    }
  }
  function escreverHash() {
    const h = "#" + linkPara(estado.uf, estado.mun);
    if (location.hash !== h) history.replaceState(null, "", h);
  }

  const linkPara = (uf, mun = "todos") => `${estado.ano}-${estado.cargo}-${uf}-${mun}-${estado.modelo}-${estado.regra}-${estado.pct}`;
  const pctEfetivo = () => (MODELOS[estado.modelo].pct ? +estado.pct : 100);
  const opcoes = () => ({ modelo: estado.modelo, regra: estado.regra, pct: pctEfetivo() });

  /** JSON compactado com gzip (arquivos de vereador). Se o servidor já descompactou, lê direto.
   *  Onde .gz não é servido (Artifact), há uma cópia em base64 em .b64.txt. */
  function carregarGz(url) {
    if (!cache[url]) cache[url] = fetch(url).then(async (r) => {
      let buf;
      if (r.ok) buf = new Uint8Array(await r.arrayBuffer());
      else {
        const alt = await fetch(url.replace(/\.json\.gz$/, ".b64.txt"));
        if (!alt.ok) throw new Error(url);
        const bin = atob((await alt.text()).trim());
        buf = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      }
      if (buf[0] !== 0x1f || buf[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(buf));
      const fluxo = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(fluxo).text());
    });
    return cache[url];
  }

  /** Lista de dados (um por estado ou município) com o conjunto de distritos do tamanho certo */
  async function carregarDados() {
    const p = pctEfetivo();
    const comDistritos = MODELOS[estado.modelo].distritos && p !== 50;
    if (estado.cargo === "vereador") {
      const muns = await carregarGz(`data/${estado.ano}/vereador/${estado.uf}.json.gz`);
      const lista = estado.mun === "todos" ? Object.values(muns) : [muns[estado.mun]];
      return lista.map((d) => (comDistritos ? { ...d, distritos: d.outros[p] } : d));
    }
    const pasta = `data/${estado.ano}/${estado.cargo === "federal" ? "" : estado.cargo + "/"}`;
    const ufs = estado.uf === "BR" ? ufsDo() : [estado.uf];
    return Promise.all(ufs.map(async (uf) => {
      const base = await carregar(`${pasta}${uf}.json`);
      if (!comDistritos) return base;
      const extra = await carregar(`${pasta}d/${uf}.json`);
      return { ...base, distritos: extra[p] };
    }));
  }

  function preencherOnde() {
    el.ano.innerHTML = anosDo(estado.cargo).map((a) => `<option>${a}</option>`).join("");
    const ufs = ufsDo();
    el.uf.innerHTML = (estado.cargo === "vereador" ? "" : `<option value="BR">Brasil (todos os estados)</option>`)
      + Object.keys(NOMES_UF).filter((uf) => ufs.includes(uf)).map((uf) => `<option value="${uf}">${NOMES_UF[uf]}</option>`).join("");
    el.campoMun.hidden = estado.cargo !== "vereador";
    if (estado.cargo === "vereador") {
      el.mun.innerHTML = `<option value="todos">Todos os municípios</option>`
        + munsDo(estado.uf).map(([cod, nome, vagas]) => `<option value="${cod}">${esc(nome)} (${vagas})</option>`).join("");
    }
    for (const k of [...CAMPOS, "mun"]) el[k].value = estado[k];
  }

  async function iniciar() {
    indice = await carregar("data/index.json");
    estado.ano = anosDo("federal")[0];
    el.cargo.innerHTML = Object.entries(CARGOS).filter(([k]) => anosDo(k).length)
      .map(([k, c]) => `<option value="${k}">${c.um[0].toUpperCase() + c.um.slice(1)}${k === "estadual" ? " (ou distrital)" : ""}</option>`).join("");
    el.pct.innerHTML = indice.pcts.filter((p) => p !== 100).map((p) => `<option value="${p}">${p}% · ${100 - p}% pela lista</option>`).join("");
    lerHash();
    preencherOnde();
    for (const k of [...CAMPOS, "mun"]) {
      el[k].addEventListener("change", () => {
        estado[k] = el[k].value;
        estado.distrito = null;
        if (k === "cargo" || k === "uf" || k === "ano") { if (k !== "ano" || estado.cargo !== "vereador") estado.mun = "todos"; corrigir(); preencherOnde(); }
        atualizar();
      });
    }
    window.addEventListener("hashchange", () => { lerHash(); preencherOnde(); atualizar(); });
    atualizar();
  }

  let geracao = 0;
  async function atualizar() {
    const minha = ++geracao;
    escreverHash();
    const m = MODELOS[estado.modelo];
    el.dicaModelo.textContent = m.dica;
    el.dicaRegra.textContent = DICAS[estado.regra];
    el.campoRegra.hidden = !m.distritos;
    el.campoPct.hidden = !m.pct;
    el.rotPct.textContent = m.distritos ? "Vagas eleitas nos distritos" : "Vagas para os mais votados";
    el.dicaPct.textContent = estado.modelo === "distritaoMisto"
      ? "As reportagens falam em metade."
      : "O PL 9.212/2017 e a PEC de 2026 falam em metade.";
    if (estado.cargo === "vereador") el.resultado.innerHTML = `<p class="carregando">Carregando os municípios ${deUF(estado.uf)}…</p>`;
    try {
      const lista = await carregarDados();
      if (minha !== geracao) return;
      if (lista.length === 1) renderEstado(lista[0]);
      else renderAgregado(lista);
    } catch (e) {
      el.resultado.innerHTML = `<p class="aviso">Não foi possível carregar os dados (${esc(e.message)}).</p>`;
    }
  }

  // ------------------------------------------------------------- componentes

  function barras(partidos, total) {
    const linha = (chave, rotulo) => `
      <div class="rot-barra"><span>${rotulo}</span><span>${total} cadeiras</span></div>
      <div class="barra" role="img" aria-label="${rotulo}">${partidos.filter((p) => p[chave] > 0).map((p) =>
        `<span class="cor-p" style="--h:${matiz(p.sigla)};flex:${p[chave]}" title="${esc(p.sigla)}: ${p[chave]}"></span>`).join("")}</div>`;
    const legenda = partidos.filter((p) => p.atual || p.total).slice(0, 14)
      .map((p) => `<li>${quad(p.sigla)}${esc(p.sigla)}</li>`).join("");
    return `<div class="comparacao">${linha("atual", "Como foi (proporcional)")}${linha("total", MODELOS[estado.modelo].nome + " (simulação)")}</div>
      <ul class="legenda">${legenda}</ul>`;
  }

  function tabelaPartidos(partidos) {
    const m = MODELOS[estado.modelo];
    const comDistritos = estado.modelo !== "distritao" && estado.modelo !== "distrital";
    const rotulo = m.distritos ? "Distritos" : "Mais votados";
    const linhas = partidos.filter((p) => p.atual || p.total).map((p) => `
      <tr><td><span class="sigla">${quad(p.sigla)}${esc(p.sigla)}</span></td>
        <td class="r">${pct(p.share)}</td>
        <td class="r">${p.atual}</td>
        ${comDistritos ? `<td class="r">${p.distritais}</td><td class="r">${p.lista}</td>` : ""}
        <td class="r"><strong>${p.total}</strong></td>
        <td class="r">${dif(p.total - p.atual)}</td></tr>`).join("");
    return `<div class="tabela"><table>
      <thead><tr><th>Partido ou federação</th><th class="r">Votos</th><th class="r">Hoje</th>
        ${comDistritos ? `<th class="r">${rotulo}</th><th class="r">Lista</th>` : ""}
        <th class="r">Simulação</th><th class="r">Diferença</th></tr></thead>
      <tbody>${linhas}</tbody></table></div>`;
  }

  function numeros(itens) {
    return `<div class="numeros">${itens.map(([rot, val, nota]) =>
      `<div class="num-card"><span class="rot">${rot}</span><span class="val">${val}</span>${nota ? `<span class="nota">${nota}</span>` : ""}</div>`).join("")}</div>`;
  }

  function linhaCand(c, sigla, det) {
    return `<li>${quad(sigla)}<span>${esc(c.nome)} <span class="det">${esc(c.partido)}${det ? " · " + det : ""}</span></span><span class="r det">${fmt(c.v)}</span></li>`;
  }

  // ------------------------------------------------------------- Brasil

  function renderAgregado(todos) {
    const ver = estado.cargo === "vereador";
    const porSigla = {};
    let saem = 0, tomadas = 0, distritos = 0;
    const linhasUF = [];
    for (const dados of todos) {
      const r = D.simular(dados, opcoes());
      saem += r.saem.length;
      tomadas += r.tomadas.length;
      distritos += r.nMaj;
      let maior = null;
      for (const p of r.partidos) {
        const s = p.grupo.sigla;
        const a = (porSigla[s] ||= { sigla: s, votos: 0, atual: 0, total: 0, distritais: 0, lista: 0 });
        a.votos += p.votos; a.atual += p.atual; a.total += p.total; a.distritais += p.distritais; a.lista += p.lista;
        const d = p.total - p.atual;
        if (d > 0 && (!maior || d > maior.d)) maior = { s, d };
      }
      linhasUF.push({ uf: dados.uf, cod: dados.cod, nome: ver ? dados.municipio : NOMES_UF[dados.uf], vagas: dados.vagas, distritos: r.nMaj, saem: r.saem.length, tomadas: r.tomadas.length, maior });
    }
    const partidos = Object.values(porSigla).sort((a, b) => b.total - a.total || b.atual - a.atual);
    const votos = partidos.reduce((s, p) => s + p.votos, 0);
    for (const p of partidos) p.share = p.votos / votos;
    const vagas = partidos.reduce((s, p) => s + p.total, 0);
    const gAtual = D.gallagher(partidos, "atual"), gNovo = D.gallagher(partidos, "total");
    const efetivos = (k) => 1 / partidos.reduce((s, p) => s + Math.pow(p[k] / vagas, 2), 0);

    el.resultado.innerHTML = `
      <h2>${ver ? `Todos os municípios ${deUF(estado.uf)}` : "Brasil"} <span class="sub">· ${fmt(vagas)} ${CARGOS[estado.cargo].nome} · eleição de ${estado.ano}</span></h2>
      <p class="intro">${MODELOS[estado.modelo].nome}. Soma ${ver ? `dos ${fmt(todos.length)} municípios` : "dos 27 estados"}, cada um simulado separadamente${
        MODELOS[estado.modelo].distritos ? `, com ${fmt(distritos)} distritos no total` : estado.modelo === "distritaoMisto" ? `; ${fmt(distritos)} vagas vão para os mais votados de cada estado` : ""}.</p>
      ${numeros([
        [`${ver ? "Vereadores" : "Deputados"} que perderiam a vaga`, fmt(saem), `de ${fmt(vagas)}, ou ${pct(saem / vagas, 0)} do total`],
        ["Desproporcionalidade (Gallagher)", `${gAtual.toFixed(1)} → ${gNovo.toFixed(1)}`, "0 = cadeiras exatamente proporcionais aos votos"],
        ["Partidos efetivos", `${efetivos("atual").toFixed(1)} → ${efetivos("total").toFixed(1)}`, ver ? "fragmentação, somando todas as câmaras (Laakso-Taagepera)" : estado.cargo === "estadual" ? "fragmentação, somando todas as assembleias (Laakso-Taagepera)" : "fragmentação da Câmara (Laakso-Taagepera)"],
        estado.modelo === "compensatorio"
          ? ["Cadeiras extras por excesso de distritos", fmt(tomadas), "tomadas do fim da lista de outros partidos"]
          : estado.modelo === "distritao"
            ? ["Eleitos pelos votos pessoais", fmt(vagas), "sem quociente, sem lista"]
            : [MODELOS[estado.modelo].distritos ? "Cadeiras eleitas nos distritos" : "Cadeiras para os mais votados", fmt(distritos),
              distritos === vagas ? "não há lista" : `as outras ${fmt(vagas - distritos)} saem da lista`],
      ])}
      ${barras(partidos, vagas)}
      <h3>Cadeiras por partido</h3>
      ${tabelaPartidos(partidos)}
      <h3>Por ${ver ? "município" : "estado"}</h3>
      ${ver ? `<p class="intro">Os ${Math.min(60, linhasUF.length)} municípios com mais vagas. Escolha outro no seletor acima.</p>` : ""}
      <div class="tabela"><table>
        <thead><tr><th>${ver ? "Município" : "Estado"}</th><th class="r">Vagas</th><th class="r">${MODELOS[estado.modelo].distritos ? "Distritos" : "Mais votados"}</th><th class="r">Perderiam a vaga</th><th>Quem mais ganha</th></tr></thead>
        <tbody>${(ver ? linhasUF.sort((a, b) => b.vagas - a.vagas).slice(0, 60) : linhasUF).map((l) => `<tr>
          <td><a href="#${ver ? linkPara(estado.uf, l.cod) : linkPara(l.uf)}">${esc(l.nome)}</a></td>
          <td class="r">${l.vagas}</td><td class="r">${l.distritos}</td><td class="r">${l.saem}</td>
          <td>${l.maior ? `<span class="sigla">${quad(l.maior.s)}${esc(l.maior.s)} ${dif(l.maior.d)}</span>` : "—"}</td></tr>`).join("")}</tbody>
      </table></div>`;
  }

  // ------------------------------------------------------------- Estado

  function renderEstado(dados) {
    const r = D.simular(dados, opcoes());
    const m = MODELOS[estado.modelo];
    const semNome = r.eleitos.filter((e) => !e.cand).length;
    const grupoPor = Object.fromEntries(dados.grupos.map((g) => [g.id, g]));
    const sig = (gid) => (grupoPor[gid] ? grupoPor[gid].sigla : "?");
    const partidos = r.partidos.map((p) => ({ ...p, sigla: p.grupo.sigla, share: p.votos / dados.validos }));
    const atuais = new Set(dados.candidatos.filter((c) => c.eleito));
    const nd = r.distritos.length || 1;
    const porDistrito = Math.round(dados.aptos / nd);

    const entram = r.entram.slice().sort((a, b) => (a.via === b.via ? b.cand.v - a.cand.v : a.via === "lista" ? 1 : -1));
    const saem = r.saem.slice().sort((a, b) => b.v - a.v);
    const ver = estado.cargo === "vereador";
    const semMapa = new Set(dados.unidades.map((u) => u[4] + "," + u[5])).size < 2;
    const viaTxt = (e) => (e.via === "distrito" ? `distrito ${e.distrito}` : e.via === "votados" ? `${e.posicao}º mais votado` : `${e.posicao}º da lista`);

    el.resultado.innerHTML = `
      <h2>${ver ? `${esc(dados.municipio)} (${dados.uf})` : NOMES_UF[dados.uf]} <span class="sub">· ${dados.vagas} ${vagasNome(dados)} · eleição de ${estado.ano}</span></h2>
      ${numeros([
        m.distritos
          ? ["Distritos", nd, `cerca de ${fmt(porDistrito)} eleitores cada`]
          : ["Vagas para os mais votados", r.nMaj, r.nMaj === dados.vagas ? "todas" : `as outras ${dados.vagas - r.nMaj} saem da lista`],
        ["Perderiam a vaga", saem.length, `de ${dados.vagas} eleitos em ${estado.ano}`],
        ["Desproporcionalidade (Gallagher)", `${D.gallagher(partidos, "atual").toFixed(1)} → ${D.gallagher(partidos, "total").toFixed(1)}`, "0 = proporcional aos votos"],
        estado.modelo !== "compensatorio"
          ? ["Partidos com cadeira", `${partidos.filter((p) => p.atual).length} → ${partidos.filter((p) => p.total).length}`, "hoje → na simulação"]
          : r.tomadas.length
            ? ["Cadeiras extras", r.tomadas.length, resumoTomadas(r.tomadas, sig)]
            : ["Cadeiras extras", 0, "nenhum partido ganhou mais distritos do que cadeiras"],
      ])}
      ${barras(partidos, dados.vagas)}
      <h3>Cadeiras por partido</h3>
      ${tabelaPartidos(partidos)}
      ${m.distritos ? `<h3>Mapa dos distritos simulados</h3>
      ${semMapa
        ? `<p class="aviso">O TSE não publicou a localização dos locais de votação deste município (ou ele tem um só), então os distritos simulados dividem os mesmos votos em partes iguais e ficam parecidos entre si.</p>`
        : `<p class="intro">Cada ponto é ${ver ? "um local de votação" : "um município (ou uma zona eleitoral, nas cidades grandes)"}, do tamanho do seu eleitorado e na cor do seu distrito. Toque em um ponto ou em um distrito para ver os detalhes.</p>
      <div class="mapa-wrap">${mapa(dados, r, sig)}</div>
      <p class="nota-mapa">Os limites são uma simulação feita automaticamente para equilibrar o número de eleitores, não uma proposta.${
        ver && dados.unidades.length < nd * 3 ? " Este município tem poucos locais de votação, então vários distritos dividem o mesmo local." : ""}</p>`}
      <label class="busca-mun">Em qual distrito fica o seu ${ver ? "bairro" : "município"}?
        <input type="search" id="busca-mun" list="lista-mun" placeholder="Digite o ${ver ? "bairro" : "município"}…" autocomplete="off"></label>
      <datalist id="lista-mun">${[...new Set(dados.unidades.map((u) => u[0]))].map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
      <div id="detalhe-distrito"></div>
      <div class="distritos" id="distritos">${r.distritos.map((v) => cartaoDistrito(v, dados, sig, atuais)).join("")}</div>` : corte(r, dados, sig)}
      ${semNome ? `<p class="aviso">${semNome} vaga${semNome > 1 ? "s" : ""} ficaria${semNome > 1 ? "m" : ""} sem nome nesta simulação: o partido ganharia mais cadeiras do que candidatos que lançou em ${estado.ano}.</p>` : ""}

      <h3>Quem muda</h3>
      <div class="mudancas">
        <div><h4>Seriam eleitos (${entram.length})</h4><ul>${entram.map((e) => linhaCand(e.cand, sig(e.grupo), viaTxt(e))).join("") || "<li>Ninguém</li>"}</ul></div>
        <div><h4>Perderiam a vaga (${saem.length})</h4><ul>${saem.map((c) => linhaCand(c, sig(c.g), eleitx(c, "eleito", "eleita") + " em " + estado.ano)).join("") || "<li>Ninguém</li>"}</ul></div>
      </div>
      <details><summary>Todos os ${dados.vagas} eleitos na simulação</summary>
        <div class="mudancas"><ul>${r.eleitos.filter((e) => e.cand).sort((a, b) => b.cand.v - a.cand.v)
          .map((e) => linhaCand(e.cand, sig(e.grupo), viaTxt(e) + (atuais.has(e.cand) ? "" : " · novo"))).join("")}</ul></div>
      </details>`;

    const mostrar = (id) => {
      estado.distrito = id;
      document.querySelectorAll(".distrito").forEach((b) => b.classList.toggle("ativo", +b.dataset.d === id));
      document.querySelectorAll(".mapa circle").forEach((c) => c.classList.toggle("apagado", id !== null && +c.dataset.d !== id));
      $("#detalhe-distrito").innerHTML = id === null ? "" : detalheDistrito(r.distritos[id - 1], dados, sig);
    };
    el.resultado.querySelectorAll(".distrito").forEach((b) => b.addEventListener("click", () => mostrar(estado.distrito === +b.dataset.d ? null : +b.dataset.d)));
    el.resultado.querySelectorAll(".mapa circle").forEach((c) => c.addEventListener("click", () => {
      mostrar(+c.dataset.d);
      $("#detalhe-distrito").scrollIntoView({ behavior: "smooth", block: "nearest" });
    }));
    const zoom = el.resultado.querySelector(".zoom");
    if (zoom) zoom.addEventListener("click", () => {
      const ativo = zoom.getAttribute("aria-pressed") !== "true";
      zoom.setAttribute("aria-pressed", ativo);
      zoom.textContent = ativo ? "Ver o estado inteiro" : "Ampliar a região mais populosa";
      const svg = el.resultado.querySelector(".mapa");
      svg.setAttribute("viewBox", ativo ? zoom.dataset.zoom : zoom.dataset.tudo);
      svg.classList.toggle("ampliado", ativo);
      // no zoom, os pontos encolhem para não se sobreporem tanto
      const f = ativo ? Math.pow(+zoom.dataset.zoom.split(" ")[2] / +zoom.dataset.tudo.split(" ")[2], 0.6) : 1;
      svg.querySelectorAll("circle").forEach((c) => c.setAttribute("r", (c.dataset.r * f).toFixed(2)));
    });
    if (m.distritos) $("#busca-mun").addEventListener("input", (ev) => {
      const nome = ev.target.value.trim().toLowerCase();
      const i = dados.unidades.findIndex((u) => u[0].toLowerCase() === nome);
      if (i < 0) return;
      const d = dados.distritos.find((x) => x.unidades.some(([j]) => j === i));
      if (d) { mostrar(d.id); $("#detalhe-distrito").scrollIntoView({ behavior: "smooth", block: "nearest" }); }
    });
    if (estado.distrito) mostrar(estado.distrito);
  }

  /** Distritão: a linha de corte entre o último eleito pelos votos pessoais e o primeiro que fica de fora */
  function corte(r, dados, sig) {
    const eleitos = new Set(r.eleitos.map((e) => e.idx));
    const ultimo = r.eleitos.filter((e) => e.via === "votados").at(-1);
    const fora = dados.candidatos.map((c, i) => ({ c, i })).filter((x) => !eleitos.has(x.i)).sort((a, b) => b.c.v - a.c.v).slice(0, 5);
    if (!ultimo) return "";
    return `<h3>A linha de corte</h3>
      <p class="intro">O ${ultimo.posicao}º mais votado do estado entra com ${fmt(ultimo.cand.v)} votos. Logo abaixo, ficariam de fora${
        estado.modelo === "distritaoMisto" ? " (a não ser que estejam bem colocados na lista do partido)" : ""}:</p>
      <div class="mudancas"><ul>${linhaCand(ultimo.cand, sig(ultimo.grupo), "último eleito")}${fora.map((x) => linhaCand(x.c, sig(x.c.g), "não eleito")).join("")}</ul></div>`;
  }

  function resumoTomadas(tomadas, sig) {
    const por = {};
    for (const t of tomadas) ((por[t.para] ||= {})[t.de] = (por[t.para][t.de] || 0) + 1);
    return Object.entries(por).map(([para, de]) => `${esc(sig(para))} ganhou mais distritos do que cadeiras e ficou com ${Object.values(de).reduce((a, b) => a + b, 0)} a mais, tiradas do fim da lista (${
      Object.entries(de).map(([g, n]) => `${esc(sig(g))}${n > 1 ? " " + n : ""}`).join(", ")})`).join("; ");
  }

  /** Nome curto de um distrito: os municípios com mais eleitores dentro dele */
  function lugares(d, dados, max = 3) {
    const porMun = new Map();
    for (const [i, f] of d.unidades) {
      const u = dados.unidades[i];
      const k = u[0];
      const m = porMun.get(k) || { nome: k, eleitores: 0, zonas: [], inteiro: true };
      m.eleitores += u[3] * f;
      m.zonas.push(u[2]);
      porMun.set(k, m);
    }
    const lista = [...porMun.values()].sort((a, b) => b.eleitores - a.eleitores);
    // município parcialmente no distrito?
    for (const m of lista) {
      const total = dados.unidades.filter((u) => u[0] === m.nome).reduce((s, u) => s + u[3], 0);
      m.inteiro = m.eleitores >= total * 0.999;
    }
    return { lista, texto: lista.slice(0, max).map((m) => m.nome + (m.inteiro ? "" : " (parte)")).join(", ") + (lista.length > max ? ` e mais ${lista.length - max}` : "") };
  }

  function cartaoDistrito(v, dados, sig, atuais) {
    const d = v.distrito, c = v.cand !== null ? dados.candidatos[v.cand] : null;
    const s = sig(v.grupo);
    return `<button type="button" class="distrito" data-d="${d.id}">
      <span class="cab"><span>Distrito ${d.id}</span><span>${pct(v.pct, 0)} · margem ${pct(v.margem, 0)}</span></span>
      <span class="quem">${quad(s)}${c ? esc(c.nome) : "—"} ${c && !atuais.has(c) ? `<span class="novo">novo</span>` : ""}</span>
      <span class="part">${esc(s)}</span>
      <p class="onde">${esc(lugares(d, dados).texto)}</p></button>`;
  }

  function detalheDistrito(v, dados, sig) {
    const d = v.distrito;
    const { lista } = lugares(d, dados);
    const total = estado.regra === "candidato" ? Object.values(d.cv).reduce((a, b) => a + b, 0) : d.validos;
    const linhas = Object.keys(d.votos)
      .map((g) => ({ g, v: estado.regra === "candidato" ? (d.cv[g] || 0) : d.votos[g], c: d.cand[g] !== undefined ? dados.candidatos[d.cand[g]] : null, cv: d.cv[g] || 0 }))
      .filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 8);
    return `<div class="detalhe-distrito">
      <h4>Distrito ${d.id} · ${fmt(d.aptos)} eleitores</h4>
      <p class="onde">${lista.map((m) => esc(m.nome) + (m.inteiro ? "" : estado.cargo === "vereador" ? " (em parte)" : ` (zona${m.zonas.length > 1 ? "s" : ""} ${[...new Set(m.zonas)].join(", ")}, em parte)`)).join(", ")}</p>
      <div class="tabela"><table><thead><tr><th>Partido</th><th>Candidato que lançaria</th><th class="r">Votos do candidato</th><th class="r">${estado.regra === "candidato" ? "%" : "Votos do partido"}</th></tr></thead>
      <tbody>${linhas.map((x, i) => `<tr${i === 0 ? ' style="font-weight:700"' : ""}><td><span class="sigla">${quad(sig(x.g))}${esc(sig(x.g))}</span></td>
        <td>${x.c ? esc(x.c.nome) : "—"}</td><td class="r">${fmt(x.cv)}</td>
        <td class="r">${estado.regra === "candidato" ? pct(x.v / total) : `${fmt(x.v)} (${pct(x.v / total, 0)})`}</td></tr>`).join("")}</tbody></table></div></div>`;
  }

  const corDistrito = (id) => Math.round((id * 137.508) % 360);

  function mapa(dados, r, sig) {
    const dono = new Array(dados.unidades.length).fill(null);
    const fracMax = new Array(dados.unidades.length).fill(0);
    for (const d of dados.distritos) for (const [i, f] of d.unidades) if (f > fracMax[i]) { fracMax[i] = f; dono[i] = d.id; }
    const us = dados.unidades.map((u, i) => ({ i, lat: u[4], lon: u[5], n: u[3], d: dono[i] })).filter((u) => u.d);
    const lat0 = us.reduce((s, u) => s + u.lat, 0) / us.length;
    const k = Math.cos((lat0 * Math.PI) / 180);
    const X = (u) => u.lon * k, Y = (u) => -u.lat;
    const caixa = (lista) => {
      const xs = lista.map(X), ys = lista.map(Y);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    };
    const tudo = caixa(us);
    const W = 600, pad = 18;
    const esc_ = W / Math.max(tudo.x1 - tudo.x0, (tudo.y1 - tudo.y0) * 0.9, 1e-6);
    const px = (u) => [pad + (X(u) - tudo.x0) * esc_, pad + (Y(u) - tudo.y0) * esc_];
    const vbTudo = `0 0 ${Math.ceil((tudo.x1 - tudo.x0) * esc_ + 2 * pad)} ${Math.ceil((tudo.y1 - tudo.y0) * esc_ + 2 * pad)}`;
    // zoom: distritos pequenos (urbanos), com diagonal menor que 12% da do estado
    const diag = (c) => Math.hypot(c.x1 - c.x0, c.y1 - c.y0);
    const porD = {};
    for (const u of us) (porD[u.d] ||= []).push(u);
    const urbanos = Object.values(porD).filter((l) => diag(caixa(l)) < 0.12 * diag(tudo)).flat();
    let vbZoom = null;
    if (urbanos.length && dados.distritos.length > 4) {
      const c = caixa(urbanos);
      const m = Math.max(c.x1 - c.x0, c.y1 - c.y0) * 0.08 + 0.02;
      const [a, b] = px({ lon: (c.x0 - m) / k, lat: -(c.y0 - m) }), [e, f] = px({ lon: (c.x1 + m) / k, lat: -(c.y1 + m) });
      vbZoom = `${a.toFixed(1)} ${b.toFixed(1)} ${(e - a).toFixed(1)} ${(f - b).toFixed(1)}`;
    }
    const nMax = Math.max(...us.map((u) => u.n));
    const rMax = Math.min(26, 5 + 110 / Math.sqrt(us.length));
    const venc = Object.fromEntries(r.distritos.map((v) => [v.distrito.id, sig(v.grupo)]));
    const centro = {};
    for (const u of us) {
      const [x, y] = px(u);
      const c = (centro[u.d] ||= { x: 0, y: 0, n: 0 });
      c.x += x * u.n; c.y += y * u.n; c.n += u.n;
    }
    const contagem = {};
    for (const u of dados.unidades) contagem[u[0]] = (contagem[u[0]] || 0) + 1;
    const pontos = us.sort((a, b) => b.n - a.n).map((u) => {
      const [x, y] = px(u);
      const raio = Math.max(1.4, rMax * Math.sqrt(u.n / nMax));
      const un = dados.unidades[u.i];
      const nome = un[0] + (contagem[un[0]] > 1 && estado.cargo !== "vereador" ? ` (zona ${un[2]})` : "");
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${raio.toFixed(2)}" data-r="${raio.toFixed(2)}" data-d="${u.d}" style="fill:hsl(${corDistrito(u.d)} var(--sat) var(--lum))"><title>${esc(nome)} · distrito ${u.d}, vencido por ${esc(venc[u.d])}</title></circle>`;
    }).join("");
    const rotulos = Object.entries(centro).map(([d, c]) => `<text x="${(c.x / c.n).toFixed(1)}" y="${(c.y / c.n).toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${d}</text>`).join("");
    const botao = vbZoom ? `<button type="button" class="zoom" data-tudo="${vbTudo}" data-zoom="${vbZoom}" aria-pressed="false">Ampliar a região mais populosa</button>` : "";
    return `${botao}<svg class="mapa" viewBox="${vbTudo}" role="img" aria-label="Mapa dos distritos simulados">${pontos}${rotulos}</svg>`;
  }

  iniciar().catch((e) => { el.resultado.innerHTML = `<p class="aviso">Erro ao iniciar: ${esc(e.message)}</p>`; });
})();
