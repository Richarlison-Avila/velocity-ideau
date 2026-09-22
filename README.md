# Corrida Fantasma

Protótipo jogável do plano em `PLANO_DESENVOLVIMENTO.md`: corrida offline, lobby multiplayer, largada sincronizada, carro fantasma do adversário e resultado oficial com revanche.

## Como se dirige

A aceleração é automática. O piloto controla **direção** e **boost** — e há três
coisas disputando esse único comando.

**A curva empurra.** A curvatura vem do traçado sorteado para a corrida, a mesma
que está sendo desenhada na tela, e entra na física como força lateral: cresce
com o quadrado da velocidade e só desloca o carro no que passa da aderência do
pneu. Segurar a linha gasta esterço que deixa de estar disponível para escolher
a faixa, e é essa disputa que faz a pista importar.

| Nível | Aderência | Pede correção em | Pior curva consome do esterço |
| --- | --- | --- | --- |
| Normal | 0,18 | 40% do traçado | 64% em cruzeiro · **101%** com boost |
| Difícil | 0,15 | 45% do traçado | 65% em cruzeiro · 99% com boost |
| Profissional | 0,12 | 52% do traçado | 66% em cruzeiro · 97% com boost |

Passar de 100% significa que ali o carro escapa mesmo com o volante todo virado:
**a velocidade máxima só é utilizável nas retas**. Isso não é uma regra escrita à
parte — é consequência de a curva cobrar o quadrado da velocidade. Para um piloto
que precisa desviar de obstáculos enquanto segura a curva, o custo medido é de
0,35 s no normal, 1,3 s no difícil e 2,1 s no profissional.

**O vácuo do rival rende.** Vindo atrás e alinhado com o adversário, o carro ganha
até 26 km/h no normal — cerca de 10% do cruzeiro nos três níveis —, mais forte
quanto mais perto. Ultrapassar custa esse ganho, porque a esteira desaparece no
instante em que o carro passa à frente. É o que dá sentido mecânico à presença do
outro piloto: sem isso, uma corrida on-line seriam duas provas solo sobrepostas.
Com pilotos de habilidade diferente o melhor continua ganhando; o vácuo só encosta
os carros quando já estão empatados, que é justamente a disputa que se quer
dramática.

**O volante castiga quem o maltrata.** Uma correção de curva mexe pouco e some;
zigue-zague sustentado acumula e cobra aderência. Os dois sistemas não brigam: uma
correção firme e mantida não é punida, porque o que conta é o curso do volante, e
não a posição do carro.

## Executar

```bash
npm install
npm run dev
```

O comando inicia o site (porta 5173) e o servidor Socket.IO (porta 3001). Abra o endereço do Vite; ele aceita conexões da rede local para facilitar testes no celular.

Para apontar o jogo a outro servidor da partida, use `GAME_SERVER_URL` no desenvolvimento ou `VITE_SERVER_URL` na build.

## Publicar

Em produção é **um processo só**: o mesmo servidor entrega o site e aceita as conexões WebSocket.

```bash
npm ci && npm run build && npm start
```

O servidor escuta em `0.0.0.0` e imprime os endereços da máquina na rede local, para acessar pelo celular. Há um `Dockerfile` pronto para hospedagens que aceitem contêiner.

O estado das salas vive na memória, então precisa ser **uma instância só** — duas separariam os dois pilotos em salas diferentes.

| Variável | Para quê | Padrão |
| --- | --- | --- |
| `PORT` | Porta do servidor | `3001` |
| `DEMO_ROOMS` | Salas que existem sempre, separadas por vírgula | `DEMO1` |

O passo a passo do evento, com conferência de véspera, rede de reserva e roteiro da apresentação, está em [WORKSHOP.md](WORKSHOP.md).

### QR code da apresentação

```bash
npm run qrcode -- https://seu-endereco --sala DEMO1
```

Gera SVG para o slide, PNG para imprimir e o endereço em texto, na pasta `qrcode/`.

### Fontes

A tipografia fica dentro do projeto, em `public/fontes`, para o jogo funcionar em rede sem internet. Para atualizá-la: `npm run fontes`.

