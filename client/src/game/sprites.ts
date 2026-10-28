// Carregador de SPRITES de prédio (PNGs em /public/sprites/). Se existir um
// sprite pro tipo (e opcionalmente pra era), o renderer desenha a imagem no
// lugar da arte procedural; se não existir, cai no desenho por código.
// Mesmo espírito do sistema de sons (arquivo-ou-reserva).
//
// IMPORTANTE: usar só arte LIVRE ou gerada por IA que é do usuário — nunca
// assets extraídos do AoE2 ou de jogos comerciais.
//
// VARIANTES POR ERA: cada prédio pode evoluir de visual por era (estilo AoE2).
// Arquivo base `<type>.png` serve todas as eras (reserva). Se existir
// `<type>_<era>.png` (ex.: house_2.png), ele é usado quando o dono está naquela
// era; sem o arquivo daquela era, usa a era inferior mais próxima e, por fim, o
// base. Só se tenta carregar as eras em que o prédio pode existir (>= ageReq).

import type { BuildingType } from '@age/shared';
import { BUILDING_DEFS, MAX_AGE } from '@age/shared';

/** Ajuste de encaixe do sprite no tile (por tipo). Tudo afinável por print. */
export interface SpriteFit {
  file: string;
  /** Largura desenhada = largura do losango do footprint × scale. */
  scale: number;
  /** Deslocamento vertical da base, em frações da meia-altura do tile (+ desce). */
  dropY: number;
}

/** Exportada pro `scripts/sprite_height_test.ts` conferir contra os PNGs de
 *  verdade que nenhuma caixa de clique passou da altura do sprite. */
export const BUILDING_SPRITES: Partial<Record<BuildingType, SpriteFit>> = {
  // TORRE: a arte é altíssima (PNG ~276×890 => razão 3.2). Sendo 1×1, a 1.25 ela
  // desenhava 8.1 alturas de tile — o DOBRO do Centro da Cidade, que é 3×3 e
  // desenha 4.15. Ficava um espeto no meio da base. 0.9375 = 1.25 × 0.75, ou seja
  // 25% menor MANTENDO A FORMA.
  //
  // Já tentamos cortar o pé da imagem (era mais tentador: encurtava sem afinar).
  // Não presta: o corte é uma linha RETA e horizontal, mas no isométrico a base
  // do prédio é um LOSANGO — a quina da frente desce mais que os lados. A torre
  // ficava com a borda de baixo reta, parecendo torta/enfiada no chão, enquanto
  // o vizinho tinha base com profundidade. Encolher preserva a base que o
  // desenhista já fez na perspectiva certa. Não voltar pro corte.
  watch_tower: { file: 'symbiosis_sensor_tower_v1.png', scale: 1.0, dropY: 0.22 },
  market: { file: 'symbiosis_trade_logistics_v1.png', scale: 1.08, dropY: 0.18 },
  // Age of Symbiosis v1 presentation set. Original era sprites remain in
  // /sprites as a non-destructive fallback while this visual direction is
  // validated against the existing footprints and selection geometry.
  house: { file: 'symbiosis_courtyard_home_v1.png', scale: 1.12, dropY: 0.18 },
  stable: { file: 'symbiosis_mobility_command_v1.png', scale: 1.03, dropY: 0.16 },
  // CC calibrado por MEDIÇÃO dos PNGs (conteúdo ocupa ~97,4% da largura, ~1,5%
  // de folga embaixo, consistente nas 4 eras): scale 1.0 => base casa com os
  // cantos do losango; dropY 0.15 => base no canto frontal (antes afundava).
  town_center: { file: 'symbiosis_civic_hub_v1.png', scale: 0.96, dropY: 0.12 },
  barracks: { file: 'symbiosis_army_basecamp_v1.png', scale: 1.03, dropY: 0.16 },
  blacksmith: { file: 'symbiosis_defense_lab_v1.png', scale: 1.08, dropY: 0.16 },
  robotics_workshop: { file: 'symbiosis_robotics_workshop_v1.png', scale: 1.05, dropY: 0.16 },
  archery_range: { file: 'symbiosis_drone_weapons_lab_v1.png', scale: 1.02, dropY: 0.16 },
  mill: { file: 'symbiosis_food_technology_v1.png', scale: 1.08, dropY: 0.16 },
  lumber_camp: { file: 'symbiosis_materials_depot_v1.png', scale: 1.08, dropY: 0.16 },
  mining_camp: { file: 'symbiosis_mineral_processing_v1.png', scale: 1.08, dropY: 0.16 },
  // PORTO: fica na água (2×2 encostado na costa); a arte é larga (o cais estende
  // pro lado), então escala um pouco maior. Calibrado por print no jogo.
  dock: { file: 'symbiosis_river_terminal_v1.png', scale: 1.12, dropY: 0.2 },
  farm: { file: 'symbiosis_hydroponic_farm_v1.png', scale: 1.04, dropY: 0.12 },
  // The protection wall stays procedural because repeated 1×1 segments must
  // connect in every direction; a single bitmap cannot preserve those joins.
};

export class Sprites {
  // por tipo: mapa era->img (era 0 = arquivo base, reserva universal)
  private imgs = new Map<BuildingType, Map<number, HTMLImageElement>>();
  private fits = new Map<BuildingType, SpriteFit>();

