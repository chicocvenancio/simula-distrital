/*
 * Motor da simulação: quem seria eleito no sistema distrital misto?
 *
 * Regras do PL 9.212/2017 (PLS 86/2017, do senador José Serra, aprovado no Senado e
 * parado na Câmara; é o projeto que Hugo Motta disse que quer votar):
 *
 *  - O estado é dividido em distritos: a parte inteira da metade das cadeiras.
 *  - Cada partido lança 1 candidato por distrito; vence quem tiver mais votos (maioria simples).
 *  - Cada eleitor também dá um voto partidário. Com esses votos se monta uma lista
 *    ordenada de partidos pelo método das maiores médias (D'Hondt), com todas as cadeiras
 *    do estado (art. 105-B). É isso que define quantas cadeiras cada partido terá.
 *  - As cadeiras que o partido ganhou nos distritos são descontadas das suas posições na
 *    lista (art. 105-C). Se ganhou mais distritos do que posições, recebe as que faltam
 *    tomando, de trás para a frente na lista, posições de outros partidos que ainda não
 *    tinham sido preenchidas (parágrafo único). O total de cadeiras não muda.
 *  - O restante é preenchido pela lista preordenada de cada partido (art. 105-D).
 *
 * Outros modelos discutidos no Congresso nos últimos 20 anos, para comparação:
 *  - "paralelo": distritos + lista proporcional, sem desconto (a leitura mais direta do que as
 *    reportagens descrevem sobre a PEC de 2026: "metade nos distritos, metade pela lista");
 *  - "distritaoMisto": a transição de 2030 negociada na PEC de 2026 — parte das vagas vai
 *    para os candidatos mais votados no estado, o resto para listas fechadas, proporcionalmente;
 *  - "distritao": todas as vagas para os mais votados no estado (PECs rejeitadas em 2015, 2017 e 2021);
 *  - "distrital": distrital puro, todas as vagas em distritos de um deputado.
 * Nos modelos mistos, opcoes.pct é a parte (%) das vagas eleitas no distrito/majoritariamente.
 *
 * Como ninguém votou assim, a simulação usa os votos reais de deputado:
 *  - voto partidário = votos do partido/federação no estado (nominais + legenda);
 *  - no distrito, cada partido é representado por um candidato (escolhido no build:
 *    o mais votado do partido naquele distrito, sem repetir candidato em dois distritos);
 *  - vence o distrito o partido com mais votos nele (regra "partido") ou o candidato com
 *    mais votos pessoais nele (regra "candidato");
 *  - a lista fechada de cada partido segue a ordem dos votos nominais no estado.
 */
