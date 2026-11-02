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
      const media = d.aptos / d.distritos.length;
      for (const x of d.distritos) assert.ok(Math.abs(x.aptos / media - 1) < 0.01, `${uf} distrito ${x.id}`);
      const nosDistritos = d.distritos.reduce((s, x) => s + Object.values(x.votos).reduce((a, b) => a + b, 0), 0);
      assert.ok(Math.abs(nosDistritos - d.validos) / d.validos < 0.001, `${uf} votos`);
      assert.equal(d.candidatos.filter((c) => c.eleito).length, d.vagas, `${uf} eleitos`);
      for (const modelo of ["compensatorio", "paralelo"]) for (const regra of ["partido", "candidato"]) {
        const r = D.simular(d, { modelo, regra });
        assert.equal(r.eleitos.length, d.vagas, `${uf} ${modelo} ${regra}`);
        assert.ok(r.eleitos.every((e) => e.cand), `${uf} ${modelo} ${regra}: vaga sem candidato`);
      }
    }
    assert.equal(vagas, 513);
  });
}
