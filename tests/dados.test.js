const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const D = require("../engine.js");

const raiz = path.join(__dirname, "..", "data");
const indice = JSON.parse(fs.readFileSync(path.join(raiz, "index.json")));

for (const [ano, ufs] of Object.entries(indice.anos)) {
  test(`dados de ${ano}: 513 vagas, distritos equilibrados e votos conferidos`, () => {
    let vagas = 0;
    for (const uf of ufs) {
      const d = JSON.parse(fs.readFileSync(path.join(raiz, ano, `${uf}.json`)));
      vagas += d.vagas;
      assert.equal(d.distritos.length, Math.floor(d.vagas / 2), uf);
      const nosDistritos = d.distritos.reduce((s, x) => s + Object.values(x.votos).reduce((a, b) => a + b, 0), 0);
      assert.ok(Math.abs(nosDistritos - d.validos) / d.validos < 0.001, `${uf} votos`);
      assert.equal(d.candidatos.filter((c) => c.eleito).length, d.vagas, `${uf} eleitos`);
      const conjuntos = { 50: d.distritos };
      for (const pct of indice.pcts.filter((p) => p !== 50)) {
        conjuntos[pct] = JSON.parse(fs.readFileSync(path.join(raiz, ano, "d", `${uf}.json`)))[pct];
      }
      for (const [pct, distritos] of Object.entries(conjuntos)) {
        assert.equal(distritos.length, D.nMajoritarias(d.vagas, +pct), `${uf} d${pct}`);
        const media = d.aptos / distritos.length;
        for (const x of distritos) assert.ok(Math.abs(x.aptos / media - 1) < 0.01, `${uf} d${pct} distrito ${x.id}`);
        const dd = { ...d, distritos };
        const modelos = +pct === 100 ? ["distrital", "distritao"] : ["paralelo", "compensatorio", "distritaoMisto"];
        for (const modelo of modelos) for (const regra of ["partido", "candidato"]) {
          const r = D.simular(dd, { modelo, regra, pct: +pct });
          assert.equal(r.eleitos.length, d.vagas, `${uf} ${modelo} ${regra} ${pct}`);
          // vaga sem nome só quando o partido não tem mais candidatos (lançou menos nomes que as vagas que ganharia)
          const eleitos = new Set(r.eleitos.map((e) => e.idx));
          for (const e of r.eleitos.filter((e) => !e.cand)) {
            assert.ok(d.candidatos.every((c, i) => c.g !== e.grupo || eleitos.has(i)), `${uf} ${modelo} ${regra} ${pct}: vaga sem candidato`);
          }
        }
      }
    }
    assert.equal(vagas, 513);
  });
}
