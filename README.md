# Corrida Fantasma

Protótipo jogável do plano em `PLANO_DESENVOLVIMENTO.md`: corrida offline, lobby multiplayer para até seis pilotos, largada sincronizada, um carro fantasma para cada rival e resultado oficial com revanche.

## Como se dirige

A aceleração é automática. O piloto controla **direção** e **boost** — e há três
coisas disputando esse único comando.

**A curva empurra, e quem segura o volante a faz.** A curvatura vem do traçado
sorteado para a corrida, a mesma que está sendo desenhada na tela, e entra na
física como força lateral: cresce com o quadrado da velocidade e só desloca o
carro no que passa da aderência do pneu. A calibração segue a regra de Top Gear:
em cruzeiro, segurar o volante para o lado da curva sempre mantém o carro na
linha — o desafio é a linha e o boost, e não uma curva que não se consegue fazer.

| Nível | Aderência | Pior curva comum pede do volante | Grampo pede do volante |
| --- | --- | --- | --- |
| Normal | 0,18 | 72% em cruzeiro · **151%** de boost | 93% em cruzeiro · **192%** de boost |
| Difícil | 0,15 | 72% em cruzeiro · 146% de boost | 94% em cruzeiro · 186% de boost |
| Profissional | 0,12 | 73% em cruzeiro · 143% de boost | 94% em cruzeiro · 181% de boost |

Passar de 100% significa que ali o carro escapa mesmo com o volante todo virado, e
é só de boost que isso acontece: **de boost, o motor manda às rodas mais força do
que o pneu segura de lado**, e a carga da curva cresce 30%. É a lição do nitro de
Top Gear — na reta ele é a arma; na curva, o jeito mais rápido de ir para a grama.
O pneu que escapa também esfrega velocidade, mas pouco: quem faz a linha perde uns
5% numa super curva.

O volante tem inércia de um décimo de segundo, e castiga só o **zigue-zague**: o
volante indo de um lado para o outro. Pulsar o mesmo lado — que é como se segura
uma curva com tecla ou toque, onde não existe meio volante — não custa nada.

**Por dentro é mais curto.** Numa curva de raio R, a linha a n metros do centro
tem raio R − n: quem vai por dentro avança na pista mais depressa na mesma
velocidade, e quem vai por fora, mais devagar. Pela mesma conta, por dentro a
curva empurra mais. É a escolha de toda curva de verdade, e pseudo-3D nenhum da
linhagem de Top Gear e Horizon Chase a fazia: neles o carro avança pela linha
central esteja onde estiver. O ganho nunca faz o carro passar do teto do nível, que
é o que o servidor usa para o tempo mínimo da prova.

**As super curvas.** Toda prova tem quatro, uma de cada tipo, em ordem e lado
sorteados pela semente, todas com raio de 21 a 27 m no ápice:

| Tipo | Virada | Pista | Carga no ápice |
| --- | --- | --- | --- |
| Cotovelo | 90° | 64 m | 2,27× a pior curva comum |
| Grampo | 180° | 100 m | 2,72× — o mais fechado |
| Caracol | 270° | 165 m | 2,53×, e dura o dobro |
| S | 100° + 100°, emendadas | 2 × 64 m | 2,45× em cada metade |

Elas empurram um quarto a mais que a pior curva comum: em cruzeiro, pedem
quase o volante todo, e de boost jogam o carro para fora. O que decide a curva é
a linha:

- **A nota de curva avisa** 280 m antes, do lado para onde a pista vai, como o
  copiloto de rali: nome, ângulo, distância e o que fazer (*SOLTE O BOOST*,
  *ENTRE POR DENTRO*, *SEGURE*). No S ela mostra as duas setas e, passado o ápice
  da primeira metade, já fala da segunda.
- **A tangência mora no ápice**, no meio da curva, na faixa âmbar da zebra de
  dentro: entre por dentro e segure a zebra até ali. Por dentro a curva empurra
  mais, porque o raio é menor, e é isso que a faz valer: devolve 22% de boost,
  uma vez por curva, e a linha de dentro é a mais curta. O S tem uma tangência
  só, a da primeira metade — para tangenciar as duas, o carro teria de largar o
  lado de dentro antes do primeiro ápice.
