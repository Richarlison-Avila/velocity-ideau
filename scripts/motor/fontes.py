"""Onde ficam as gravações dos motores e como lê-las."""
import functools
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np

SR = 44100
RAIZ = Path(__file__).resolve().parents[2]
PASTA_PADRAO = RAIZ / 'arte' / 'motor'
EXTENSOES = ('.wav', '.ogg', '.mp3', '.flac', '.m4a')


def achar(fonte, pasta=PASTA_PADRAO):
    """O arquivo da gravação `fonte` — um caminho, ou o nome sem extensão dentro de `pasta`.

    Um WAV com o mesmo nome tem preferência: é a gravação já decodificada.
    """
    caminho = Path(fonte)
    if caminho.suffix and caminho.exists():
        return caminho
    for extensao in EXTENSOES:
        candidato = Path(pasta) / (fonte + extensao)
        if candidato.exists():
            return candidato
    return None


@functools.lru_cache(maxsize=None)
def ler(caminho):
    """A gravação em mono a 44,1 kHz, em float64 entre -1 e 1.

    WAV de 16 bits é lido direto. OGG, MP3 e os outros passam pelo ffmpeg, que
    precisa estar no PATH.
    """
    caminho = Path(caminho)
    if caminho.suffix.lower() == '.wav':
        with wave.open(str(caminho), 'rb') as w:
            if w.getframerate() != SR or w.getsampwidth() != 2:
                raise SystemExit(f'{caminho.name}: o WAV precisa ser de 16 bits a {SR} Hz.')
            canais = w.getnchannels()
            dados = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    else:
        if not shutil.which('ffmpeg'):
            raise SystemExit(f'{caminho.name}: para ler {caminho.suffix} é preciso o ffmpeg no PATH; '
                             f'ou converta antes para WAV mono de 16 bits a {SR} Hz.')
        comando = ['ffmpeg', '-v', 'error', '-i', str(caminho), '-f', 's16le', '-ac', '1', '-ar', str(SR), '-']
        canais, dados = 1, np.frombuffer(subprocess.run(comando, capture_output=True, check=True).stdout, dtype=np.int16)
    if canais == 1:
        return dados.astype(np.float64) / 32768
    # Estéreo vira mono pela média dos canais.
    return (dados.astype(np.float32) / 32768).reshape(-1, canais).mean(axis=1).astype(np.float64)
