// WATT Arena views adapted to Age of Symbiosis match records. Each view
// answers one question, as in WATT's Shell: who served best (Stewardship),
// what was recorded (Commons Ledger), what happened (Campaigns), how it works
// (Codex), and what can be trusted (Proof layer).
import type { ChainTx, Standing } from '@age/shared';
import {
  L, badge, code, defs, fmt, grid, h, hero, meter, ownerTag, pageHead, panel, pct, readout, rich, shortHash, table, tile,
} from './kit';
import { SEAT_COLORS, campaign, campaigns, chainState, type CampaignSummary, type ChainStatus, type ProofRecord } from './data';

export type PageId = 'play' | 'stewardship' | 'ledger' | 'campaigns' | 'codex' | 'proof';

export interface PageNav {
  go: (page: PageId, matchId?: string) => void;
}

function colorFor(standings: Standing[] | undefined, playerId: number): string {
  const ids = [...new Set((standings ?? []).map((s) => s.playerId))].sort((a, b) => a - b);
  return SEAT_COLORS[Math.max(0, ids.indexOf(playerId)) % SEAT_COLORS.length];
}

function loading(): HTMLElement {
  return h('div', 'waNote', h('span', '', '›'), h('div', '', L('Loading the match archive…', 'Carregando o arquivo de partidas…', 'Cargando el archivo de partidas…')));
}

function emptyState(nav: PageNav): HTMLElement {
  const btn = h('button', 'button', L('Play a Symbiosis match →', 'Jogar uma partida Simbiose →', 'Jugar una partida Simbiosis →'));
  btn.addEventListener('click', () => nav.go('play'));
  return panel({ title: L('No finished campaigns yet', 'Nenhuma campanha concluída ainda', 'Aún no hay campañas terminadas'), subtitle: L('Every finished match is archived, hashed, and listed here.', 'Toda partida concluída é arquivada, recebe hash e aparece aqui.', 'Cada partida terminada se archiva, recibe hash y aparece aquí.') },
    h('p', 'waEmptyLede', L('Create a room, choose the Symbiosis presentation, and finish a match. Its stewardship record, ledger, and on-chain commitment will appear on these pages.', 'Crie uma sala, escolha a apresentação Simbiose e termine uma partida. O registro de stewardship, o ledger e o compromisso on-chain aparecerão nestas páginas.', 'Crea una sala, elige la presentación Simbiosis y termina una partida. Su registro de stewardship, el ledger y el compromiso on-chain aparecerán en estas páginas.')),
    btn);
}

export function proofTone(p: ProofRecord | null): { tone: 'good' | 'warning' | 'critical' | 'neutral'; text: string } {
  switch (p?.status) {
    case 'confirmed': return { tone: 'good', text: L(`Block #${p.blockNumber}`, `Bloco #${p.blockNumber}`, `Bloque #${p.blockNumber}`) };
    case 'submitted': return { tone: 'warning', text: L('Submitted', 'Enviado', 'Enviado') };
    case 'failed': return { tone: 'critical', text: L('Failed', 'Falhou', 'Falló') };
    case 'local': return { tone: 'neutral', text: L('Local only', 'Só local', 'Solo local') };
    case 'disabled': return { tone: 'neutral', text: L('Chain off', 'Blockchain off', 'Blockchain off') };
    case 'skipped': return { tone: 'warning', text: L('Dev match', 'Partida dev', 'Partida dev') };
    default: return { tone: 'neutral', text: '—' };
  }
}

// ---------------------------------------------------------------- Stewardship

export function stewardshipTable(rows: Standing[]): HTMLElement {
  return table(
    [{ label: '#' }, { label: L('Commander', 'Comandante', 'Comandante') }, { label: L('ELON standing', 'Standing ELON', 'Standing ELON'), num: true },
      { label: L('Facilities', 'Instalações', 'Instalaciones'), num: true }, { label: L('Stewardship value', 'Valor de stewardship', 'Valor de stewardship'), num: true },
      { label: L('Combined standing', 'Standing combinado', 'Standing combinado'), num: true }, { label: L('Reliability', 'Confiabilidade', 'Fiabilidad'), num: true },
      { label: L('Bonus', 'Bônus', 'Bono'), num: true }, { label: L('Score', 'Pontuação', 'Puntuación'), num: true }],
    rows.map((r) => [
      h('span', r.rank === 1 ? 'waRank first' : 'waRank', String(r.rank)),
      ownerTag(r.name, colorFor(rows, r.playerId)),
      fmt(r.standing),
      String(r.facilities),
      fmt(r.stewardship),
      h('b', '', fmt(r.standing + r.stewardship)),
      pct(r.reliabilityPpm),
      fmt(r.bonus, 2),
      h('b', '', fmt(r.score, 2)),
    ]),
  );
}

export function reliabilityPanel(rows: Standing[]): HTMLElement {
  return panel({ title: L('Reliability', 'Confiabilidade', 'Fiabilidad'), subtitle: L('The share of each commander\'s own declared need that was actually served.', 'A parcela da necessidade declarada de cada comandante que foi de fato atendida.', 'La parte de la necesidad declarada de cada comandante que realmente se atendió.'), foot: L('Need is sampled every cycle (5 s): homes for every person, work for every villager, and grid power for every robot or drone.', 'A necessidade é medida a cada ciclo (5 s): moradia para cada pessoa, trabalho para cada aldeão e energia para cada robô ou drone.', 'La necesidad se mide cada ciclo (5 s): vivienda para cada persona, trabajo para cada aldeano y energía para cada robot o dron.') },
    ...rows.map((r) => meter(r.name, r.reliabilityPpm, 1_000_000, pct(r.reliabilityPpm), colorFor(rows, r.playerId))),
    h('div', { style: 'margin-top:14px' }, table(
      [{ label: L('Commander', 'Comandante', 'Comandante') }, { label: L('Declared', 'Declarada', 'Declarada'), num: true }, { label: L('Served', 'Atendida', 'Atendida'), num: true }],
      rows.map((r) => [r.name, fmt(r.declaredNeed), fmt(r.servedNeed)]))));
}

