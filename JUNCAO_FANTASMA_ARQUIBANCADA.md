# Junção: fantasma no presente e arquibancada

Para a sessão que fez a ranqueada, o contrarrelógio, os perfis e a Copa do Dia. Leia antes de mesclar o branch `claude/fantasma-espectadores` em `main`, e apague este arquivo depois da junção.

## Resumo

O branch faz duas coisas: redesenha o fantasma de rede, que agora é desenhado no presente e fica legível com seis carros na pista, e cria a arquibancada, com espectadores fora das seis vagas.

Ele saiu de `main` em 0b66c70, sem o seu trabalho, que ainda não estava commitado. Testei a junção contra uma foto do seu trabalho tirada às 17:07 de 23/09, e ela fecha:

- `tsc` do app e do servidor passam;
- 804 testes passam, 1 pulado;
- o build de produção passa.

A resolução testada está no branch `claude/juncao-teste`. Use-o como gabarito e **não o mescle**: o primeiro pai dele é a foto do seu trabalho, não um commit de verdade.

## Como mesclar

1. Commite o seu trabalho em `main`.
2. Rode `git merge claude/fantasma-espectadores`.
3. Resolva os conflitos nos 5 arquivos da seção "Conflitos, arquivo por arquivo". Para cada arquivo, compare com `git show claude/juncao-teste:<arquivo>`. Seu código mudou desde a foto, então use o gabarito como referência e não copie às cegas.
4. Faça as quatro correções da seção "Correções que o git não acusa". Elas não aparecem como conflito.
5. Rode `npx vitest run --exclude ".claude/**"` e `npm run build`, e depois faça a checagem manual do fim deste arquivo.

`README.md` e `src/styles.css` se juntam sozinhos.

## Commits do branch

| Commit | O que faz |
| --- | --- |
| 4c3c040 | O fantasma é desenhado no presente, e não 160 ms no passado. Só mexe em `ghost.ts` e nos testes dele, e não conflita. |
| ae7a47d | Servidor: arquibancada fora das vagas e `falaPor` em todos os eventos de piloto. |
| a1d8a03 | Cliente: fantasma legível (profundidade, etiquetas, radar, classificação) e câmera da arquibancada. |
| 26c6b2e | O papel de espectador some junto com a sala, por meio de `voltarAPiloto()`. |
| 14a4e0b | O teste da demonstração lê o fantasma no instante da medição. Antes ele falhava 1 vez em 5 com a suíte cheia. |

## Contratos que mudaram

### `GhostTracker` (`src/game/ghost.ts`)

- **`sample(now)`** projeta a posição até `now` a partir da medição mais nova, usando a velocidade e a aceleração das últimas medições.
  - A correção de uma medição nova é absorvida em cerca de 150 ms, com teto de +35 m/s, e o fantasma nunca anda para trás.
  - Uma diferença acima de 40 m reposiciona o carro de uma vez.
  - Depois de 0,9 s sem notícias, o fantasma fica sem sinal e com velocidade zero.
- **`sample` guarda estado**, porque é ele que suaviza as correções. Chame em tempos crescentes, o normal é uma vez por quadro. Uma chamada com tempo menor não quebra nada, só não suaviza.
- **`INTERPOLATION_DELAY_MS` agora vale 0.** Quem compara a posição exibida com a verdadeira usa o mesmo instante nos dois lados.
- **`GhostSample` ganhou `finishedAt?: number | null`.** O campo é opcional, então a sua `ReproducaoDeVolta` compila sem mudar nada. Preencha se quiser que o recorde entre na ordem de chegada.

### `RaceCanvas`

- **Props.** `mode` passa a ser `'solo' | 'online' | 'contrarrelogio' | 'espectador'`, e entra a prop `espectadores?: number`.
- **`drawGhost(rival, profundidade, sample, dt, etiqueta)`.**
  - A profundidade é `sample.progress - race.progress + CAR_VIEW_DISTANCE`, porque o carro de quem manda a telemetria fica um pouco à frente da câmera dele. Com isso, um rival lado a lado aparece ao lado do nosso carro. Os carros colados atrás (profundidade entre 0,8 m e `CAR_VIEW_DISTANCE`) são desenhados depois do nosso carro.
  - Um carro mais atrás que isso vira seta no radar, só para quem pilota.
