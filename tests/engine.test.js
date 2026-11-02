const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../engine.js");

test("D'Hondt ordena os partidos pelas maiores médias", () => {
  // A=100, B=60, C=30: médias A100 B60 A50 A33.3 B30 C30 ...
  const lista = D.listaDHondt({ A: 100, B: 60, C: 30 }, 5);
  assert.deepEqual(lista, ["A", "B", "A", "A", "B"]);
});

test("compensatório: distritos descontam as posições do partido", () => {
  const r = D.compensatorio({ A: 100, B: 60, C: 30 }, 6, { A: 2, B: 1 });
  // lista A B A A B (A ou C na 6ª: A=25, C=30 -> C)
  assert.deepEqual(r.lista, ["A", "B", "A", "A", "B", "C"]);
  assert.deepEqual(r.cadeiras, { A: 3, B: 2, C: 1 });
  assert.equal(r.tomadas.length, 0);
});

test("compensatório: excesso de distritos toma posições de trás para a frente", () => {
  // B ganha 3 distritos mas só tem 2 posições: toma a última ainda não preenchida (C, 6ª)
  const r = D.compensatorio({ A: 100, B: 60, C: 30 }, 6, { B: 3 });
  assert.deepEqual(r.cadeiras, { A: 3, B: 3 });
  assert.deepEqual(r.tomadas, [{ posicao: 6, de: "C", para: "B" }]);
});

test("compensatório: não toma posição já preenchida por distrito", () => {
  // C ganhou o distrito da 6ª posição; B (excesso) toma a 5ª? Não: a 5ª é de B mesmo e já
  // está preenchida. Toma a 4ª (A, não preenchida porque A não ganhou distritos).
  const r = D.compensatorio({ A: 100, B: 60, C: 30 }, 6, { B: 3, C: 1 });
  assert.deepEqual(r.cadeiras, { A: 2, B: 3, C: 1 });
  assert.deepEqual(r.tomadas, [{ posicao: 4, de: "A", para: "B" }]);
});

test("paralelo: distritos somam à metade proporcional", () => {
  const r = D.paralelo({ A: 100, B: 60, C: 30 }, 6, 3, { B: 3 });
  assert.deepEqual(r.cadeiras, { A: 2, B: 4 });
});

function estado() {
  const candidatos = [
    { n: "1001", nome: "Ana", g: "A", v: 50, eleito: true },
    { n: "1002", nome: "Beto", g: "A", v: 30, eleito: true },
    { n: "1003", nome: "Caio", g: "A", v: 20, eleito: false },
    { n: "2001", nome: "Dora", g: "B", v: 40, eleito: true },
    { n: "2002", nome: "Edu", g: "B", v: 20, eleito: false },
    { n: "3001", nome: "Fia", g: "C", v: 30, eleito: false },
  ];
  return {
    vagas: 4,
    grupos: [
      { id: "A", sigla: "A", votos: 100, vagasAtual: 2 },
      { id: "B", sigla: "B", votos: 60, vagasAtual: 1 },
      { id: "C", sigla: "C", votos: 30, vagasAtual: 0 },
    ],
    candidatos,
    distritos: [
      { id: 1, validos: 95, votos: { A: 40, B: 25, C: 30 }, cand: { A: 1, B: 3, C: 5 }, cv: { A: 20, B: 25, C: 30 } },
      { id: 2, validos: 95, votos: { A: 60, B: 35, C: 0 }, cand: { A: 0, B: 4 }, cv: { A: 50, B: 20 } },
    ],
  };
}

test("simulação completa (regra do partido)", () => {
  const r = D.simular(estado(), { modelo: "compensatorio", regra: "partido" });
  // lista D'Hondt de 4: A B A A ; distritos: A, A
  assert.deepEqual(r.distritos.map((d) => d.grupo), ["A", "A"]);
  const tot = Object.fromEntries(r.partidos.map((p) => [p.grupo.id, p.total]));
  assert.deepEqual(tot, { A: 3, B: 1, C: 0 });
  const nomes = r.eleitos.map((e) => e.cand.nome).sort();
  // A: Beto (distrito 1), Ana (distrito 2), Caio (lista); B: Dora (lista)
  assert.deepEqual(nomes, ["Ana", "Beto", "Caio", "Dora"]);
  assert.deepEqual(r.entram.map((e) => e.cand.nome), ["Caio"]);
  assert.deepEqual(r.saem.map((c) => c.nome), []);
});

test("regra do candidato muda o vencedor do distrito", () => {
  const r = D.simular(estado(), { modelo: "compensatorio", regra: "candidato" });
  // distrito 1: Fia (C) 30 > Dora 25 > Beto 20
  assert.equal(r.distritos[0].grupo, "C");
  const tot = Object.fromEntries(r.partidos.map((p) => [p.grupo.id, p.total]));
  // C ganha 1 distrito mas não tem posição na lista: toma a última não preenchida (A, 4ª)
  assert.deepEqual(tot, { A: 2, B: 1, C: 1 });
  assert.equal(r.tomadas.length, 1);
  // A fica com 2: Ana (distrito 2) e Beto, o próximo da lista
  assert.deepEqual(r.entram.map((e) => e.cand.nome), ["Fia"]);
});

test("Gallagher é zero quando cadeiras são proporcionais", () => {
  const p = [{ votos: 50, total: 5 }, { votos: 50, total: 5 }];
  assert.equal(D.gallagher(p, "total"), 0);
});
