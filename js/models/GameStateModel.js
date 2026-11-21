/**
 * GameStateModel.js
 * Gerencia o estado reativo da corrida entre o Jogador e a CPU.
 */
export class GameStateModel {
  constructor() {
    this.TOTAL_TILES = 64;
    this.INITIAL_COINS = 10;
    this.PYTHON_UNLOCK_COST = 10;
    this.TIME_EXTEND_COST = 10;
    this.INITIAL_JUMP_CHARGES = 2;
    this.INITIAL_SHIELD_CHARGES = 2;
    this.MAX_TACTICAL_CHARGES = 3;
    this.logListeners = [];
    this.reset();
  }

  setTotalTiles(total = 64) {
    this.TOTAL_TILES = total;
  }

  reset() {
    this.playerPos = 1;
    this.botPos = 1;
    this.currentTurn = 'player'; // 'player' | 'bot'
    this.phase = 'waiting_roll'; // 'waiting_roll' | 'coding' | 'moving' | 'challenge' | 'game_over'
    
    // Economia da Partida (Moedas, Desbloqueio Adaptativo, Tempo Extra e Cargas Táticas)
    this.playerCoins = this.INITIAL_COINS;
    this.pythonUnlockedThisTurn = false;
    this.pythonUnlockReason = null; // null | 'coins' | 'behind' | 'common_miss'
    this.freePythonUnlocks = 0;
    this.jumpCharges = this.INITIAL_JUMP_CHARGES;
    this.shieldCharges = this.INITIAL_SHIELD_CHARGES;
    this.challengeStreak = 0;

    // Bônus e status
    this.playerBoost = 0; // passos extras na próxima rolagem
    this.playerStunned = false; // se perde o próximo turno
    this.playerShielded = false; // proteção try...except contra próxima armadilha
    this.botBoost = 0;
    this.botStunned = false;
    
    this.roundCount = 1;
    this.winner = null;
    this.lastDiceRoll = 0;
    this.lastDiceBonus = 0;
    this.lastDiceValue = 0;
    this.logs = [];
  }

  addCoins(amount) {
    const val = Math.max(0, parseInt(amount, 10) || 0);
    this.playerCoins += val;
    return this.playerCoins;
  }

  spendCoins(amount) {
    const cost = Math.max(0, parseInt(amount, 10) || 0);
    if (this.playerCoins < cost) {
      return {
        success: false,
        needed: cost - this.playerCoins,
        cost,
        remainingCoins: this.playerCoins
      };
    }
    this.playerCoins -= cost;
    return {
      success: true,
      cost,
      remainingCoins: this.playerCoins
    };
  }

  grantFreePythonUnlock(count = 1) {
    const add = Math.max(0, parseInt(count, 10) || 0);
    this.freePythonUnlocks += add;
    return this.freePythonUnlocks;
  }

  consumeTacticalCharges({ jumps = 0, shields = 0 } = {}) {
    if (jumps > 0) {
      this.jumpCharges = Math.max(0, this.jumpCharges - jumps);
    }
    if (shields > 0) {
      this.shieldCharges = Math.max(0, this.shieldCharges - shields);
    }
    return { jumpCharges: this.jumpCharges, shieldCharges: this.shieldCharges };
  }

  rechargeTacticalCharges(amount = 1) {
    const add = Math.max(0, parseInt(amount, 10) || 0);
    const prevJump = this.jumpCharges;
    const prevShield = this.shieldCharges;
    this.jumpCharges = Math.min(this.MAX_TACTICAL_CHARGES, this.jumpCharges + add);
    this.shieldCharges = Math.min(this.MAX_TACTICAL_CHARGES, this.shieldCharges + add);
    return {
      jumpGained: this.jumpCharges - prevJump,
      shieldGained: this.shieldCharges - prevShield,
      jumpCharges: this.jumpCharges,
      shieldCharges: this.shieldCharges
    };
  }

  applyAutoPythonAssistance() {
    if (this.playerPos < this.botPos) {
      this.pythonUnlockedThisTurn = true;
      this.pythonUnlockReason = 'behind';
      return { unlocked: true, reason: 'behind' };
    }
    if (this.freePythonUnlocks > 0) {
      this.freePythonUnlocks -= 1;
      this.pythonUnlockedThisTurn = true;
      this.pythonUnlockReason = 'common_miss';
      return { unlocked: true, reason: 'common_miss', remainingPasses: this.freePythonUnlocks };
    }
    return { unlocked: false, reason: null };
  }

  unlockPythonForTurn() {
    if (this.pythonUnlockedThisTurn) {
      return {
        success: true,
        alreadyUnlocked: true,
        reason: this.pythonUnlockReason,
        remainingCoins: this.playerCoins
      };
    }
    const spent = this.spendCoins(this.PYTHON_UNLOCK_COST);
    if (!spent.success) {
      return spent;
    }
    this.pythonUnlockedThisTurn = true;
    this.pythonUnlockReason = 'coins';
    return {
      success: true,
      reason: 'coins',
      cost: this.PYTHON_UNLOCK_COST,
      remainingCoins: this.playerCoins
    };
  }

  onLog(callback) {
    if (typeof callback === 'function') {
      this.logListeners.push(callback);
    }
  }

  addLog(sender, text, type = 'info') {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const entry = { sender, text, type, time };
    this.logs.unshift(entry);
    if (this.logs.length > 60) this.logs.pop();

    // Notifica ouvintes reativos (ex: StatusPanelView terminal)
    this.logListeners.forEach(listener => {
      try {
        listener(entry);
      } catch (err) {
        console.error('Erro no log listener:', err);
      }
    });

    return entry;
  }

  setPhase(newPhase) {
    this.phase = newPhase;
  }

  setRollData(roll, bonus, total) {
    this.lastDiceRoll = roll;
    this.lastDiceBonus = bonus;
    this.lastDiceValue = total;
  }

  setDiceValue(val) {
    this.lastDiceValue = val;
    if (!this.lastDiceRoll) {
      this.lastDiceRoll = val;
    }
  }

  advancePlayer(steps) {
    this.playerPos = Math.min(this.TOTAL_TILES, Math.max(1, this.playerPos + steps));
    if (this.playerPos >= this.TOTAL_TILES) {
      this.winner = 'player';
      this.phase = 'game_over';
    }
    return this.playerPos;
  }

  advanceBot(steps) {
    this.botPos = Math.min(this.TOTAL_TILES, Math.max(1, this.botPos + steps));
    if (this.botPos >= this.TOTAL_TILES) {
      this.winner = 'bot';
      this.phase = 'game_over';
    }
    return this.botPos;
  }

  toggleTurn() {
    if (this.phase === 'game_over') return;

    this.pythonUnlockedThisTurn = false;
    this.pythonUnlockReason = null;
    if (this.currentTurn === 'player') {
      this.currentTurn = 'bot';
    } else {
      this.currentTurn = 'player';
      this.roundCount++;
    }
    this.phase = 'waiting_roll';
  }
}