export function scoringRules(): HTMLElement {
  return panel({ title: L('What the ranking does and does not reward', 'O que o ranking recompensa e o que não', 'Qué recompensa el ranking y qué no'), subtitle: L('Worth knowing before reading too much into the order.', 'Vale saber antes de interpretar demais a ordem.', 'Conviene saberlo antes de interpretar demasiado el orden.') },
    defs([
      { term: L('Need served', 'Necessidade atendida', 'Necesidad atendida'), body: L('ELON standing is earned by serving need each cycle: housed people, working villagers, and powered automation. A fully met need is always worth at least 1. Training workers (+1, robots and drones +2) and reaching an age (+5) also add standing.', 'O standing ELON vem de atender necessidades a cada ciclo: pessoas com moradia, aldeões trabalhando e automação com energia. Uma necessidade totalmente atendida vale sempre ao menos 1. Treinar trabalhadores (+1, robôs e drones +2) e avançar de era (+5) também somam.', 'El standing ELON se gana atendiendo necesidades cada ciclo: personas con vivienda, aldeanos trabajando y automatización con energía. Una necesidad totalmente cubierta vale al menos 1. Entrenar trabajadores (+1, robots y drones +2) y avanzar de edad (+5) también suman.') },
      { term: L('Counted once', 'Contado uma vez', 'Contado una vez'), body: L('A finished facility does not add standing. It appears as stewardship value — a share of its build cost — only while it stands. Destroyed or deleted facilities stop counting.', 'Uma instalação pronta não soma standing. Ela aparece como valor de stewardship — parte do custo da obra — só enquanto estiver de pé. Destruída ou apagada, deixa de contar.', 'Una instalación terminada no suma standing. Aparece como valor de stewardship — parte de su coste — solo mientras siga en pie. Destruida o borrada, deja de contar.') },
      { term: L('Reliability recognition', 'Reconhecimento de confiabilidade', 'Reconocimiento de fiabilidad'), body: L('Up to 50 ELON in proportion to the share of declared need served across the match. It recognizes fulfilled need and separates close finishes.', 'Até 50 ELON na proporção da necessidade declarada atendida na partida. Reconhece a necessidade cumprida e separa resultados próximos.', 'Hasta 50 ELON en proporción a la necesidad declarada atendida en la partida. Reconoce la necesidad cumplida y separa resultados ajustados.') },
      { term: L('Not conquest', 'Não é conquista', 'No es conquista'), body: L('Victory is still decided on the battlefield. Stewardship is a separate record: a defeated commander can out-serve the winner.', 'A vitória continua sendo decidida no campo de batalha. Stewardship é um registro à parte: um comandante derrotado pode servir melhor que o vencedor.', 'La victoria se sigue decidiendo en el campo de batalla. Stewardship es un registro aparte: un comandante derrotado puede servir mejor que el ganador.') },
    ]));
}

export function integrityPanel(c: { matchId: string; finishedTick: number; ledger?: { head: string; height: number; verified: boolean } | null; proof: ProofRecord | null }, nav?: PageNav): HTMLElement {
  const verified = c.ledger?.verified;
  const ledgerBody = h('span', '', c.ledger
    ? `${fmt(c.ledger.height + 1)} ${L('blocks, every link recomputed.', 'blocos, cada elo recalculado.', 'bloques, cada enlace recalculado.')} `
    : L('This match ran in Classic presentation, so no ledger was kept.', 'Esta partida foi em apresentação Clássica, então não houve ledger.', 'Esta partida fue en presentación Clásica, así que no hubo ledger.'));
  if (c.ledger && nav) {
    const link = h('a', { class: 'waLink', href: '#' }, L('Inspect them', 'Inspecionar', 'Inspeccionarlos'));
    link.addEventListener('click', (e) => { e.preventDefault(); nav.go('ledger', c.matchId); });
    ledgerBody.append(link, '.');
  }
  const pt = proofTone(c.proof);
  return panel({ title: L('Match integrity', 'Integridade da partida', 'Integridad de la partida'), subtitle: L('What has actually been checked about this result.', 'O que de fato foi verificado neste resultado.', 'Lo que realmente se ha verificado de este resultado.'), tools: badge(verified === false ? 'critical' : 'good', verified === false ? L('Broken', 'Quebrado', 'Roto') : L('Verified', 'Verificado', 'Verificado')) },
    defs([
      { term: L('Match', 'Partida', 'Partida'), body: code(c.matchId) },
      { term: L('Cycles completed', 'Ciclos concluídos', 'Ciclos completados'), body: fmt(Math.floor(c.finishedTick / 50)) },
      { term: L('Ledger', 'Ledger', 'Ledger'), body: ledgerBody },
      { term: L('Ledger head', 'Topo do ledger', 'Cima del ledger'), body: c.ledger ? code(shortHash(c.ledger.head, 14, 8), c.ledger.head) : '—' },
      { term: L('On-chain', 'On-chain', 'On-chain'), body: h('span', '', badge(pt.tone, pt.text), c.proof?.transactionHash ? h('span', '', ' ', code(shortHash(c.proof.transactionHash), c.proof.transactionHash)) : '') },
    ]));
}