### Carros

Não há imagem de carro nenhuma no projeto. O desenho inteiro — carroceria, pneus, asas, cockpit e piloto — é descrito em `src/game/carModel.ts` com as mesmas formas cheias e cores chapadas do cenário, e é por isso que o carro parece estar dentro da pista em vez de colado por cima dela.

Cada ponto do molde é dado em metros e projetado por uma câmera de teleobjetiva, alta e distante, a mesma de Top Gear e Horizon Chase. A altura entra achatada de propósito, na convenção do desenho de corrida visto de cima: sem isso o capacete subiria até a altura do bico e o carro perderia o empilhamento que o faz ler como carro.

Nenhum volume usa degradê; todos são resolvidos em faixas de cor chapada, como um artista de pixel art resolve um cilindro, e a rampa de tons desliza com a luminância da pintura — numa cor clara o relevo vem de escurecer, numa escura de clarear. O que dá volume de verdade, porém, são as costuras: um vinco escuro em cada encontro de peça, mais largo do lado da sombra do que do lado do sol, com um fio claro na quina iluminada. É o vale entre os pontões e a tampa do motor, e o lábio escuro no contorno do pontão, que fazem o meio do carro deixar de ser uma chapa.

`src/game/carSprites.ts` assa esse molde numa folha de sprites, uma tira de nove quadros de esterço, e o laço de corrida escolhe o quadro e faz um `drawImage`. O que varia continuamente — posição, escala com a distância, inclinação da carroceria, trepidação e brilho do boost — fica para a hora do desenho. A garagem e o lobby usam o SVG do mesmo molde, que amplia sem perder nada.

A meia-largura do pneu traseiro é `CAR_SPRITE_HALF_WIDTH`, e um teste cobra isso: o carro ocupa na tela exatamente a largura que a regra de saída de pista cobra. O rival usa a mesma folha, banhada de azul, e nunca se confunde com o carro do próprio jogador.

As artes raster em `arte/carros` ficam como material de referência das marcas de cada equipe; nada no jogo as lê. Para acrescentar uma pintura, registre o carro em `CARS` e a pintura dele em `PINTURAS`.

A escolha é só de pintura. Todos os carros andam com a mesma física: o duelo mede quem dirige melhor, e um carro mais rápido decidiria a corrida antes da largada.

### Cenário

Árvore, arbusto, capim, placa e marcador de distância são descritos em `src/game/cenarioModel.ts` com o mesmo pincel do carro — `src/game/pincel.ts` — e a mesma regra de luz de `src/game/paleta.ts`: rampa de cinco tons que desliza com a luminância, luz sempre de cima e da esquerda, vinco escuro em cada encontro de peça. `src/game/cenarioSprites.ts` assa todos numa folha só, durante a contagem de largada, e o laço de quadro desenha cada objeto com um `drawImage`.

A intuição sobre o que assar estava invertida, e vale registrar: parecia que a folha servia para o campo distante, onde há muitos objetos pequenos, e que o objeto colado na câmera deveria ser desenhado ao vivo para não borrar. É o contrário. Objeto pequeno custa **chamadas**; objeto grande custa **área escrita**. Uma árvore de setecentos pixels com trinta faces escreve mais pixels do que todas as faixas de grama da pista somadas; esticada de uma célula de 256, escreve um terço disso. A folha é o caminho rápido justamente para o que está perto — e o borrão ali custa pouco, porque a sessenta metros por segundo um objeto a cinco metros atravessa a tela em seis quadros.

A **cerca** continua procedural, por motivo estrutural: as travessas de vagas vizinhas precisam se encontrar, e isso depende das projeções das duas vagas — assada por vaga, viraria uma fila de portõezinhos soltos. Os obstáculos que ficam deitados no asfalto também, pelo motivo contrário: a folha descreve cada objeto numa caixa com o chão em zero e o topo em menos um, e essa caixa não descreve uma peça sem altura.

