# Corte das vozes do motor

Os laços de `public/audio/motor`, as vozes que `src/game/motorF1.ts` toca, saem das gravações de [`arte/motor`](../../arte/motor) por estes scripts. O método está explicado na seção "Motor" do [README principal](../../README.md#motor).

| Arquivo | Para quê |
| --- | --- |
| `cortar.py` | As receitas de cada voz, isto é, que trechos de que gravação formam cada camada. Também faz o corte: normaliza a rotação, achata o volume, iguala o timbre, emenda e fecha o laço. |
| `rastrear.py` | Mostra a rotação ao longo de uma gravação, em texto e numa imagem, para escolher os trechos. |
| `rastreio.py` | O rastreio da rotação pela soma das ordens do motor, usado pelos dois scripts acima. |
| `fontes.py` | Acha e lê as gravações. |

## Requisitos

- **Python 3.10 ou mais novo**, com as dependências instaladas: `pip install -r scripts/motor/requirements.txt`.
- **ffmpeg no PATH**, para ler OGG e MP3. No Windows, instale com `winget install Gyan.FFmpeg`. Sem ele, converta cada gravação para WAV mono de 16 bits a 44,1 kHz e deixe o WAV ao lado dela, com o mesmo nome; o WAV tem preferência.

## Recortar

```bash
python scripts/motor/cortar.py
```

Sem argumentos, o script corta todas as vozes. Para uma só, passe o nome dela, por exemplo `python scripts/motor/cortar.py hibrido-v6`.

Para cada camada, o script mostra de onde veio cada pedaço e em que faixa de rotação ele estava. Ele avisa quando algo pede atenção:

- **estouros:** há um pico muito acima do típico dentro do trecho, como troca de marcha, zebra ou estalo. O laço repetiria esse pico a cada volta.
- **esticado demais:** o trecho foi reamostrado mais de 22% e soa como desenho animado.
- **laço curto:** o laço tem menos de 0,8 s, e a repetição começa a ser notada.

A rotação impressa para cada camada é a que vai em `camadas` no `motorF1.ts`. Se ela mudar, atualize lá e rode `npx vitest run src/game/motorF1.test.ts`. Os testes conferem três coisas:

- todo laço existe;
- a camada que domina nunca é esticada mais de um quinto;
- o câmbio de cada voz fecha com as rotações das camadas.

## Uma voz nova

1. Ponha a gravação em `arte/motor` e anote no README de lá de onde ela veio e qual é a licença.
2. Veja a rotação com `python scripts/motor/rastrear.py nome 8 9000 19000`. Os argumentos são o nome do arquivo sem extensão, o número de cilindros e a faixa de rotação. A imagem vai para `scripts/motor/saida`. Com `--de` e `--ate`, o script mostra só um pedaço, para acertar as bordas.
3. Escolha trechos de aceleração plena, com o carro perto do microfone, sem troca de marcha nem chiado de pneu. Cada camada fica numa faixa de rotação, e trechos de gravações diferentes podem entrar na mesma camada.
4. Acrescente a voz em `VOZES`, no `cortar.py`. Dê a cada trecho uma faixa de rastreio estreita em volta da rotação dele, porque com a faixa larga o rastreio pula de oitava.
5. Corte e registre a voz no `motorF1.ts`:
   - em `VOZES`, com `troca`, `corte`, `largada` e `segurando` coerentes com as camadas;
   - em `VOZ_DO_CARRO`, para os carros que usam a voz.

## O Mercedes V10

A gravação do V10 da MP4-16 é o áudio de um vídeo do YouTube, sem licença livre, e não vem com o repositório.

- **Com o arquivo:** salve-o em `arte/motor/v10.wav` (ou `.mp3`) e rode `python scripts/motor/cortar.py mercedes-v10`. O `.gitignore` daquela pasta impede que o arquivo seja commitado.
- **Sem o arquivo:** o corte de todas as vozes pula esta e deixa os laços `v10-*.wav` como estão.

Esta foi a primeira voz, cortada com uma versão mais simples do método, que ficou guardada em `V10` no `cortar.py`. Para publicar o jogo fora do protótipo acadêmico, troque esses cinco laços por uma gravação de licença livre, cortada como as outras vozes.

## Reprodutibilidade

Com as mesmas gravações decodificadas, os scripts refazem byte a byte os 24 laços de `public/audio/motor`. As gravações usadas no repositório foram decodificadas no navegador, pelo `decodeAudioData`. Decodificadas pelo ffmpeg, as amostras mudam um pouco e os laços saem equivalentes, mas não idênticos.