export function renderStewardship(root: HTMLElement, nav: PageNav, matchId?: string): void {
  root.append(pageHead(
    L('Stewardship record', 'Registro de stewardship', 'Registro de stewardship'),
    L('Who served the commons most reliably', 'Quem serviu o bem comum com mais confiabilidade', 'Quién sirvió al bien común con más fiabilidad'),
    L('Every commander starts with zero ELON standing. This is not a wealth ranking: ELON records contribution, stewardship, and responsibility.', 'Todo comandante começa com standing ELON zero. Não é um ranking de riqueza: ELON registra contribuição, stewardship e responsabilidade.', 'Todo comandante empieza con standing ELON cero. No es un ranking de riqueza: ELON registra contribución, stewardship y responsabilidad.'),
    rich(L('How this score works.', 'Como esta pontuação funciona.', 'Cómo funciona esta puntuación.'), L('Contribution standing is combined with infrastructure stewardship, counted once, and a reliability recognition for the share of each commander\'s declared need that was served.', 'O standing de contribuição é somado ao stewardship da infraestrutura, contado uma vez, e a um reconhecimento de confiabilidade pela parcela da necessidade declarada que foi atendida.', 'El standing de contribución se suma al stewardship de la infraestructura, contado una vez, y a un reconocimiento de fiabilidad por la parte de la necesidad declarada que se atendió.')),
  ));
  const slot = h('div', '', loading());
  root.append(slot);
  void (async () => {
    const list = await campaigns().catch(() => []);
    const chosen = (matchId ? list.find((c) => c.matchId === matchId) : list.find((c) => c.standings?.length)) ?? null;
    slot.innerHTML = '';
    if (!chosen?.standings?.length) { slot.append(emptyState(nav)); return; }
    const rows = chosen.standings;
    if (chosen.dev) slot.append(devNote());
    const winner = rows[0];
    const runner = rows[1];
    const margin = runner ? winner.score - runner.score : winner.score;
    const last = rows[rows.length - 1];
    slot.append(
      hero(L('Most reliable steward', 'Steward mais confiável', 'Steward más fiable'), winner.name,
        L(`${fmt(winner.score, 2)} ELON of combined standing, stewardship, and recognition with ${pct(winner.reliabilityPpm)} reliability${runner ? ` — ${fmt(margin, 2)} ELON ahead of ${runner.name}` : ''}. Battlefield winner: ${chosen.winnerName || '—'}.`,
          `${fmt(winner.score, 2)} ELON de standing, stewardship e reconhecimento com ${pct(winner.reliabilityPpm)} de confiabilidade${runner ? ` — ${fmt(margin, 2)} ELON à frente de ${runner.name}` : ''}. Vencedor no campo: ${chosen.winnerName || '—'}.`,
          `${fmt(winner.score, 2)} ELON de standing, stewardship y reconocimiento con ${pct(winner.reliabilityPpm)} de fiabilidad${runner ? ` — ${fmt(margin, 2)} ELON por delante de ${runner.name}` : ''}. Ganador en el campo: ${chosen.winnerName || '—'}.`),
        h('div', { class: 'waTiles', style: 'margin:0' },
          tile(L('Starting standing (all)', 'Standing inicial (todos)', 'Standing inicial (todos)'), '0', 'ELON', L('Neutral, identical opening', 'Neutro, idêntico para todos', 'Neutral, idéntico para todos')),
          tile(L('Winning score', 'Pontuação vencedora', 'Puntuación ganadora'), fmt(winner.score, 2), 'ELON', L('Standing + stewardship + bonus', 'Standing + stewardship + bônus', 'Standing + stewardship + bono')),
          tile(L('Margin', 'Margem', 'Margen'), fmt(margin, 2), 'ELON', runner ? L(`over ${runner.name}`, `sobre ${runner.name}`, `sobre ${runner.name}`) : ''),
          tile(L('Spread, first to last', 'Diferença, 1º ao último', 'Diferencia, 1º al último'), fmt(winner.score - last.score, 2), 'ELON', `${winner.name} → ${last.name}`))),
      grid('', panel({ title: L('Final table', 'Tabela final', 'Tabla final'), subtitle: L('Sorted by score. Ties break on player id, so the ordering is reproducible.', 'Ordenada pela pontuação. Empates desempatam pelo id do jogador, então a ordem é reproduzível.', 'Ordenada por puntuación. Los empates se deciden por id de jugador, así el orden es reproducible.'), body: 'table', foot: L('Reliability is the share of a commander\'s own declared need that was met across the whole match.', 'Confiabilidade é a parcela da própria necessidade declarada atendida durante toda a partida.', 'La fiabilidad es la parte de la propia necesidad declarada atendida durante toda la partida.') }, stewardshipTable(rows))),
      grid('wide', reliabilityPanel(rows), scoringRules()),
      grid('two', integrityPanel(chosen, nav), campaignPicker(list, chosen.matchId, (id) => nav.go('stewardship', id))),
    );
  })();
}

function campaignPicker(list: CampaignSummary[], current: string, pick: (id: string) => void): HTMLElement {
  return panel({ title: L('Other campaigns', 'Outras campanhas', 'Otras campañas'), subtitle: L('Open any archived match\'s stewardship record.', 'Abra o registro de stewardship de qualquer partida arquivada.', 'Abre el registro de stewardship de cualquier partida archivada.'), body: 'table' },
    table([{ label: L('Match', 'Partida', 'Partida') }, { label: L('Battlefield winner', 'Vencedor no campo', 'Ganador en el campo') }, { label: L('Top steward', 'Melhor steward', 'Mejor steward') }],
      list.filter((c) => c.standings?.length).slice(0, 8).map((c) => {
        const a = h('a', { class: 'waLink', href: '#' }, c.matchId);
        a.addEventListener('click', (e) => { e.preventDefault(); pick(c.matchId); });
        return [c.matchId === current ? h('b', '', c.matchId) : a, c.winnerName || '—', c.standings?.[0]?.name ?? '—'];
      })));
}

