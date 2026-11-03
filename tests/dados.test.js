const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const D = require("../engine.js");

const raiz = path.join(__dirname, "..", "data");
const indice = JSON.parse(fs.readFileSync(path.join(raiz, "index.json")));
const ler = (...p) => JSON.parse(fs.readFileSync(path.join(raiz, ...p)));

/** Confere um estado ou município em todos os tamanhos de distrito e modelos. */
function conferir(rotulo, d, outros) {
  assert.equal(d.distritos.length, Math.floor(d.vagas / 2), rotulo);
  const nosDistritos = d.distritos.reduce((s, x) => s + Object.values(x.votos).reduce((a, b) => a + b, 0), 0);
  // cada distrito arredonda os votos de cada partido: tolerância de 0,1% ou meio voto por (distrito, partido)
  const folga = Math.max(0.001 * d.validos, 0.5 * d.distritos.length * d.grupos.length);
  assert.ok(Math.abs(nosDistritos - d.validos) <= folga, `${rotulo} votos`);
  assert.equal(d.candidatos.filter((c) => c.eleito).length, d.vagas, `${rotulo} eleitos`);
  const conjuntos = { 50: d.distritos, ...outros };
  for (const [pct, distritos] of Object.entries(conjuntos)) {
    assert.equal(distritos.length, D.nMajoritarias(d.vagas, +pct), `${rotulo} d${pct}`);
    const media = d.aptos / distritos.length;
    for (const x of distritos) assert.ok(Math.abs(x.aptos / media - 1) < 0.01, `${rotulo} d${pct} distrito ${x.id}`);
    const dd = { ...d, distritos };
    const modelos = +pct === 100 ? ["distrital", "distritao"] : ["paralelo", "compensatorio", "distritaoMisto"];
    for (const modelo of modelos) for (const regra of ["partido", "candidato"]) {
      const r = D.simular(dd, { modelo, regra, pct: +pct });
      assert.equal(r.eleitos.length, d.vagas, `${rotulo} ${modelo} ${regra} ${pct}`);
      // vaga sem nome só quando o partido não tem mais candidatos (lançou menos nomes que as vagas que ganharia)
      const eleitos = new Set(r.eleitos.map((e) => e.idx));
      for (const e of r.eleitos.filter((e) => !e.cand)) {
        assert.ok(d.candidatos.every((c, i) => c.g !== e.grupo || eleitos.has(i)), `${rotulo} ${modelo} ${regra} ${pct}: vaga sem candidato`);
      }
    }
  }
}

for (const [ano, ufs] of Object.entries(indice.anos)) {
  test(`deputados federais ${ano}: 513 vagas, distritos equilibrados e votos conferidos`, () => {
    let vagas = 0;
    for (const uf of ufs) {
      const d = ler(ano, `${uf}.json`);
      vagas += d.vagas;
      conferir(`${uf}`, d, ler(ano, "d", `${uf}.json`));
    }
    assert.equal(vagas, 513);
  });
}

for (const [ano, ufs] of Object.entries(indice.estadual || {})) {
  test(`deputados estaduais ${ano}: 1.059 vagas e distritos conferidos`, () => {
    let vagas = 0;
    for (const uf of ufs) {
      const d = ler(ano, "estadual", `${uf}.json`);
      vagas += d.vagas;
      assert.equal(d.cargo, uf === "DF" ? "distrital" : "estadual");
      conferir(`estadual ${uf}`, d, ler(ano, "estadual", "d", `${uf}.json`));
    }
    assert.equal(vagas, 1059);
  });
}

for (const [ano, porUF] of Object.entries(indice.vereador || {})) {
  test(`vereadores ${ano}: índice, distritos e simulação de cada município`, () => {
    for (const [uf, lista] of Object.entries(porUF)) {
      const muns = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(raiz, ano, "vereador", `${uf}.json.gz`))));
      assert.deepEqual(Object.keys(muns).sort(), lista.map((m) => m[0]).sort(), `${uf} índice`);
      for (const [cod, d] of Object.entries(muns)) conferir(`vereador ${uf} ${d.municipio}`, d, d.outros);
    }
  });
}