- **Por fora de cada super curva há um muro de pneus**, a 70 cm do asfalto.
  Encostar nele é batida: conta para o reset, derruba a velocidade, solta faísca,
  e colado nele o carro continua raspando velocidade. Quem segura o volante nunca
  chega lá; quem não vira, ou entra de boost e corrige tarde, chega.
- Medido com os pilotos de teste no normal: quem faz a tangência chega de 0,6 a
  1,4 s antes de quem entra pelo meio, e ninguém que segura o volante vai para a
  grama. Quem não vira na super curva bate no muro em toda semente e perde de 8 a
  10 s. O iniciante termina dentro da janela de 60 a 90 s em todos os níveis.

A pista relida a cada passo fixo, e não uma vez por quadro, garante que a super
curva chegue na mesma hora para aparelhos de 60, 30 e 20 quadros por segundo. O
traçado põe o miolo de cada uma, e o lado de dentro da entrada, longe dos
obstáculos que todos os níveis têm.

**Para desenhar a volta, a câmera virou de verdade.** Ela ficava presa ao eixo do
mundo, e era isso que limitava as curvas a 24°. Agora a pista é desenhada no
referencial do carro, e a paisagem gira com o rumo dele. E o desenho exagera: nas
super curvas a pista na tela vira uma vez e meia o que a física vira, chicoteando
para fora da tela, e a paisagem gira junto — o caracol passa o céu inteiro diante
do carro mais de uma vez. O horizonte inclina para dentro da curva na proporção da
força lateral — três graus na pior curva comum, quatro num grampo, oito de boost —, e o
carro deita com ela. O muro é uma parede contínua de pneus vermelhos e brancos com
as placas de seta em cima, e o pneu que passa da carga da pior curva comum solta
fumaça.

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

`npm run dev:paralelo` sobe o mesmo par nas portas 5175 e 3002, para quando outra cópia do projeto — outra worktree, outra sessão — já está com a 5173 e a 3001. É o que a entrada `corrida-fantasma` de `.claude/launch.json` usa.

## Publicar

Em produção é **um processo só**: o mesmo servidor entrega o site e aceita as conexões WebSocket.

```bash
npm ci && npm run build && npm start
```

O servidor escuta em `0.0.0.0` e imprime os endereços da máquina na rede local, para acessar pelo celular. Há um `Dockerfile` pronto para hospedagens que aceitem contêiner.

O estado das salas vive na memória, então precisa ser **uma instância só** — duas separariam os pilotos de uma mesma sala.

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

A pintura de cada carro é uma arte em `public/carros`, gerada por `npm run carros` a partir dos originais em `arte/carros`. É a mesma imagem no menu, na seleção de pilotos, no lobby, no resultado e na pista.

Na pista, `src/game/carSprites.ts` assa a arte numa folha de sprites de quinze quadros durante a contagem de largada, e o laço de corrida escolhe o quadro e faz um `drawImage`. O que varia continuamente — posição, escala com a distância, inclinação da carroceria, trepidação e brilho do boost — fica para a hora do desenho.

Os quadros são poses de um eixo só, da derrapagem toda à esquerda à derrapagem toda à direita:

- **Curva comum**: nove quadros, do volante todo virado para um lado ao outro. As rodas da frente esterçam, a carroceria rola e o carro **gira no próprio eixo** até 7°.
- **Derrapagem**: três quadros de cada lado. O carro atravessa até 13°, a traseira escapa para fora da curva e as rodas da frente **contraesterçam** — o desenho clássico do carro seguro no limite.

A arte é uma imagem chapada, e o giro não é um recorte girado. As rodas da frente saem da carroceria para esterçar sozinhas, e a carroceria é cisalhada: cada linha do desenho desliza de lado na proporção da distância dela ao pivô, pouco à frente do eixo traseiro, que é o que a projeção faria com o carro girado de verdade. O cisalhamento é calibrado para os dois eixos andarem exatamente o que as rodas andam, então a sombra, a banda do pneu e a terra da grama continuam no lugar em qualquer quadro.