export function devNote(): HTMLElement {
  return h('div', 'waNote', h('span', { 'aria-hidden': 'true' }, '›'), h('div', '', rich(
    L('Dev match.', 'Partida dev.', 'Partida dev.'),
    L('Developer commands (/age, /res, /build, /power) were used, so these scores are not comparable with real matches. It was archived locally and not committed on-chain.', 'Comandos de desenvolvedor (/age, /res, /build, /power) foram usados, então estas pontuações não são comparáveis às de partidas reais. Ela foi arquivada localmente e não foi gravada on-chain.', 'Se usaron comandos de desarrollador (/age, /res, /build, /power), así que estas puntuaciones no son comparables con partidas reales. Se archivó localmente y no se registró on-chain.'))));
}

// ---------------------------------------------------------------- Proof layer

function chainReadout(s: ChainStatus | null, unreachable: boolean): HTMLElement {
  const node = unreachable ? L('Server unreachable', 'Servidor fora do ar', 'Servidor inaccesible')
    : !s ? '…'
      : s.mode === 'disabled' ? L('Disabled', 'Desligada', 'Desactivada')
        : s.mode === 'local' ? L('Local only (no contract)', 'Só local (sem contrato)', 'Solo local (sin contrato)')
          : s.online ? L(`Online · block ${fmt(s.block ?? 0)}`, `Online · bloco ${fmt(s.block ?? 0)}`, `Online · bloque ${fmt(s.block ?? 0)}`)
            : L('Offline', 'Offline', 'Offline');
  return readout([
    { label: L('Chain node', 'Nó da blockchain', 'Nodo de la blockchain'), value: node },
    { label: L('Registry contract', 'Contrato de registro', 'Contrato de registro'), value: s?.contract ? shortHash(s.contract, 8, 6) : '—' },
    { label: L('Archived matches', 'Partidas arquivadas', 'Partidas archivadas'), value: s ? fmt(s.archives) : '—' },
    { label: L('On-chain commitments', 'Compromissos on-chain', 'Compromisos on-chain'), value: s ? fmt(s.commitments) : '—' },
  ]);
}

export function renderProof(root: HTMLElement, nav: PageNav): () => void {
  root.append(pageHead(
    L('Optional local verification', 'Verificação local opcional', 'Verificación local opcional'),
    L('Blockchain proves records; it does not create ELON', 'A blockchain prova registros; ela não cria ELON', 'La blockchain prueba registros; no crea ELON'),
    L('ELON is non-transferable contribution standing kept by the authoritative game server. The chain is only a proof layer: when a Symbiosis match ends, its archive hash and the head of its hash-chained ledger are committed to a registry contract.', 'ELON é standing de contribuição intransferível mantido pelo servidor autoritativo do jogo. A blockchain é só uma camada de prova: quando uma partida Simbiose termina, o hash do arquivo e o topo do ledger encadeado são gravados num contrato de registro.', 'ELON es standing de contribución intransferible que guarda el servidor autoritativo del juego. La blockchain es solo una capa de prueba: al terminar una partida Simbiosis, el hash del archivo y la cima del ledger encadenado se registran en un contrato.'),
    rich(L('No wallet, token, or fee is involved.', 'Não há carteira, token nem taxa.', 'No hay cartera, token ni comisión.'), L('The registry stores two hashes and a block height per match. Nothing on it can be bought, sold, or used to gate play.', 'O registro guarda dois hashes e uma altura por partida. Nada nele pode ser comprado, vendido ou usado para barrar o jogo.', 'El registro guarda dos hashes y una altura por partida. Nada en él se puede comprar, vender ni usar para limitar el juego.')),
  ));
  const read = h('div', '');
  const latestSlot = h('div', '');
  root.append(read,
    grid('two',
      panel({ title: L('What belongs on-chain', 'O que vai on-chain', 'Qué va on-chain'), subtitle: L('Small, durable proofs — not tick-by-tick simulation.', 'Provas pequenas e duráveis — não a simulação tick a tick.', 'Pruebas pequeñas y duraderas — no la simulación tick a tick.'), tools: badge('good', L('Proof only', 'Só prova', 'Solo prueba')) },
        defs([
          { term: L('Match commitment', 'Compromisso da partida', 'Compromiso de la partida'), body: L('SHA-256 of the canonical match archive: players, standings, facilities, every ELON posting and the full ledger. 32 bytes, so it fits a Solidity bytes32 exactly.', 'SHA-256 do arquivo canônico da partida: jogadores, standings, instalações, cada lançamento ELON e o ledger inteiro. 32 bytes, cabe exatamente num bytes32 do Solidity.', 'SHA-256 del archivo canónico de la partida: jugadores, standings, instalaciones, cada asiento ELON y el ledger completo. 32 bytes, cabe exacto en un bytes32 de Solidity.') },
          { term: L('Ledger head', 'Topo do ledger', 'Cima del ledger'), body: L('The final block hash of the match ledger. Each block links the previous one and a Merkle root of its transactions, sealed every 5 seconds of play.', 'O hash do último bloco do ledger. Cada bloco aponta para o anterior e para a raiz Merkle das suas transações, selado a cada 5 segundos de jogo.', 'El hash del último bloque del ledger. Cada bloque enlaza al anterior y a la raíz Merkle de sus transacciones, sellado cada 5 segundos de juego.') },
          { term: L('Facility reference', 'Referência da instalação', 'Referencia de la instalación'), body: L('Each completed facility carries the hash of the ledger transaction that recorded it — provenance for stewardship, not ownership.', 'Cada instalação concluída leva o hash da transação que a registrou — procedência para stewardship, não propriedade.', 'Cada instalación terminada lleva el hash de la transacción que la registró — procedencia para stewardship, no propiedad.') },
          { term: L('Run seal', 'Selo da partida', 'Sello de la partida'), body: L('Archive hash plus ledger head lets anyone holding the archive recompute every link and check a claimed score.', 'Hash do arquivo mais topo do ledger permitem que quem tiver o arquivo recalcule cada elo e confira uma pontuação.', 'Hash del archivo más cima del ledger permiten que quien tenga el archivo recalcule cada enlace y compruebe una puntuación.') },
        ])),
      panel({ title: L('What stays off-chain', 'O que fica fora da blockchain', 'Qué queda fuera de la blockchain'), subtitle: L('The high-volume simulation layer.', 'A camada de simulação, de alto volume.', 'La capa de simulación, de alto volumen.'), tools: badge('warning', L('Simulation', 'Simulação', 'Simulación')) },
        defs([
          { term: L('ELON standing', 'Standing ELON', 'Standing ELON'), body: L('Energy, Labor, Obligation, and Need postings stay in the server\'s balanced ledger.', 'Os lançamentos de Energia, Trabalho, Obrigação e Necessidade ficam no ledger balanceado do servidor.', 'Los asientos de Energía, Trabajo, Obligación y Necesidad quedan en el ledger balanceado del servidor.') },
          { term: L('Simulation ticks', 'Ticks da simulação', 'Ticks de la simulación'), body: L('Movement, combat, gathering, and construction run 10 times a second on the server and never wait for a chain.', 'Movimento, combate, coleta e construção rodam 10 vezes por segundo no servidor e nunca esperam a blockchain.', 'Movimiento, combate, recolección y construcción corren 10 veces por segundo en el servidor y nunca esperan a la blockchain.') },
          { term: L('Essential access', 'Acesso essencial', 'Acceso esencial'), body: L('Never gated by a wallet, token balance, transaction fee, or ELON standing.', 'Nunca condicionado a carteira, saldo de token, taxa ou standing ELON.', 'Nunca condicionado a cartera, saldo de token, comisión o standing ELON.') },
          { term: L('Failures', 'Falhas', 'Fallos'), body: L('If the chain is down, the match still ends normally; the commitment is recorded as failed and the archive stays local.', 'Se a blockchain cair, a partida termina normalmente; o compromisso fica como falho e o arquivo segue local.', 'Si la blockchain cae, la partida termina normalmente; el compromiso queda como fallido y el archivo sigue local.') },
        ]))),
    latestSlot);

  const paint = (): void => {
    const { status, unreachable } = chainState();
    read.innerHTML = '';
    read.append(chainReadout(status, unreachable));
    latestSlot.innerHTML = '';
    if (status && status.mode !== 'rpc') {
      latestSlot.append(panel({ title: L('Turn on the local chain', 'Ligar a blockchain local', 'Activar la blockchain local'), subtitle: L('Optional. Requires Foundry; never use these dev accounts on a public network.', 'Opcional. Requer Foundry; nunca use estas contas de dev numa rede pública.', 'Opcional. Requiere Foundry; nunca uses estas cuentas de dev en una red pública.'), tools: badge('neutral', status.mode === 'disabled' ? L('Disabled', 'Desligada', 'Desactivada') : L('No contract', 'Sem contrato', 'Sin contrato')) },
        h('pre', 'waCode', 'npm run chain:node                 # Anvil on :8545\nnpm run chain:build && npm run chain:deploy\nBLOCKCHAIN_ENABLED=true npm run dev:server')));
    }
    const latest = status?.latest;
    if (latest) latestSlot.append(grid('two', integrityPanel(latest, nav), latestCommitment(latest)));
  };
  paint();
  return paint;
}

