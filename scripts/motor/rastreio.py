"""Rastreio da rotação de um motor numa gravação.

Soma harmônica das ordens do motor, com continuidade por programação dinâmica.
Num quatro tempos, a explosão é a ordem cilindros/2 — 3 no V6, 4 no V8, 5 no
V10 — e as ordens de meia volta aparecem em todos. Em cada quadro de 10 ms,
cada rotação candidata soma o contraste do espectro nas suas ordens; a rotação
é o caminho de maior soma, com um custo a cada salto entre quadros. Uma faixa
estreita em volta da rotação esperada impede o rastreio de pular de oitava.
"""
import numpy as np


def ordens_do_motor(cilindros):
    """Meias ordens até duas vezes a explosão, e o peso de cada uma.

    A explosão e seus múltiplos pesam mais; as outras ordens inteiras, um pouco
    menos; as de meia volta, menos ainda.
    """
    explosao = cilindros / 2
    ordens = np.arange(0.5, explosao * 2 + 0.01, 0.5)
    pesos = np.array([1.0 if abs((o / explosao) - round(o / explosao)) < 1e-9 else (0.7 if o == int(o) else 0.45)
                      for o in ordens])
    return ordens, pesos


def espectro_branqueado(x, salto=441, janela=4096):
    """Log do espectro de cada quadro, dividido pela média local: as linhas contam pelo contraste, não pelo volume."""
    hann = np.hanning(janela).astype(np.float32)
    q = 1 + (len(x) - janela) // salto
    log_esp = np.empty((q, janela // 2 + 1), dtype=np.float32)
    for i in range(q):
        mag = np.abs(np.fft.rfft(x[i * salto:i * salto + janela] * hann))
        suave = np.convolve(mag, np.ones(31) / 31, mode='same') + 1e-6
        log_esp[i] = np.log(mag / suave + 1e-3)
    return log_esp


def rastrear(x, sr, cilindros, rpm_min, rpm_max, salto=441, janela=4096, passo_rpm=10, salto_max_rpm=250,
             penalidade=0.01, ordens=None, pesos=None, normalizar=True, log_esp=None):
    """Devolve (t, rpm, confiança), quadro a quadro, para o sinal x em float32.

    `t` é contado em segundos desde o início de x. De um quadro para o outro a
    rotação muda no máximo `salto_max_rpm`, e cada `passo_rpm` de mudança custa
    `penalidade`. `ordens` e `pesos` trocam as ordens padrão da arquitetura.
    """
    if ordens is None:
        ordens, pesos = ordens_do_motor(cilindros)
    ordens, pesos = np.asarray(ordens, dtype=np.float64), np.asarray(pesos, dtype=np.float64)
    if log_esp is None:
        log_esp = espectro_branqueado(x, salto, janela)
    q, n_freqs = log_esp.shape
    bin_hz = sr / janela
    rpms = np.arange(rpm_min, rpm_max + 1, passo_rpm)
    idx = np.outer(rpms / 60, ordens) / bin_hz
    i0 = np.floor(idx).astype(int)
    fr = idx - i0
    ok = (i0 + 1) < n_freqs
    pontos = np.empty((q, len(rpms)), dtype=np.float32)
    for k in range(q):
        e = log_esp[k]
        v = e[np.clip(i0, 0, n_freqs - 1)] * (1 - fr) + e[np.clip(i0 + 1, 0, n_freqs - 1)] * fr
        soma = (np.where(ok, v, 0) * pesos).sum(axis=1)
        pontos[k] = soma / pesos.sum() * 10 if normalizar else soma
    salto_max = int(salto_max_rpm / passo_rpm)
    custo = pontos[0].copy()
    volta = np.zeros((q, len(rpms)), dtype=np.int32)
    for k in range(1, q):
        melhor = np.full(len(rpms), -np.inf, dtype=np.float32)
        arg = np.zeros(len(rpms), dtype=np.int32)
        for d in range(-salto_max, salto_max + 1):
            origem = np.arange(len(rpms)) - d
            valido = (origem >= 0) & (origem < len(rpms))
            cand = np.full(len(rpms), -np.inf, dtype=np.float32)
            cand[valido] = custo[origem[valido]] - penalidade * abs(d)
            t = cand > melhor
            melhor[t] = cand[t]
            arg[t] = origem[t]
        custo = melhor + pontos[k]
        volta[k] = arg
    caminho = np.zeros(q, dtype=np.int32)
    caminho[-1] = int(np.argmax(custo))
    for k in range(q - 1, 0, -1):
        caminho[k - 1] = volta[k, caminho[k]]
    t = (np.arange(q) * salto + janela / 2) / sr
    return t, rpms[caminho].astype(np.float64), pontos[np.arange(q), caminho]


def suavizar(rpm):
    """Mediana de 9 quadros contra os pulos isolados, depois média de 7."""
    y = np.pad(rpm, 4, mode='edge')
    mediana = np.array([np.median(y[i:i + 9]) for i in range(len(rpm))])
    return np.convolve(mediana, np.ones(7) / 7, mode='same')