Nenhuma face do cenário pode ser translúcida, e isso é teste. Quem desenha aplica a névoa da distância com `globalAlpha`: face a face isso dá uma cor, e aplicado ao objeto já composto na folha, dá outra — o objeto mudaria de cor ao trocar de nível de detalhe. Pela mesma razão a sombra no chão fica **fora** do sprite, desenhada ao vivo. Ela é o detalhe mais barato do cenário e o que mais rende: sem ela, tudo o que fica na beira da pista paira alguns pixels acima da grama.

### Os quatro lugares

Até aqui os quatro ambientes trocavam só a cor do céu, da serra e da grama: a diferença entre eles era de hora do dia, não de lugar. Agora cada um tem o próprio repertório de objetos, que é o que Top Gear fazia trocando de país a cada etapa — a mesma pista parece outra com outra coisa na beira.

| Ambiente | Lugar | O que aparece na beira |
| --- | --- | --- |
| entardecer | campo | árvore, arbusto, cerca, bandeira, arquibancada |
| manhã | cidade | prédio, poste de luz, guardrail, pilha de pneus, arquibancada |
| meio-dia | montanha | pinheiro, rocha, guardrail, pilha de pneus |
| travessia seca | deserto | cacto, rocha, cerca, capim |

Os quatro conjuntos têm o mesmo número de entradas de propósito. O índice do trecho é sorteado sobre o tamanho da lista, então listas de tamanhos diferentes fariam a estrutura do traçado — onde estão os trechos densos, onde estão as pausas — mudar junto com o lugar. Assim só muda o que aparece.

Três números estavam embutidos e impediam acrescentar família. `FAMILIES.length` era índice, então somar uma entrada mudava a família de toda região em toda semente; a variante vinha de um `* 3` que só funcionava porque três vetores de cor tinham exatamente três entradas; e a supressão de vizinho tinha dois nomes de família escritos à mão. Hoje a variante sorteada é `VARIANTES_SORTEADAS` e quem desenha a reduz ao repertório da própria família, e a supressão sai de uma tabela de estorvo — duas famílias só convivem lado a lado se couberem juntas na soma. A mesma tabela afasta da pista o que é largo: um prédio na beira do asfalto tapa a curva, o mesmo prédio um pouco atrás compõe o fundo.

Cerca e guardrail seguem procedurais, e pelo mesmo motivo: são contínuos, e o vão de cada vaga cobre metade do espaçamento para os dois lados para as travessas se encontrarem. Isso depende das projeções de duas vagas vizinhas, que diferem — assados numa célula por vaga, virariam uma fila de portõezinhos soltos.

Os canais de `randomAt` agora estão listados no cabeçalho de `layout.ts`. Reusar um por engano faz duas decisões independentes andarem juntas: um defeito que não quebra nada, não aparece em teste, e só deixa a pista estranhamente regular.

### Pórticos e chegada

Os arcos sobre a pista caem a cada dezesseis vagas de cenário — noventa e seis metros —, e nem todo marco recebe um: em fila certinha o pórtico vira placa de quilometragem em vez de marco. São **decoração e só**; se colidissem, o layout competitivo passaria a depender da semente e cairia a garantia de que os dois pilotos correm a mesma prova.

Eles são emitidos de **dentro** do laço do cenário, e não num passe à parte. A copa de uma árvore a quarenta metros se debruça sobre a pista, e um arco a oitenta desenhado depois passaria por cima dela.

O pórtico continua procedural, junto com cerca e guardrail: ele acompanha a largura do asfalto, chega a dois mil pixels de dispositivo e não caberia em célula nenhuma — e é barato, uma dúzia de preenchimentos.

O pórtico vive e morre com a vaga em que está, como qualquer outro objeto da beira da pista. Houve uma versão que o fazia subir e se dissolver ao chegar perto, para ele não sumir de um quadro para o outro quando a câmera o alcança — `roadProjection` faz `Math.max(0, distanceAhead)`, então nada cresce além do tamanho que tem em `ahead = 0`. O remédio se via mais que a doença, e saiu.

