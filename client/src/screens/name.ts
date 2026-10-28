// Tela 1: landing page in WATT Arena's layout (apps/web/app/page.tsx), with the
// commander-name form in the hero and a live proof-layer section so the
// blockchain record is visible from the very first screen.

import { t } from '../i18n';
import { L, fmt, h, shortHash } from '../shell/kit';
import { chainState, onChain, refreshChain } from '../shell/data';
import type { PageId } from '../shell/pages';

export interface NameScreenDeps {
  onEnter: (name: string) => void;
  initialName?: string; // nome salvo (localStorage) p/ pré-preencher após refresh
  onOpenPage: (page: PageId) => void;
}

export class NameScreen {
  readonly el: HTMLElement;
  private input!: HTMLInputElement;
  private status!: HTMLElement;
  private live: { pill: HTMLElement; stats: HTMLElement; proof: HTMLElement; world: HTMLElement } | null = null;
  private poll: number | null = null;

  constructor(private deps: NameScreenDeps) {
    this.el = h('div', 'screen entry-screen wattApp');
    this.build(deps.initialName ?? '');
    onChain(() => this.paintLive());
  }

  private link(label: string, page: PageId, cls = ''): HTMLElement {
    const a = h('a', { href: '#', class: cls }, label);
    a.addEventListener('click', (e) => { e.preventDefault(); this.deps.onOpenPage(page); });
    return a;
  }