function latestCommitment(c: CampaignSummary): HTMLElement {
  const p = c.proof;
  const pt = proofTone(p);
  return panel({ title: L('Latest commitment', 'Último compromisso', 'Último compromiso'), subtitle: c.matchId, tools: badge(pt.tone, pt.text) },
    defs([
      { term: L('Archive hash', 'Hash do arquivo', 'Hash del archivo'), body: p ? code(shortHash(p.archiveHash, 16, 8), p.archiveHash) : '—' },
      { term: L('Ledger head', 'Topo do ledger', 'Cima del ledger'), body: p?.ledgerHead ? code(shortHash(p.ledgerHead, 14, 8), p.ledgerHead) : '—' },
      { term: L('Transaction', 'Transação', 'Transacción'), body: p?.transactionHash ? code(shortHash(p.transactionHash, 14, 8), p.transactionHash) : '—' },
      { term: L('Contract', 'Contrato', 'Contrato'), body: p?.contract ? code(shortHash(p.contract, 10, 6), p.contract) : '—' },
      { term: L('Chain', 'Rede', 'Red'), body: p?.chainId ? `${p.chainId}${p.chainId === 31337 ? ' · Anvil' : ''}` : '—' },
      ...(p?.error ? [{ term: L('Error', 'Erro', 'Error'), body: p.error }] : []),
    ]));
}

// ---------------------------------------------------------------- Commons ledger

const KINDS: ChainTx['kind'][] = ['facility', 'labor', 'obligation', 'energy', 'need', 'genesis'];

export function kindLabel(k: ChainTx['kind']): string {
  return ({
    facility: L('Facility', 'Instalação', 'Instalación'), labor: L('Labor', 'Trabalho', 'Trabajo'), obligation: L('Obligation', 'Obrigação', 'Obligación'),
    energy: L('Energy', 'Energia', 'Energía'), need: L('Need', 'Necessidade', 'Necesidad'), genesis: L('Genesis', 'Gênese', 'Génesis'),
  } as Record<string, string>)[k] ?? k;
}

