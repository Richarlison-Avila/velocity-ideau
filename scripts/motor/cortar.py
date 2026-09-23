"""Corta as gravações em vozes de motor: camadas de rotação constante, prontas para laço.

    python scripts/motor/cortar.py [voz ...] [--fontes PASTA] [--saida PASTA]

Sem voz, corta todas. As gravações vêm de arte/motor e os laços vão para
public/audio/motor, com os nomes que src/game/motorF1.ts pede.

Cada camada junta trechos de aceleração plena na mesma faixa de rotação. Em
cada trecho a rotação é rastreada de novo, numa faixa estreita, e o trecho é
reamostrado com taxa variável até o motor girar numa rotação só. O volume é
achatado, os trechos da camada são equalizados até o timbre do primeiro e
emendados onde mais se parecem, e o fim do laço cruza com o começo num
múltiplo exato do ciclo de quatro tempos — duas voltas do virabrequim —, para
o laço não estalar nem pulsar.
"""
import argparse
import sys
import wave
from pathlib import Path

import numpy as np

from fontes import PASTA_PADRAO, RAIZ, SR, achar, ler
from rastreio import rastrear, suavizar

SAIDA_PADRAO = RAIZ / 'public' / 'audio' / 'motor'
RMS_ALVO = 0.12

# Cada trecho: (gravação, início, fim, rotação mínima, rotação máxima do rastreio).
# A rotação da camada é a mediana dos trechos, arredondada de 50 em 50: é ela
# que vai em `camadas` no motorF1.ts.
VOZES = {
    'honda-v6-turbo': {
        'cilindros': 6,
        'camadas': {
            'baixa': [('mp44-honda-1988', 8.40, 9.05, 7000, 11000)],
            'media': [('mp44-honda-1988', 9.05, 9.80, 8500, 12500)],
            'alta': [('mp44-honda-1988', 6.05, 7.30, 10500, 14000)],
        },
    },
    'tag-v6-turbo': {
        'cilindros': 6,
        'camadas': {
            'media': [('mp42c-tag-1986', 5.45, 6.95, 8000, 12000)],
        },
    },
    'renault-v10': {
        'cilindros': 10,
        'camadas': {
            'media': [('fw18-renault-1996', 4.20, 5.25, 10000, 18000)],
            'alta': [('fw18-renault-1996', 5.58, 6.30, 14500, 18000)],
        },
    },
    'cosworth-v10': {
        'cilindros': 10,
        'camadas': {
            'baixa': [('rb1-cosworth-2005', 5.90, 9.30, 9000, 15000)],
            'alta': [('rb1-cosworth-2005', 17.95, 21.55, 12000, 20000)],
        },
    },
    'ferrari-v8': {
        'cilindros': 8,
        'camadas': {
            'media': [('f60-ferrari-2009', 8.50, 9.55, 11000, 16500)],
            'alta': [('f60-ferrari-2009', 4.95, 7.95, 12000, 18500)],
        },
    },
    'mercedes-v8': {
        'cilindros': 8,
        'camadas': {
            'alta': [('bgp001-mercedes-2009', 5.90, 7.25, 12000, 18500)],
            'grito': [('bgp001-mercedes-2009', 1.80, 3.10, 14500, 18500)],
            # Pé fora: a rotação caindo depois do estouro de acelerador na largada.
            'alivio': [('bgp001-mercedes-2009', 4.45, 5.20, 9500, 15500)],
        },
    },
    'renault-v8': {
        'cilindros': 8,
        'camadas': {
            'baixa': [('rb5-renault-2009', 15.00, 16.20, 9000, 16500)],
            'media': [('ears68-rb8-2012', 7.80, 10.10, 12000, 17500)],
            'alta': [('ears68-rb8-2012', 10.55, 11.90, 12000, 17500), ('rb5-renault-2009', 13.50, 14.40, 12000, 18500)],
        },
    },
    'hibrido-v6': {
        'cilindros': 6,
        'camadas': {
            'baixa': [('geoff-752264', 3.30, 3.90, 8500, 12000), ('geoff-752264', 5.75, 6.45, 8500, 12000),
                      ('geoff-751867', 1.50, 2.60, 9000, 12000)],
            'media': [('geoff-752118', 2.15, 2.65, 10500, 14000), ('geoff-745819', 0.40, 1.10, 10500, 14000),
                      ('geoff-752827', 2.15, 2.60, 10500, 14000)],
            'alta': [('geoff-745817', 1.50, 2.45, 12500, 15500), ('geoff-745819', 1.60, 3.20, 12500, 15500),
                     ('geoff-752118', 0.90, 1.65, 12500, 15500), ('geoff-745818', 1.40, 2.90, 12500, 15500)],
        },
    },
}