  /** Dispara o carregamento dos PNGs presentes. Ausentes ficam sem sprite. */
  preload(base = '/sprites/'): void {
    for (const [type, fit] of Object.entries(BUILDING_SPRITES) as [BuildingType, SpriteFit][]) {
      this.fits.set(type, fit);
      const perEra = new Map<number, HTMLImageElement>();
      this.imgs.set(type, perEra);
      const load = (era: number, file: string): void => {
        const img = new Image();
        img.onload = () => { perEra.set(era, img); };
        img.onerror = () => { /* arquivo ausente: usa reserva/procedural */ };
        img.src = base + file;
      };
      // base (sem sufixo) = reserva pra qualquer era
      load(0, fit.file);
      // variantes por era: <type>_<era>.png, só das eras em que o prédio existe
      const dot = fit.file.lastIndexOf('.');
      const stem = fit.file.slice(0, dot), ext = fit.file.slice(dot);
      const ageReq = BUILDING_DEFS[type].ageReq;
      for (let a = ageReq; a <= MAX_AGE; a++) load(a, `${stem}_${a}${ext}`);
    }
  }

  /** Sprite pra este tipo na era dada, ou null (então usa o desenho por código).
   *  Preferência: era exata → era inferior mais próxima → base. */
  get(type: BuildingType, age = 1): { img: HTMLImageElement; fit: SpriteFit } | null {
    const perEra = this.imgs.get(type);
    const fit = this.fits.get(type);
    if (!perEra || !fit) return null;
    // Sem crescimento por era: o prédio preenche o footprint em TODAS as eras
    // (fit.scale já é o tamanho "cheio"). Antes ele encolhia na Era 1 e ficava
    // menor que o quadrado de seleção. A ARTE ainda pode mudar por era abaixo
    // (variantes <type>_<era>.png); só o encolhimento saiu.
    for (let a = age; a >= 1; a--) { const img = perEra.get(a); if (img) return { img, fit }; }
    const b = perEra.get(0);
    return b ? { img: b, fit } : null;
  }
}

/** Sprites de ÁRVORE (variações sorteadas por posição). Estáticas, sem era.
 *  tree_1.png, tree_2.png, ... — se nenhuma existir, o renderer usa a árvore
 *  procedural. Mesmo espírito do fallback dos prédios. */
export class TreeSprites {
  private imgs: (HTMLImageElement | undefined)[] = [];

  preload(base = '/sprites/', count = 8): void {
    for (let i = 1; i <= count; i++) {
      const img = new Image();
      img.onload = () => { this.imgs[i - 1] = img; };
      img.onerror = () => { /* ausente: usa árvore procedural */ };
      img.src = `${base}tree_${i}.png`;
    }
  }

  /** Uma variação estável para o seed dado (posição da árvore), ou null. */
  get(seed: number): HTMLImageElement | null {
    const list = this.imgs.filter((x): x is HTMLImageElement => !!x);
    if (!list.length) return null;
    return list[Math.abs(seed) % list.length];
  }
}

export type ConstructionSprite = 'human' | 'humanoid' | 'mason' | 'builder_robot' | 'material_rover' | 'drone' | 'crane';

/** Civilian construction art imported from the independently owned WATT Arena
 * project. These are presentation-only overlays; the simulation still derives
 * every worker, progress value, and completion event from server snapshots. */
export class ConstructionSprites {
  private imgs = new Map<ConstructionSprite, HTMLImageElement>();

  preload(base = '/sprites/'): void {
    const files: Record<ConstructionSprite, string> = {
      human: 'symbiosis_human_builders_v1.png',
      humanoid: 'symbiosis_humanoid_installer_v1.png',
      mason: 'symbiosis_humanoid_mason_v1.png',
      builder_robot: 'symbiosis_ai_builder_robot_v1.png',
      material_rover: 'symbiosis_material_rover_v1.png',
      drone: 'symbiosis_construction_drone_v1.png',
      crane: 'symbiosis_autonomous_crane_v1.png',
    };
    for (const [kind, file] of Object.entries(files) as [ConstructionSprite, string][]) {
      const img = new Image();
      img.onload = () => { this.imgs.set(kind, img); };
      img.onerror = () => { /* keep the renderer's procedural fallback */ };
      img.src = base + file;
    }
  }

  get(kind: ConstructionSprite): HTMLImageElement | null {
    return this.imgs.get(kind) ?? null;
  }
}

export type SymbiosisCombatSprite = 'attack_drone' | 'fighter' | 'rocket_launcher';

/** Original transparent combat-unit cutouts. Simulation and hit geometry stay
 * unit-based; these images only replace the procedural body drawing. */
export class SymbiosisCombatSprites {
  private imgs = new Map<SymbiosisCombatSprite, HTMLImageElement>();

  preload(base = '/sprites/'): void {
    for (const kind of ['attack_drone', 'fighter', 'rocket_launcher'] as const) {
      const img = new Image();
      img.onload = () => { this.imgs.set(kind, img); };
      img.onerror = () => { /* renderer uses a compact geometric fallback */ };
      img.src = `${base}symbiosis_${kind}_v1.png`;
    }
  }

  get(kind: SymbiosisCombatSprite): HTMLImageElement | null {
    return this.imgs.get(kind) ?? null;
  }
}
