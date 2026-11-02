/* Interface da simulação. Depende de engine.js (window.Distrital). */
(function () {
  "use strict";
  const D = window.Distrital;
  const $ = (s) => document.querySelector(s);
  const el = {
    ano: $("#ano"), uf: $("#uf"), modelo: $("#modelo"), regra: $("#regra"),
    resultado: $("#resultado"), dicaModelo: $("#dica-modelo"), dicaRegra: $("#dica-regra"),
  };
  const NOMES_UF = {
    AC: "Acre", AL: "Alagoas", AM: "Amazonas", AP: "Amapá", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
    ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MG: "Minas Gerais", MS: "Mato Grosso do Sul", MT: "Mato Grosso",
    PA: "Pará", PB: "Paraíba", PE: "Pernambuco", PI: "Piauí", PR: "Paraná", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
    RO: "Rondônia", RR: "Roraima", RS: "Rio Grande do Sul", SC: "Santa Catarina", SE: "Sergipe", SP: "São Paulo", TO: "Tocantins",
  };
  const DICAS = {
    compensatorio: "Cadeiras de cada partido pelos votos partidários; os distritos são descontados delas.",
    paralelo: "Metade das cadeiras nos distritos, a outra metade pelos votos partidários, sem desconto.",
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
  const estado = { ano: null, uf: "BR", modelo: "compensatorio", regra: "partido", distrito: null };

  function lerHash() {
    // formato: #2026-SP-compensatorio-partido (só letras, números e hífens, para funcionar também como Artifact)
    const [ano, uf, modelo, regra] = location.hash.replace(/^#\/?/, "").split(/[-/]/);
    if (ano && indice.anos[ano]) estado.ano = ano;
    if (uf && (uf === "BR" || NOMES_UF[uf])) estado.uf = uf;
    if (modelo === "paralelo" || modelo === "compensatorio") estado.modelo = modelo;
    if (regra === "candidato" || regra === "partido") estado.regra = regra;
  }
  function escreverHash() {
    const h = `#${estado.ano}-${estado.uf}-${estado.modelo}-${estado.regra}`;
    if (location.hash !== h) history.replaceState(null, "", h);
  }

  async function iniciar() {
    indice = await carregar("data/index.json");
    const anos = Object.keys(indice.anos).sort().reverse();
    estado.ano = anos[0];
    el.ano.innerHTML = anos.map((a) => `<option>${a}</option>`).join("");
    el.uf.innerHTML += Object.keys(NOMES_UF).map((uf) => `<option value="${uf}">${NOMES_UF[uf]}</option>`).join("");
    lerHash();
    for (const k of ["ano", "uf", "modelo", "regra"]) {
      el[k].value = estado[k];
      el[k].addEventListener("change", () => { estado[k] = el[k].value; estado.distrito = null; atualizar(); });
    }
    window.addEventListener("hashchange", () => { lerHash(); for (const k of ["ano", "uf", "modelo", "regra"]) el[k].value = estado[k]; atualizar(); });
    atualizar();
  }

  let geracao = 0;
  async function atualizar() {
    const minha = ++geracao;
    escreverHash();
    el.dicaModelo.textContent = DICAS[estado.modelo];
    el.dicaRegra.textContent = DICAS[estado.regra];
    try {
      if (estado.uf === "BR") {
        const ufs = indice.anos[estado.ano];
        const todos = await Promise.all(ufs.map((uf) => carregar(`data/${estado.ano}/${uf}.json`)));
        if (minha === geracao) renderBrasil(todos);
      } else {
        const dados = await carregar(`data/${estado.ano}/${estado.uf}.json`);
        if (minha === geracao) renderEstado(dados);
      }
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
    return `<div class="comparacao">${linha("atual", "Como foi (proporcional)")}${linha("total", "Distrital misto (simulação)")}</div>
      <ul class="legenda">${legenda}</ul>`;
  }

  function tabelaPartidos(partidos, comDistritos) {
    const linhas = partidos.filter((p) => p.atual || p.total).map((p) => `
      <tr><td><span class="sigla">${quad(p.sigla)}${esc(p.sigla)}</span></td>
        <td class="r">${pct(p.share)}</td>
        <td class="r">${p.atual}</td>
        ${comDistritos ? `<td class="r">${p.distritais}</td><td class="r">${p.lista}</td>` : ""}
        <td class="r"><strong>${p.total}</strong></td>
        <td class="r">${dif(p.total - p.atual)}</td></tr>`).join("");
    return `<div class="tabela"><table>
      <thead><tr><th>Partido ou federação</th><th class="r">Votos</th><th class="r">Hoje</th>
        ${comDistritos ? `<th class="r">Distritos</th><th class="r">Lista</th>` : ""}
        <th class="r">Distrital misto</th><th class="r">Diferença</th></tr></thead>
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

  function renderBrasil(todos) {
    const porSigla = {};
    let saem = 0, tomadas = 0, distritos = 0;
    const linhasUF = [];
    for (const dados of todos) {
      const r = D.simular(dados, estado);
      saem += r.saem.length;
      tomadas += r.tomadas.length;
      distritos += dados.distritos.length;
      let maior = null;
      for (const p of r.partidos) {
        const s = p.grupo.sigla;
        const a = (porSigla[s] ||= { sigla: s, votos: 0, atual: 0, total: 0, distritais: 0, lista: 0 });
        a.votos += p.votos; a.atual += p.atual; a.total += p.total; a.distritais += p.distritais; a.lista += p.lista;
        const d = p.total - p.atual;
        if (d > 0 && (!maior || d > maior.d)) maior = { s, d };
      }
      linhasUF.push({ uf: dados.uf, vagas: dados.vagas, distritos: dados.distritos.length, saem: r.saem.length, tomadas: r.tomadas.length, maior });
    }
    const partidos = Object.values(porSigla).sort((a, b) => b.total - a.total || b.atual - a.atual);
    const votos = partidos.reduce((s, p) => s + p.votos, 0);
    for (const p of partidos) p.share = p.votos / votos;
    const vagas = partidos.reduce((s, p) => s + p.total, 0);
    const gAtual = D.gallagher(partidos, "atual"), gNovo = D.gallagher(partidos, "total");
    const efetivos = (k) => 1 / partidos.reduce((s, p) => s + Math.pow(p[k] / vagas, 2), 0);

    el.resultado.innerHTML = `
      <h2>Brasil <span class="sub">· eleição de ${estado.ano}</span></h2>
      <p class="intro">Soma dos 27 estados: cada um é simulado separadamente, com ${fmt(distritos)} distritos no total.</p>
      ${numeros([
        ["Deputados que perderiam a vaga", fmt(saem), `de ${vagas}, ou ${pct(saem / vagas, 0)} da Câmara`],
        ["Desproporcionalidade (Gallagher)", `${gAtual.toFixed(1)} → ${gNovo.toFixed(1)}`, "0 = cadeiras exatamente proporcionais aos votos"],
        ["Partidos efetivos", `${efetivos("atual").toFixed(1)} → ${efetivos("total").toFixed(1)}`, "fragmentação da Câmara (Laakso-Taagepera)"],
        estado.modelo === "compensatorio"
          ? ["Cadeiras extras por excesso de distritos", fmt(tomadas), "tomadas do fim da lista de outros partidos"]
          : ["Cadeiras eleitas nos distritos", fmt(distritos), "a outra metade sai da lista"],
      ])}
      ${barras(partidos, vagas)}
      <h3>Cadeiras por partido</h3>
      ${tabelaPartidos(partidos, true)}
      <h3>Por estado</h3>
      <div class="tabela"><table>
        <thead><tr><th>Estado</th><th class="r">Vagas</th><th class="r">Distritos</th><th class="r">Perderiam a vaga</th><th>Quem mais ganha</th></tr></thead>
        <tbody>${linhasUF.map((l) => `<tr>
          <td><a href="#${estado.ano}-${l.uf}-${estado.modelo}-${estado.regra}">${NOMES_UF[l.uf]}</a></td>
          <td class="r">${l.vagas}</td><td class="r">${l.distritos}</td><td class="r">${l.saem}</td>
          <td>${l.maior ? `<span class="sigla">${quad(l.maior.s)}${esc(l.maior.s)} ${dif(l.maior.d)}</span>` : "—"}</td></tr>`).join("")}</tbody>
      </table></div>`;
  }

  // ------------------------------------------------------------- Estado

  function renderEstado(dados) {
    const r = D.simular(dados, estado);
    const grupoPor = Object.fromEntries(dados.grupos.map((g) => [g.id, g]));
    const sig = (gid) => (grupoPor[gid] ? grupoPor[gid].sigla : "?");
    const partidos = r.partidos.map((p) => ({ ...p, sigla: p.grupo.sigla, share: p.votos / dados.validos }));
    const atuais = new Set(dados.candidatos.filter((c) => c.eleito));
    const nd = dados.distritos.length;
    const porDistrito = Math.round(dados.aptos / nd);

    const entram = r.entram.slice().sort((a, b) => (a.via === b.via ? b.cand.v - a.cand.v : a.via === "distrito" ? -1 : 1));
    const saem = r.saem.slice().sort((a, b) => b.v - a.v);
    const viaTxt = (e) => (e.via === "distrito" ? `distrito ${e.distrito}` : `${e.posicao}º da lista`);

    el.resultado.innerHTML = `
      <h2>${NOMES_UF[dados.uf]} <span class="sub">· ${dados.vagas} deputados federais · eleição de ${estado.ano}</span></h2>
      ${numeros([
        ["Distritos", nd, `cerca de ${fmt(porDistrito)} eleitores cada`],
        ["Perderiam a vaga", saem.length, `de ${dados.vagas} eleitos em ${estado.ano}`],
        ["Desproporcionalidade (Gallagher)", `${D.gallagher(partidos, "atual").toFixed(1)} → ${D.gallagher(partidos, "total").toFixed(1)}`, "0 = proporcional aos votos"],
        r.tomadas.length
          ? ["Cadeiras extras", r.tomadas.length, resumoTomadas(r.tomadas, sig)]
          : ["Cadeiras extras", 0, "nenhum partido ganhou mais distritos do que cadeiras"],
      ])}
      ${barras(partidos, dados.vagas)}
      <h3>Cadeiras por partido</h3>
      ${tabelaPartidos(partidos, true)}

      <h3>Mapa dos distritos simulados</h3>
      <p class="intro">Cada ponto é um município (ou uma zona eleitoral, nas cidades grandes), do tamanho do seu eleitorado e na cor do seu distrito. Toque em um ponto ou em um distrito para ver os detalhes.</p>
      <div class="mapa-wrap">${mapa(dados, r, sig)}</div>
      <p class="nota-mapa">Os limites são uma simulação feita automaticamente para equilibrar o número de eleitores, não uma proposta.</p>
      <label class="busca-mun">Em qual distrito fica o seu município?
        <input type="search" id="busca-mun" list="lista-mun" placeholder="Digite o município…" autocomplete="off"></label>
      <datalist id="lista-mun">${[...new Set(dados.unidades.map((u) => u[0]))].map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
      <div id="detalhe-distrito"></div>
      <div class="distritos" id="distritos">${r.distritos.map((v) => cartaoDistrito(v, dados, sig, atuais)).join("")}</div>

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
    $("#busca-mun").addEventListener("input", (ev) => {
      const nome = ev.target.value.trim().toLowerCase();
      const i = dados.unidades.findIndex((u) => u[0].toLowerCase() === nome);
      if (i < 0) return;
      const d = dados.distritos.find((x) => x.unidades.some(([j]) => j === i));
      if (d) { mostrar(d.id); $("#detalhe-distrito").scrollIntoView({ behavior: "smooth", block: "nearest" }); }
    });
    if (estado.distrito) mostrar(estado.distrito);
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
      <p class="onde">${lista.map((m) => esc(m.nome) + (m.inteiro ? "" : ` (zona${m.zonas.length > 1 ? "s" : ""} ${m.zonas.join(", ")}, em parte)`)).join(", ")}</p>
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
      const nome = un[0] + (contagem[un[0]] > 1 ? ` (zona ${un[2]})` : "");
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${raio.toFixed(2)}" data-r="${raio.toFixed(2)}" data-d="${u.d}" style="fill:hsl(${corDistrito(u.d)} var(--sat) var(--lum))"><title>${esc(nome)} · distrito ${u.d}, vencido por ${esc(venc[u.d])}</title></circle>`;
    }).join("");
    const rotulos = Object.entries(centro).map(([d, c]) => `<text x="${(c.x / c.n).toFixed(1)}" y="${(c.y / c.n).toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${d}</text>`).join("");
    const botao = vbZoom ? `<button type="button" class="zoom" data-tudo="${vbTudo}" data-zoom="${vbZoom}" aria-pressed="false">Ampliar a região mais populosa</button>` : "";
    return `${botao}<svg class="mapa" viewBox="${vbTudo}" role="img" aria-label="Mapa dos distritos simulados">${pontos}${rotulos}</svg>`;
  }

  iniciar().catch((e) => { el.resultado.innerHTML = `<p class="aviso">Erro ao iniciar: ${esc(e.message)}</p>`; });
})();