(function (global) {
  "use strict";

  /** Lista ordenada de partidos pelo método D'Hondt (art. 105-B). Empate: mais votos, depois id. */
  function listaDHondt(votos, cadeiras) {
    const ids = Object.keys(votos).filter((id) => votos[id] > 0);
    const n = Object.fromEntries(ids.map((id) => [id, 0]));
    const lista = [];
    for (let i = 0; i < cadeiras && ids.length; i++) {
      let melhor = null, media = -1;
      for (const id of ids) {
        const m = votos[id] / (n[id] + 1);
        if (m > media || (m === media && (votos[id] > votos[melhor] || (votos[id] === votos[melhor] && id < melhor)))) {
          melhor = id; media = m;
        }
      }
      lista.push(melhor);
      n[melhor]++;
    }
    return lista;
  }

  function contar(lista) {
    const c = {};
    for (const id of lista) c[id] = (c[id] || 0) + 1;
    return c;
  }

  /** Vencedor de cada distrito: { grupo, cand, votos, segundo, margem } */
  function vencedoresDistritos(dados, regra) {
    return dados.distritos.map((d) => {
      const disputa = Object.keys(d.votos).map((g) => ({
        g,
        votos: regra === "candidato" ? (d.cv[g] || 0) : d.votos[g],
        cand: d.cand[g] ?? null,
      })).filter((x) => x.votos > 0 && x.cand !== null); // partido sem candidato no distrito não concorre
      disputa.sort((a, b) => b.votos - a.votos || (d.votos[b.g] - d.votos[a.g]) || (a.g < b.g ? -1 : 1));
      const [v, s] = disputa;
      const total = regra === "candidato" ? disputa.reduce((t, x) => t + x.votos, 0) : d.validos;
      return {
        distrito: d,
        grupo: v ? v.g : null,
        cand: v ? v.cand : null,
        votos: v ? v.votos : 0,
        segundo: s ? s.g : null,
        pct: total ? (v ? v.votos : 0) / total : 0,
        margem: total && s ? (v.votos - s.votos) / total : 1,
      };
    });
  }

  /**
   * Cadeiras por partido no modelo compensatório (arts. 105-B e 105-C).
   * Retorna { lista, porLista, distritais, cadeiras, tomadas: [{posicao, de, para}] }
   */
  function compensatorio(votos, cadeiras, distritais) {
    const lista = listaDHondt(votos, cadeiras);
    const porLista = contar(lista);
    // dono final de cada posição da lista; começa igual à lista
    const dono = lista.slice();
    // posições "distribuídas": as primeiras de cada partido, até o nº de distritos que ganhou
    const usadas = {};
    const preenchida = lista.map((id) => {
      usadas[id] = (usadas[id] || 0) + 1;
      return usadas[id] <= (distritais[id] || 0);
    });
    const tomadas = [];
    // partidos com mais distritos do que posições (em ordem de quem tem mais excesso)
    const falta = Object.keys(distritais)
      .map((id) => ({ id, n: distritais[id] - (porLista[id] || 0) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1));
    let pos = lista.length - 1;
    for (const f of falta) {
      for (let k = 0; k < f.n; k++) {
        while (pos >= 0 && preenchida[pos]) pos--;
        if (pos < 0) break; // não acontece: distritos < cadeiras
        tomadas.push({ posicao: pos + 1, de: dono[pos], para: f.id });
        dono[pos] = f.id;
        preenchida[pos] = true;
        pos--;
      }
    }
    return { lista, dono, porLista, distritais, cadeiras: contar(dono), tomadas };
  }

  /** Variante paralela: distritos + metade restante proporcional, sem desconto. */
  function paralelo(votos, cadeiras, nDistritos, distritais) {
    const lista = listaDHondt(votos, cadeiras - nDistritos);
    const porLista = contar(lista);
    const total = { ...porLista };
    for (const id in distritais) total[id] = (total[id] || 0) + distritais[id];
    return { lista, dono: lista, porLista, distritais, cadeiras: total, tomadas: [] };
  }

  /**
   * Simula um estado.
   * opcoes: { modelo: "paralelo" | "compensatorio" | "distritaoMisto" | "distritao" | "distrital",
   *           regra: "partido" | "candidato", pct: 50 }
   * dados.distritos deve ser o conjunto de distritos do tamanho certo (o app carrega o arquivo d<pct>).
   * Retorna { distritos, partidos: [{grupo, atual, distritais, lista, total}], eleitos, entram, saem, ... }
   */
  function simular(dados, opcoes = {}) {
    const modelo = opcoes.modelo || "paralelo";
    const regra = opcoes.regra || "candidato";
    const cands = dados.candidatos;
    const votos = Object.fromEntries(dados.grupos.map((g) => [g.id, g.votos]));
    const pct = modelo === "distrital" || modelo === "distritao" ? 100 : (opcoes.pct || 50);
    const nMaj = nMajoritarias(dados.vagas, pct);
    const porDistrito = ["paralelo", "compensatorio", "distrital"].includes(modelo);
    const venc = porDistrito ? vencedoresDistritos(dados, regra) : [];
    // eleitos pela parte majoritária: vencedores dos distritos ou os mais votados no estado
    const eleitos = [];
    const jaEleito = new Set();
    const distritais = {};
    if (porDistrito) {
      for (const v of venc) {
        if (!v.grupo) continue;
        distritais[v.grupo] = (distritais[v.grupo] || 0) + 1;
        const c = v.cand !== null ? cands[v.cand] : null;
        if (c) jaEleito.add(v.cand);
        eleitos.push({ cand: c, idx: v.cand, grupo: v.grupo, via: "distrito", distrito: v.distrito.id });
      }
    } else {
      const ranking = cands.map((c, i) => i).sort((a, b) => cands[b].v - cands[a].v || a - b).slice(0, nMaj);
      ranking.forEach((i, k) => {
        distritais[cands[i].g] = (distritais[cands[i].g] || 0) + 1;
        jaEleito.add(i);
        eleitos.push({ cand: cands[i], idx: i, grupo: cands[i].g, via: "votados", posicao: k + 1 });
      });
    }

    let r;
    if (modelo === "compensatorio") r = compensatorio(votos, dados.vagas, distritais);
    else if (modelo === "distritao" || modelo === "distrital") r = { lista: [], porLista: {}, cadeiras: { ...distritais }, tomadas: [] };
    else r = paralelo(votos, dados.vagas, porDistrito ? dados.distritos.length : nMaj, distritais);

    // depois, a lista de cada partido
    const porGrupo = {};
    cands.forEach((c, i) => (porGrupo[c.g] ||= []).push(i));
    for (const g in porGrupo) porGrupo[g].sort((a, b) => cands[b].v - cands[a].v || a - b);
    for (const g of Object.keys(r.cadeiras)) {
      const vagasLista = r.cadeiras[g] - (distritais[g] || 0);
      const fila = (porGrupo[g] || []).filter((i) => !jaEleito.has(i));
      for (let k = 0; k < vagasLista; k++) {
        const i = fila[k];
        eleitos.push({ cand: i === undefined ? null : cands[i], idx: i ?? null, grupo: g, via: "lista", posicao: k + 1 });
        if (i !== undefined) jaEleito.add(i);
      }
    }

    const atuais = new Set(cands.map((c, i) => (c.eleito ? i : -1)).filter((i) => i >= 0));
    const entram = eleitos.filter((e) => e.idx !== null && !atuais.has(e.idx));
    const saem = [...atuais].filter((i) => !jaEleito.has(i)).map((i) => cands[i]);
    const ficam = eleitos.filter((e) => e.idx !== null && atuais.has(e.idx));

    const partidos = dados.grupos.map((g) => ({
      grupo: g,
      votos: g.votos,
      atual: g.vagasAtual,
      distritais: distritais[g.id] || 0,
      lista: (r.cadeiras[g.id] || 0) - (distritais[g.id] || 0),
      total: r.cadeiras[g.id] || 0,
      proporcional: r.porLista[g.id] || 0,
    })).sort((a, b) => b.total - a.total || b.atual - a.atual || b.votos - a.votos);

    return { modelo, regra, pct, nMaj: porDistrito ? dados.distritos.length : nMaj, distritos: venc, partidos, eleitos, entram, saem, ficam, tomadas: r.tomadas, lista: r.lista };
  }

  /** Quantas vagas a parte majoritária elege (igual ao nº de distritos gerado no build). */
  function nMajoritarias(vagas, pct) {
    return Math.max(1, Math.floor((vagas * pct) / 100));
  }

  /** Índice de desproporcionalidade de Gallagher (0 = cadeiras exatamente proporcionais aos votos). */
  function gallagher(partidos, chaveCadeiras) {
    const votos = partidos.reduce((s, p) => s + p.votos, 0);
    const cad = partidos.reduce((s, p) => s + p[chaveCadeiras], 0);
    if (!votos || !cad) return 0;
    const soma = partidos.reduce((s, p) => s + Math.pow((100 * p.votos) / votos - (100 * p[chaveCadeiras]) / cad, 2), 0);
    return Math.sqrt(soma / 2);
  }

  const api = { nMajoritarias, listaDHondt, compensatorio, paralelo, vencedoresDistritos, simular, gallagher };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.Distrital = api;
})(typeof window !== "undefined" ? window : globalThis);
