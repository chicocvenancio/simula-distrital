#!/usr/bin/env python3
"""Gera data/<ano>/<UF>.json para a simulação do distrital misto (deputado federal).

Uso:
    python3 scripts/build_data.py 2022 2026 [federal|estadual]   # deputados
    python3 scripts/build_data.py 2020 2024                        # vereadores (anos de eleição municipal)

Baixa (e guarda em cache em scripts/.cache/) do Portal de Dados Abertos do TSE:
  - votacao_candidato_munzona_<ano>.zip -> votos de cada candidato por município e zona
  - votacao_partido_munzona_<ano>.zip   -> votos de legenda por município e zona
  - detalhe_votacao_munzona_<ano>.zip   -> eleitores aptos e votos válidos por município e zona
  - eleitorado_local_votacao_<ano>.zip  -> coordenadas dos locais de votação
  - consulta_cand_<ano>.zip             -> gênero declarado (concordância no texto)

Os distritos são uma simulação, não uma proposta: o PL manda a Justiça Eleitoral desenhá-los.
Aqui eles saem de uma bisseção recursiva sobre o mapa: cada "unidade" é um par
(município, zona eleitoral), posicionada na média das coordenadas dos seus locais de votação.
O estado é cortado ao meio (pela direção mais comprida) de modo que cada lado tenha eleitores
proporcionais ao número de distritos que vai conter, e assim por diante. Quando a linha de
corte passa por uma unidade, ela é repartida entre os dois lados (supondo que os votos se
distribuem por igual dentro dela); assim todos os distritos têm o mesmo número de eleitores.
"""
import csv
import gzip
import multiprocessing
import io
import json
import math
import sys
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

BASE = "https://cdn.tse.jus.br/estatistica/sead/odsele"
ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(__file__).resolve().parent / ".cache"
# Código do cargo no TSE: 6 = deputado federal, 7 = deputado estadual, 8 = deputado distrital (DF), 13 = vereador
CARGOS = {"federal": {"6"}, "estadual": {"7", "8"}, "vereador": {"13"}}
UFS = ("AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO").split()
NULOS = {"#NULO#", "#NE#", "#NULO", "-1", "-3", ""}
PASTAS = {"eleitorado_local_votacao": "eleitorado_locais_votacao"}

csv.field_size_limit(1 << 30)


