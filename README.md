# E se fosse distrital misto?

Simulação que compara os deputados federais eleitos no sistema proporcional atual com quem seria eleito no
**voto distrital misto** do PL 9.212/2017 (PLS 86/2017, de José Serra, aprovado no Senado em 2017). É o projeto
que o presidente da Câmara, Hugo Motta, diz querer votar. Usa os votos reais de 2022 e 2026, do Portal de Dados Abertos do TSE.

Projeto irmão de [Para onde foi o seu voto?](https://github.com/chicocvenancio/Para-onde-foi-o-seu-voto).

## Regras simuladas (`engine.js`)

- O estado tem `⌊vagas ÷ 2⌋` distritos; em cada um vence o mais votado (maioria simples).
- Os votos partidários repartem **todas** as cadeiras do estado pelo método D'Hondt (art. 105-B).
- **Modelo compensatório** (o do PL): os distritos ganhos são descontados das cadeiras do partido. Se um partido ganha mais
  distritos do que cadeiras, fica com todos, e as cadeiras extras saem das últimas posições ainda não preenchidas da lista
  (art. 105-C, parágrafo único). O total não muda.
- **Modelo paralelo** (opção): metade das vagas nos distritos, metade pelos votos partidários, sem desconto.
- O resto das vagas é preenchido pela lista preordenada de cada partido (art. 105-D).

## Hipóteses

- Voto partidário = votos nominais + legenda do partido ou federação no estado.
- Distritos desenhados automaticamente (`scripts/build_data.py`). Cada par (município, zona eleitoral) fica na média das coordenadas
  dos seus locais de votação. Depois, bisseção recursiva pelo eixo mais comprido, com o mesmo número de **eleitores aptos** por distrito
  (o PL fala em habitantes). Uma zona cortada pela linha é repartida, e seus votos são divididos na mesma proporção.
- Cada partido lança, em cada distrito, o seu candidato mais votado ali, sem repetir candidato (escolha gulosa).
- Quem vence o distrito: o partido com mais votos ali (padrão) ou o candidato com mais votos pessoais.
- A lista preordenada segue os votos nominais no estado.

## Gerar os dados

```bash
python3 scripts/build_data.py 2022 2026
```

Baixa cerca de 1,3 GB do TSE para `scripts/.cache/` e gera `data/<ano>/<UF>.json` e `data/index.json`.

## Rodar e testar

```bash
python3 -m http.server 8000
node --test tests/*.test.js
```
