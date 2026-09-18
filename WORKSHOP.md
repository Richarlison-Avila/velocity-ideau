# Roteiro do workshop

Tudo o que precisa ser feito antes, durante e depois da demonstração do Corrida Fantasma.

## 1. Publicar

O jogo roda em **um processo só**: o mesmo servidor entrega o site e aceita as conexões WebSocket. Não há front-end e back-end separados para sincronizar.

```bash
npm ci
npm run build
npm start
```

O servidor escuta em `0.0.0.0` na porta de `PORT` (3001 por padrão) e imprime, ao subir, os endereços da máquina na rede local.

### Opção A — Rede local, no seu notebook

É a opção mais segura para um workshop: não depende de internet nem de serviço externo.

1. Conecte o notebook e os celulares à mesma rede.
2. `npm run build && npm start`
3. Use o endereço de rede local que aparece no terminal.

Cuidado: algumas redes de empresa e de evento isolam os dispositivos entre si (*client isolation*), e aí um celular não enxerga o notebook. Teste antes. Se estiver isolada, use o hotspot (seção 4).

### Opção B — Servidor na internet

Precisa de um endereço **HTTPS** para o QR code ficar confiável e para o navegador não reclamar.

Há um `Dockerfile` pronto, que serve para qualquer hospedagem que aceite contêiner e WebSocket:

```bash
docker build -t corrida-fantasma .
docker run -p 3001:3001 -e PORT=3001 corrida-fantasma
```

Sem contêiner, qualquer máquina com Node 24 roda `npm ci && npm run build && npm start`.

Requisitos da hospedagem:

- aceitar **WebSocket** (Socket.IO cai para long-polling se não houver, mas a largada fica pior);
- **uma instância só** — o estado das salas vive na memória do processo. Duas instâncias separam os dois pilotos em salas diferentes;
- não dormir por inatividade, ou o primeiro acesso da demonstração demora.

| Variável | Para quê | Padrão |
| --- | --- | --- |
| `PORT` | Porta do servidor | `3001` |
| `DEMO_ROOMS` | Salas que existem sempre, separadas por vírgula | `DEMO1` |

## 2. Sala de demonstração

O código `DEMO1` se cria sozinho quando alguém entra, mesmo que a sala esteja vazia. Isso faz o QR code do slide funcionar sempre, sem depender de alguém ter criado a sala antes.

Ela continua limitada a dois pilotos e se reabre depois que todos saem — dá para repetir a demonstração quantas vezes quiser.

Para usar outro código: `DEMO_ROOMS=PISTA,GRID npm start`.

## 3. QR code definitivo

```bash
npm run qrcode -- https://seu-endereco --sala DEMO1
```

Gera, na pasta `qrcode/`:

- `corrida-fantasma.svg` — para o slide, sem perder qualidade no projetor;
- `corrida-fantasma.png` — para imprimir e colar na parede;
- `endereco.txt` — o endereço em texto, para quem precisar digitar.

Sem argumento, ele usa o endereço da máquina na rede local. **Gere o QR code depois de decidir o endereço final** — um QR apontando para o lugar errado é o jeito mais rápido de perder a demonstração.

Deixe o endereço escrito também em texto grande no slide. Câmera de celular antigo, reflexo no projetor e sala escura atrapalham a leitura do código.

## 4. Rede de reserva

Prepare **antes**, não na hora:

1. Ative o roteamento de rede pelo celular (hotspot) e conecte o notebook a ele.
2. Suba o servidor e anote o novo endereço local — ele muda de rede para rede.
3. Gere um segundo QR code para esse endereço e deixe-o em um slide oculto.

Se a rede do evento cair no meio, trocar para o hotspot é questão de mudar de rede e projetar o outro slide.

## 5. Conferência na véspera

O roteiro da apresentação é também um teste automatizado. Ele sobe o servidor,
conecta dois pilotos, corre as duas provas com a física de verdade, troca
telemetria, confere que as duas telas recebem o mesmo vencedor e pede
revanche — tudo em poucos segundos:

```bash
npx vitest run server/demonstracao.test.ts
```

Se esse teste passar, o caminho inteiro da demonstração está de pé. O que ele
não cobre é a rede e os aparelhos do evento, que é o resto desta lista.

- [ ] `npm ci && npm run build && npm test` sem falhas
- [ ] Servidor sobe e `/health` responde `{"ok":true}`
- [ ] Abrir o jogo em um computador e em um celular, na rede do evento
- [ ] Criar sala, entrar pelo QR code, completar uma corrida inteira
- [ ] Conferir que o resultado é o mesmo nas duas telas
- [ ] Pedir revanche e confirmar que a segunda corrida começa
- [ ] Testar no celular em pé e deitado
- [ ] Repetir tudo pelo hotspot de reserva
- [ ] Bateria dos aparelhos e do notebook carregada; levar carregadores
- [ ] Brilho da tela no máximo e bloqueio automático desligado nos celulares
- [ ] Som testado, se for usar o áudio da largada

## 6. Roteiro da apresentação

Cerca de oito minutos, seguindo a seção 17 do plano.

1. **Conceito** (1 min). Dois pilotos, a mesma prova, cada um vê o outro como um carro fantasma. Ninguém empurra ninguém — o rival é informação, não obstáculo.
2. **Criar a sala** (30 s). No seu aparelho, mostre o código e o QR code na tela.
3. **Entrar pelo QR code** (1 min). Um voluntário lê o código com a câmera. É aqui que o público entende que qualquer um consegue entrar.
4. **O lobby** (30 s). Os dois pilotos aparecem, cada um confirma. Mostre o indicador de relógio sincronizado.
5. **A largada** (30 s). As cinco luzes acendem ao mesmo tempo nos dois aparelhos e apagam juntas. Diga que o servidor marcou um horário futuro comum, e não um "comece agora".
6. **A corrida** (1 min 30 s). Mostre o fantasma azul e o indicador de diferença. Peça para o voluntário tentar uma ultrapassagem.
7. **O resultado** (1 min). As duas telas mostram o mesmo vencedor, os mesmos tempos e a mesma diferença, porque quem decidiu foi o servidor.
8. **Revanche** (30 s). Os dois pedem, a corrida recomeça sem recarregar a página.
9. **Como funciona por dentro** (1 min 30 s). Relógio sincronizado, largada agendada, telemetria a dez vezes por segundo, interpolação do fantasma e validação da chegada.

### Se algo der errado

| Problema | O que fazer |
| --- | --- |
| O QR code não lê | Dite o endereço e o código da sala, que estão no slide |
| O celular não abre o endereço | Rede errada ou rede isolada: troque para o hotspot |
| A sala aparece cheia | Alguém entrou antes; use `DEMO_ROOMS` com um segundo código |
| O voluntário não consegue jogar | Use o piloto virtual como adversário (abaixo) |
| Nada funciona | Use o modo treino: a corrida sozinha não depende de rede |

### Adversário de reserva

Se faltar um segundo piloto, ou se a conexão do voluntário falhar, rode no notebook:

```bash
npm run piloto -- DEMO1 --nome Rival --velocidade 250
```

Ele entra na sala como segundo jogador, confirma presença, corre e pede revanche — pelo mesmo protocolo do navegador. A demonstração continua inteira, com fantasma e resultado.

Ajuste `--velocidade` para calibrar a disputa: abaixo de 250 km/h o voluntário ganha com facilidade; acima de 270 km/h ele perde. Acima de 314 km/h o servidor recusa a chegada, porque é mais rápido do que o carro consegue andar.

## 7. Depois do workshop

- `docker stop` ou `Ctrl+C` no servidor
- Se usou rede local, nada fica publicado
- Os resultados não são gravados: o estado vive na memória e some ao desligar