A linha de chegada era doze células num retângulo de cinco pixels de altura: a superfície mais pobre do jogo, no momento que mais importa dele. Agora são duas fileiras de quadriculado com espessura no asfalto e o pórtico quadriculado por cima.

### Faixa de meio-campo

Entre a serra e a grama corre uma faixa própria de cada lugar: linha de mata no campo, silhueta de prédios na cidade, cumeada de rocha na montanha, dunas no deserto. Sem ela a montanha encostava direto na grama e a distância entre as duas virava um salto.

É uma tira assada uma vez e desenhada como padrão que se repete, então custa um preenchimento por quadro. A tira emenda consigo mesma porque toda silhueta que cruza a borda direita é repetida do outro lado — sem isso, a repetição mostra uma costura vertical atravessando o horizonte a cada volta.

Ela corre mais depressa que a serra e mais devagar que as árvores da beira da pista, e é essa diferença de velocidade que dá a leitura de camadas. O sorteio da tira não usa a semente da corrida: é decoração de horizonte, igual para todo mundo que correr naquele lugar.

`banca.html` é a bancada de desenvolvimento: abre com `npm run dev` em `/banca.html` e mostra toda a folha em três tamanhos, os cinco obstáculos em cinco tamanhos, a poça nos quatro ambientes, uma tira de pórticos de cento e vinte metros até a vaga em que são cortados, as quatro faixas de fundo e o carro em seis poses; no rodapé, o tempo de assar e o tamanho da folha. `?familia=tree` isola uma família, `?flora=seca` troca a paleta. Não entra na build. Ela não precisa do servidor da partida, então a entrada `bancada` de `.claude/launch.json` sobe só o Vite, na porta 5174 — útil quando outra sessão já está com a 5173.

O fundo tem duas cordilheiras, a de trás já lavada pela cor do céu, e cada uma é desenhada duas vezes com a mesma crista deslocada: o que sobra entre as duas é a lasca acesa na encosta voltada para o sol. Nuvens, o halo do sol em três degraus de opacidade e as rajadas de velocidade do boost completam o fundo. Tudo isso junto custa 0,4 ms por quadro.

O que está longe recebe só a silhueta. Detalhe no horizonte vira ruído, e quem manda ali é a névoa.

### Obstáculos

Barreira e cone saem da folha, como o resto do cenário. Eram os últimos desenhos ao vivo de pé sobre o chão, e os únicos fora do banho de névoa da folha: em cor cheia, apareciam recortados de outra cena à medida que a pista escurecia. A barreira tem duas pinturas, de galões e de blocos, e a variante sai do identificador do obstáculo — que é literal em `track.ts`, então os dois pilotos veem a mesma barreira no mesmo lugar. Buraco, óleo e poça seguem procedurais, deitados no asfalto.

Medir o cone pixel a pixel revelou um defeito que era de todo o cenário, desde que a folha existe: as células estavam encostadas umas nas outras, e o `drawImage` de um objeto de perto, que amplia, lia meio texel além do retângulo pedido e trazia junto a primeira coluna da vizinha. Aparecia como um risco de cor estranha na borda de cada objeto. Hoje há dois pixels de folga em volta de cada célula. O empacotamento também passou a preencher a sobra de cada prateleira em vez de deixá-la vazia, e a folha — já com as duas famílias novas e a folga — caiu de 8,3 para 7,8 MB, e de 9 para 6,6 ms de assar.

**Óleo e poça** são o perfil oposto ao da barreira: largos (0,34 e 0,30 de meia-largura de colisão, contra 0,25) e baratos (40% e 30% da penalidade). Dá para atravessar de propósito em vez de jogar o carro na grama para desviar, que é a decisão que a barreira nunca oferece. A água da poça é o céu do lugar, então ela muda com a etapa sem saber que etapa é.