# O V10 da MP4-16 foi a primeira voz, cortada antes das outras e de um jeito
# mais simples: a gravação inteira rastreada de uma vez, com ordens escolhidas
# à mão, a rotação de cada camada fixada, sem achatar o volume nem igualar o
# timbre, e o laço sem limite de duração. A gravação não vem com o
# repositório (veja o README): sem ela, esta voz fica de fora.
V10 = {
    'fonte': 'v10',
    'rastreio': {'rpm_min': 5000, 'rpm_max': 19500, 'passo_rpm': 25, 'salto_max_rpm': 400, 'penalidade': 0.02,
                 'ordens': [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7.5, 10],
                 'pesos': [0.6, 1, 0.8, 0.6, 1, 0.5, 0.4, 0.4, 1, 0.4, 0.6, 0.6], 'normalizar': False},
    # Camada: (rotação, [(início, fim), ...]).
    'camadas': {
        # Aceleração plena, do meio da subida de cada marcha.
        'baixa': (10_500, [(21.95, 22.75), (28.15, 28.80), (33.00, 33.75)]),
        'media': (13_500, [(22.90, 23.70), (9.55, 10.10), (34.00, 34.65)]),
        'alta': (16_300, [(24.10, 24.62), (29.90, 30.55), (35.00, 35.62), (37.25, 38.35)]),
        # O motor segurado em rotação máxima, parado no alto do grito.
        'grito': (18_400, [(59.00, 61.70)]),
        # Pé fora: a rotação cai sem carga, com os estalos do escapamento.
        'alivio': (14_000, [(11.00, 11.72), (26.40, 26.95), (31.00, 31.45)]),
    },
}


def hermite(x, pos):
    """Interpolação cúbica de Hermite (Catmull-Rom) em posições fracionárias."""
    i = np.floor(pos).astype(np.int64)
    f = pos - i
    xm1 = x[np.clip(i - 1, 0, len(x) - 1)]
    x0 = x[np.clip(i, 0, len(x) - 1)]
    x1 = x[np.clip(i + 1, 0, len(x) - 1)]
    x2 = x[np.clip(i + 2, 0, len(x) - 1)]
    c1 = 0.5 * (x1 - xm1)
    c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
    c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
    return ((c3 * f + c2) * f + c1) * f + x0


def normalizar(x, t, rpm_suave, a, b, alvo):
    """O trecho [a, b] em segundos, reamostrado para girar sempre a `alvo` rpm."""
    indices = np.arange(int(a * SR), int(b * SR), dtype=np.float64)
    rpm = np.interp(indices / SR, t, rpm_suave)
    fase = np.cumsum(rpm / 60 / SR)  # voltas do virabrequim
    fase -= fase[0]
    total = int(fase[-1] * 60 / alvo * SR)
    pos = np.interp(np.arange(total) * alvo / 60 / SR, fase, indices)
    return hermite(x, pos), (rpm.min(), rpm.max())


