"""Mostra a rotação do motor ao longo de uma gravação, para escolher os trechos de cada camada.

    python scripts/motor/rastrear.py GRAVACAO CILINDROS RPM_MIN RPM_MAX [--de T0] [--ate T1]

GRAVACAO é o nome em arte/motor, sem extensão (mp44-honda-1988), ou um
caminho. Imprime a rotação a cada 0,2 s — com a confiança do rastreio e a
energia do quadro, que separa o carro perto do microfone do carro sumindo ao
longe — e salva em scripts/motor/saida uma imagem com o espectrograma e, por
cima, a ordem 1 (azul) e a da explosão (vermelha). Trecho bom para laço é onde
as duas linhas seguem as listras do espectrograma, com o carro perto, sem
troca de marcha nem chiado de pneu. Com --de e --ate, só aquele pedaço, para
ajustar as bordas.
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from fontes import PASTA_PADRAO, SR, achar, ler
from rastreio import espectro_branqueado, rastrear

SAIDA = Path(__file__).resolve().parent / 'saida'
SALTO, JANELA = 441, 4096


def main():
    parser = argparse.ArgumentParser(description='Rastreia a rotação do motor numa gravação.')
    parser.add_argument('gravacao')
    parser.add_argument('cilindros', type=int)
    parser.add_argument('rpm_min', type=float)
    parser.add_argument('rpm_max', type=float)
    parser.add_argument('--de', type=float, default=0.0, help='início do trecho, em segundos')
    parser.add_argument('--ate', type=float, default=None, help='fim do trecho, em segundos')
    parser.add_argument('--fontes', type=Path, default=PASTA_PADRAO, help='pasta das gravações (padrão: arte/motor)')
    args = parser.parse_args()
    caminho = achar(args.gravacao, args.fontes)
    if caminho is None:
        raise SystemExit(f'Gravação "{args.gravacao}" não encontrada em {args.fontes}.')
    inteira = ler(caminho)
    de = max(0.0, args.de)
    ate = len(inteira) / SR if args.ate is None else min(args.ate, len(inteira) / SR)
    x = inteira[int(de * SR):int(ate * SR)].astype(np.float32)

    # Na gravação inteira a rotação passa por todas as marchas: um passo de
    # 25 rpm e um custo maior por salto seguram o rastreio na faixa larga.
    log_esp = espectro_branqueado(x, SALTO, JANELA)
    t, rpm, conf = rastrear(x, SR, args.cilindros, args.rpm_min, args.rpm_max, SALTO, JANELA, passo_rpm=25,
                            salto_max_rpm=400, penalidade=0.02, log_esp=log_esp)
    q = len(t)
    energia = np.array([20 * np.log10(np.sqrt((x[k * SALTO:k * SALTO + JANELA] ** 2).mean()) + 1e-9) for k in range(q)])
    passo = max(1, int(0.2 * SR / SALTO))
    print(' '.join(f'{de + t[k]:.1f}:{int(rpm[k])}({conf[k]:.0f},{energia[k]:.0f}dB)' for k in range(0, q, passo)))

    explosao = args.cilindros / 2
    fmax = 2500
    bins = int(fmax / (SR / JANELA))
    img = np.clip((log_esp[:, :bins].T[::-1] + 1) / 4, 0, 1)
    largura, altura = 1500, 500
    im = Image.fromarray((img * 255).astype(np.uint8)).resize((largura, altura)).convert('RGB')
    d = ImageDraw.Draw(im)
    for ordem, cor in [(1, (80, 200, 255)), (explosao, (255, 90, 90))]:
        d.line([(k / q * largura, altura - (rpm[k] / 60 * ordem) / fmax * altura) for k in range(0, q, 3)], fill=cor, width=1)
    dur = ate - de
    marca = 0.25 if dur <= 6 else (1 if dur <= 40 else 5)
    s = np.ceil(de / marca) * marca
    while s <= ate:
        px = (s - de) / dur * largura
        d.line([(px, 0), (px, 6)], fill=(255, 255, 0))
        d.text((px + 2, 6), f'{s:g}', fill=(255, 255, 0))
        s += marca
    SAIDA.mkdir(exist_ok=True)
    trecho = '' if args.de == 0 and args.ate is None else f'_{de:g}-{ate:g}'
    destino = SAIDA / f'{caminho.stem}{trecho}_rpm.png'
    im.save(destino)
    print(f'imagem: {destino}')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    main()
