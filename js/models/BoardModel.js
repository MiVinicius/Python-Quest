/**
 * BoardModel.js
 * Mapeamento da Trilha em Zigue-Zague Descendente:
 * Suporta:
 * - Modo Completo ('full'): 64 casas (8 ciclos de 6 horizontais + 2 verticais)
 * - Modo Demonstração ('demo'): 32 casas (4 ciclos completos de 6 horizontais + 2 verticais),
 *   com alta densidade de desafios, atalhos e bugs sem colisão de destinos.
 */
export class BoardModel {
  constructor(mode = 'full') {
    this.GRID_COLS = 6;
    this.mode = mode;
    this.TOTAL_TILES = mode === 'demo' ? 32 : 64;
    this.tiles = this.generateTiles(mode);
  }

  setBoardMode(mode = 'full') {
    this.mode = mode === 'demo' ? 'demo' : 'full';
    this.TOTAL_TILES = this.mode === 'demo' ? 32 : 64;
    this.tiles = this.generateTiles(this.mode);
    return this.TOTAL_TILES;
  }

  generateTiles(mode = this.mode) {
    const tiles = {};
    const isDemo = (mode === 'demo');
    const total = isDemo ? 32 : 64;
    this.TOTAL_TILES = total;

    // Atalhos estratégicos (todos pousam em casas normais)
    const shortcuts = isDemo
      ? {
          5: { bonus: 3, label: 'Atalho: Algoritmo O(1) (+3)' },     // 5 + 3 = 8 (normal)
          13: { bonus: 3, label: 'Atalho: Turbo Cache (+3)' },       // 13 + 3 = 16 (normal)
          23: { bonus: 3, label: 'Atalho: Refatoração Limpa (+3)' }  // 23 + 3 = 26 (normal)
        }
      : {
          5: { bonus: 3, label: 'Atalho: Algoritmo O(1) (+3)' },     // 5 + 3 = 8 (normal)
          19: { bonus: 4, label: 'Atalho: Turbo Cache (+4)' },       // 19 + 4 = 23 (normal)
          34: { bonus: 3, label: 'Atalho: Refatoração Limpa (+3)' }, // 34 + 3 = 37 (normal)
          52: { bonus: 4, label: 'Atalho: Otimização de GPU (+4)' }  // 52 + 4 = 56 (normal)
        };

    // Armadilhas / Bugs (todos recuam para casas normais)
    const traps = isDemo
      ? {
          9: { penalty: 2, label: 'Bug: Memory Leak (-2)' },          // 9 - 2 = 7 (normal)
          18: { penalty: 3, label: 'Bug: Recursão Infinita (-3)' },   // 18 - 3 = 15 (normal)
          28: { penalty: 3, label: 'Bug: NullPointerException (-3)' } // 28 - 3 = 25 (normal)
        }
      : {
          12: { penalty: 3, label: 'Bug: Memory Leak (-3)' },         // 12 - 3 = 9 (normal)
          26: { penalty: 4, label: 'Bug: Recursão Infinita (-4)' },   // 26 - 4 = 22 (normal)
          44: { penalty: 3, label: 'Bug: NullPointerException (-3)' },// 44 - 3 = 41 (normal)
          59: { penalty: 5, label: 'Bug Crítico: Kernel Panic (-5)' } // 59 - 5 = 54 (normal)
        };

    // Casas de Desafio Python (nenhuma coincide com destinos de atalhos ou bugs)
    const challenges = isDemo
      ? [3, 6, 11, 14, 19, 21, 24, 29, 30]
      : [4, 7, 10, 14, 17, 21, 25, 29, 32, 36, 40, 43, 47, 50, 55, 58, 62];

    for (let i = 1; i <= total; i++) {
      let type = 'normal';
      let effect = null;
      let label = `Casa ${i}`;

      if (i === 1) {
        type = 'start';
        label = isDemo ? 'Largada: Início da Demonstração' : 'Largada: Início da Corrida';
      } else if (i === total) {
        type = 'goal';
        label = isDemo ? `Meta Demo: Python Master (Casa ${total})` : `Meta: Python Master (Casa ${total})`;
      } else if (shortcuts[i]) {
        type = 'shortcut';
        effect = { steps: shortcuts[i].bonus };
        label = shortcuts[i].label;
      } else if (traps[i]) {
        type = 'trap';
        effect = { steps: -traps[i].penalty };
        label = traps[i].label;
      } else if (challenges.includes(i)) {
        type = 'challenge';
        label = 'Arena de Desafio Python!';
      }

      // Cálculo da coordenada no zigue-zague de 6 na linha + 2 na coluna:
      const zeroIdx = i - 1;
      const cycle = Math.floor(zeroIdx / 8);
      const posInCycle = zeroIdx % 8; // 0 a 7

      let row = 1;
      let col = 1;
      let flowDirection = 'right'; // 'right' | 'down' | 'left'

      if (posInCycle < 6) {
        row = cycle * 3 + 1;
        if (cycle % 2 === 0) {
          col = posInCycle + 1;
          flowDirection = posInCycle === 5 ? 'down' : 'right';
        } else {
          col = 6 - posInCycle;
          flowDirection = posInCycle === 5 ? 'down' : 'left';
        }
      } else {
        const step = posInCycle - 6; // 0 ou 1
        row = cycle * 3 + 2 + step;
        col = (cycle % 2 === 0) ? 6 : 1;
        flowDirection = (step === 1) ? (cycle % 2 === 0 ? 'left' : 'right') : 'down';
      }

      if (i === total) {
        flowDirection = 'right';
      }

      tiles[i] = {
        number: i,
        type,
        effect,
        label,
        row,
        col,
        flowDirection
      };
    }

    return tiles;
  }

  getTile(number) {
    return this.tiles[number] || null;
  }
}