- **Etiquetas.** Mostram `P# NOME` a partir da classificação do quadro, e sobem em degraus quando colidem (`fantasmaNaTela.ts`). Um fantasma com `semVacuo`, que é o seu recorde, leva só o nome.
- **Modo espectador.** A câmera usa o carro seguido, tirado da amostra de um rival. Tudo o que é do piloto fica atrás de `noModoEspectador`:
  - `stepRace`;
  - o juiz da largada;
  - `gravadorDeEntradas`, `analista`, `gravador` e parciais;
  - o radar.
- **Painel.**
  - A classificação ao vivo aparece nos modos online e espectador.
  - A barra de progresso ganha a marca de cada carro.
  - O espectador não vê boost, avisos de pilotagem, controles nem dica de teclado, e ganha o painel da câmera (‹, ›, LÍDER).
- **Telemetria.** Se a física não andou nos últimos 250 ms (`ultimoPassoRef`), sai velocidade zero. É o caso da aba escondida.

### Servidor

- **`falaPor`, `DadosDoSocket` e `RECUSADO`.** Os dois lados criaram. O corpo de `falaPor` é idêntico, mas o git deixa as duas definições (veja as correções).
- **`rooms.ts`:**
  - `Room.spectators` e `PublicRoom.spectators`;
  - `MAX_SPECTATORS` (30);
  - `spectate()`, `allTelemetries()`, `dropSpectatorsBySocket()` e `afterSpectatorLeft()`;
  - `join()` tira da arquibancada quem desce para o grid;
  - `leaveBySocket()` também trata espectadores;
  - a sala só fecha quando não sobra piloto de verdade nem espectador.
- **`app.ts`:**
  - Entra o evento `room:spectate`.
  - Em `room:leave`, o temporizador da largada só é derrubado quando a saída cancelou a contagem. Antes, a saída de um espectador deixava a sala presa em contagem.
  - Em `disconnect`, o espectador sai da sala na hora.

### `App.tsx` e `Lobby.tsx`

- **Papel na sala.**
  - O estado `papel` guarda `'piloto'` ou `'espectador'`; `ROLE_KEY` guarda o papel ao lado de `ROOM_KEY`.
  - `voltarAPiloto()` desfaz o papel, e `openRoom(sala, papel)` abre a sala nele.
- **Entradas e saídas.** `spectateRoom`, `entrarNoGrid`, `irParaArquibancada` e o link `?room=X&assistir=1`, que entra direto como espectador.
- **Lobby.** Ganha as props `espectador`, `onJoinGrid` e `onSpectate`, a lista da arquibancada e o botão "LINK PARA ASSISTIR". Você não mexeu neste arquivo, então ele não conflita.
- **Resultado.** O caso `assistiu` vem primeiro, antes da copa e da ranqueada.

## Conflitos, arquivo por arquivo

São 29 trechos, e a resolução abaixo foi a que passou nos testes. Nas tabelas, "seu lado" é o trabalho competitivo e "meu lado" é o branch.

### `src/multiplayer/types.ts` — 1 trecho

Mantenha os dois: `ranqueada?` e `copa?` do seu lado, `spectators?` e o tipo `LobbySpectator` do meu.

### `server/rooms.ts` — 6 trechos

| # | Onde | Resolução |
| --- | --- | --- |
| 1 | `PublicRoom` | O seu lado (`ranqueada`, `copa`) e depois o meu (`spectators` e o tipo `PublicSpectator`). A linha `/**` antes do trecho é comum aos dois, então abra outra para o comentário da arquibancada. |
| 2 | `Room` | O seu lado (`exigeTelemetria`, `ranqueada`, `copa`, `sorteioDeSemente`) mais `spectators`. |
| 3 | `RoomError` | Os dois códigos novos: `... 'NOT_HOST' \| 'RANKED' \| 'SPECTATORS_FULL'`. |
| 4 | Constantes | O bloco de `MAX_SPECTATORS` e, logo depois, o seu comentário do teto ("Teto absoluto..."). |
| 5 | `afterDeparture` | `if (room.players.every((player) => player.fantasma) && room.spectators.length === 0)`. É a sua regra (só fantasmas sobrando fecha a sala) mais a minha (com espectador, a sala espera). |
| 6 | `toPublic` | O seu lado (`ranqueada`, `...copa`) mais `spectators`. |