A pose sai da física: o esterço é o do volante, e a derrapagem começa pouco antes da carga da pior curva comum — nas super curvas o carro atravessa, e de boost ele vai todo de lado. Ela entra em pouco mais de um décimo de segundo e sai em quase três, e é essa inércia que faz a troca de quadros virar movimento: na entrada de um grampo o carro vira, atravessa, escorrega e endireita. Cada rival derrapa pela mesma conta, com a curva de onde ele está e a velocidade que informou.

A meia-largura do pneu traseiro é `CAR_SPRITE_HALF_WIDTH`, e um teste cobra isso: o carro ocupa na tela exatamente a largura que a regra de saída de pista cobra. Cada rival usa a folha do próprio carro, banhada de azul, e nunca se confunde com o carro do jogador — nem quando os dois escolhem o mesmo.

#### O molde vetorial

`src/game/carModel.ts` descreve o mesmo carro com as formas cheias e as cores chapadas do cenário, e tem dois papéis. É dele que sai a geometria do giro — a profundidade de cada peça, o centro das rodas e a linha do chão —, e é ele que a corrida desenha enquanto a arte não chega, ou se ela não chegar: o jogo nunca espera um arquivo para largar. A pintura de reserva de cada carro, em `PINTURAS`, segue as cores da arte dele.

Cada ponto do molde é dado em metros e projetado por uma câmera de teleobjetiva, alta e distante, a mesma de Top Gear e Horizon Chase. A altura entra achatada de propósito, na convenção do desenho de corrida visto de cima: sem isso o capacete subiria até a altura do bico e o carro perderia o empilhamento que o faz ler como carro. Nenhum volume usa degradê; todos são resolvidos em faixas de cor chapada, com um vinco escuro em cada encontro de peça e um fio claro na quina iluminada.

Para acrescentar um carro, ponha a arte em `arte/carros`, rode `npm run carros`, registre o carro em `CARS` e a pintura de reserva dele em `PINTURAS`.

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

`banca.html` é a bancada de desenvolvimento: abre com `npm run dev` em `/banca.html` e mostra toda a folha em três tamanhos, os obstáculos numa pista com a régua antiga e a nova lado a lado, os cinco obstáculos em cinco tamanhos, a poça nos quatro ambientes, uma tira de pórticos de cento e vinte metros até a vaga em que são cortados, as quatro faixas de fundo e o carro em seis poses; no rodapé, o tempo de assar e o tamanho da folha. `?familia=tree` isola uma família, `?flora=seca` troca a paleta. Não entra na build. Ela não precisa do servidor da partida, então a entrada `bancada` de `.claude/launch.json` sobe só o Vite, na porta 5174 — útil quando outra sessão já está com a 5173.

O fundo tem duas cordilheiras, a de trás já lavada pela cor do céu, e cada uma é desenhada duas vezes com a mesma crista deslocada: o que sobra entre as duas é a lasca acesa na encosta voltada para o sol. Nuvens, o halo do sol em três degraus de opacidade e as rajadas de velocidade do boost completam o fundo. Tudo isso junto custa 0,4 ms por quadro.

O que está longe recebe só a silhueta. Detalhe no horizonte vira ruído, e quem manda ali é a névoa.

### Obstáculos

Todo obstáculo mede uma fração da largura da pista **naquela distância** — a mesma régua de perspectiva do asfalto, do cenário e do fantasma. Antes ele tinha régua própria, uma curva quase linear na distância: a pista encolhe com `1/z` e o obstáculo encolhia bem menos, e a cem metros uma barreira cobria dois terços do asfalto que, na altura do carro, ela cobre um quinto. Chegava enorme e ia "diminuindo para dentro" da pista conforme se aproximava, e é daí que vinha a impressão de peça colada por cima dela. Na altura do carro nada mudou — ali a colisão foi calibrada contra o desenho, e um teste cobra que o tamanho continue o de antes.

