/**
 * CodingController.js
 * Coordena a montagem de blocos com a restrição de energia do dado,
 * validando a sintaxe lógica e autorizando o movimento do jogador.
 */
export class CodingController {
  constructor(blockModel, workspaceView, diceModel, gameStateModel, soundView) {
    this.blockModel = blockModel;
    this.workspaceView = workspaceView;
    this.diceModel = diceModel;
    this.gameState = gameStateModel;
    this.sound = soundView;

    this.onValidExecutionCallback = null;

    this.setupEvents();
  }

  setupEvents() {
    this.workspaceView.onExecute(() => {
      this.handleExecute();
    });

    this.workspaceView.onBlockChanged(() => {
      this.sound.playBlockSnap();
    });
  }

  unlockCoding() {
    this.workspaceView.setExecuteDisabled(false);
  }

  lockCoding() {
    this.workspaceView.setExecuteDisabled(true);
  }

  handleExecute() {
    if (this.gameState.currentTurn !== 'player' || this.gameState.phase !== 'coding') {
      const waitMsg = 'Role o dado primeiro para gerar sua energia de passos antes de executar.';
      this.gameState.addLog('Sistema', waitMsg, 'warning');
      if (typeof this.workspaceView.showValidationFeedback === 'function') {
        this.workspaceView.showValidationFeedback(waitMsg, 'warning');
      }
      return;
    }

    const diceTotal = this.gameState.lastDiceValue;
    const validation = this.blockModel.validateAgainstDice(diceTotal, {
      jumpCharges: this.gameState.jumpCharges,
      shieldCharges: this.gameState.shieldCharges
    });

    if (validation.valid) {
      this.sound.playCompileSuccess();
      this.gameState.addLog('Compilador', `Status 200 OK: ${validation.message}`, 'success');
      if (typeof this.workspaceView.showValidationFeedback === 'function') {
        this.workspaceView.showValidationFeedback(validation.message, 'success');
      }
      this.lockCoding();
      
      if (this.onValidExecutionCallback) {
        this.onValidExecutionCallback(validation.steps, validation.actions);
      }
    } else {
      this.sound.playCompileError();
      this.gameState.addLog('Compilador', `Erro de Lógica: ${validation.message}`, 'danger');
      if (typeof this.workspaceView.showValidationFeedback === 'function') {
        this.workspaceView.showValidationFeedback(validation.message, 'error');
      }
    }
  }

  onValidExecution(callback) {
    this.onValidExecutionCallback = callback;
  }
}