export function renderLedger(root: HTMLElement, nav: PageNav, matchId?: string): void {
  root.append(pageHead(
    L('Commons ledger', 'Ledger comum', 'Ledger común'),
    L('Every contribution, hash-chained', 'Cada contribuição, encadeada por hash', 'Cada contribución, encadenada por hash'),
    L('Each ELON posting and facility completion becomes a transaction. The server seals them into a block every 5 seconds; each block commits to the previous one and to a Merkle root of its transactions.', 'Cada lançamento ELON e conclusão de instalação vira uma transação. O servidor as sela num bloco a cada 5 segundos; cada bloco se compromete com o anterior e com a raiz Merkle das transações.', 'Cada asiento ELON y finalización de instalación se vuelve una transacción. El servidor las sella en un bloque cada 5 segundos; cada bloque se compromete con el anterior y con la raíz Merkle de sus transacciones.'),
  ));
  const slot = h('div', '', loading());
  root.append(slot);
  void (async () => {
    const list = await campaigns().catch(() => []);
    const id = matchId ?? list.find((c) => c.ledger)?.matchId;
    slot.innerHTML = '';
    if (!id) { slot.append(emptyState(nav)); return; }
    const c = await campaign(id).catch(() => null);
    if (!c?.ledger) { slot.append(emptyState(nav)); return; }
    const names = new Map(c.players.map((p) => [p.id, p.name]));
    const colors = new Map(c.players.map((p, i) => [p.id, SEAT_COLORS[i % SEAT_COLORS.length]]));
    const txs = c.ledger.txs;
    const byKind = new Map<string, number>();
    for (const t of txs) byKind.set(t.kind, (byKind.get(t.kind) ?? 0) + 1);
    let filter: string | null = null;
    const tableSlot = h('div', '');
    const chips = h('div', 'waSeg');
    const draw = (): void => {
      chips.innerHTML = '';
      for (const k of [null, ...KINDS.filter((k) => byKind.has(k))]) {
        const b = h('button', filter === k ? 'on' : '', k ? `${kindLabel(k as ChainTx['kind'])} · ${byKind.get(k)}` : `${L('All', 'Todas', 'Todas')} · ${txs.length}`);
        b.addEventListener('click', () => { filter = k; draw(); });
        chips.append(b);
      }
      tableSlot.innerHTML = '';
      const shown = txs.filter((t) => !filter || t.kind === filter).slice(-400).reverse();
      tableSlot.append(table(
        [{ label: L('Block', 'Bloco', 'Bloque') }, { label: L('Cycle', 'Ciclo', 'Ciclo'), num: true }, { label: L('Kind', 'Tipo', 'Tipo') }, { label: L('Commander', 'Comandante', 'Comandante') }, { label: L('Posting', 'Lançamento', 'Asiento') }, { label: 'ELON', num: true }, { label: L('Transaction', 'Transação', 'Transacción') }],
        shown.map((t) => [`#${t.block ?? '—'}`, fmt(Math.floor(t.tick / 50)), kindLabel(t.kind), t.playerId >= 0 ? ownerTag(names.get(t.playerId) ?? `#${t.playerId}`, colors.get(t.playerId) ?? '#888') : '—', t.label, t.amount ? fmt(t.amount) : '—', code(shortHash(t.hash, 10, 6), t.hash)])));
    };
    draw();
    slot.append(
      readout([
        { label: L('Match', 'Partida', 'Partida'), value: c.matchId },
        { label: L('Blocks', 'Blocos', 'Bloques'), value: fmt(c.ledger.height + 1) },
        { label: L('Transactions', 'Transações', 'Transacciones'), value: fmt(txs.length) },
        { label: L('Chain integrity', 'Integridade da cadeia', 'Integridad de la cadena'), value: c.ledger.verified ? L('Every link verified', 'Todos os elos verificados', 'Todos los enlaces verificados') : L('Broken link', 'Elo quebrado', 'Enlace roto') },
      ]),
      grid('', panel({ title: L('Postings', 'Lançamentos', 'Asientos'), subtitle: L('Newest first. Showing up to 400.', 'Mais novos primeiro. Até 400.', 'Más nuevos primero. Hasta 400.'), tools: chips, body: 'table', foot: h('span', '', `${L('Ledger head', 'Topo do ledger', 'Cima del ledger')} `, code(c.ledger.head)) }, tableSlot)),
      grid('', panel({ title: L('Blocks', 'Blocos', 'Bloques'), subtitle: L('Latest 12 sealed blocks.', 'Últimos 12 blocos selados.', 'Últimos 12 bloques sellados.'), body: 'table' },
        table([{ label: L('Height', 'Altura', 'Altura'), num: true }, { label: L('Cycle', 'Ciclo', 'Ciclo'), num: true }, { label: 'Tx', num: true }, { label: L('Hash', 'Hash', 'Hash') }, { label: L('Previous', 'Anterior', 'Anterior') }, { label: L('Tx root', 'Raiz das tx', 'Raíz de tx') }],
          c.ledger.blocks.slice(-12).reverse().map((b) => [fmt(b.height), fmt(Math.floor(b.tick / 50)), String(b.txCount), code(shortHash(b.hash), b.hash), code(shortHash(b.prevHash), b.prevHash), code(shortHash(b.txRoot), b.txRoot)])))),
    );
  })();
}

// ---------------------------------------------------------------- Campaigns