def achatar(x, janela_s=0.06, forca=0.85):
    """Tira a onda de volume do trecho — o carro passando perto do microfone e se afastando.

    Divide pelo envelope suavizado, elevado a `forca`: o volume fica quase
    constante, mas o respiro do motor dentro de cada ciclo continua.
    """
    n = int(janela_s * SR)
    env = np.sqrt(np.convolve(x ** 2, np.ones(n) / n, mode='same')) + 1e-6
    env = np.convolve(env, np.ones(n) / n, mode='same')
    y = x / env ** forca
    return y / np.sqrt((y ** 2).mean()) * np.sqrt((x ** 2).mean())


def envelope_espectral(x, n=4096):
    """Espectro médio do trecho (Welch), alisado em faixas de um sexto de oitava."""
    hann = np.hanning(n)
    blocos = [np.abs(np.fft.rfft(x[i:i + n] * hann)) ** 2 for i in range(0, len(x) - n, n // 2)]
    p = np.mean(blocos, axis=0) + 1e-12
    f = np.fft.rfftfreq(n, 1 / SR)
    alisado = np.empty_like(p)
    for k, fk in enumerate(f):
        lo, hi = fk / 2 ** (1 / 12), fk * 2 ** (1 / 12)
        m = (f >= lo) & (f <= max(hi, lo + SR / n))
        alisado[k] = p[m].mean()
    return f, alisado


def igualar_timbre(ref, x, limite_db=9):
    """Filtra x para o espectro médio dele casar com o de ref: o carro longe fica tão brilhante quanto o perto."""
    f, pr = envelope_espectral(ref)
    _, px = envelope_espectral(x)
    ganho_db = np.clip(10 * np.log10(pr / px), -limite_db, limite_db)
    ganho_db -= np.median(ganho_db[(f > 150) & (f < 6000)])
    espectro = np.fft.rfft(x)
    fx = np.fft.rfftfreq(len(x), 1 / SR)
    espectro *= 10 ** (np.interp(fx, f, ganho_db) / 20)
    y = np.fft.irfft(espectro, len(x))
    return y / np.sqrt((y ** 2).mean()) * np.sqrt((x ** 2).mean())


def ciclo(alvo):
    """Um ciclo completo do quatro tempos, em amostras: duas voltas."""
    return 120 / alvo * SR


def emendar(a, b, alvo, cruz=0.045):
    """Emenda b depois de a, cruzando no ponto, dentro de um ciclo, em que os dois mais se parecem."""
    n = int(cruz * SR)
    c = int(round(ciclo(alvo)))
    fim_a = a[-n:]
    melhor, desloc = -np.inf, 0
    for d in range(0, c):
        trecho = b[d:d + n]
        if len(trecho) < n:
            break
        corr = float(np.dot(fim_a, trecho) / (np.linalg.norm(fim_a) * np.linalg.norm(trecho) + 1e-9))
        if corr > melhor:
            melhor, desloc = corr, d
    b = b[desloc:]
    w = np.linspace(0, np.pi / 2, n)
    return np.concatenate([a[:-n], fim_a * np.cos(w) + b[:n] * np.sin(w), b[n:]]), melhor


def fechar_laco(x, alvo, cruz=0.1, maximo_s=None):
    """Transforma x num laço: o fim cruza com o começo, num múltiplo do ciclo.

    Entre os comprimentos possíveis — múltiplos exatos do ciclo, do mais longo
    para trás, até perder um quarto do som —, fica o que deixa o trecho depois
    do fim mais parecido com o começo: é o que menos se nota na volta.
    """
    n = int(cruz * SR)
    c = ciclo(alvo)
    disponivel = len(x) if maximo_s is None else min(len(x), int(maximo_s * SR) + n)
    maximo = int((disponivel - n) / c)
    melhor, voltas = -np.inf, maximo
    for v in range(maximo, max(1, int(maximo * 0.75)) - 1, -1):
        comp = int(round(v * c))
        a, b = x[:n], x[comp:comp + n]
        corr = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
        if corr > melhor:
            melhor, voltas = corr, v
    comprimento = int(round(voltas * c))
    laco = x[:comprimento].copy()
    w = np.linspace(0, np.pi / 2, n)
    # O começo do laço recebe a continuação natural do fim: tocando o último
    # ponto e voltando ao primeiro, o som segue como se não houvesse emenda.
    laco[:n] = x[:n] * np.sin(w) + x[comprimento:comprimento + n] * np.cos(w)
    return laco, melhor


def tirar_estalos(x, limite=18):
    """Conserta estalos digitais: picos isolados na segunda diferença do sinal.

    O motor é feito de pulsos, e um limite baixo apagaria as explosões de
    verdade. Só o que passa de dezoito desvios é defeito da gravação ou da
    decodificação, e esse milissegundo é refeito a partir dos vizinhos.
    """
    y = x.copy()
    r = np.abs(y[2:] - 2 * y[1:-1] + y[:-2])
    sigma = np.std(r)
    meio = int(0.0005 * SR)
    for i in np.where(r > limite * sigma)[0] + 1:
        a, b = max(1, i - meio), min(len(y) - 2, i + meio)
        esquerda, direita = y[a - 1:a + 1], y[b:b + 2]
        n = b - a
        tt = np.linspace(0, 1, n + 2)[1:-1]
        p0, p1 = esquerda[-1], direita[0]
        m0, m1 = (esquerda[-1] - esquerda[0]) * n, (direita[1] - direita[0]) * n
        y[a:b] = ((2 * tt ** 3 - 3 * tt ** 2 + 1) * p0 + (tt ** 3 - 2 * tt ** 2 + tt) * m0
                  + (-2 * tt ** 3 + 3 * tt ** 2) * p1 + (tt ** 3 - tt ** 2) * m1)
    return y


def passa_altas(x, fc=35):
    rc = 1 / (2 * np.pi * fc)
    alfa = rc / (rc + 1 / SR)
    y = np.empty_like(x)
    ax = ay = 0.0
    for i, v in enumerate(x):
        ay = alfa * (ay + v - ax)
        ax = v
        y[i] = ay
    return y


def estouros(x, a, b, limite=2.6):
    """Instantes, dentro de [a, b], em que o pico passa muito do típico: troca de marcha, zebra, estalo."""
    bruto = x[int(a * SR):int(b * SR)]
    picos = np.array([np.abs(bruto[i:i + 441]).max() for i in range(0, len(bruto) - 441, 441)])
    return [round(a + int(i) * 0.01, 2) for i in np.where(picos > limite * np.median(picos))[0]]


def gravar(caminho, x):
    with wave.open(str(caminho), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())


def terminar(pedacos, alvo, arquivo, laco_max_s):
    """Emenda os pedaços já na rotação da camada, fecha o laço e grava."""
    som = pedacos[0]
    for p in pedacos[1:]:
        som, corr = emendar(som, p, alvo)
        print(f'   emenda com correlação {corr:.2f}')
    som = tirar_estalos(passa_altas(som - som.mean()))
    laco, corr_laco = fechar_laco(som, alvo, maximo_s=laco_max_s)
    laco *= RMS_ALVO / np.sqrt((laco ** 2).mean())
    pico = np.abs(laco).max()
    if pico > 0.98:
        laco *= 0.98 / pico
    gravar(arquivo, laco)
    curto = '  ATENÇÃO laço curto' if len(laco) / SR < 0.8 else ''
    print(f'   -> {arquivo.name}: {alvo:.0f} rpm, {len(laco) / SR:.2f} s, '
          f'correlação da volta {corr_laco:.2f}, pico {np.abs(laco).max():.2f}{curto}')


def cortar_voz(nome, conf, pasta, saida):
    for camada, trechos in conf['camadas'].items():
        rastreados = []
        for fonte, a, b, lo, hi in trechos:
            x = ler(exigir(fonte, pasta))
            margem = int(0.3 * SR)
            ini = max(0, int(a * SR) - margem)
            t, rpm, _ = rastrear(x[ini:int(b * SR) + margem].astype(np.float32), SR, conf['cilindros'], lo, hi)
            t = t + ini / SR
            rpm_suave = suavizar(rpm)
            rastreados.append((fonte, a, b, x, t, rpm_suave, float(np.median(rpm_suave[(t >= a) & (t <= b)]))))
        alvo = float(np.round(np.median([r[-1] for r in rastreados]) / 50) * 50)
        pedacos = []
        for fonte, a, b, x, t, rpm_suave, mediana in rastreados:
            p, faixa = normalizar(x, t, rpm_suave, a, b, alvo)
            suspeitos = estouros(x, a, b)
            esticado = max(abs(faixa[0] / alvo - 1), abs(faixa[1] / alvo - 1))
            aviso = f'  ATENÇÃO estouros {suspeitos[:6]}' if suspeitos else ''
            aviso += '  ATENÇÃO esticado demais' if esticado > 0.22 else ''
            print(f'{nome}/{camada}: {fonte} {a}-{b} s, {faixa[0]:.0f}-{faixa[1]:.0f} rpm '
                  f'(mediana {mediana:.0f}) -> {len(p) / SR:.2f} s a {alvo:.0f}{aviso}')
            pedacos.append(achatar(p))
        # Cada trecho com o timbre do primeiro: sem isso, uma camada feita de
        # gravações a distâncias diferentes alterna claro e escuro a cada volta.
        pedacos = [pedacos[0]] + [igualar_timbre(pedacos[0], p) for p in pedacos[1:]]
        terminar(pedacos, alvo, saida / f'{nome}-{camada}.wav', laco_max_s=2.4)


def cortar_v10(pasta, saida):
    x = ler(exigir(V10['fonte'], pasta))
    print('mercedes-v10: rastreando a gravação inteira…')
    t, rpm, _ = rastrear(x.astype(np.float32), SR, 10, **V10['rastreio'])
    rpm_suave = suavizar(rpm)
    for camada, (alvo, trechos) in V10['camadas'].items():
        pedacos = []
        for a, b in trechos:
            p, faixa = normalizar(x, t, rpm_suave, a, b, alvo)
            suspeitos = estouros(x, a, b)
            aviso = f'  ATENÇÃO estouros {suspeitos[:6]}' if suspeitos else ''
            print(f'mercedes-v10/{camada}: {a:.2f}-{b:.2f} s, {faixa[0]:.0f}-{faixa[1]:.0f} rpm '
                  f'-> {len(p) / SR:.2f} s a {alvo}{aviso}')
            pedacos.append(p)
        terminar(pedacos, alvo, saida / f'v10-{camada}.wav', laco_max_s=None)


def exigir(fonte, pasta):
    caminho = achar(fonte, pasta)
    if caminho is None:
        raise SystemExit(f'Gravação "{fonte}" não encontrada em {pasta}.')
    return caminho


def main():
    todas = list(VOZES) + ['mercedes-v10']
    parser = argparse.ArgumentParser(description='Corta as gravações em laços de motor.')
    parser.add_argument('vozes', nargs='*', metavar='voz', help=f'uma de: {", ".join(todas)} (sem nenhuma, todas)')
    parser.add_argument('--fontes', type=Path, default=PASTA_PADRAO, help='pasta das gravações (padrão: arte/motor)')
    parser.add_argument('--saida', type=Path, default=SAIDA_PADRAO, help='pasta dos laços (padrão: public/audio/motor)')
    args = parser.parse_args()
    desconhecidas = [voz for voz in args.vozes if voz not in todas]
    if desconhecidas:
        parser.error(f'voz desconhecida: {", ".join(desconhecidas)}. Escolha entre {", ".join(todas)}.')
    args.saida.mkdir(parents=True, exist_ok=True)
    pedidas = args.vozes or todas
    for voz in pedidas:
        if voz == 'mercedes-v10':
            if achar(V10['fonte'], args.fontes) is None and not args.vozes:
                print('mercedes-v10: sem a gravação (não vem com o repositório), os laços v10-*.wav ficam como estão.')
                continue
            cortar_v10(args.fontes, args.saida)
        else:
            cortar_voz(voz, VOZES[voz], args.fontes, args.saida)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    main()
