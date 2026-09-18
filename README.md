# Corrida Fantasma

Protótipo jogável do plano em `PLANO_DESENVOLVIMENTO.md`, agora com corrida offline, lobby multiplayer, largada sincronizada e o carro fantasma do adversário.

## Executar

```bash
npm install
npm run dev
```

O comando inicia o site (porta 5173) e o servidor Socket.IO (porta 3001). Abra o endereço do Vite; ele aceita conexões da rede local para facilitar testes no celular.

Para apontar o jogo a outro servidor da partida, use `GAME_SERVER_URL` no desenvolvimento ou `VITE_SERVER_URL` na build.

## Testes

```bash
npm test
```

A suíte cobre a física da corrida, a sequência das cinco luzes, a estimativa de relógio, a interpolação do fantasma, as regras das salas e testes de integração que sobem o servidor real e conectam dois clientes Socket.IO — inclusive medindo o erro do fantasma com pacotes atrasados e perdidos.

### Piloto virtual

Para testar o fantasma sem um segundo aparelho, entre em uma sala pelo navegador e rode:

```bash
npm run piloto -- CODIGO --nome Rival --velocidade 250
```

Ele entra na sala como segundo jogador, confirma presença, corre no ritmo pedido e envia telemetria pelo mesmo protocolo do navegador.

## Controles

- `A` / `D` ou setas: direção
- `Espaço`: boost
- Celular: botões de direção e boost na tela

## Como a largada é sincronizada

1. Cada cliente mede a diferença entre o próprio relógio e o do servidor com cinco amostras de ida e volta e fica com a de menor latência.
2. Quando os dois pilotos confirmam, o servidor escolhe um instante futuro comum (`startAt`, 5,4 s à frente) e envia o mesmo valor para os dois.
3. Cada cliente converte `startAt` em luzes: cinco acendem uma a uma, com 900 ms de intervalo, e todas apagam exatamente em `startAt`.
4. O cronômetro da corrida é contado a partir de `startAt`, e não do quadro em que a tela abriu, então os dois medem o mesmo tempo.

## Como o fantasma funciona

Cada navegador envia dez medições por segundo (progresso, faixa, velocidade e estado). O servidor valida — recusa pacotes atrasados, corrige horários incoerentes e limita avanços impossíveis — e repassa apenas ao adversário.

Quem recebe guarda as medições recentes e desenha o rival 160 ms no passado, interpolando entre duas medições conhecidas. Se a telemetria falhar, projeta o movimento por até 600 ms e então congela o carro, marcando-o como sem sinal. O progresso exibido nunca recua, então um pacote atrasado não puxa o fantasma para trás.

O fantasma é apenas desenhado: a simulação da corrida (`stepRace`) não recebe nenhum dado do rival, então é impossível ele empurrar ou frear o carro do jogador.

## Estado atual

- [x] Fluxo menu → largada → corrida → resultado → nova tentativa
- [x] Pista pseudo-3D e aceleração automática
- [x] Controles por teclado e toque
- [x] Limites da pista, obstáculos e penalidades
- [x] Boost com consumo, recarga e bloqueio ao esgotar
- [x] Cronômetro, velocidade e progresso
- [x] Cinco luzes de largada e áudio procedural básico
- [x] Salas para dois jogadores com código, link e QR code
- [x] Lobby em tempo real, confirmação e tratamento de sala cheia/inexistente
- [x] Relógio sincronizado entre cliente e servidor
- [x] Largada agendada e idêntica nos dois aparelhos
- [x] Cancelamento da largada por desistência, saída ou queda de conexão
- [x] Reconexão curta e retorno após recarregar a página
- [x] Telemetria validada pelo servidor e repassada ao adversário
- [x] Carro fantasma interpolado, translúcido e em cor distinta
- [x] Posição P1/P2, diferença em segundos e metros, indicador de rival fora da tela
- [ ] Resultado validado pelo servidor e revanche

## Limitações conhecidas

- Em uma aba fora de primeiro plano o navegador pausa a animação: o relógio da corrida continua correto, mas o carro não anda e a telemetria deixa de ser enviada enquanto a aba estiver escondida. O rival vê o fantasma parado e marcado como sem sinal.
- Partículas e marcas de pneu previstas na Fase 2 ainda não foram implementadas.
- O resultado ainda é calculado em cada cliente; a comparação oficial entre os dois pilotos entra na Fase 6.