export function renderCampaigns(root: HTMLElement, nav: PageNav): void {
  root.append(pageHead(
    L('Campaigns', 'Campanhas', 'Campañas'),
    L('History and audit trail', 'Histórico e trilha de auditoria', 'Historial y rastro de auditoría'),
    L('Every finished match on this server, newest first. Symbiosis matches carry a ledger and, when the chain is on, an on-chain commitment.', 'Toda partida concluída neste servidor, da mais nova para a mais antiga. Partidas Simbiose têm ledger e, com a blockchain ligada, um compromisso on-chain.', 'Cada partida terminada en este servidor, de la más nueva a la más antigua. Las partidas Simbiosis tienen ledger y, con la blockchain activada, un compromiso on-chain.'),
  ));
  const slot = h('div', '', loading());
  root.append(slot);
  void (async () => {
    const list = await campaigns().catch(() => []);
    slot.innerHTML = '';
    if (!list.length) { slot.append(emptyState(nav)); return; }
    const confirmed = list.filter((c) => c.proof?.status === 'confirmed').length;
    slot.append(
      readout([
        { label: L('Campaigns archived', 'Campanhas arquivadas', 'Campañas archivadas'), value: fmt(list.length) },
        { label: L('With a ledger', 'Com ledger', 'Con ledger'), value: fmt(list.filter((c) => c.ledger).length) },
        { label: L('Committed on-chain', 'Gravadas on-chain', 'Registradas on-chain'), value: fmt(confirmed) },
        { label: L('Latest', 'Mais recente', 'Más reciente'), value: new Date(list[0].savedAt).toLocaleString() },
      ]),
      grid('', panel({ title: L('All campaigns', 'Todas as campanhas', 'Todas las campañas'), body: 'table' },
        table([{ label: L('Match', 'Partida', 'Partida') }, { label: L('Finished', 'Fim', 'Fin') }, { label: L('Players', 'Jogadores', 'Jugadores'), num: true }, { label: L('Battlefield winner', 'Vencedor no campo', 'Ganador en el campo') }, { label: L('Top steward', 'Melhor steward', 'Mejor steward') }, { label: L('Ledger', 'Ledger', 'Ledger') }, { label: L('Proof', 'Prova', 'Prueba') }, { label: '' }],
          list.map((c) => {
            const pt = proofTone(c.proof);
            const open = h('a', { class: 'waLink', href: '#' }, L('Stewardship →', 'Stewardship →', 'Stewardship →'));
            open.addEventListener('click', (e) => { e.preventDefault(); nav.go('stewardship', c.matchId); });
            const ledger = c.ledger ? h('a', { class: 'waLink', href: '#' }, `${fmt(c.ledger.height + 1)} ${L('blocks', 'blocos', 'bloques')}`) : null;
            ledger?.addEventListener('click', (e) => { e.preventDefault(); nav.go('ledger', c.matchId); });
            return [h('span', '', code(c.matchId), c.dev ? h('span', '', ' ', badge('warning', L('Dev', 'Dev', 'Dev'))) : ''), new Date(c.savedAt).toLocaleString(), String(c.players), c.winnerName || '—', c.standings?.[0]?.name ?? '—', ledger ?? L('Classic', 'Clássica', 'Clásica'), badge(pt.tone, pt.text), c.standings?.length ? open : ''];
          })))),
    );
  })();
}

// ---------------------------------------------------------------- Codex