def baixar(nome: str, ano: int, uf: str = "") -> Path:
    CACHE.mkdir(exist_ok=True)
    arquivo = f"{nome}_{ano}" + (f"_{uf}" if uf else "") + ".zip"
    destino = CACHE / arquivo
    if not destino.exists():
        url = f"{BASE}/{PASTAS.get(nome, nome)}/{arquivo}"
        print(f"baixando {url}", file=sys.stderr)
        tmp = destino.with_suffix(".part")
        with urllib.request.urlopen(url) as r, open(tmp, "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
        tmp.rename(destino)
    return destino


def linhas(zip_path: Path, uf: str | None):
    """CSV da UF dentro do zip; uf=None lê o único CSV (arquivo nacional) e filtra depois."""
    with zipfile.ZipFile(zip_path) as z:
        csvs = [n for n in z.namelist() if n.upper().endswith(".CSV")]
        if uf:
            nomes = [n for n in csvs if n.upper().endswith(f"_{uf}.CSV")]
        else:  # arquivo nacional: único CSV ou o _BRASIL
            nomes = [n for n in csvs if n.upper().endswith("_BRASIL.CSV")] or csvs[:1]
        if not nomes:
            return
        with z.open(nomes[0]) as raw:
            texto = io.TextIOWrapper(raw, encoding="latin-1", newline="")
            yield from csv.DictReader(texto, delimiter=";")


def col(row, *nomes, default="0"):
    for n in nomes:
        if n in row and row[n] not in (None, ""):
            return row[n]
    return default


def num(v) -> int:
    try:
        return max(int(v), 0)
    except (TypeError, ValueError):
        return 0


def limpo(v: str) -> str:
    v = (v or "").strip()
    return "" if v.upper() in NULOS else v


def chave_grupo(row) -> tuple[str, str, str]:
    """Federação conta como um único 'partido' (como nas eleições de 2022 e 2026)."""
    nr_fed = limpo(col(row, "NR_FEDERACAO", default=""))
    if nr_fed:
        sigla = limpo(col(row, "SG_FEDERACAO", default="")) or f"Federação {nr_fed}"
        nome = limpo(col(row, "NM_FEDERACAO", default="")) or sigla
        return f"F{nr_fed}", sigla, nome
    sigla = row["SG_PARTIDO"].strip()
    return f"P{sigla}", sigla, limpo(col(row, "NM_PARTIDO", default="")) or sigla


MINUSCULAS = {"da", "de", "do", "das", "dos", "e"}
ROMANOS = {"ii", "iii", "iv", "vi", "vii", "viii", "ix", "xi", "xii", "xiii", "xiv", "xv"}


def titulo(nome: str) -> str:
    partes = nome.strip().lower().split()
    return " ".join(p.upper() if p in ROMANOS else p if (i and p in MINUSCULAS) else p[:1].upper() + p[1:]
                    for i, p in enumerate(partes))


def sem_acento(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


def do_cargo(row, cargos: set) -> bool:
    return col(row, "CD_CARGO", default="") in cargos and col(row, "NR_TURNO", default="1") == "1"


def unidade(row) -> tuple[int, int]:
    return int(row["CD_MUNICIPIO"]), int(row["NR_ZONA"])


def coordenadas(zip_local: Path) -> dict:
    """{uf: {(município, zona): (lat, lon, municipio_nome)}} média ponderada pelos eleitores."""
    soma = defaultdict(lambda: [0.0, 0.0, 0])
    soma_mun = defaultdict(lambda: [0.0, 0.0, 0])
    for row in linhas(zip_local, None):
        if col(row, "NR_TURNO", default="1") != "1":
            continue
        try:
            lat = float(row["NR_LATITUDE"].replace(",", "."))
            lon = float(row["NR_LONGITUDE"].replace(",", "."))
        except ValueError:
            continue
        if lat == -1 or lon == -1 or not (-35 < lat < 6 and -75 < lon < -28):
            continue
        n = num(row.get("QT_ELEITOR_SECAO")) or 1
        uf = row["SG_UF"]
        for s, k in ((soma, (uf, int(row["CD_MUNICIPIO"]), int(row["NR_ZONA"]))), (soma_mun, (uf, int(row["CD_MUNICIPIO"])))):
            s[k][0] += lat * n
            s[k][1] += lon * n
            s[k][2] += n
    out = defaultdict(dict)
    for (uf, mun, zona), (a, b, n) in soma.items():
        out[uf][(mun, zona)] = (a / n, b / n)
    por_mun = defaultdict(dict)
    for (uf, mun), (a, b, n) in soma_mun.items():
        por_mun[uf][mun] = (a / n, b / n)
    return out, por_mun


# ---------------------------------------------------------------- distritos

def bissecao(pedacos: list, k: int, pos: dict) -> list:
    """pedacos: [(unidade, peso)]. Devolve k listas de pedaços com pesos iguais."""
    if k == 1:
        return [pedacos]
    k1 = k // 2
    total = sum(p for _, p in pedacos)
    alvo = total * k1 / k
    lat0 = sum(pos[u][0] * p for u, p in pedacos) / total
    escala = math.cos(math.radians(lat0))

    def xy(u):
        return pos[u][1] * escala, pos[u][0]

    xs = [xy(u)[0] for u, _ in pedacos]
    ys = [xy(u)[1] for u, _ in pedacos]
    # corta perpendicular à direção mais comprida (x = leste-oeste, y = norte-sul)
    eixo = 0 if (max(xs) - min(xs)) >= (max(ys) - min(ys)) else 1
    ordem = sorted(pedacos, key=lambda up: (xy(up[0])[eixo], xy(up[0])[1 - eixo], up[0]))
    a, b, acum = [], [], 0.0
    for u, p in ordem:
        if acum >= alvo - 1e-9:
            b.append((u, p))
        elif acum + p <= alvo + 1e-9:
            a.append((u, p))
            acum += p
        else:  # a linha de corte passa dentro desta unidade: reparte
            parte = alvo - acum
            a.append((u, parte))
            b.append((u, p - parte))
            acum = alvo
    return bissecao(a, k1, pos) + bissecao(b, k - k1, pos)


# Fração das vagas eleitas em distritos para a qual se desenham distritos. 50% é o PL 9.212/2017
# (arquivo principal); 100% é o distrital puro; os outros servem ao controle de proporção.
PCTS = (30, 40, 50, 60, 70, 100)


def n_distritos(vagas: int, pct: int) -> int:
    return max(1, vagas * pct // 100)


def desenhar(pedacos, n, pos, unidades, idx_un, cands):
    """Desenha n distritos e escolhe o candidato de cada partido em cada um."""
    distritos = []
    for i, parte in enumerate(bissecao(pedacos, n, pos)):
        votos_g, votos_c = defaultdict(float), defaultdict(float)
        validos = aptos = 0.0
        membros = []
        for k, peso in parte:
            u = unidades[k]
            f = peso / u["aptos"]
            aptos += peso
            validos += u["validos"] * f
            for g, v in u["grupo"].items():
                votos_g[g] += v * f
            for sq, v in u["cand"].items():
                votos_c[sq] += v * f
            membros.append([idx_un[k], round(f, 4)])
        distritos.append({"id": i + 1, "aptos": round(aptos), "validos": round(validos),
                          "votos": {g: round(v) for g, v in votos_g.items() if round(v) > 0},
                          "_cv": votos_c, "unidades": membros})

    # cada partido lança 1 candidato por distrito; um candidato só concorre em 1 distrito.
    # Escolha gulosa: os pares (candidato, distrito) com mais votos primeiro.
    pares = [(v, sq, d["id"]) for d in distritos for sq, v in d["_cv"].items()]
    pares.sort(key=lambda t: (-t[0], t[1], t[2]))
    usado, ocupado, escolhidos = set(), set(), {}
    for v, sq, did in pares:
        g = cands[sq]["g"]
        if sq in usado or (g, did) in ocupado:
            continue
        usado.add(sq)
        ocupado.add((g, did))
        escolhidos[(g, did)] = (sq, v)
    return distritos, escolhidos, usado


# ---------------------------------------------------------------- estado

def coletar_munzona(uf: str, zips: dict, cargos: set):
    """Deputados: unidades = pares (município, zona). Devolve (unidades, cands, grupos) ou None."""
    feminino = {row["SQ_CANDIDATO"]: row.get("DS_GENERO", "").strip().upper() == "FEMININO"
                for row in linhas(zips["cand_info"], uf) if col(row, "CD_CARGO", default="") in cargos}

    grupos: dict[str, dict] = {}

    def grupo(row):
        gid, sigla, nome = chave_grupo(row)
        g = grupos.setdefault(gid, {"id": gid, "sigla": sigla, "nome": nome, "partidos": set(), "votos": 0})
        g["partidos"].add(row["SG_PARTIDO"].strip())
        return gid

    unidades: dict[tuple, dict] = {}

    def un(row):
        k = unidade(row)
        if k not in unidades:
            unidades[k] = {"mun": k[0], "zona": k[1], "nome": titulo(row["NM_MUNICIPIO"]),
                           "aptos": 0, "validos": 0, "cand": defaultdict(int), "grupo": defaultdict(int)}
        return unidades[k]

    for row in linhas(zips["detalhe"], uf):
        if not do_cargo(row, cargos):
            continue
        u = un(row)
        u["aptos"] += num(row["QT_APTOS"])
        u["validos"] += num(row["QT_TOTAL_VOTOS_VALIDOS"])

    cands: dict[str, dict] = {}
    for row in linhas(zips["cand"], uf):
        if not do_cargo(row, cargos):
            continue
        sq = row["SQ_CANDIDATO"]
        votos = num(col(row, "QT_VOTOS_NOMINAIS_VALIDOS", "QT_VOTOS_NOMINAIS"))
        c = cands.get(sq)
        if c is None:
            situacao = row["DS_SIT_TOT_TURNO"].strip().upper()
            c = cands[sq] = {"n": row["NR_CANDIDATO"].strip(), "nome": titulo(row["NM_URNA_CANDIDATO"]),
                             "partido": row["SG_PARTIDO"].strip(), "g": grupo(row), "v": 0,
                             "eleito": situacao.startswith("ELEITO")}
            if feminino.get(sq):
                c["f"] = 1
        c["v"] += votos
        if votos:
            u = un(row)
            u["cand"][sq] += votos
            u["grupo"][c["g"]] += votos
    if not cands:
        return None

    for row in linhas(zips["partido"], uf):
        if not do_cargo(row, cargos):
            continue
        leg = num(col(row, "QT_TOTAL_VOTOS_LEG_VALIDOS", "QT_VOTOS_LEGENDA_VALIDOS"))
        if leg:
            un(row)["grupo"][grupo(row)] += leg

    return unidades, cands, grupos


def montar(ano, uf, unidades, cands, grupos, pos_de, cargo):
    """Parte comum: desenha os distritos de cada tamanho e monta o JSON.
    pos_de(chave da unidade) -> (lat, lon) ou None."""
    for u in unidades.values():
        for g, v in u["grupo"].items():
            grupos[g]["votos"] += v

    vagas = sum(1 for c in cands.values() if c["eleito"])
    if not vagas:
        return None

    # posição de cada unidade
    pos = {}
    sem_coord = []
    for k, u in unidades.items():
        p = pos_de(k)
        if p:
            pos[k] = p
        else:
            sem_coord.append(k)
    if sem_coord and cargo != "vereador":
        print(f"  {uf}: {len(sem_coord)} unidades sem coordenadas (ficam no centro do estado)", file=sys.stderr)
    if sem_coord:
        if not pos:  # nenhuma coordenada: todas no mesmo ponto
            pos = {k: (0.0, 0.0) for k in unidades}
        tot = sum(unidades[k]["aptos"] for k in pos) or 1
        centro = (sum(pos[k][0] * unidades[k]["aptos"] for k in pos) / tot,
                  sum(pos[k][1] * unidades[k]["aptos"] for k in pos) / tot)
        for k in sem_coord:
            pos[k] = centro

    # índice das unidades (ordenado) para o JSON
    chaves = sorted(unidades, key=lambda k: (unidades[k]["nome"], k[1]))
    idx_un = {k: i for i, k in enumerate(chaves)}
    pedacos = [(k, float(u["aptos"])) for k, u in unidades.items() if u["aptos"] > 0]

    conjuntos = {}  # pct -> (distritos, escolhidos)
    usado_total = set()
    for pct in PCTS:
        distritos, escolhidos, usado = desenhar(pedacos, n_distritos(vagas, pct), pos, unidades, idx_un, cands)
        conjuntos[pct] = (distritos, escolhidos)
        usado_total |= usado

    # candidatos que entram no JSON: eleitos de fato, candidatos de distrito e o topo de cada lista
    por_grupo = defaultdict(list)
    for sq, c in cands.items():
        por_grupo[c["g"]].append(sq)
    manter = set(sq for sq, c in cands.items() if c["eleito"]) | usado_total
    for g, lst in por_grupo.items():
        lst.sort(key=lambda sq: -cands[sq]["v"])
        manter.update(lst[: vagas + 2])
    lista_sq = sorted(manter, key=lambda sq: -cands[sq]["v"])
    idx_c = {sq: i for i, sq in enumerate(lista_sq)}

    for distritos, escolhidos in conjuntos.values():
        for d in distritos:
            d["cand"], d["cv"] = {}, {}
            for g in d["votos"]:
                if (g, d["id"]) in escolhidos:
                    sq, v = escolhidos[(g, d["id"])]
                    d["cand"][g] = idx_c[sq]
                    d["cv"][g] = round(v)
            del d["_cv"]

    lista_grupos = []
    for g in grupos.values():
        lista_grupos.append({"id": g["id"], "sigla": g["sigla"], "nome": g["nome"], "partidos": sorted(g["partidos"]),
                             "votos": g["votos"],
                             "vagasAtual": sum(1 for c in cands.values() if c["g"] == g["id"] and c["eleito"])})
    lista_grupos.sort(key=lambda g: -g["votos"])

    lista_c = []
    for sq in lista_sq:
        c = dict(cands[sq])
        c["eleito"] = 1 if c["eleito"] else 0
        lista_c.append(c)

    lista_un = []
    for k in chaves:
        u = unidades[k]
        lat, lon = pos[k]
        lista_un.append([u["nome"], u["mun"], u["zona"], u["aptos"], round(lat, 4), round(lon, 4)])

    return {
        "ano": ano, "uf": uf, "vagas": vagas,
        "cargo": "distrital" if cargo == "estadual" and uf == "DF" else cargo,
        "validos": sum(g["votos"] for g in lista_grupos),
        "aptos": sum(u["aptos"] for u in unidades.values()),
        "grupos": lista_grupos,
        "candidatos": lista_c,
        "distritos": conjuntos[50][0],
        # outros tamanhos (% das vagas eleitas em distritos) vão em arquivos separados
        "_outros": {pct: conjuntos[pct][0] for pct in PCTS if pct != 50},
        # deputados: [nome do município, código TSE, zona, eleitores aptos, lat, lon]
        # vereador:  [bairro do local de votação, nº do local, zona, eleitores aptos, lat, lon]
        "unidades": lista_un,
    }


# ---------------------------------------------------------------- vereadores

def locais_votacao(zip_local: Path) -> dict:
    """{(uf, município, zona, local): [lat, lon, eleitores, bairro]} a partir do cadastro de locais de votação."""
    out = {}
    for row in linhas(zip_local, None):
        if col(row, "NR_TURNO", default="1") != "1":
            continue
        k = (row["SG_UF"], int(row["CD_MUNICIPIO"]), int(row["NR_ZONA"]), int(row["NR_LOCAL_VOTACAO"]))
        v = out.get(k)
        if v is None:
            try:
                lat = float(row["NR_LATITUDE"].replace(",", "."))
                lon = float(row["NR_LONGITUDE"].replace(",", "."))
                if lat == -1 or lon == -1 or not (-35 < lat < 6 and -75 < lon < -28):
                    lat = lon = None
            except ValueError:
                lat = lon = None
            bairro = limpo(row.get("NM_BAIRRO", "")) or limpo(row.get("NM_LOCAL_VOTACAO", ""))
            v = out[k] = [lat, lon, 0, titulo(bairro) if bairro else f"Local {k[3]}"]
        v[2] += num(row.get("QT_ELEITOR_SECAO"))
    return out


def vereadores_uf(ano: int, uf: str, zips: dict, locais: dict) -> dict:
    """{código do município: dados} para todos os municípios da UF."""
    cargos = CARGOS["vereador"]
    feminino = {row["SQ_CANDIDATO"] for row in linhas(zips["cand_info"], uf)
                if col(row, "CD_CARGO", default="") in cargos and row.get("DS_GENERO", "").strip().upper() == "FEMININO"}
    cands = defaultdict(dict)    # SG_UE -> sq -> candidato
    grupos = defaultdict(dict)   # SG_UE -> gid -> grupo
    partido_grupo = {}           # (SG_UE, nº do partido) -> gid
    nomes, cod_mun = {}, {}

    def grupo(ue, row):
        gid, sigla, nome = chave_grupo(row)
        g = grupos[ue].setdefault(gid, {"id": gid, "sigla": sigla, "nome": nome, "partidos": set(), "votos": 0})
        g["partidos"].add(row["SG_PARTIDO"].strip())
        return gid

    for row in linhas(zips["cand"], uf):
        if not do_cargo(row, cargos):
            continue
        ue, sq = row["SG_UE"], row["SQ_CANDIDATO"]
        nomes[ue] = titulo(row["NM_UE"])
        cod_mun[ue] = int(row["CD_MUNICIPIO"])
        c = cands[ue].get(sq)
        if c is None:
            situacao = row["DS_SIT_TOT_TURNO"].strip().upper()
            c = cands[ue][sq] = {"n": row["NR_CANDIDATO"].strip(), "nome": titulo(row["NM_URNA_CANDIDATO"]),
                                 "partido": row["SG_PARTIDO"].strip(), "g": grupo(ue, row), "v": 0,
                                 "eleito": situacao.startswith("ELEITO")}
            if sq in feminino:
                c["f"] = 1
        c["v"] += num(col(row, "QT_VOTOS_NOMINAIS_VALIDOS", "QT_VOTOS_NOMINAIS"))
    for row in linhas(zips["partido"], uf):
        if do_cargo(row, cargos):
            partido_grupo[(row["SG_UE"], row["NR_PARTIDO"].strip())] = grupo(row["SG_UE"], row)

    unidades = defaultdict(dict)  # SG_UE -> (zona, local) -> unidade
    for row in linhas(zips["secao_" + uf], uf):
        if not do_cargo(row, cargos):
            continue
        ue, nr, votos = row["SG_UE"], row["NR_VOTAVEL"].strip(), num(row["QT_VOTOS"])
        if not votos or ue not in cands:
            continue
        if len(nr) == 2:
            gid, sq = partido_grupo.get((ue, nr)), None
        else:
            sq = row["SQ_CANDIDATO"]
            c = cands[ue].get(sq)
            gid = c["g"] if c and c["v"] else None  # só votos válidos (candidato com votação válida)
        if gid is None:
            continue
        k = (int(row["NR_ZONA"]), int(row["NR_LOCAL_VOTACAO"]))
        u = unidades[ue].get(k)
        if u is None:
            info = locais.get((uf, cod_mun[ue], k[0], k[1]))
            u = unidades[ue][k] = {"mun": k[1], "zona": k[0], "nome": info[3] if info else f"Local {k[1]}",
                                   "aptos": info[2] if info else 0, "validos": 0,
                                   "cand": defaultdict(int), "grupo": defaultdict(int)}
        u["validos"] += votos
        u["grupo"][gid] += votos
        if sq:
            u["cand"][sq] += votos

    out = {}
    for ue in sorted(cands, key=lambda x: nomes[x]):
        us = unidades.get(ue)
        if not us:
            continue
        for u in us.values():  # local sem eleitorado no cadastro: usa os votos como peso
            u["aptos"] = u["aptos"] or u["validos"]

        def pos_de(k, ue=ue):
            info = locais.get((uf, cod_mun[ue], k[0], k[1]))
            return (info[0], info[1]) if info and info[0] is not None else None

        d = montar(ano, uf, us, cands[ue], grupos[ue], pos_de, "vereador")
        if d:
            d["cod"], d["municipio"] = ue, nomes[ue]
            out[ue] = d
    return out


_LOCAIS: dict = {}


def _vereadores_uf_arquivo(args):
    """Processa uma UF e grava data/<ano>/vereador/<UF>.json.gz (roda em processo separado)."""
    ano, uf, zips = args
    zips = dict(zips, **{"secao_" + uf: baixar("votacao_secao", ano, uf)})
    muns = vereadores_uf(ano, uf, zips, _LOCAIS)
    if not muns:
        return uf, None
    for d in muns.values():
        d["outros"] = {str(k): v for k, v in d.pop("_outros").items()}
    pasta = ROOT / "data" / str(ano) / "vereador"
    texto = json.dumps(muns, ensure_ascii=False, separators=(",", ":")).encode()
    (pasta / f"{uf}.json.gz").write_bytes(gzip.compress(texto, 9, mtime=0))
    print(f"{ano} vereador {uf}: {len(muns)} municípios, {sum(d['vagas'] for d in muns.values())} vagas, "
          f"{len(texto) >> 20} MB -> {(pasta / f'{uf}.json.gz').stat().st_size >> 10} KB", file=sys.stderr)
    return uf, [[cod, d["municipio"], d["vagas"]] for cod, d in muns.items()]


def gerar_vereadores(ano: int, zips: dict, indice: dict) -> None:
    """data/<ano>/vereador/<UF>.json.gz: {código TSE: dados do município}, com os outros tamanhos de
    distrito em "outros". Um arquivo compactado por UF (e não um por município) para caber no Artifact;
    o site descompacta com DecompressionStream."""
    global _LOCAIS
    _LOCAIS = locais_votacao(zips["local"])
    (ROOT / "data" / str(ano) / "vereador").mkdir(parents=True, exist_ok=True)
    ufs = [uf for uf in UFS if uf != "DF"]  # o DF não tem municípios
    with multiprocessing.get_context("fork").Pool(3) as pool:
        res = dict(pool.map(_vereadores_uf_arquivo, [(ano, uf, zips) for uf in ufs], chunksize=1))
    indice.setdefault("vereador", {})[str(ano)] = {uf: res[uf] for uf in ufs if res.get(uf)}


def coords_completas(zips_local: Path):
    """Coordenadas do ano; locais sem coordenadas costumam tê-las em outro ano em cache."""
    coords, coords_mun = coordenadas(zips_local)
    for outro in sorted(CACHE.glob("eleitorado_local_votacao_*.zip")):
        if outro != zips_local:
            c2, m2 = coordenadas(outro)
            for uf in c2:
                for k, v in c2[uf].items():
                    coords[uf].setdefault(k, v)
                for k, v in m2[uf].items():
                    coords_mun[uf].setdefault(k, v)
    return coords, coords_mun


def salvar(pasta: Path, uf: str, d: dict) -> None:
    """data/.../<UF>.json e data/.../d/<UF>.json ({"30": [distritos], ..., "100": [...]})"""
    (pasta / "d").mkdir(parents=True, exist_ok=True)
    (pasta / "d" / f"{uf}.json").write_text(json.dumps({str(k): v for k, v in d.pop("_outros").items()},
                                                       ensure_ascii=False, separators=(",", ":")))
    (pasta / f"{uf}.json").write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")))


def main(anos, cargos):
    indice_path = ROOT / "data" / "index.json"
    indice = json.loads(indice_path.read_text()) if indice_path.exists() else {"anos": {}}
    indice["pcts"] = list(PCTS)
    for ano in anos:
        municipal = ano % 4 == 0
        zips = {
            "cand": baixar("votacao_candidato_munzona", ano),
            "partido": baixar("votacao_partido_munzona", ano),
            "detalhe": baixar("detalhe_votacao_munzona", ano),
            "local": baixar("eleitorado_local_votacao", ano),
            "cand_info": baixar("consulta_cand", ano),
        }
        if municipal:
            gerar_vereadores(ano, zips, indice)
            indice_path.write_text(json.dumps(indice, ensure_ascii=False, indent=1))
            continue
        coords, coords_mun = coords_completas(zips["local"])
        for cargo in cargos:
            # federal: data/<ano>/<UF>.json (caminho original); estadual: data/<ano>/estadual/<UF>.json
            pasta = ROOT / "data" / str(ano) / ("" if cargo == "federal" else cargo)
            pasta.mkdir(parents=True, exist_ok=True)
            feitos = []
            for uf in UFS:
                r = coletar_munzona(uf, zips, CARGOS[cargo])
                c_uf, m_uf = coords.get(uf, {}), coords_mun.get(uf, {})
                d = r and montar(ano, uf, *r, lambda k: c_uf.get(k) or m_uf.get(k[0]), cargo)
                if d is None:
                    print(f"{ano} {cargo} {uf}: sem dados", file=sys.stderr)
                    continue
                salvar(pasta, uf, d)
                feitos.append(uf)
                print(f"{ano} {cargo} {uf}: {d['vagas']} vagas, {len(d['distritos'])} distritos, {len(d['unidades'])} unidades",
                      file=sys.stderr)
            # "anos" é o índice dos federais
            indice.setdefault("anos" if cargo == "federal" else cargo, {})[str(ano)] = feitos
            indice_path.write_text(json.dumps(indice, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    args = sys.argv[1:]
    cargos = tuple(a for a in args if a in ("federal", "estadual")) or ("federal", "estadual")
    main([int(a) for a in args if a.isdigit()], cargos)
