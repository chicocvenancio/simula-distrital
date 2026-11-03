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
- **Modelo paralelo** (padrão do site): metade das vagas nos distritos, metade pelos votos partidários, sem desconto.
- O resto das vagas é preenchido pela lista preordenada de cada partido (art. 105-D).

## Outros modelos

- **Distritão misto** (transição de 2030 na PEC de 2026): parte das vagas para os mais votados do estado, o resto por lista fechada (D'Hondt).
- **Distritão**: todas as vagas para os mais votados do estado (rejeitado em 2015, 2017 e 2021).
- **Distrital puro**: um distrito por vaga.
- Nos modelos mistos, a parte majoritária vai de 30% a 70% (padrão: 50%). Os distritos de cada tamanho ficam em `data/<ano>/d/<UF>.json`.

Padrão do site: modelo paralelo, 50%, vence o candidato mais votado no distrito.

## Hipóteses

- Voto partidário = votos nominais + legenda do partido ou federação no estado.
- Distritos desenhados automaticamente (`scripts/build_data.py`). Cada par (município, zona eleitoral) fica na média das coordenadas
  dos seus locais de votação. Depois, bisseção recursiva pelo eixo mais comprido, com o mesmo número de **eleitores aptos** por distrito
  (o PL fala em habitantes). Uma zona cortada pela linha é repartida, e seus votos são divididos na mesma proporção.
- Cada partido lança, em cada distrito, o seu candidato mais votado ali, sem repetir candidato (escolha gulosa).
- Quem vence o distrito: o candidato com mais votos pessoais ali (padrão) ou o partido com mais votos ali.
- A lista preordenada segue os votos nominais no estado.

## Cargos

- **Deputado federal** e **deputado estadual** (distrital no DF), 2022 e 2026: distritos desenhados sobre pares (município, zona eleitoral).
- **Vereador**, 2020 e 2024: distritos desenhados dentro de cada município sobre os locais de votação, com os votos por seção
  (`votacao_secao`). Um arquivo compactado por UF (`data/<ano>/vereador/<UF>.json.gz`), lido com `DecompressionStream`.
  Se um distrito fica sem candidato atribuído (municípios com poucos candidatos), vence o partido mais votado ali e a vaga
  vai para o seu próximo candidato ainda não eleito.

## Gerar os dados

```bash
python3 scripts/build_data.py 2022 2026   # deputados federais e estaduais
python3 scripts/build_data.py 2020 2024   # vereadores
```

Baixa os arquivos do TSE para `scripts/.cache/` (cerca de 1,3 GB para os deputados e 6 GB para os vereadores, por causa da votação por seção).

## Rodar e testar

```bash
python3 -m http.server 8000
node --test tests/*.test.js
```