### `server/app.ts` — 5 trechos

| # | Onde | Resolução |
| --- | --- | --- |
| 1 | imports | O seu lado. |
| 2 | `room:join` | O meu lado: a linha que limpa `espectadorDe`. |
| 3 | `race:finish` | O seu lado, com `ack` e `gravacao`. Ele já tem o `falaPor`. |
| 4 | `room:set-ready` | O seu lado: as guardas da ranqueada e da copa. |
| 5 | `disconnect` | Os dois: `ranqueada.sairPorSocket(socket.id)` e depois o laço de `dropSpectatorsBySocket`. |

### `src/App.tsx` — 6 trechos

| # | Onde | Resolução |
| --- | --- | --- |
| 1 | estados | Os dois: os seus (contrarrelógio, perfil, ranqueada, copa) e `papel`. |
| 2 | refs | Os dois: `modoDaProvaRef` e `papelRef`. |
| 3 | props do `RaceCanvas` | Troque para `onTelemetry={online && !assistindo ? ...}` e `onAbandon={online && !assistindo ? ...}`, e mantenha `recorde`, `onRestart` e `modificador`. |
| 4 | manchete | Defina `contra`, `assistiu` e `vencedor`, e monte `manchete = contra ? (...) : !online`. O git já emenda o resto da minha versão: `? 'Prova concluída.' : assistiu ? ... : !outcome ...`. |
| 5 | selo e marca | O seu selo (copa, desafio, Pista do Dia) e a classe `winner` com `contra?.novoRecorde`. O número da marca usa `online && outcome && !assistiu`. |
| 6 | botões | `{assistiu ? (...) : daCopa && outcome ? (...) : ranqueada && outcome ? (...)` e depois o resto, que o git já emenda. O espectador precisa vir antes, para quem assiste uma sala ranqueada não ver "VOLTAR À FILA". |

### `src/game/RaceCanvas.tsx` — 11 trechos

| # | Onde | Resolução |
| --- | --- | --- |
| 1 | import | O seu lado, com `useMemo`. |
| 2 | tipo da prop `mode` | Junte o comentário, use o tipo com as quatro opções e acrescente `espectadores?`. Depois, as suas props `recorde`, `onRestart` e `modificador`. |
| 3 | desestruturação | Os dois. |
| 4 | refs | Os dois: `fantasmaDoRecorde`, `rivaisDaPista` e `restartRef` do seu lado; `pilotNameRef`, `modeRef` e `autoLiderRef` do meu. |
| 5 | teclado | A sua linha do dispositivo e depois o bloco do espectador, que troca de piloto e retorna. |
| 6 | início do quadro | Primeiro o meu bloco (câmera do espectador e classificação, que define `noModoEspectador`), depois o seu juiz da largada com duas mudanças: `const decisaoDaLargada = noModoEspectador ? null : juizRef.current.observar(...)` e `if (largada && !doneRef.current && !noModoEspectador)`. |
| 7 | física | A sua versão (`quantizarPasso`, `gravadorDeEntradas`, `stepRace`, `analista`, `gravador`, parciais), mas com tudo que é do piloto atrás de `noModoEspectador`: `const eventosDoQuadro = noModoEspectador ? [] : stepRace(...)`, e o registro, a análise, a gravação e `ultimoPassoRef` dentro de `if (!noModoEspectador)`. |
| 8 | bloco da posição | Câmera do espectador, posição online, `'RELÓGIO'` no contrarrelógio e `'SOLO'`. Mantenha o seu modificador no rótulo do nível. |
| 9 | boost | A minha classificação ao vivo e depois o seu medidor de boost, com `telemetry.impulso`, dentro de `{!espectador && (...)}`. |
| 10 | parcial e tangência | A sua parcial do setor e depois `{!espectador && tangencias > 0 && (`. |
| 11 | dica do teclado | A sua dica, com `⌫ RECOMEÇAR`, dentro de `{!espectador && (...)}`. |

## Correções que o git não acusa

Faça depois de resolver os conflitos. O `tsc` pega as duas primeiras; as outras duas são de comportamento.