As peças deitadas — buraco, óleo e poça — têm comprimento em metros ao longo da pista, e as duas bordas passam pela mesma projeção que desenha as faixas de doze metros do asfalto. É o que as deita: antes tinham proporção fixa entre altura e largura e, ao longe, ficavam de pé como discos. A perspectiva de verdade, porém, achata um buraco a cinquenta metros até um pixel e meio, e encostado na zebra ele sumia — o que não pode acontecer com a peça que fecha a beirada da pista. Então, dali em diante, o achatamento para em 14% e a peça fica um traço deitado que ainda se lê. `banca.html` mostra a mesma cena com as duas réguas, lado a lado.

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

Ele entra na sala como mais um piloto, confirma presença, corre no ritmo pedido e envia telemetria pelo mesmo protocolo do navegador. Sem `--carro`, corre com a Red Bull, diferente do carro padrão do navegador, para o fantasma mostrar a pintura do rival. Para encher o grid, rode um por vaga, cada um com o próprio `--nome` e `--carro`.

## Controles

- `A` / `D` ou setas: direção
- `Espaço`: boost
- Celular: botões de direção e boost na tela
- **SOM** liga e desliga todo o áudio; **MÚSICA** liga e desliga só a trilha, e as duas escolhas ficam guardadas na aba

### Trilha sonora

Rock de corrida, gerado na hora como o resto do som — sem arquivo nenhum. `src/game/trilha.ts` guarda a composição como partitura, testada sem navegador, e a sintetiza pelo mesmo contexto de áudio do motor:

- Mi menor, 150 batidas por minuto, em quatro seções de oito compassos: **estrofe** com a guitarra abafada em galope, **refrão** com acordes soltos e a guitarra solo por cima, **estrofe** de novo e **ponte** com o bumbo nos quatro tempos até a virada de caixa que devolve ao começo. São 51 segundos, e a trilha dá a volta.
- Bateria de seno e ruído filtrado, baixo em serra, power chords de seis serras desafinadas somadas antes de uma saturação e de uma caixa de som simulada, e a guitarra solo com vibrato e eco.
- Entra no "VAI!" com o prato do primeiro compasso — online, a mesma largada em todos os aparelhos — e some aos poucos na bandeirada. Fica sob o motor, que é retorno de jogo.
- As notas são agendadas pouco adiante, no relógio do áudio, e não no de animação: a música não atrasa quando o quadro engasga. Renderizada fora de tempo real, a trilha inteira custa cerca de 8% de um núcleo de computador de mesa.

## Como a largada é sincronizada

1. Cada cliente mede a diferença entre o próprio relógio e o do servidor com cinco amostras de ida e volta e fica com a de menor latência.
2. Quando todos os pilotos da sala — de dois a seis — confirmam, o servidor escolhe um instante futuro comum (`startAt`, 5,4 s à frente) e envia o mesmo valor para todos.
3. Cada cliente converte `startAt` em luzes: cinco acendem uma a uma, com 900 ms de intervalo, e todas apagam exatamente em `startAt`.
4. O cronômetro da corrida é contado a partir de `startAt`, e não do quadro em que a tela abriu, então todos medem o mesmo tempo.

## Como o fantasma funciona

Cada navegador envia dez medições por segundo (progresso, faixa, velocidade e estado). O servidor valida — recusa pacotes atrasados, corrige horários incoerentes e limita avanços impossíveis — e repassa aos outros pilotos da sala.

Quem recebe guarda as medições recentes de cada rival e desenha cada um 160 ms no passado, interpolando entre duas medições conhecidas. Se a telemetria falhar, projeta o movimento por até 600 ms e então congela o carro, marcando-o como sem sinal. O progresso exibido nunca recua, então um pacote atrasado não puxa o fantasma para trás.

O rival não tem colisão: os carros se atravessam. Mas ele não é só desenho — a posição dele entra na simulação por um caminho só, e estreito: a força do vácuo, um número de 0 a 1 calculado da distância e do alinhamento. É isso que `stepRace` recebe dos rivais — o melhor vácuo entre todos —, e nada mais. Ele não pode empurrar, frear nem desviar o carro do jogador; só permitir que quem vem atrás ande um pouco mais rápido.