Onde eles cabem não foi escolha de gosto. O campo do profissional já estava saturado: 38 obstáculos em 4 800 m, um único vão maior que 150 m e 0,628 s de folga no desvio mais apertado, contra o piso de 0,5 s cobrado em `rules.test.ts`. Cortar um vão típico de 110 m ao meio exige que a peça nova fique a menos de 0,324 de faixa das **duas** vizinhas, que costumam estar a meia pista uma da outra. Sobraram três lugares que não tocam naquela folga — os 510 m de abertura, a fresta logo depois do primeiro obstáculo e o vão largo da reta final —, e entraram quatro manchas. Que três caiam nos primeiros 600 m é feliz por acidente: são as ameaças baratas do jogo, e a largada é onde o piloto aprende o que elas são sem pagar por isso.

### O carro na pista

A sombra do carro saiu da folha. A folha inteira inclina com o volante e é deslocada pela suspensão e pela trepidação, e a sombra assada ia junto — uma sombra que rola com a carroceria não é sombra, é adesivo. Desenhada ao vivo, ela fica no chão e reage só à altura: fecha e escurece quando o carro afunda, abre e clareia quando ele fica leve, no topo de uma lomba ou no quadro da batida. A sombra de cada pneu é a exceção, e vai atrás dele: neste desenho a rolagem gira o quadro inteiro, rodas inclusive, em torno da linha do chão, e a roda da frente está sessenta unidades acima desse pivô — no esterço máximo ela anda nove para o lado, e uma sombra parada ali ficava sozinha no asfalto.

Depois de uma passagem pela grama o carro fica sujo. A sujeira é o único sinal assimétrico de `feel.ts`: chega perto do máximo em menos de um segundo de grama e leva uns vinte segundos de asfalto para sair. São manchas de respingo, e não um véu sobre a carroceria — barro atirado por pneu tem borda, e um véu uniforme leria como o carro ter mudado de cor. As posições saem de onde o barro de cada eixo cai de fato, e um teste cobra que toda mancha fique sobre o carro: a primeira versão punha terra ao lado da roda dianteira, e num carro de roda descoberta ali só há braço de suspensão e ar.

A suspensão responde ao relevo — à **mudança** de inclinação, que é o que carrega o carro: o fundo de uma depressão comprime, a crista alivia. Jogar o volante depressa rola a carroceria um pouco além do ponto antes de ela assentar, e o carro no limite de aderência vibra, numa frequência mais alta e menor que a da grama e a da batida. Cada partícula passou a ter a própria cor e o próprio giro: a poeira sobe da cor do chão de cada lugar, e as faíscas giram em vez de saírem todas alinhadas à tela, como confete.

## Testes

```bash
npm test
```

A suíte cobre a física da corrida, a sequência das cinco luzes, a estimativa de relógio, a interpolação do fantasma, as regras das salas e testes de integração que sobem o servidor real e conectam dois clientes Socket.IO — inclusive medindo o erro do fantasma com pacotes atrasados e perdidos.

Três testes merecem destaque:

- **A prova cabe entre 60 e 90 segundos em qualquer semente e qualquer nível**,
  com a curva ativa e no ritmo de quem corrige só na borda do asfalto. Desde que
  o traçado é sorteado por corrida e a curva cobra tempo, é este teste que
  impede uma pista sorteada de estourar a janela do plano.
- **A curva desloca o carro de onde o piloto aponta**, medido pelo desvio médio
  em cinco sementes contra a mesma prova em pista reta. Não se mede isso pelo
  tempo: quem só segura o meio tem esterço sobrando e corrige quase de graça —
  a força cobra margem de comando, não segundos. Se este teste parar de valer, a
  curva voltou a ser enfeite.
- **O ritmo do fantasma na tela nunca passa da velocidade real do rival**, com
  rede boa, com pacotes fora de ordem e com perdas. A medição é em metros por
  segundo, e não metros por amostra, porque `setInterval` não entrega intervalos
  constantes — medir por amostra transformava atraso do temporizador em "salto
  do fantasma", e reprovava o teste em uma execução a cada três sem nada de
  errado com o fantasma.

O roteiro da apresentação é um teste de aceitação à parte, que percorre a demonstração inteira — dois pilotos na mesma sala, largada, corrida com a física real, fantasma, resultado e revanche:

```bash
npx vitest run server/demonstracao.test.ts
```

### Piloto virtual