1. **`server/app.ts`.** `DadosDoSocket`, `falaPor` e `RECUSADO` ficam definidos duas vezes. Deixe um de cada, com o tipo `type DadosDoSocket = { playerId?: string; perfilId?: string; espectadorDe?: string }`.
2. **`server/rooms.ts`.** Toda sala montada à mão precisa de `spectators: []`. Hoje é a sua `criarAutomatica`, e vale para qualquer sala nova da copa. O `afterSpectatorLeft` usa a mesma regra do `afterDeparture`: `room.players.every((player) => player.fantasma) && room.spectators.length === 0`.
3. **`src/App.tsx`.** Todo caminho que entra numa sala como piloto sem passar por `openRoom`, ou que esquece a sala, chama `voltarAPiloto()`. Hoje isso vale para `onPartida` (ranqueada), `onPartidaDaCopa` e `onCancelada`. Sem isso, quem assistiu a uma sala e depois entrou na fila correria a ranqueada em modo espectador, e ao reconectar voltaria para a arquibancada.
4. **`src/game/RaceCanvas.tsx`.** A etiqueta do fantasma do recorde fica sem posição. No contrarrelógio a classificação só tem o recorde, e ele sairia como "P1 SEU RECORDE". Use:

   ```ts
   const etiquetaDe = (rival: RaceRival) =>
     rival.semVacuo ? nomeDaEtiqueta(rival.name) : `P${posicaoDe.get(rival.id) ?? '?'} ${nomeDaEtiqueta(rival.name)}`
   ```

## Decisões para você confirmar

- **Espectador em sala ranqueada e da copa.** Hoje é permitido: entra quem tiver o código. A copa ganharia um telão com o link `?room=X&assistir=1`. Se preferir barrar, faça no `spectate()`.
- **Sala só com fantasmas do servidor e alguém assistindo.** Hoje ela fica aberta até o último espectador sair, e o resultado aparece para ele. Se a copa depende de a sala sumir para avançar a rodada, troque a regra do trecho 5 de `rooms.ts`.
- **Pilotos com `fantasma: true`.** Para o espectador e para a classificação, são pilotos como os outros: a telemetria que o servidor gera chega pelo mesmo `race:rival`.
- **`scripts/piloto-virtual.ts`.** Não precisa saber da arquibancada.

## Checagem depois da junção

**Automática:**

- `npx tsc -b` e `npx tsc --noEmit -p tsconfig.server.json`;
- `npx vitest run --exclude ".claude/**"`: sobre o seu trabalho foram 804 testes passando e 1 pulado. Os novos estão em `ghost.test.ts`, `classificacao.test.ts`, `fantasmaNaTela.test.ts`, `espectadores.test.ts`, no bloco "arquibancada" de `rooms.test.ts` e em `fantasma.e2e.test.ts` (inclusive o caso de 120 ms de latência);
- `npm run build`.

**Manual, com o servidor de desenvolvimento e bots do `scripts/piloto-virtual.ts`:**

1. **Sala de 6.** Com o navegador e 5 bots, confira as etiquetas "P# NOME" sobre os fantasmas, a classificação ao vivo à esquerda, as marcas na barra de progresso e um rival lado a lado visível na largada.
2. **Espectador.** Em outra aba anônima, entre pelo "LINK PARA ASSISTIR" do lobby com a prova já andando. A câmera deve seguir o líder, as setas e um toque na classificação trocam o piloto seguido, e L volta ao líder.
3. **Contrarrelógio e Pista do Dia.** O fantasma do recorde deve ter a etiqueta só com o nome, sem classificação na tela, e o radar deve mostrar o recorde quando ele vier atrás.
4. **Ranqueada.** Quem acabou de assistir uma sala entra na fila e deve correr como piloto.
5. **Copa.** Um espectador numa sala da copa deve ver os pilotos-fantasma do servidor como carros comuns.

## Onde está cada coisa

- **O trabalho:** a worktree `D:\velocity-fantasma`, no branch `claude/fantasma-espectadores`.
  - O `node_modules` dela é uma junção para `D:\velocity-ideau\node_modules`.
  - Para apagar essa worktree, rode `rmdir D:\velocity-fantasma\node_modules` antes de `git worktree remove`. Nunca apague recursivamente: isso seguiria a junção e apagaria o `node_modules` do projeto.
- **O gabarito:** `claude/juncao-teste`, a resolução testada contra a foto das 17:07. Não mescle.