## Quem decide o vencedor

O cliente avisa a própria chegada, mas quem decide é o servidor. Ele conhece o instante oficial da largada e o comprimento da pista, então prende o tempo informado entre o mínimo fisicamente possível — a pista inteira na velocidade máxima do carro — e o tempo já decorrido desde a largada. Um relógio errado ou um cliente adulterado não conseguem reivindicar uma volta impossível.

Quando todos os pilotos têm um desfecho, o servidor monta o resultado uma única vez e envia o mesmo objeto para todas as telas: vencedor, tempos, diferença e posições. Num duelo, quem cai e não volta dentro da janela de retorno entrega a vitória por abandono; com três ou mais, os outros seguem correndo e o abandono ocupa a posição dele no resultado.

A revanche precisa do pedido de todos. Com eles, a sala limpa telemetria e resultado e agenda uma nova largada sincronizada, sem ninguém recarregar a página. Com a corrida em andamento, a sala não aceita piloto novo.

## Estado atual

- [x] Fluxo menu → largada → corrida → resultado → nova tentativa
- [x] Pista pseudo-3D e aceleração automática
- [x] Super curvas de 90° a 270° e S emendado, com nota de curva, tangência no ápice, muro de pneus e câmera no referencial do carro
- [x] Curvas calibradas pela regra de Top Gear: quem segura o volante faz a curva; de boost, ela joga o carro para fora
- [x] Reset depois de três batidas ou de tempo demais fora da pista
- [x] Controles por teclado e toque
- [x] Limites da pista, obstáculos e penalidades
- [x] Boost com consumo, recarga e bloqueio ao esgotar
- [x] Cronômetro, velocidade e progresso
- [x] Cinco luzes de largada e áudio procedural básico
- [x] Poeira, faíscas, rastro de boost e marcas de pneu, com teto de partículas
- [x] Cenário assado em folha de sprites, com quatro lugares, pórticos e faixa de meio-campo
- [x] Cinco tipos de obstáculo, dois deles manchas que valem a pena atravessar
- [x] Sombra no chão, terra da grama e suspensão que responde ao relevo
- [x] Salas de dois a seis pilotos com código, link e QR code
- [x] Lobby em tempo real, confirmação e tratamento de sala cheia/inexistente
- [x] Relógio sincronizado entre cliente e servidor
- [x] Largada agendada e idêntica em todos os aparelhos
- [x] Cancelamento da largada por desistência, saída ou queda de conexão
- [x] Reconexão curta e retorno após recarregar a página
- [x] Telemetria validada pelo servidor e repassada aos outros pilotos
- [x] Um fantasma por rival, interpolado, translúcido, em cor distinta e na ordem de profundidade da pista
- [x] Posição no grid, diferença para o rival mais perto em segundos e metros, indicador de rival fora da tela
- [x] Chegada validada pelo servidor, com tempo impossível recusado
- [x] Mesmo vencedor, tempos e diferença em todas as telas
- [x] Vitória por abandono no duelo; com mais pilotos, o abandono entra na classificação
- [x] Revanche na mesma sala, sem recarregar a página
- [x] Publicação em processo único, com Dockerfile e endereços da rede local
- [x] Sala de demonstração que se cria sozinha
- [x] Fontes servidas pelo projeto, sem depender de internet
- [x] Garagem com dezesseis carros em arte própria, agrupados por piloto: a escolha vale no treino e online, e cada fantasma usa a pintura do rival
- [x] Quadros de curva e de derrapagem com contraesterço, assados da arte de cada carro, com transição guiada pela física da curva
- [x] Trilha sonora de rock procedural, com botão próprio
- [x] QR code definitivo e roteiro do workshop

## Limitações conhecidas

- Em uma aba fora de primeiro plano o navegador pausa a animação: o relógio da corrida continua correto, mas o carro não anda enquanto a aba estiver escondida. A telemetria continua sendo enviada por temporizador, então o rival vê o fantasma parado na posição real, em vez de perdê-lo de vista.