Para testar o fantasma sem um segundo aparelho, entre em uma sala pelo navegador e rode:

```bash
npm run piloto -- CODIGO --nome Rival --velocidade 250 --carro schumacher
```

Ele entra na sala como segundo jogador, confirma presença, corre no ritmo pedido e envia telemetria pelo mesmo protocolo do navegador. Sem `--carro`, corre com a Red Bull, diferente do carro padrão do navegador, para o fantasma mostrar a pintura do rival.

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

O rival não tem colisão: os carros se atravessam. Mas ele não é só desenho — a posição dele entra na simulação por um caminho só, e estreito: a força do vácuo, um número de 0 a 1 calculado da distância e do alinhamento. É isso que `stepRace` recebe do adversário, e nada mais. Ele não pode empurrar, frear nem desviar o carro do jogador; só permitir que quem vem atrás ande um pouco mais rápido.

## Quem decide o vencedor

O cliente avisa a própria chegada, mas quem decide é o servidor. Ele conhece o instante oficial da largada e o comprimento da pista, então prende o tempo informado entre o mínimo fisicamente possível — a pista inteira na velocidade máxima do carro — e o tempo já decorrido desde a largada. Um relógio errado ou um cliente adulterado não conseguem reivindicar uma volta impossível.

Quando os dois pilotos têm um desfecho, o servidor monta o resultado uma única vez e envia o mesmo objeto para as duas telas: vencedor, tempos, diferença e posições. Se um piloto cair e não voltar dentro da janela de retorno, o adversário vence por abandono e a vaga é liberada.

A revanche precisa dos dois pedidos. Com os dois, a sala limpa telemetria e resultado e agenda uma nova largada sincronizada, sem ninguém recarregar a página.

## Estado atual

- [x] Fluxo menu → largada → corrida → resultado → nova tentativa
- [x] Pista pseudo-3D e aceleração automática
- [x] Controles por teclado e toque
- [x] Limites da pista, obstáculos e penalidades
- [x] Boost com consumo, recarga e bloqueio ao esgotar
- [x] Cronômetro, velocidade e progresso
- [x] Cinco luzes de largada e áudio procedural básico
- [x] Poeira, faíscas, rastro de boost e marcas de pneu, com teto de partículas
- [x] Cenário assado em folha de sprites, com quatro lugares, pórticos e faixa de meio-campo
- [x] Cinco tipos de obstáculo, dois deles manchas que valem a pena atravessar
- [x] Sombra no chão, terra da grama e suspensão que responde ao relevo
- [x] Salas para dois jogadores com código, link e QR code
- [x] Lobby em tempo real, confirmação e tratamento de sala cheia/inexistente
- [x] Relógio sincronizado entre cliente e servidor
- [x] Largada agendada e idêntica nos dois aparelhos
- [x] Cancelamento da largada por desistência, saída ou queda de conexão
- [x] Reconexão curta e retorno após recarregar a página
- [x] Telemetria validada pelo servidor e repassada ao adversário
- [x] Carro fantasma interpolado, translúcido e em cor distinta
- [x] Posição P1/P2, diferença em segundos e metros, indicador de rival fora da tela
- [x] Chegada validada pelo servidor, com tempo impossível recusado
- [x] Mesmo vencedor, tempos e diferença nas duas telas
- [x] Vitória por abandono quando o rival não volta
- [x] Revanche na mesma sala, sem recarregar a página
- [x] Publicação em processo único, com Dockerfile e endereços da rede local
- [x] Sala de demonstração que se cria sozinha
- [x] Fontes servidas pelo projeto, sem depender de internet
- [x] Garagem com cinco carros: a escolha vale no treino e no duelo, e o fantasma usa a pintura do rival
- [x] QR code definitivo e roteiro do workshop

## Limitações conhecidas

- Em uma aba fora de primeiro plano o navegador pausa a animação: o relógio da corrida continua correto, mas o carro não anda enquanto a aba estiver escondida. A telemetria continua sendo enviada por temporizador, então o rival vê o fantasma parado na posição real, em vez de perdê-lo de vista.