export function renderCodex(root: HTMLElement, nav: PageNav): void {
  const flow: [string, string, string][] = [
    ['01', L('Gather and settle', 'Colete e assente', 'Recolecta y asienta'), L('Villagers bring in food, wood, gold, and stone. Homes keep everyone housed — people waiting for a home count as unmet need.', 'Aldeões trazem comida, madeira, ouro e pedra. Casas mantêm todos abrigados — quem espera por moradia conta como necessidade não atendida.', 'Los aldeanos traen comida, madera, oro y piedra. Las casas mantienen a todos alojados — quien espera vivienda cuenta como necesidad no atendida.')],
    ['02', L('Power the grid', 'Energize a rede', 'Energiza la red'), L('Solar Arrays (+4) and Wind Turbines (+6) add supply; the Town Center gives 2. Lines on the map turn coral when the grid is overloaded.', 'Usinas Solares (+4) e Turbinas Eólicas (+6) somam geração; o Centro da Cidade dá 2. As linhas no mapa ficam coral quando a rede está sobrecarregada.', 'Plantas Solares (+4) y Turbinas Eólicas (+6) suman generación; el Centro Urbano da 2. Las líneas del mapa se vuelven coral si la red se sobrecarga.')],
    ['03', L('Automate', 'Automatize', 'Automatiza'), L('The Robotics Workshop trains Builder Robots (build 1.8×) and Construction Drones (fly over water, build 1.25×). Each draws grid power; an overloaded grid slows them.', 'A Oficina de Robótica treina Robôs Construtores (constroem 1,8×) e Drones de Obra (voam sobre a água, constroem 1,25×). Cada um consome energia; rede sobrecarregada os deixa lentos.', 'El Taller de Robótica entrena Robots Constructores (construyen 1,8×) y Drones de Obra (vuelan sobre el agua, construyen 1,25×). Cada uno consume energía; una red saturada los frena.')],
    ['04', L('Weigh the council', 'Pese o conselho', 'Sopesa el consejo'), L('The AI Council reads the same numbers you see and says what it would do next, and why. It never issues a command.', 'O Conselho de IA lê os mesmos números que você e diz o que faria a seguir, e por quê. Ele nunca dá ordens.', 'El Consejo de IA lee los mismos números que tú y dice qué haría y por qué. Nunca da órdenes.')],
    ['05', L('Live with it', 'Arque com as consequências', 'Vive con ello'), L('Every 5 seconds the server serves each commander\'s needs, posts ELON for what was met, and seals the cycle into the match ledger.', 'A cada 5 segundos o servidor atende as necessidades de cada comandante, lança ELON pelo que foi atendido e sela o ciclo no ledger da partida.', 'Cada 5 segundos el servidor atiende las necesidades de cada comandante, asienta ELON por lo atendido y sella el ciclo en el ledger.')],
  ];
  const ages: [string, string, string][] = [
    ['I', L('Settlement', 'Assentamento', 'Asentamiento'), L('Homes, first power, and a working economy.', 'Moradias, primeira energia e uma economia funcionando.', 'Viviendas, primera energía y una economía en marcha.')],
    ['II', L('Growth', 'Crescimento', 'Crecimiento'), L('Wind power, drones, and specialised production.', 'Energia eólica, drones e produção especializada.', 'Energía eólica, drones y producción especializada.')],
    ['III', L('Scale', 'Escala', 'Escala'), L('Institutions and heavy infrastructure that serve thousands.', 'Instituições e infraestrutura pesada que servem milhares.', 'Instituciones e infraestructura pesada que sirven a miles.')],
    ['IV', L('Philanthropy', 'Filantropia', 'Filantropía'), L('A civilization strong enough to turn its surplus outward.', 'Uma civilização forte o bastante para voltar o excedente para fora.', 'Una civilización lo bastante fuerte para volcar su excedente hacia fuera.')],
  ];
  const where: [PageId, string, string][] = [
    ['play', L('Play Realm', 'Jogar', 'Jugar'), L('Find or create a room and start a match.', 'Encontre ou crie uma sala e comece uma partida.', 'Encuentra o crea una sala y empieza una partida.')],
    ['stewardship', L('Stewardship', 'Stewardship', 'Stewardship'), L('Who served the commons most reliably?', 'Quem serviu o bem comum com mais confiabilidade?', '¿Quién sirvió al bien común con más fiabilidad?')],
    ['ledger', L('Commons Ledger', 'Ledger comum', 'Ledger común'), L('What exactly was recorded, and when?', 'O que exatamente foi registrado, e quando?', '¿Qué se registró exactamente y cuándo?')],
    ['campaigns', L('Campaigns', 'Campanhas', 'Campañas'), L('Which matches happened on this server?', 'Quais partidas aconteceram neste servidor?', '¿Qué partidas ocurrieron en este servidor?')],
    ['proof', L('Proof layer', 'Camada de prova', 'Capa de prueba'), L('Can I trust the record?', 'Posso confiar no registro?', '¿Puedo confiar en el registro?')],
  ];
  const whereGrid = h('div', 'whereGrid', ...where.map(([id, title, q]) => {
    const a = h('a', { href: '#' }, h('b', '', title), h('span', '', q));
    a.addEventListener('click', (e) => { e.preventDefault(); nav.go(id); });
    return a;
  }));
  const steps = (items: [string, string, string][]): HTMLElement => h('div', 'flowSteps', ...items.map(([n, t, p]) => h('article', '', h('i', '', n), h('div', '', h('h3', '', t), h('p', '', p)))));
  root.append(h('div', 'guidePage',
    h('section', 'guideHero',
      h('span', 'eyebrow', L('THE CIVILIZATION CODEX', 'O CÓDICE DA CIVILIZAÇÃO', 'EL CÓDICE DE LA CIVILIZACIÓN')),
      h('h1', '', L('How Age of Symbiosis is played', 'Como se joga Age of Symbiosis', 'Cómo se juega Age of Symbiosis')),
      h('p', '', L('A real-time strategy game where humans gather, robots and drones build, a shared grid sets the pace, and a hash-chained ledger remembers who served the commons.', 'Um jogo de estratégia em tempo real onde humanos coletam, robôs e drones constroem, uma rede compartilhada dita o ritmo e um ledger encadeado por hash lembra quem serviu o bem comum.', 'Un juego de estrategia en tiempo real donde los humanos recolectan, robots y drones construyen, una red compartida marca el ritmo y un ledger encadenado por hash recuerda quién sirvió al bien común.'))),
    h('section', { class: 'elonDefinition', id: 'elon' },
      h('div', '', h('span', '', 'ELON'), h('small', '', 'ENERGY · LABOR · OBLIGATION · NEED')),
      h('p', '', h('b', '', L('A memory of contribution, never money.', 'Uma memória de contribuição, nunca dinheiro.', 'Una memoria de contribución, nunca dinero.')), ' ', L('ELON records what each commander served, built, and promised. It cannot be spent, traded, or used to gate anything in the match.', 'ELON registra o que cada comandante atendeu, construiu e prometeu. Não pode ser gasto, trocado nem usado para barrar nada na partida.', 'ELON registra lo que cada comandante atendió, construyó y prometió. No se puede gastar, intercambiar ni usar para limitar nada en la partida.'))),
    h('section', 'flowSection', h('div', 'flowIntro', h('span', '', L('THE PLAYER LOOP', 'O CICLO DO JOGADOR', 'EL CICLO DEL JUGADOR')), h('h2', '', L('How a match is played', 'Como uma partida é jogada', 'Cómo se juega una partida')), h('p', '', L('Each cycle turns a strategic intention into a measurable consequence.', 'Cada ciclo transforma uma intenção estratégica numa consequência mensurável.', 'Cada ciclo convierte una intención estratégica en una consecuencia medible.'))), steps(flow)),
    h('section', 'flowSection ageCodex', h('div', 'flowIntro', h('span', '', L('THE FOUR AGES', 'AS QUATRO ERAS', 'LAS CUATRO EDADES')), h('h2', '', L('Progress is a relationship, not a tech tree', 'Progresso é uma relação, não uma árvore tecnológica', 'El progreso es una relación, no un árbol tecnológico')), h('p', '', L('Ages unlock capability; how you use it shows up in your stewardship record.', 'Eras liberam capacidade; como você a usa aparece no seu registro de stewardship.', 'Las edades desbloquean capacidad; cómo la usas aparece en tu registro de stewardship.'))), steps(ages)),
    h('section', 'flowSection', h('div', 'flowIntro', h('span', '', L('SCORING', 'PONTUAÇÃO', 'PUNTUACIÓN')), h('h2', '', L('Score = standing + stewardship + reliability', 'Pontuação = standing + stewardship + confiabilidade', 'Puntuación = standing + stewardship + fiabilidad')), h('p', '', L('The same rule as WATT Arena\'s archived campaigns, applied every 5-second cycle of a live match.', 'A mesma regra das campanhas arquivadas do WATT Arena, aplicada a cada ciclo de 5 segundos de uma partida ao vivo.', 'La misma regla de las campañas archivadas de WATT Arena, aplicada a cada ciclo de 5 segundos de una partida en vivo.'))), scoringRules()),
    h('section', 'whereSection', h('span', 'eyebrow', L('WORLD INTERFACE', 'INTERFACE DO MUNDO', 'INTERFAZ DEL MUNDO')), h('h2', '', L('Every screen has a strategic purpose', 'Cada tela tem um propósito estratégico', 'Cada pantalla tiene un propósito estratégico')), whereGrid),
  ));
}