  private build(name: string): void {
    this.el.innerHTML = '';
    const enterTop = h('a', { href: '#', class: 'button small' }, L('Enter the world', 'Entrar no mundo', 'Entrar al mundo'));
    enterTop.addEventListener('click', (e) => { e.preventDefault(); this.focus(); });
    const nav = h('nav', '', h('div', 'brand', h('i'), ' AGE OF SYMBIOSIS'),
      h('div', 'landingNav', this.link(L('The Codex', 'O Códice', 'El Códice'), 'codex'), this.link(L('Proof layer', 'Camada de prova', 'Capa de prueba'), 'proof'), enterTop));

    this.input = h('input', { class: 'txt', type: 'text', maxlength: '20', placeholder: t('name.placeholder'), 'aria-label': t('name.placeholder') });
    this.input.value = name;
    const enter = h('button', 'button', L('Enter the world →', 'Entrar no mundo →', 'Entrar al mundo →'));
    enter.addEventListener('click', () => this.submit());
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.submit(); });
    this.status = h('div', 'status-line');
    const pill = h('div', 'truthPill', h('i'), '…');
    const stats = h('div', 'proof symProof');

    const ages: [string, string, string, 'current' | 'locked'][] = [
      ['I', L('Settlement', 'Assentamento', 'Asentamiento'), L('Homes, first power, and a working economy.', 'Moradias, primeira energia e uma economia funcionando.', 'Viviendas, primera energía y una economía en marcha.'), 'current'],
      ['II', L('Growth', 'Crescimento', 'Crecimiento'), L('Wind power, drones, and specialised production.', 'Energia eólica, drones e produção especializada.', 'Energía eólica, drones y producción especializada.'), 'locked'],
      ['III', L('Scale', 'Escala', 'Escala'), L('Institutions and heavy infrastructure that serve thousands.', 'Instituições e infraestrutura pesada que servem milhares.', 'Instituciones e infraestructura pesada que sirven a miles.'), 'locked'],
      ['IV', L('Philanthropy', 'Filantropia', 'Filantropía'), L('Turn the surplus outward, to places that cannot yet generate their own.', 'Voltar o excedente para fora, para quem ainda não gera o próprio.', 'Volcar el excedente hacia fuera, a quien aún no genera el suyo.'), 'locked'],
    ];
    const agePanel = h('div', { class: 'agePanel', 'aria-label': 'The four stages' },
      h('div', 'agePanelHead', h('span', '', L('CIVILIZATION PATH', 'CAMINHO DA CIVILIZAÇÃO', 'CAMINO DE LA CIVILIZACIÓN')), h('b', '', L('The road to symbiosis', 'O caminho até a simbiose', 'El camino a la simbiosis'))),
      h('div', 'agePath', ...ages.map(([roman, title, text, state]) => h('article', state,
        h('i', '', roman),
        h('div', '', h('small', '', state === 'current' ? L('WHERE YOU BEGIN', 'ONDE VOCÊ COMEÇA', 'DONDE EMPIEZAS') : L('LOCKED', 'BLOQUEADA', 'BLOQUEADA')), h('h3', '', title), h('p', '', text)),
        h('em', '', state === 'current' ? 'LIVE' : '○')))),
      h('div', 'civilizationSignal', h('span', '', L('COLLECTIVE OBJECTIVE', 'OBJETIVO COLETIVO', 'OBJETIVO COLECTIVO')), h('p', '', L('Keep essential systems reliable while expanding shared capability.', 'Manter os sistemas essenciais confiáveis enquanto amplia a capacidade compartilhada.', 'Mantener fiables los sistemas esenciales mientras crece la capacidad compartida.'))));

    const hero = h('section', 'symHero',
      h('div', 'symHeroCopy',
        h('div', 'eyebrow', L('A HUMAN–AI CIVILIZATION STRATEGY GAME', 'UM JOGO DE ESTRATÉGIA DE CIVILIZAÇÃO HUMANO–IA', 'UN JUEGO DE ESTRATEGIA DE CIVILIZACIÓN HUMANO–IA')),
        h('h1', '', L('Raise a civilization.', 'Erga uma civilização.', 'Levanta una civilización.'), h('br'), h('span', '', L('Shape the next age.', 'Molde a próxima era.', 'Moldea la próxima era.'))),
        h('p', '', L('Gather with villagers, build with robots and drones, power a shared grid, and guide your realm through four stages of growth. Human judgment sets the purpose; machine intelligence helps the civilization survive the complexity.', 'Colete com aldeões, construa com robôs e drones, energize uma rede compartilhada e guie seu reino por quatro estágios de crescimento. O julgamento humano define o propósito; a inteligência das máquinas ajuda a civilização a sobreviver à complexidade.', 'Recolecta con aldeanos, construye con robots y drones, energiza una red compartida y guía tu reino por cuatro etapas de crecimiento. El juicio humano fija el propósito; la inteligencia de las máquinas ayuda a la civilización a sobrevivir a la complejidad.')),
        pill,
        h('div', 'heroActions symJoin', this.input, enter, this.link(L('Learn how to play', 'Aprender a jogar', 'Aprender a jugar'), 'codex', 'ghost')),
        this.status,
        stats),
      agePanel);

    const pillars: [string, string, string][] = [
      ['01', L('Serve what people need', 'Atenda o que as pessoas precisam', 'Atiende lo que la gente necesita'), L('Every cycle each commander declares need: a home for every person, work for every villager, power for every machine.', 'A cada ciclo cada comandante declara necessidades: moradia para cada pessoa, trabalho para cada aldeão, energia para cada máquina.', 'Cada ciclo cada comandante declara necesidades: vivienda para cada persona, trabajo para cada aldeano, energía para cada máquina.')],
      ['02', L('Raise the right buildings', 'Erga as construções certas', 'Levanta los edificios correctos'), L('Homes, depots, solar arrays, wind turbines, and a Robotics Workshop. A facility counts once, as stewardship, only while it stands.', 'Casas, depósitos, usinas solares, turbinas e uma Oficina de Robótica. Uma instalação conta uma vez, como stewardship, só enquanto estiver de pé.', 'Casas, depósitos, plantas solares, turbinas y un Taller de Robótica. Una instalación cuenta una vez, como stewardship, solo mientras siga en pie.')],
      ['03', L('Weigh the council\'s advice', 'Pese o conselho', 'Sopesa el consejo'), L('An AI council reads the same numbers you do and says what it would do, and why. You can take it or ignore it.', 'Um conselho de IA lê os mesmos números que você e diz o que faria, e por quê. Você aceita ou ignora.', 'Un consejo de IA lee los mismos números que tú y dice qué haría y por qué. Lo aceptas o lo ignoras.')],
      ['04', L('Earn standing by meeting need', 'Ganhe standing atendendo necessidades', 'Gana standing atendiendo necesidades'), L('ELON is earned by covering what people actually need. Reliability across the match is recognized in the final score.', 'ELON vem de cobrir o que as pessoas realmente precisam. A confiabilidade ao longo da partida é reconhecida na pontuação final.', 'ELON se gana cubriendo lo que la gente realmente necesita. La fiabilidad a lo largo de la partida se reconoce en la puntuación final.')],
    ];
    const loop: [string, string, string][] = [
      ['DECLARE', L('Needs are declared', 'Necessidades declaradas', 'Se declaran necesidades'), L('Housing, work, and power, scaled to how many people and machines you run.', 'Moradia, trabalho e energia, na escala de quantas pessoas e máquinas você tem.', 'Vivienda, trabajo y energía, según cuántas personas y máquinas tienes.')],
      ['ADVISE', L('The council reports', 'O conselho relata', 'El consejo informa'), L('Shortfalls, idle workers, and an overloaded grid — each with a reason you can check.', 'Faltas, trabalhadores parados e rede sobrecarregada — cada um com um motivo verificável.', 'Faltas, trabajadores ociosos y red saturada — cada uno con un motivo verificable.')],
      ['DECIDE', L('You command', 'Você comanda', 'Tú mandas'), L('Gather, build, automate, defend. Robots build fast; drones cross water; both draw power.', 'Colete, construa, automatize, defenda. Robôs constroem rápido; drones cruzam a água; ambos consomem energia.', 'Recolecta, construye, automatiza, defiende. Los robots construyen rápido; los drones cruzan el agua; ambos consumen energía.')],
      ['RESOLVE', L('The cycle runs', 'O ciclo roda', 'El ciclo corre'), L('Every 5 seconds the server serves each need and posts ELON for what was met.', 'A cada 5 segundos o servidor atende cada necessidade e lança ELON pelo que foi atendido.', 'Cada 5 segundos el servidor atiende cada necesidad y asienta ELON por lo atendido.')],
      ['RECORD', L('The ledger seals it', 'O ledger sela', 'El ledger lo sella'), L('Each cycle becomes a hash-chained block; the final head is anchored on-chain.', 'Cada ciclo vira um bloco encadeado por hash; o topo final é ancorado on-chain.', 'Cada ciclo se vuelve un bloque encadenado por hash; la cima final se ancla on-chain.')],
    ];
    const proof = h('div', 'worldStats');
    const world = h('div', 'worldStats');
    const finalEnter = h('a', { href: '#', class: 'button' }, L('Enter the world →', 'Entrar no mundo →', 'Entrar al mundo →'));
    finalEnter.addEventListener('click', (e) => { e.preventDefault(); this.focus(); });

    this.el.append(h('main', 'landing symLanding', nav, hero,
      h('section', 'symSection pillarsSection',
        h('div', 'sectionLead', h('span', 'eyebrow', L('THE STRATEGY', 'A ESTRATÉGIA', 'LA ESTRATEGIA')), h('h2', '', L('Build a realm that can', 'Construa um reino capaz de', 'Construye un reino capaz de'), h('br'), L('outgrow scarcity.', 'superar a escassez.', 'superar la escasez.')),
          h('p', '', L('Age of Symbiosis reimagines the civilization RTS for a modern, currency-less record of contribution. Victory is still won on the battlefield — but every match also asks who kept their people housed, working, and powered.', 'Age of Symbiosis reimagina o RTS de civilização com um registro de contribuição moderno e sem moeda. A vitória ainda é no campo de batalha — mas toda partida também pergunta quem manteve seu povo abrigado, trabalhando e com energia.', 'Age of Symbiosis reimagina el RTS de civilización con un registro de contribución moderno y sin moneda. La victoria se sigue ganando en el campo de batalla — pero cada partida también pregunta quién mantuvo a su gente alojada, trabajando y con energía.'))),
        h('div', 'symPillars', ...pillars.map(([n, title, text]) => h('article', '', h('span', '', n), h('h3', '', title), h('p', '', text))))),
      h('section', 'symSection gameLoopSection',
        h('div', 'sectionLead compact', h('span', 'eyebrow', L('HOW YOU PLAY', 'COMO SE JOGA', 'CÓMO SE JUEGA')), h('h2', '', L('One decision cycle.', 'Um ciclo de decisão.', 'Un ciclo de decisión.'), h('br'), L('Many consequences.', 'Muitas consequências.', 'Muchas consecuencias.'))),
        h('div', 'campaignLoop', ...loop.map(([tag, title, text], i) => h('article', '', h('i', '', String(i + 1).padStart(2, '0')), h('span', '', tag), h('h3', '', title), h('p', '', text))))),
      h('section', { class: 'symSection elonSection', id: 'elon' },
        h('div', 'elonSigil', 'ELON', h('small', '', L('THE COMMONS PROTOCOL', 'O PROTOCOLO COMUM', 'EL PROTOCOLO COMÚN'))),
        h('div', 'elonCopy', h('span', 'eyebrow', 'ENERGY · LABOR · OBLIGATION · NEED'), h('h2', '', L('A memory of contribution.', 'Uma memória de contribuição.', 'Una memoria de contribución.'), h('br'), L('Never money.', 'Nunca dinheiro.', 'Nunca dinero.')),
          h('p', '', L('ELON records what each commander contributed, served, and promised. It creates accountability without becoming a tradable token or a gate to anything in the match.', 'ELON registra o que cada comandante contribuiu, atendeu e prometeu. Cria responsabilidade sem virar um token negociável nem barrar nada na partida.', 'ELON registra lo que cada comandante contribuyó, atendió y prometió. Crea responsabilidad sin volverse un token negociable ni limitar nada en la partida.')),
          this.link(L('Read the protocol →', 'Ler o protocolo →', 'Leer el protocolo →'), 'codex'))),
      h('section', 'symSection currentWorld proofSection',
        h('div', 'sectionLead compact', h('span', 'eyebrow', L('THE PROOF LAYER', 'A CAMADA DE PROVA', 'LA CAPA DE PRUEBA')), h('h2', '', L('Blockchain proves records;', 'A blockchain prova registros;', 'La blockchain prueba registros;'), h('br'), L('it does not create ELON.', 'ela não cria ELON.', 'no crea ELON.')),
          h('p', '', L('Every Symbiosis match keeps a hash-chained ledger sealed every 5 seconds. When it ends, the archive hash and ledger head are committed to a registry contract — no wallet, token, or fee.', 'Toda partida Simbiose mantém um ledger encadeado por hash selado a cada 5 segundos. Ao terminar, o hash do arquivo e o topo do ledger vão para um contrato de registro — sem carteira, token ou taxa.', 'Cada partida Simbiosis mantiene un ledger encadenado por hash sellado cada 5 segundos. Al terminar, el hash del archivo y la cima del ledger se registran en un contrato — sin cartera, token ni comisión.'))),
        proof,
        h('div', 'scopeStrip symScope', h('b', '', L('On-chain', 'On-chain', 'On-chain')), h('span', '', L('Archive hash', 'Hash do arquivo', 'Hash del archivo')), h('span', '', L('Ledger head + height', 'Topo + altura do ledger', 'Cima + altura del ledger')), h('span', '', L('Facility provenance', 'Procedência das instalações', 'Procedencia de instalaciones')), h('span', '', L('Never: ELON, wallets, fees', 'Nunca: ELON, carteiras, taxas', 'Nunca: ELON, carteras, comisiones'))),
        h('div', { style: 'margin-top:18px' }, this.link(L('Open the proof layer →', 'Abrir a camada de prova →', 'Abrir la capa de prueba →'), 'proof', 'ghost'))),
      h('section', 'symSection currentWorld',
        h('div', 'sectionLead compact', h('span', 'eyebrow', L('THE WORLD AVAILABLE NOW', 'O MUNDO DISPONÍVEL AGORA', 'EL MUNDO DISPONIBLE AHORA')), h('h2', '', L('The latest campaign', 'A campanha mais recente', 'La campaña más reciente')),
          h('p', '', L('Real matches from this server, inspectable from every angle: stewardship, ledger, and proof.', 'Partidas reais deste servidor, inspecionáveis por todos os ângulos: stewardship, ledger e prova.', 'Partidas reales de este servidor, inspeccionables desde todos los ángulos: stewardship, ledger y prueba.'))),
        world,
        h('div', 'finalCall', h('p', '', L('Human judgment. Machine intelligence.', 'Julgamento humano. Inteligência de máquina.', 'Juicio humano. Inteligencia de máquina.'), h('br'), h('b', '', L('One civilization.', 'Uma civilização.', 'Una civilización.'))), finalEnter)),
    ));
    this.live = { pill, stats, proof, world };
    this.paintLive();
  }

  private paintLive(): void {
    if (!this.live) return;
    const { status, unreachable } = chainState();
    const { pill, stats, proof, world } = this.live;
    pill.innerHTML = '';
    pill.append(h('i'), unreachable
      ? L('Connecting to the game server…', 'Conectando ao servidor do jogo…', 'Conectando al servidor del juego…')
      : status?.mode === 'rpc' && status.online
        ? L(`Live multiplayer · proof chain online at block ${fmt(status.block ?? 0)}`, `Multiplayer ao vivo · cadeia de prova online no bloco ${fmt(status.block ?? 0)}`, `Multijugador en vivo · cadena de prueba online en el bloque ${fmt(status.block ?? 0)}`)
        : L('Live multiplayer · every Symbiosis match is hash-chained and archived', 'Multiplayer ao vivo · toda partida Simbiose é encadeada e arquivada', 'Multijugador en vivo · cada partida Simbiosis se encadena y archiva'));
    stats.innerHTML = '';
    stats.append(h('b', '', 'STAGE I'), h('span', '', L('Settlement', 'Assentamento', 'Asentamiento')),
      h('b', '', '5 s'), h('span', '', L('Ledger cycle', 'Ciclo do ledger', 'Ciclo del ledger')),
      h('b', '', status ? fmt(status.archives) : '—'), h('span', '', L('Campaigns archived', 'Campanhas arquivadas', 'Campañas archivadas')));
    const cell = (label: string, value: string, foot: string): HTMLElement => h('article', '', h('small', '', label), h('b', '', value), h('span', '', foot));
    const node = unreachable ? L('Unreachable', 'Fora do ar', 'Inaccesible')
      : !status ? '…'
        : status.mode === 'rpc' ? (status.online ? L(`Block ${fmt(status.block ?? 0)}`, `Bloco ${fmt(status.block ?? 0)}`, `Bloque ${fmt(status.block ?? 0)}`) : 'Offline')
          : status.mode === 'local' ? L('Local', 'Local', 'Local') : L('Off', 'Desligada', 'Desactivada');
    const latest = status?.latest;
    proof.innerHTML = '';
    proof.append(
      cell(L('CHAIN NODE', 'NÓ DA CADEIA', 'NODO DE LA CADENA'), node, status?.chainId ? `chain ${status.chainId}${status.chainId === 31337 ? ' · Anvil' : ''}` : L('optional, local', 'opcional, local', 'opcional, local')),
      cell(L('REGISTRY', 'REGISTRO', 'REGISTRO'), status?.contract ? shortHash(status.contract, 6, 4) : '—', L('MatchCommitmentRegistry', 'MatchCommitmentRegistry', 'MatchCommitmentRegistry')),
      cell(L('COMMITMENTS', 'COMPROMISSOS', 'COMPROMISOS'), status ? fmt(status.commitments) : '—', L('matches anchored on-chain', 'partidas ancoradas on-chain', 'partidas ancladas on-chain')),
      cell(L('LATEST HEAD', 'ÚLTIMO TOPO', 'ÚLTIMA CIMA'), latest?.ledger ? shortHash(latest.ledger.head, 6, 4) : '—', latest?.ledger ? L(`${fmt(latest.ledger.height + 1)} blocks · ${latest.ledger.verified ? 'verified' : 'broken'}`, `${fmt(latest.ledger.height + 1)} blocos · ${latest.ledger.verified ? 'verificado' : 'quebrado'}`, `${fmt(latest.ledger.height + 1)} bloques · ${latest.ledger.verified ? 'verificado' : 'roto'}`) : L('no Symbiosis match yet', 'nenhuma partida Simbiose ainda', 'aún no hay partidas Simbiosis')),
    );
    world.innerHTML = '';
    const top = latest?.standings?.[0];
    world.append(
      cell(L('CAMPAIGN', 'CAMPANHA', 'CAMPAÑA'), latest?.matchId ?? '—', latest ? new Date(latest.savedAt).toLocaleString() : L('play the first one', 'jogue a primeira', 'juega la primera')),
      cell(L('BATTLEFIELD WINNER', 'VENCEDOR NO CAMPO', 'GANADOR EN EL CAMPO'), latest?.winnerName || '—', L('decided by conquest', 'decidido pela conquista', 'decidido por conquista')),
      cell(L('LEADING STEWARD', 'MELHOR STEWARD', 'MEJOR STEWARD'), top?.name ?? '—', top ? L(`${fmt(top.score, 2)} ELON score`, `${fmt(top.score, 2)} ELON de pontuação`, `${fmt(top.score, 2)} ELON de puntuación`) : L('strongest contribution', 'maior contribuição', 'mayor contribución')),
      cell(L('CHRONICLE', 'CRÔNICA', 'CRÓNICA'), latest?.ledger ? fmt(latest.ledger.txs) : '—', L('auditable ledger postings', 'lançamentos auditáveis', 'asientos auditables')),
    );
  }

  /** Language change: rebuild every string, keeping what was typed. */
  retranslate(): void {
    this.build(this.input.value);
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  setVisible(visible: boolean): void {
    if (visible && this.poll === null) {
      void refreshChain();
      this.poll = window.setInterval(() => void refreshChain(), 15_000);
    } else if (!visible && this.poll !== null) {
      window.clearInterval(this.poll);
      this.poll = null;
    }
  }

  focus(): void {
    this.input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    this.input.focus();
    this.input.select(); // seleciona o nome pré-preenchido p/ trocar fácil
  }

  private submit(): void {
    const name = this.input.value.trim();
    if (!name) {
      this.setStatus(t('name.empty'));
      this.input.focus();
      return;
    }
    this.deps.onEnter(name);
  }
}
