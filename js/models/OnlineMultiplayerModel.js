/**
 * OnlineMultiplayerModel.js
 * Sistema Multiplayer Serverless 100% compatível com GitHub Pages e Execução Local.
 * Arquitetura resiliente em 3 camadas com entrega garantida e ordenada:
 * 1. BroadcastChannel + Storage Events (< 1ms entre abas do mesmo navegador).
 * 2. WebRTC Peer-to-Peer (PeerJS DataChannel com STUN + TURN) com upgrade contínuo mesmo após o início da sala.
 * 3. Relay HTTPS/WSS (ntfy.sh) com fila serializada de POST, retry/backoff em HTTP 429,
 *    reconexão automática de WebSocket via ?since=<lastId> e fallback por HTTP polling.
 * 4. Protocolo de confiabilidade na camada de aplicação: ordenação estrita por seqId,
 *    confirmação consolidada (ACTION_ACK), reenvio automático e RESEND_REQUEST para lacunas.
 */
export class OnlineMultiplayerModel {
  constructor() {
    this.tabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.roomCode = null;
    this.roomSessionId = null;
    this.playerRole = null; // 'host' | 'guest'
    this.connected = false;
    this.hasAcceptedGuest = false;
    this.isQuickMatchSearching = false;
    this.listeners = [];

    // Controle de sequência, ordenação, deduplicação e ACK
    this.outgoingSeqId = 0;
    this.processedActionIds = new Set();
    this.sentActionHistory = new Map(); // seqId -> actionPacket
    this.unackedActions = new Map(); // seqId -> { packet, sentAt, lastAttemptAt, attempts }
    this.expectedRemoteSeqId = 1;
    this.remoteReorderBuffer = new Map(); // seqId -> actionPacket
    this.reorderGapTimer = null;
    this.ackRetryTimer = null;
    this.relayAckDebounceTimer = null;
    this.pendingRelayAckSeq = 0;

    // WebRTC (PeerJS)
    this.PeerClass = null;
    this.peer = null;
    this.dataConn = null;
    this.activeConnections = [];
    this.pendingOutgoingQueue = [];
    this.mmPeer = null;
    this.peerConnectRetryTimer = null;

    // Relay WebSocket + HTTP Polling + Fila serializada de POST
    this.roomWs = null;
    this.roomWsTopic = null;
    this.roomRelayShouldStayOpen = false;
    this.roomWsReconnectTimer = null;
    this.roomWsReconnectAttempt = 0;
    this.lastRoomRelayMsgId = null;
    this.lastRoomRelayMsgTime = 0;
    this.lastRoomRelayActivityAt = 0;
    this.roomPollTimer = null;
    this.isPollingRelay = false;
    this.relayPostQueue = [];
    this.isFlushingRelayQueue = false;

    // QuickMatch / Join timers
    this.qmWs = null;
    this.qmAnnounceTimer = null;
    this.joinRetryTimer = null;
    this.pendingGuestProfile = null;
    this.pendingJoinResolve = null;
    this.connectionTransport = 'idle'; // 'idle' | 'p2p' | 'relay' | 'reconnecting'

    // Monitoramento de presença do oponente (saída imediata + queda silenciosa)
    this.lastOpponentSeenAt = 0;
    this.lastHeartbeatSentAt = 0;
    this.opponentPresenceState = 'online'; // 'online' | 'unstable' | 'disconnected' | 'left'
    this.presenceTimer = null;
    this.hasSentLeaveSignal = false;

    // Canal local para sincronização instantânea entre abas do mesmo navegador
    this.channel = null;
    this.setupSyncChannel();
    this.setupLifecycleListeners();
  }

  getPeerOptions() {
    return {
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          }
        ]
      }
    };
  }

  async loadPeerJS() {
    if (this.PeerClass) return this.PeerClass;
    if (typeof window !== 'undefined' && window.Peer) {
      this.PeerClass = window.Peer;
      return this.PeerClass;
    }
    try {
      const mod = await import('https://esm.sh/peerjs@1.5.4');
      this.PeerClass = mod.Peer || mod.default;
      return this.PeerClass;
    } catch (err) {
      console.info('PeerJS CDN indisponível: usando BroadcastChannel / Relay.');
      return null;
    }
  }

  setupSyncChannel() {
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        this.channel = new BroadcastChannel('python_quest_p2p_sync');
        this.channel.onmessage = (event) => {
          this.handleIncomingMessage(event.data, 'local');
        };
      }
      if (typeof window !== 'undefined') {
        window.addEventListener('storage', (event) => {
          if (event.key && event.key.startsWith('py_sync_evt_') && event.newValue) {
            try {
              const data = JSON.parse(event.newValue);
              this.handleIncomingMessage(data, 'local');
            } catch (e) {}
          }
        });
      }
    } catch (err) {
      console.warn('BroadcastChannel não suportado:', err);
    }
  }

  setupLifecycleListeners() {
    if (typeof window === 'undefined') return;
    const cleanup = () => {
      this.notifyPlayerLeft(true);
      this.clearQuickMatchQueueIfMine();
      this.cleanupPeers();
    };
    window.addEventListener('beforeunload', cleanup);
    window.addEventListener('pagehide', cleanup);

    // Ao voltar para a aba (comum em mobile) ou recuperar internet, reconecta e puxa eventos pendentes
    const recoverConnection = () => {
      if (!this.connected || !this.roomCode) return;
      if (!this.roomWs || this.roomWs.readyState !== 1) {
        this.connectRoomRelay(this.roomCode, true);
      }
      this.pollRoomRelayOnce();
      this.retryPendingUnackedActions(true);
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          recoverConnection();
        }
      });
    }
    window.addEventListener('online', recoverConnection);
  }

  onStateChange(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback);
    }
  }

  notifyListeners(data) {
    this.listeners.forEach((cb) => {
      try {
        cb(data);
      } catch (e) {
        console.error('Erro no multiplayer listener:', e);
      }
    });
  }

  updateConnectionStatus() {
    let next = 'idle';
    if (this.connected && this.roomCode) {
      if (this.isWebRTCOpen()) {
        next = 'p2p';
      } else if (this.roomWs && this.roomWs.readyState === 1) {
        next = 'relay';
      } else {
        next = 'reconnecting';
      }
    }
    if (next !== this.connectionTransport) {
      this.connectionTransport = next;
      this.notifyListeners({
        type: 'CONNECTION_STATUS',
        status: next,
        roomCode: this.roomCode
      });
    }
  }

  isWebRTCOpen() {
    if (this.dataConn && this.dataConn.open) return true;
    return this.activeConnections.some((c) => c && c.open);
  }

  getCleanCode(roomCode) {
    return (roomCode || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  }

  getPeerRoomId(roomCode) {
    return `python-quest-v2-room-${this.getPeerCleanId(roomCode)}`;
  }

  getPeerCleanId(roomCode) {
    return this.getCleanCode(roomCode);
  }

  getRelayRoomTopic(roomCode) {
    return `pq_sync_2026_room_${this.getCleanCode(roomCode)}`;
  }

  getRelayQuickMatchTopic() {
    return 'pq_sync_2026_qm_lobby_v2';
  }

  resetSessionSequencing() {
    this.outgoingSeqId = 0;
    this.expectedRemoteSeqId = 1;
    this.processedActionIds.clear();
    this.sentActionHistory.clear();
    this.unackedActions.clear();
    this.remoteReorderBuffer.clear();
    this.pendingRelayAckSeq = 0;
    this.lastRoomRelayMsgId = null;
    this.lastRoomRelayMsgTime = 0;
    this.lastOpponentSeenAt = 0;
    this.lastHeartbeatSentAt = 0;
    this.opponentPresenceState = 'online';
    this.hasSentLeaveSignal = false;
    this.stopPresenceMonitor();
    if (this.reorderGapTimer) {
      clearTimeout(this.reorderGapTimer);
      this.reorderGapTimer = null;
    }
    if (this.relayAckDebounceTimer) {
      clearTimeout(this.relayAckDebounceTimer);
      this.relayAckDebounceTimer = null;
    }
  }

  // =========================================================================
  // CAMADA DE RELAY RESILIENTE (WebSocket com reconexão + HTTP Polling + Fila POST)
  // =========================================================================

  connectRoomRelay(roomCode, forceReconnect = false) {
    if (typeof WebSocket === 'undefined' || !roomCode) return;
    const topic = this.getRelayRoomTopic(roomCode);

    if (
      !forceReconnect &&
      this.roomWs &&
      this.roomWsTopic === topic &&
      (this.roomWs.readyState === 0 || this.roomWs.readyState === 1)
    ) {
      return;
    }

    this.roomRelayShouldStayOpen = true;
    this.roomWsTopic = topic;

    if (this.roomWsReconnectTimer) {
      clearTimeout(this.roomWsReconnectTimer);
      this.roomWsReconnectTimer = null;
    }
    if (this.roomWs) {
      try {
        this.roomWs.onopen = null;
        this.roomWs.onmessage = null;
        this.roomWs.onerror = null;
        this.roomWs.onclose = null;
        this.roomWs.close();
      } catch (_) {}
      this.roomWs = null;
    }

    const sinceParam = this.lastRoomRelayMsgId
      ? encodeURIComponent(this.lastRoomRelayMsgId)
      : '30s';

    try {
      const ws = new WebSocket(`wss://ntfy.sh/${topic}/ws?since=${sinceParam}`);
      this.roomWs = ws;
      this.updateConnectionStatus();

      ws.onopen = () => {
        if (this.roomWs !== ws) return;
        this.roomWsReconnectAttempt = 0;
        this.lastRoomRelayActivityAt = Date.now();
        this.updateConnectionStatus();
      };

      ws.onmessage = (evt) => {
        if (this.roomWs !== ws) return;
        this.lastRoomRelayActivityAt = Date.now();
        this.processRelayWrapperLine(evt.data);
      };

      ws.onerror = () => {
        // O fechamento subsequente (onclose) aciona a reconexão com backoff
      };

      ws.onclose = () => {
        if (this.roomWs !== ws) return;
        this.roomWs = null;
        this.updateConnectionStatus();
        if (this.roomRelayShouldStayOpen && this.roomCode) {
          this.scheduleRoomRelayReconnect();
        }
      };
    } catch (_) {
      this.updateConnectionStatus();
      if (this.roomRelayShouldStayOpen && this.roomCode) {
        this.scheduleRoomRelayReconnect();
      }
    }

    this.startRoomRelayPolling();
    this.startAckRetryMonitor();
  }

  scheduleRoomRelayReconnect() {
    if (this.roomWsReconnectTimer || !this.roomRelayShouldStayOpen || !this.roomCode) return;
    const delay = Math.min(8000, 1000 * Math.pow(2, this.roomWsReconnectAttempt));
    this.roomWsReconnectAttempt = Math.min(this.roomWsReconnectAttempt + 1, 4);
    this.roomWsReconnectTimer = setTimeout(() => {
      this.roomWsReconnectTimer = null;
      if (this.roomRelayShouldStayOpen && this.roomCode) {
        this.connectRoomRelay(this.roomCode, true);
        this.pollRoomRelayOnce();
      }
    }, delay);
  }

  processRelayWrapperLine(rawLine) {
    if (!rawLine || typeof rawLine !== 'string') return;
    try {
      const wrapper = JSON.parse(rawLine);
      if (!wrapper) return;
      if (wrapper.id && wrapper.event === 'message') {
        const msgTime = typeof wrapper.time === 'number' ? wrapper.time : 0;
        if (msgTime >= this.lastRoomRelayMsgTime) {
          this.lastRoomRelayMsgTime = msgTime;
          this.lastRoomRelayMsgId = wrapper.id;
        }
      }
      if (wrapper.event === 'message' && wrapper.message) {
        const payload = JSON.parse(wrapper.message);
        if (payload && payload.senderTabId !== this.tabId) {
          this.handleIncomingMessage(payload, 'relay');
        }
      }
    } catch (_) {}
  }

  startRoomRelayPolling() {
    if (this.roomPollTimer) return;
    this.roomPollTimer = setInterval(() => {
      if (!this.roomRelayShouldStayOpen || !this.roomCode) return;
      const wsOpen = Boolean(this.roomWs && this.roomWs.readyState === 1);
      const staleMs = Date.now() - (this.lastRoomRelayActivityAt || 0);
      // Faz polling rápido (3.5s) se WebSocket caiu ou se há lacuna/WebRTC fechado e sem atividade recente
      if (!wsOpen || this.remoteReorderBuffer.size > 0 || (!this.isWebRTCOpen() && staleMs > 7000)) {
        this.pollRoomRelayOnce();
      }
    }, 3500);
  }

  async pollRoomRelayOnce() {
    if (this.isPollingRelay || !this.roomCode || typeof fetch === 'undefined') return;
    this.isPollingRelay = true;
    const topic = this.getRelayRoomTopic(this.roomCode);
    const sinceParam = this.lastRoomRelayMsgId
      ? encodeURIComponent(this.lastRoomRelayMsgId)
      : '90s';

    try {
      const res = await fetch(`https://ntfy.sh/${topic}/json?poll=1&since=${sinceParam}`, {
        cache: 'no-store'
      });
      if (res.ok) {
        const text = await res.text();
        if (text) {
          const lines = text.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) this.processRelayWrapperLine(trimmed);
          }
        }
      }
    } catch (_) {
      // Silencia falha transitória de rede no polling; próxima iteração tenta de novo
    } finally {
      this.isPollingRelay = false;
    }
  }

  closeRoomRelay() {
    this.roomRelayShouldStayOpen = false;
    if (this.roomWsReconnectTimer) {
      clearTimeout(this.roomWsReconnectTimer);
      this.roomWsReconnectTimer = null;
    }
    if (this.roomPollTimer) {
      clearInterval(this.roomPollTimer);
      this.roomPollTimer = null;
    }
    if (this.ackRetryTimer) {
      clearInterval(this.ackRetryTimer);
      this.ackRetryTimer = null;
    }
    if (this.roomWs) {
      try {
        this.roomWs.onopen = null;
        this.roomWs.onmessage = null;
        this.roomWs.onerror = null;
        this.roomWs.onclose = null;
        this.roomWs.close();
      } catch (_) {}
      this.roomWs = null;
      this.roomWsTopic = null;
    }
    this.relayPostQueue = [];
    this.updateConnectionStatus();
  }

  /**
   * Enfileira envios POST para o Relay em ordem estrita (FIFO), com checagem de HTTP 429/5xx e retry.
   */
  sendToRelayTopic(topic, payload, options = {}) {
    if (!topic || typeof fetch === 'undefined') return;
    const packet = {
      ...payload,
      senderTabId: this.tabId,
      sentAt: Date.now()
    };

    if (options.immediate) {
      this._postRelayWithRetry(topic, packet, options.maxRetries ?? 2);
      return;
    }

    if (this.relayPostQueue.length < 80) {
      this.relayPostQueue.push({
        topic,
        packet,
        maxRetries: options.maxRetries ?? 4
      });
    }
    this.flushRelayPostQueue();
  }

  async flushRelayPostQueue() {
    if (this.isFlushingRelayQueue) return;
    this.isFlushingRelayQueue = true;

    try {
      while (this.relayPostQueue.length > 0) {
        const item = this.relayPostQueue.shift();
        await this._postRelayWithRetry(item.topic, item.packet, item.maxRetries);
      }
    } finally {
      this.isFlushingRelayQueue = false;
    }
  }

  async _postRelayWithRetry(topic, packet, maxRetries = 4) {
    const body = JSON.stringify(packet);
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(`https://ntfy.sh/${topic}`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body
        });
        if (res.ok) return true;

        // Rate limit (429) ou erro transitório de servidor (5xx) -> aguarda backoff e tenta novamente
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          const retryAfterHeader = parseInt(res.headers?.get?.('Retry-After'), 10);
          const backoffMs = !Number.isNaN(retryAfterHeader) && retryAfterHeader > 0
            ? Math.min(6000, retryAfterHeader * 1000)
            : Math.min(4000, 700 * Math.pow(2, attempt));
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        return false;
      } catch (_) {
        if (attempt < maxRetries) {
          const backoffMs = Math.min(4000, 700 * Math.pow(2, attempt));
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        return false;
      }
    }
    return false;
  }

  sendRoomRelay(payload, options = {}) {
    if (!this.roomCode) return;
    const topic = this.getRelayRoomTopic(this.roomCode);
    this.sendToRelayTopic(topic, {
      ...payload,
      roomCode: this.roomCode
    }, options);
  }

  // =========================================================================
  // CRIAÇÃO E CONEXÃO DE SALAS (PRIVADA & PARTIDA RÁPIDA)
  // =========================================================================

  /**
   * Cria uma sala privada com código PY-XXXX (Host).
   */
  async createRoom(userProfile, customCode = null) {
    this.cleanupPeers();
    this.resetSessionSequencing();
    this.hasAcceptedGuest = false;

    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    this.roomCode = customCode || `PY-${randomDigits}`;
    this.roomSessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.playerRole = 'host';
    this.connected = true;

    const initialRoomState = {
      code: this.roomCode,
      sessionId: this.roomSessionId,
      hostTabId: this.tabId,
      status: 'waiting',
      host: {
        nickname: userProfile.nickname || 'Host',
        avatar: userProfile.avatar || '🐍',
        role: 'host',
        pos: 1,
        boost: 0,
        shield: false
      },
      guest: null,
      currentTurn: 'host',
      round: 1,
      createdAt: Date.now()
    };

    this.currentRoomState = initialRoomState;
    this.saveLocalRoom(initialRoomState);

    // 1. Conecta imediatamente ao Relay WebSocket da sala
    this.connectRoomRelay(this.roomCode);

    // 2. Notifica abas do mesmo navegador
    this.broadcastMessage({
      type: 'ROOM_CREATED',
      roomCode: this.roomCode,
      roomState: initialRoomState
    });

    // 3. Inicializa Host WebRTC Peer (não bloqueia a UI por muito tempo, mas segue escutando)
    await this.initWebRTCHost(initialRoomState);

    return initialRoomState;
  }

  async initWebRTCHost(roomState) {
    const Peer = await this.loadPeerJS();
    if (!Peer) return false;

    return new Promise((resolve) => {
      let settled = false;
      const done = (ok) => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };

      const timer = setTimeout(() => done(false), 2400);

      try {
        const peerId = this.getPeerRoomId(roomState.code);
        const peer = new Peer(peerId, this.getPeerOptions());
        this.peer = peer;

        peer.on('open', () => {
          clearTimeout(timer);
          done(true);
        });

        peer.on('connection', (conn) => {
          if (this.peer !== peer) return;
          this.dataConn = conn;
          this.setupDataConnection(conn, roomState);
        });

        peer.on('disconnected', () => {
          if (this.peer === peer && this.connected && !peer.destroyed) {
            setTimeout(() => {
              try {
                if (this.peer === peer && !peer.destroyed && peer.disconnected) {
                  peer.reconnect();
                }
              } catch (_) {}
            }, 1500);
          }
        });

        peer.on('error', (err) => {
          clearTimeout(timer);
          console.debug('Aviso PeerJS Host:', err.type || err.message);
          done(false);
        });
      } catch (e) {
        clearTimeout(timer);
        done(false);
      }
    });
  }

  registerActiveConn(conn) {
    if (!conn) return;
    this.dataConn = conn;
    if (!this.activeConnections.includes(conn)) {
      this.activeConnections.push(conn);
    }
    this.updateConnectionStatus();
    this.flushPendingOutgoing();
  }

  unregisterConn(conn) {
    if (!conn) return;
    this.activeConnections = this.activeConnections.filter((c) => c !== conn);
    if (this.dataConn === conn) {
      this.dataConn = this.activeConnections.find((c) => c && c.open) || null;
    }
    this.updateConnectionStatus();
  }

  flushPendingOutgoing() {
    if (!this.pendingOutgoingQueue.length) return;
    if (!this.isWebRTCOpen()) return;

    while (this.pendingOutgoingQueue.length > 0) {
      const pkt = this.pendingOutgoingQueue.shift();
      // Não reenvia pacotes PLAYER_ACTION que já foram confirmados via ACK pelo Relay
      if (pkt && pkt.type === 'PLAYER_ACTION' && pkt.seqId && !this.unackedActions.has(pkt.seqId)) {
        continue;
      }
      this.sendRawWebRTC(pkt, false);
    }
  }

  sendRawWebRTC(pkt, queueIfClosed = true) {
    const targets = new Set(this.activeConnections.filter((c) => c && c.open));
    if (this.dataConn && this.dataConn.open) {
      targets.add(this.dataConn);
    }
    if (targets.size === 0) {
      if (queueIfClosed && this.pendingOutgoingQueue.length < 40) {
        this.pendingOutgoingQueue.push(pkt);
      }
      return false;
    }
    let sentAny = false;
    targets.forEach((conn) => {
      try {
        conn.send(pkt);
        sentAny = true;
      } catch (e) {
        console.warn('Erro ao enviar pacote WebRTC:', e);
      }
    });
    return sentAny;
  }

  /**
   * Processa a entrada de um Guest no Host de forma idempotente.
   */
  acceptGuestOnHost(guestProfile, roomStateRef = null, sourceConn = null) {
    if (this.playerRole !== 'host' || !guestProfile) return;

    const room = this.currentRoomState || roomStateRef || this.getLocalRoom(this.roomCode) || {
      code: this.roomCode,
      host: { nickname: 'Host', avatar: '🐍', role: 'host' }
    };

    room.guest = guestProfile;
    room.status = 'ready';
    this.roomCode = room.code || this.roomCode;
    this.currentRoomState = room;
    this.saveLocalRoom(room);

    const acceptPacket = {
      type: 'P2P_JOIN_ACCEPTED',
      roomCode: this.roomCode,
      room,
      actionId: `accept_${this.roomCode}_${Date.now()}`
    };

    if (sourceConn) {
      if (sourceConn.open) {
        try { sourceConn.send(acceptPacket); } catch (_) {}
      } else {
        sourceConn.on('open', () => {
          try { sourceConn.send(acceptPacket); } catch (_) {}
        });
      }
    }
    this.sendRawWebRTC(acceptPacket, false);
    this.broadcastMessage(acceptPacket);
    this.sendRoomRelay(acceptPacket);

    // Só dispara OPPONENT_CONNECTED uma única vez por partida no Host
    if (!this.hasAcceptedGuest) {
      this.hasAcceptedGuest = true;
      this.isQuickMatchSearching = false;
      this.stopQuickMatchLobbyWatch();
      this.clearQuickMatchQueueIfMine();
      this.startPresenceMonitor();
      this.notifyListeners({ type: 'OPPONENT_CONNECTED', room, role: 'host' });
    }
  }

  setupDataConnection(conn, roomStateRef = null) {
    if (!conn) return;

    const onOpen = () => {
      this.registerActiveConn(conn);
      if (this.playerRole === 'guest' && this.pendingGuestProfile && this.pendingJoinResolve) {
        try {
          conn.send({
            type: 'P2P_JOIN_REQUEST',
            roomCode: this.roomCode,
            guest: this.pendingGuestProfile,
            senderTabId: this.tabId
          });
        } catch (_) {}
      } else if (this.connected && this.roomCode) {
        // Handshake leve ao subir o canal P2P em segundo plano durante uma partida já ativa
        try {
          conn.send({
            type: 'P2P_CHANNEL_READY',
            roomCode: this.roomCode,
            senderRole: this.playerRole,
            senderTabId: this.tabId,
            maxReceivedSeqId: this.expectedRemoteSeqId - 1
          });
        } catch (_) {}
      }
    };

    if (conn.open) {
      onOpen();
    }

    conn.on('open', onOpen);

    conn.on('data', (data) => {
      this.registerActiveConn(conn);
      if (!data || typeof data !== 'object') return;

      if (data.type === 'P2P_JOIN_REQUEST' && this.playerRole === 'host') {
        this.acceptGuestOnHost(data.guest, roomStateRef, conn);
      } else if (data.type === 'P2P_JOIN_ACCEPTED' && this.playerRole === 'guest') {
        this.handleJoinAcceptedOnGuest(data);
      } else {
        this.handleIncomingMessage(data, 'webrtc');
      }
    });

    conn.on('close', () => {
      this.unregisterConn(conn);
    });

    conn.on('error', () => {
      this.unregisterConn(conn);
    });
  }

  handleJoinAcceptedOnGuest(data) {
    if (this.playerRole !== 'guest') return;
    if (data.room && data.room.code) {
      this.roomCode = data.room.code;
    } else if (data.roomCode) {
      this.roomCode = data.roomCode;
    }
    this.connected = true;
    if (data.room) {
      this.currentRoomState = data.room;
      this.saveLocalRoom(data.room);
    }
    this.connectRoomRelay(this.roomCode);
    this.startPresenceMonitor();

    if (this.joinRetryTimer) {
      clearInterval(this.joinRetryTimer);
      this.joinRetryTimer = null;
    }

    if (this.pendingJoinResolve) {
      const resolve = this.pendingJoinResolve;
      this.pendingJoinResolve = null;
      resolve({ success: true, room: data.room });
    }
  }

  /**
   * Conecta a uma sala existente usando o código PY-XXXX (Guest).
   */
  async joinRoom(code, userProfile) {
    this.cleanupPeers();
    this.resetSessionSequencing();
    this.hasAcceptedGuest = false;

    let formattedCode = (code || '').toUpperCase().trim();
    if (/^\d{4}$/.test(formattedCode)) {
      formattedCode = `PY-${formattedCode}`;
    } else if (/^PY\d{4}$/.test(formattedCode)) {
      formattedCode = `PY-${formattedCode.substring(2)}`;
    }

    this.roomCode = formattedCode;
    this.playerRole = 'guest';

    const guestProfile = {
      nickname: userProfile.nickname || 'Jogador 2',
      avatar: userProfile.avatar || '🦊',
      role: 'guest',
      pos: 1,
      boost: 0,
      shield: false
    };

    // 1. Verifica primeiro se a sala existe localmente (outra aba no mesmo navegador)
    const localRoom = this.getLocalRoom(formattedCode);
    if (localRoom && localRoom.status === 'waiting' && localRoom.hostTabId !== this.tabId) {
      localRoom.guest = guestProfile;
      localRoom.status = 'ready';
      this.connected = true;
      this.currentRoomState = localRoom;
      this.saveLocalRoom(localRoom);
      this.connectRoomRelay(formattedCode);

      this.broadcastMessage({
        type: 'GUEST_JOINED',
        roomCode: formattedCode,
        guest: guestProfile,
        room: localRoom,
        actionId: `join_${Date.now()}`
      });

      this.sendRoomRelay({
        type: 'P2P_JOIN_REQUEST',
        roomCode: formattedCode,
        guest: guestProfile
      });
      this.startPresenceMonitor();

      return { success: true, room: localRoom };
    }

    // 2. Navegadores ou cidades diferentes: conecta ao Relay + inicia upgrade WebRTC em paralelo!
    this.connectRoomRelay(formattedCode);
    const Peer = await this.loadPeerJS();

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        this.pendingJoinResolve = null;
        if (this.joinRetryTimer) {
          clearInterval(this.joinRetryTimer);
          this.joinRetryTimer = null;
        }
        resolve(result);
      };

      this.pendingGuestProfile = guestProfile;

      const timeout = setTimeout(() => {
        finish({
          success: false,
          message: `Sala ${formattedCode} não encontrada ou o anfitrião já iniciou a partida.`
        });
      }, 10000);

      const wrappedFinish = (res) => {
        clearTimeout(timeout);
        finish(res);
      };
      this.pendingJoinResolve = wrappedFinish;

      // Envia pedido de entrada pelo Relay e BroadcastChannel (intervalo amigável ao rate limit)
      const sendJoinSignals = () => {
        if (settled) return;
        const joinReq = {
          type: 'P2P_JOIN_REQUEST',
          roomCode: formattedCode,
          guest: guestProfile,
          actionId: `join_req_${this.tabId}_${Date.now()}`
        };
        this.broadcastMessage(joinReq);
        this.sendRoomRelay(joinReq);
        if (this.dataConn && this.dataConn.open) {
          try { this.dataConn.send(joinReq); } catch (_) {}
        }
      };

      sendJoinSignals();
      this.joinRetryTimer = setInterval(sendJoinSignals, 1800);

      // Inicia WebRTC via PeerJS SEM abortar quando settled=true (permite upgrade P2P durante a partida!)
      if (Peer) {
        try {
          const peer = new Peer(this.getPeerOptions());
          this.peer = peer;
          const hostPeerId = this.getPeerRoomId(formattedCode);
          let connectAttempts = 0;

          const attemptPeerConnect = () => {
            if (
              this.peer !== peer ||
              peer.destroyed ||
              this.playerRole !== 'guest' ||
              this.roomCode !== formattedCode ||
              this.isWebRTCOpen()
            ) {
              return;
            }
            connectAttempts += 1;
            try {
              const conn = peer.connect(hostPeerId, {
                reliable: true,
                serialization: 'json'
              });
              this.dataConn = conn;
              this.setupDataConnection(conn);
            } catch (_) {}
          };

          peer.on('open', () => {
            attemptPeerConnect();
          });

          peer.on('disconnected', () => {
            if (this.peer === peer && this.connected && !peer.destroyed) {
              setTimeout(() => {
                try {
                  if (this.peer === peer && !peer.destroyed && peer.disconnected) {
                    peer.reconnect();
                  }
                } catch (_) {}
              }, 1500);
            }
          });

          peer.on('error', (err) => {
            if (
              err &&
              err.type === 'peer-unavailable' &&
              connectAttempts < 4 &&
              this.peer === peer &&
              this.roomCode === formattedCode
            ) {
              this.peerConnectRetryTimer = setTimeout(() => attemptPeerConnect(), 1500);
            }
          });
        } catch (_) {}
      }
    });
  }

  /**
   * ⚡ PARTIDA RÁPIDA (Matchmaking Automático sem precisar digitar código).
   */
  async startQuickMatch(userProfile) {
    this.isQuickMatchSearching = true;
    this.hasAcceptedGuest = false;

    // 1. Verifica fila local imediata (outra aba no mesmo navegador)
    const waitingLocal = this.getQuickMatchWaitingRoom();
    if (waitingLocal && waitingLocal.hostTabId !== this.tabId) {
      this.clearQuickMatchQueue();
      const joinRes = await this.joinRoom(waitingLocal.roomCode, userProfile);
      if (joinRes.success) {
        this.isQuickMatchSearching = false;
        return {
          mode: 'matched_as_guest',
          roomCode: waitingLocal.roomCode,
          room: joinRes.room
        };
      }
    }

    // 2. Procura oponente aguardando em outro navegador/cidade via Lobby Relay
    const discoveredRoomCode = await this.seekWaitingQuickMatchHost();
    if (!this.isQuickMatchSearching) return null;

    if (discoveredRoomCode) {
      const joinRes = await this.joinRoom(discoveredRoomCode, userProfile);
      if (joinRes.success && joinRes.room) {
        this.isQuickMatchSearching = false;
        return {
          mode: 'matched_as_guest',
          roomCode: joinRes.room.code || discoveredRoomCode,
          room: joinRes.room
        };
      }
    }

    // 3. Nenhum Host encontrado: cria sala imediatamente e anuncia no lobby
    const room = await this.createRoom(userProfile);
    if (!this.isQuickMatchSearching) return null;

    this.setQuickMatchWaitingRoom(room.code);
    this.startQuickMatchHostWatch(room, userProfile);
    this.claimPeerJSMatchmakingSlotInBackground(room);

    return {
      mode: 'waiting_as_host',
      roomCode: room.code,
      room
    };
  }

  seekWaitingQuickMatchHost() {
    return new Promise((resolve) => {
      if (typeof WebSocket === 'undefined') {
        resolve(null);
        return;
      }

      let settled = false;
      const done = (roomCode) => {
        if (!settled) {
          settled = true;
          resolve(roomCode);
        }
      };

      const topic = this.getRelayQuickMatchTopic();
      const timer = setTimeout(() => done(null), 1300);

      try {
        const ws = new WebSocket(`wss://ntfy.sh/${topic}/ws?since=25s`);
        this.qmWs = ws;

        ws.onopen = () => {
          this.sendToRelayTopic(topic, {
            type: 'QM_SEEK_HOST',
            seekerTabId: this.tabId
          }, { immediate: true, maxRetries: 1 });
        };

        ws.onmessage = (evt) => {
          try {
            const wrapper = JSON.parse(evt.data);
            if (!wrapper || wrapper.event !== 'message' || !wrapper.message) return;
            const msg = JSON.parse(wrapper.message);
            if (!msg || msg.senderTabId === this.tabId) return;

            if (msg.sentAt && Math.abs(Date.now() - msg.sentAt) > 30000) return;

            if (
              (msg.type === 'QM_HOST_AVAILABLE' || msg.type === 'QM_HOST_ANNOUNCEMENT') &&
              msg.roomCode
            ) {
              clearTimeout(timer);
              done(msg.roomCode);
            }
          } catch (_) {}
        };

        ws.onerror = () => {
          clearTimeout(timer);
          done(null);
        };
      } catch (_) {
        clearTimeout(timer);
        done(null);
      }
    });
  }

  startQuickMatchHostWatch(room, userProfile) {
    this.stopQuickMatchLobbyWatch();
    const topic = this.getRelayQuickMatchTopic();

    const announceHost = () => {
      if (!this.isQuickMatchSearching || this.hasAcceptedGuest || this.playerRole !== 'host') return;
      this.setQuickMatchWaitingRoom(room.code);
      const packet = {
        type: 'QM_HOST_ANNOUNCEMENT',
        roomCode: room.code,
        hostTabId: this.tabId,
        createdAt: room.createdAt
      };
      this.broadcastMessage(packet);
      this.sendToRelayTopic(topic, packet, { immediate: true, maxRetries: 1 });
    };

    try {
      if (typeof WebSocket !== 'undefined') {
        const ws = new WebSocket(`wss://ntfy.sh/${topic}/ws`);
        this.qmWs = ws;

        ws.onopen = () => {
          announceHost();
        };

        ws.onmessage = async (evt) => {
          if (!this.isQuickMatchSearching || this.hasAcceptedGuest) return;
          try {
            const wrapper = JSON.parse(evt.data);
            if (!wrapper || wrapper.event !== 'message' || !wrapper.message) return;
            const msg = JSON.parse(wrapper.message);
            if (!msg || msg.senderTabId === this.tabId) return;

            if (msg.type === 'QM_SEEK_HOST') {
              this.sendToRelayTopic(topic, {
                type: 'QM_HOST_AVAILABLE',
                roomCode: room.code,
                hostTabId: this.tabId,
                seekerTabId: msg.seekerTabId,
                createdAt: room.createdAt
              }, { immediate: true, maxRetries: 1 });
            } else if (
              (msg.type === 'QM_HOST_ANNOUNCEMENT' || msg.type === 'QM_HOST_AVAILABLE') &&
              msg.roomCode &&
              msg.roomCode !== room.code
            ) {
              // Desempate determinístico imune a diferença de relógio entre cidades:
              // compara o código/tabId lexicograficamente (sempre exatamente um cede e o outro hospeda)
              const otherKey = `${msg.roomCode}_${msg.senderTabId || ''}`;
              const myKey = `${room.code}_${this.tabId}`;
              const shouldYieldToOtherHost = otherKey < myKey;

              if (shouldYieldToOtherHost && this.isQuickMatchSearching && !this.hasAcceptedGuest) {
                this.isQuickMatchSearching = false;
                this.stopQuickMatchLobbyWatch();
                this.clearQuickMatchQueueIfMine();
                const joinRes = await this.joinRoom(msg.roomCode, userProfile);
                if (joinRes.success && joinRes.room) {
                  this.notifyListeners({
                    type: 'OPPONENT_CONNECTED',
                    room: joinRes.room,
                    role: 'guest'
                  });
                }
              }
            }
          } catch (_) {}
        };
      }
    } catch (_) {}

    announceHost();
    this.qmAnnounceTimer = setInterval(announceHost, 3500);
  }

  stopQuickMatchLobbyWatch() {
    if (this.qmAnnounceTimer) {
      clearInterval(this.qmAnnounceTimer);
      this.qmAnnounceTimer = null;
    }
    if (this.qmWs) {
      try {
        this.qmWs.onmessage = null;
        this.qmWs.close();
      } catch (_) {}
      this.qmWs = null;
    }
  }

  async claimPeerJSMatchmakingSlotInBackground(room) {
    const Peer = await this.loadPeerJS();
    if (!Peer || !this.isQuickMatchSearching || this.hasAcceptedGuest) return;

    const SLOTS = [
      'pq-mm-2026-slot-1',
      'pq-mm-2026-slot-2',
      'pq-mm-2026-slot-3',
      'pq-mm-2026-slot-4',
      'pq-mm-2026-slot-5'
    ];

    for (const slotId of SLOTS) {
      if (!this.isQuickMatchSearching || this.hasAcceptedGuest) return;

      const claimed = await new Promise((resolve) => {
        let doneFlag = false;
        const done = (val) => {
          if (!doneFlag) {
            doneFlag = true;
            resolve(val);
          }
        };

        try {
          const testPeer = new Peer(slotId, this.getPeerOptions());
          const timer = setTimeout(() => {
            try { testPeer.destroy(); } catch (_) {}
            done(null);
          }, 1500);

          testPeer.on('open', () => {
            clearTimeout(timer);
            done(testPeer);
          });

          testPeer.on('error', () => {
            clearTimeout(timer);
            try { testPeer.destroy(); } catch (_) {}
            done(null);
          });
        } catch (_) {
          done(null);
        }
      });

      if (claimed) {
        if (!this.isQuickMatchSearching || this.hasAcceptedGuest) {
          try { claimed.destroy(); } catch (_) {}
          return;
        }
        this.mmPeer = claimed;
        this.mmPeer.on('connection', (conn) => {
          this.dataConn = conn;
          this.setupDataConnection(conn, room);
        });
        return;
      }
    }
  }

  cancelQuickMatch() {
    this.isQuickMatchSearching = false;
    this.stopQuickMatchLobbyWatch();
    this.clearQuickMatchQueueIfMine();
    if (this.mmPeer) {
      try { this.mmPeer.destroy(); } catch (e) {}
      this.mmPeer = null;
    }
  }

  getQuickMatchWaitingRoom() {
    try {
      const raw = localStorage.getItem('py_quickmatch_waiting');
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() - data.timestamp > 45000) {
        localStorage.removeItem('py_quickmatch_waiting');
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  setQuickMatchWaitingRoom(roomCode) {
    try {
      localStorage.setItem('py_quickmatch_waiting', JSON.stringify({
        roomCode,
        hostTabId: this.tabId,
        timestamp: Date.now()
      }));
    } catch (e) {}
  }

  clearQuickMatchQueue() {
    try {
      localStorage.removeItem('py_quickmatch_waiting');
    } catch (e) {}
  }

  clearQuickMatchQueueIfMine() {
    const waiting = this.getQuickMatchWaitingRoom();
    if (waiting && waiting.hostTabId === this.tabId) {
      this.clearQuickMatchQueue();
    }
  }

  // =========================================================================
  // PROTOCOLO DE ENTREGA CONFIÁVEL (ORDENAÇÃO seqId + ACK + REENVIO)
  // =========================================================================

  /**
   * Envia uma ação de turno (ROLL, MOVE, CHALLENGE_START, CHALLENGE_RESULT, TILE_EFFECT, END_TURN, REMATCH)
   * com número de sequência estrito (seqId), confirmação (ACK) e reenvio automático.
   */
  async sendTurnAction(actionType, payload) {
    if (!this.connected || !this.roomCode) return;

    this.outgoingSeqId += 1;
    const seqId = this.outgoingSeqId;
    const now = Date.now();
    const action = {
      type: 'PLAYER_ACTION',
      actionId: `${this.playerRole}_${seqId}_${now}`,
      seqId,
      actionName: actionType,
      roomCode: this.roomCode,
      senderRole: this.playerRole,
      senderTabId: this.tabId,
      payload,
      timestamp: now
    };

    this.processedActionIds.add(action.actionId);
    this.sentActionHistory.set(seqId, action);
    if (this.sentActionHistory.size > 60) {
      const oldestKey = this.sentActionHistory.keys().next().value;
      this.sentActionHistory.delete(oldestKey);
    }

    this.unackedActions.set(seqId, {
      packet: action,
      sentAt: now,
      lastAttemptAt: now,
      attempts: 1
    });

    // 1. BroadcastChannel (abas locais)
    this.broadcastMessage(action);

    // 2. WebRTC DataChannel (se aberto, entrega em <50ms sem gastar cota do Relay!)
    const sentViaWebRTC = this.sendRawWebRTC(action, true);

    // 3. Se WebRTC NÃO está aberto, envia imediatamente via Relay serializado.
    //    (Se WebRTC estiver aberto, o monitor de ACK fará fallback ao Relay em 2s caso o ACK não chegue.)
    if (!sentViaWebRTC) {
      this.sendRoomRelay(action);
    }
    this.lastHeartbeatSentAt = now;

    this.startAckRetryMonitor();
  }

  // =========================================================================
  // PRESENÇA DO OPONENTE (SAÍDA EXPLÍCITA + HEARTBEAT / DETECÇÃO DE QUEDA)
  // =========================================================================

  startPresenceMonitor() {
    this.stopPresenceMonitor();
    this.lastOpponentSeenAt = Date.now();
    this.lastHeartbeatSentAt = Date.now();
    this.opponentPresenceState = 'online';
    this.hasSentLeaveSignal = false;

    this.presenceTimer = setInterval(() => {
      this.checkOpponentPresence();
    }, 5000);
  }

  stopPresenceMonitor() {
    if (this.presenceTimer) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
  }

  markOpponentSeen() {
    if (!this.connected || !this.roomCode) return;
    this.lastOpponentSeenAt = Date.now();
    if (this.opponentPresenceState !== 'online') {
      this.opponentPresenceState = 'online';
      this.notifyListeners({
        type: 'OPPONENT_PRESENCE',
        state: 'online',
        reconnected: true,
        roomCode: this.roomCode
      });
    }
  }

  checkOpponentPresence(now = Date.now()) {
    if (!this.connected || !this.roomCode || this.opponentPresenceState === 'left') return;
    // No Host, só monitora presença depois que um oponente entrou na sala
    if (this.playerRole === 'host' && !this.hasAcceptedGuest) return;

    const p2pOpen = this.isWebRTCOpen();
    const silentMs = this.lastOpponentSeenAt > 0 ? (now - this.lastOpponentSeenAt) : 0;
    const sinceLastHeartbeat = now - (this.lastHeartbeatSentAt || 0);
    const heartbeatInterval = p2pOpen ? 5000 : 20000;

    if (sinceLastHeartbeat >= heartbeatInterval) {
      this.lastHeartbeatSentAt = now;
      const ping = {
        type: 'PRESENCE_PING',
        roomCode: this.roomCode,
        senderRole: this.playerRole,
        senderTabId: this.tabId,
        needsPong: silentMs >= 20000,
        timestamp: now
      };
      this.broadcastMessage(ping);
      const sentWebRTC = this.sendRawWebRTC(ping, false);
      if (!sentWebRTC) {
        this.sendRoomRelay(ping, { immediate: true, maxRetries: 0 });
      }
    }

    const disconnectThreshold = p2pOpen ? 18000 : 45000;
    const unstableThreshold = p2pOpen ? 10000 : 25000;

    if (silentMs >= disconnectThreshold && this.opponentPresenceState !== 'disconnected') {
      this.opponentPresenceState = 'disconnected';
      this.notifyListeners({
        type: 'OPPONENT_PRESENCE',
        state: 'disconnected',
        reason: 'timeout',
        silentMs,
        roomCode: this.roomCode
      });
    } else if (
      silentMs >= unstableThreshold &&
      silentMs < disconnectThreshold &&
      this.opponentPresenceState === 'online'
    ) {
      this.opponentPresenceState = 'unstable';
      this.notifyListeners({
        type: 'OPPONENT_PRESENCE',
        state: 'unstable',
        reason: 'slow',
        silentMs,
        roomCode: this.roomCode
      });
    }
  }

  notifyPlayerLeft(isUnload = false) {
    if (!this.connected || !this.roomCode || this.hasSentLeaveSignal) return;
    if (this.playerRole === 'host' && !this.hasAcceptedGuest) return;

    this.hasSentLeaveSignal = true;
    const leavePacket = {
      type: 'PLAYER_LEFT',
      roomCode: this.roomCode,
      senderRole: this.playerRole,
      senderTabId: this.tabId,
      timestamp: Date.now()
    };

    this.sendRawWebRTC(leavePacket, false);
    this.broadcastMessage(leavePacket);

    const topic = this.getRelayRoomTopic(this.roomCode);
    const body = JSON.stringify({ ...leavePacket, sentAt: Date.now() });

    if (isUnload && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
        const queued = navigator.sendBeacon(`https://ntfy.sh/${topic}`, blob);
        if (queued) return;
      } catch (_) {}
    }

    if (typeof fetch !== 'undefined') {
      try {
        fetch(`https://ntfy.sh/${topic}`, {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body
        }).catch(() => {});
      } catch (_) {}
    }
  }

  startAckRetryMonitor() {
    if (this.ackRetryTimer) return;
    this.ackRetryTimer = setInterval(() => {
      this.retryPendingUnackedActions(false);
    }, 2200);
  }

  retryPendingUnackedActions(forceImmediate = false) {
    if (!this.connected || !this.roomCode || this.unackedActions.size === 0) return;
    const now = Date.now();

    // Reenvia sempre em ordem crescente de seqId
    const pendingEntries = Array.from(this.unackedActions.entries()).sort((a, b) => a[0] - b[0]);
    for (const [seqId, entry] of pendingEntries) {
      const waitMs = entry.attempts === 1 ? 2200 : 3800;
      if (!forceImmediate && now - entry.lastAttemptAt < waitMs) continue;

      if (entry.attempts >= 7) {
        this.unackedActions.delete(seqId);
        continue;
      }

      entry.attempts += 1;
      entry.lastAttemptAt = now;

      this.sendRawWebRTC(entry.packet, false);
      this.broadcastMessage(entry.packet);
      this.sendRoomRelay(entry.packet);
    }
  }

  sendActionAck(maxSeqId, sourceTransport = 'relay') {
    if (!this.connected || !this.roomCode || !maxSeqId) return;
    const ackPacket = {
      type: 'ACTION_ACK',
      roomCode: this.roomCode,
      senderRole: this.playerRole,
      senderTabId: this.tabId,
      maxReceivedSeqId: maxSeqId,
      timestamp: Date.now()
    };

    // ACK imediato nos canais sem custo (local + WebRTC)
    this.broadcastMessage(ackPacket);
    const sentWebRTC = this.sendRawWebRTC(ackPacket, false);

    // No Relay, consolida ACKs em janela de 350ms para economizar cota de POST do ntfy.sh
    if (!sentWebRTC && sourceTransport === 'relay') {
      this.pendingRelayAckSeq = Math.max(this.pendingRelayAckSeq, maxSeqId);
      if (!this.relayAckDebounceTimer) {
        this.relayAckDebounceTimer = setTimeout(() => {
          this.relayAckDebounceTimer = null;
          const seqToAck = this.pendingRelayAckSeq;
          this.pendingRelayAckSeq = 0;
          if (seqToAck > 0 && this.connected && this.roomCode && !this.isWebRTCOpen()) {
            this.sendRoomRelay({
              type: 'ACTION_ACK',
              senderRole: this.playerRole,
              maxReceivedSeqId: seqToAck,
              timestamp: Date.now()
            });
          }
        }, 350);
      }
    }
  }

  handleActionAck(maxReceivedSeqId) {
    if (typeof maxReceivedSeqId !== 'number' || maxReceivedSeqId <= 0) return;
    for (const seqId of Array.from(this.unackedActions.keys())) {
      if (seqId <= maxReceivedSeqId) {
        this.unackedActions.delete(seqId);
      }
    }
  }

  requestResendFrom(fromSeqId) {
    if (!this.connected || !this.roomCode) return;
    const req = {
      type: 'RESEND_REQUEST',
      roomCode: this.roomCode,
      senderRole: this.playerRole,
      senderTabId: this.tabId,
      fromSeqId,
      timestamp: Date.now()
    };
    this.broadcastMessage(req);
    const sentWebRTC = this.sendRawWebRTC(req, false);
    if (!sentWebRTC) {
      this.sendRoomRelay(req);
    }
  }

  handleResendRequest(fromSeqId) {
    if (typeof fromSeqId !== 'number' || fromSeqId <= 0) return;
    const missing = Array.from(this.sentActionHistory.entries())
      .filter(([seqId]) => seqId >= fromSeqId)
      .sort((a, b) => a[0] - b[0]);

    for (const [, pkt] of missing) {
      this.broadcastMessage(pkt);
      const sentWebRTC = this.sendRawWebRTC(pkt, false);
      if (!sentWebRTC) {
        this.sendRoomRelay(pkt);
      }
    }
  }

  /**
   * Garante entrega estritamente ordenada por seqId ao GameController,
   * evitando que END_TURN seja processado antes de ROLL ou MOVE.
   */
  enqueueRemoteActionOrdered(data, sourceTransport = 'relay') {
    const seqId = typeof data.seqId === 'number' ? data.seqId : null;

    if (seqId === null) {
      const uniqueKey = data.actionId || `${data.senderRole}_${data.actionName}_${data.timestamp}`;
      if (this.processedActionIds.has(uniqueKey)) return;
      this.processedActionIds.add(uniqueKey);
      this.notifyListeners({ ...data, type: 'REMOTE_ACTION' });
      return;
    }

    // Já processado anteriormente (duplicata de camada paralela ou retry): só reconfirma ACK
    if (seqId < this.expectedRemoteSeqId) {
      this.sendActionAck(this.expectedRemoteSeqId - 1, sourceTransport);
      return;
    }

    if (!this.remoteReorderBuffer.has(seqId)) {
      this.remoteReorderBuffer.set(seqId, data);
    }

    this.drainRemoteReorderBuffer(sourceTransport);
  }

  drainRemoteReorderBuffer(sourceTransport = 'relay') {
    let deliveredAny = false;
    while (this.remoteReorderBuffer.has(this.expectedRemoteSeqId)) {
      const nextAction = this.remoteReorderBuffer.get(this.expectedRemoteSeqId);
      this.remoteReorderBuffer.delete(this.expectedRemoteSeqId);
      this.expectedRemoteSeqId += 1;
      deliveredAny = true;

      const uniqueKey = nextAction.actionId || `${nextAction.senderRole}_${nextAction.seqId}`;
      if (!this.processedActionIds.has(uniqueKey)) {
        this.processedActionIds.add(uniqueKey);
        this.notifyListeners({ ...nextAction, type: 'REMOTE_ACTION' });
      }
    }

    if (deliveredAny) {
      this.sendActionAck(this.expectedRemoteSeqId - 1, sourceTransport);
    }

    if (this.reorderGapTimer) {
      clearTimeout(this.reorderGapTimer);
      this.reorderGapTimer = null;
    }

    // Se ainda há ações futuras no buffer aguardando uma lacuna (ex.: seq 3 chegou antes da seq 2),
    // solicita reenvio após 1.8s e, como rede de segurança final, libera após 6s para nunca travar!
    if (this.remoteReorderBuffer.size > 0) {
      const missingSeq = this.expectedRemoteSeqId;
      this.reorderGapTimer = setTimeout(() => {
        if (!this.connected || this.remoteReorderBuffer.size === 0) return;
        if (this.expectedRemoteSeqId === missingSeq) {
          this.requestResendFrom(missingSeq);
          this.pollRoomRelayOnce();

          this.reorderGapTimer = setTimeout(() => {
            if (!this.connected || this.remoteReorderBuffer.size === 0) return;
            if (this.expectedRemoteSeqId === missingSeq) {
              const sortedSeqs = Array.from(this.remoteReorderBuffer.keys()).sort((a, b) => a - b);
              if (sortedSeqs.length > 0) {
                this.expectedRemoteSeqId = sortedSeqs[0];
                this.drainRemoteReorderBuffer(sourceTransport);
              }
            }
          }, 4200);
        }
      }, 1800);
    }
  }

  handleIncomingMessage(data, sourceTransport = 'local') {
    if (!data || typeof data !== 'object') return;
    if (data.senderTabId && data.senderTabId === this.tabId) return;

    if (
      data.type === 'QM_HOST_ANNOUNCEMENT' &&
      this.isQuickMatchSearching &&
      !this.hasAcceptedGuest &&
      this.playerRole === 'host' &&
      data.roomCode &&
      data.roomCode !== this.roomCode
    ) {
      return;
    }

    if (data.roomCode && this.roomCode && data.roomCode !== this.roomCode) return;

    if ((data.type === 'GUEST_JOINED' || data.type === 'P2P_JOIN_REQUEST') && this.playerRole === 'host') {
      this.acceptGuestOnHost(data.guest, data.room || null);
    } else if (data.type === 'P2P_JOIN_ACCEPTED' && this.playerRole === 'guest') {
      this.handleJoinAcceptedOnGuest(data);
    } else if (data.type === 'PLAYER_LEFT' && data.senderRole !== this.playerRole) {
      if (this.opponentPresenceState !== 'left') {
        this.opponentPresenceState = 'left';
        this.stopPresenceMonitor();
        this.notifyListeners({
          type: 'OPPONENT_PRESENCE',
          state: 'left',
          reason: 'left',
          roomCode: this.roomCode
        });
      }
    } else if (data.type === 'PRESENCE_PING' && data.senderRole !== this.playerRole) {
      this.markOpponentSeen();
      if (sourceTransport !== 'relay' || data.needsPong) {
        const pong = {
          type: 'PRESENCE_PONG',
          roomCode: this.roomCode,
          senderRole: this.playerRole,
          senderTabId: this.tabId,
          timestamp: Date.now()
        };
        this.broadcastMessage(pong);
        const sentWebRTC = this.sendRawWebRTC(pong, false);
        if (!sentWebRTC && sourceTransport === 'relay' && data.needsPong) {
          this.sendRoomRelay(pong, { immediate: true, maxRetries: 0 });
        }
      }
    } else if (data.type === 'PRESENCE_PONG' && data.senderRole !== this.playerRole) {
      this.markOpponentSeen();
    } else if (data.type === 'P2P_CHANNEL_READY' && data.senderRole !== this.playerRole) {
      this.markOpponentSeen();
      if (typeof data.maxReceivedSeqId === 'number') {
        this.handleActionAck(data.maxReceivedSeqId);
        // Se o oponente ficou para trás antes do P2P abrir, reenvia o que falta imediatamente
        if (data.maxReceivedSeqId < this.outgoingSeqId) {
          this.handleResendRequest(data.maxReceivedSeqId + 1);
        }
      }
    } else if (data.type === 'ACTION_ACK' && data.senderRole !== this.playerRole) {
      this.markOpponentSeen();
      this.handleActionAck(data.maxReceivedSeqId);
    } else if (data.type === 'RESEND_REQUEST' && data.senderRole !== this.playerRole) {
      this.markOpponentSeen();
      this.handleResendRequest(data.fromSeqId);
    } else if (data.type === 'PLAYER_ACTION' && data.senderRole !== this.playerRole) {
      this.markOpponentSeen();
      this.enqueueRemoteActionOrdered(data, sourceTransport);
    }
  }

  broadcastMessage(message) {
    const packet = {
      ...message,
      roomCode: message.roomCode || this.roomCode,
      senderTabId: this.tabId
    };
    if (this.channel) {
      try {
        this.channel.postMessage(packet);
      } catch (e) {}
    }
    try {
      const key = `py_sync_evt_${packet.roomCode || 'global'}_${packet.seqId || Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      localStorage.setItem(key, JSON.stringify(packet));
      setTimeout(() => {
        try { localStorage.removeItem(key); } catch (e) {}
      }, 4000);
    } catch (e) {}
  }

  getLocalRoom(code) {
    try {
      const raw = localStorage.getItem(`py_room_${code}`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  saveLocalRoom(roomState) {
    if (!roomState || !roomState.code) return;
    try {
      localStorage.setItem(`py_room_${roomState.code}`, JSON.stringify(roomState));
    } catch (e) {}
  }

  cleanupPeers() {
    this.stopPresenceMonitor();
    if (this.joinRetryTimer) {
      clearInterval(this.joinRetryTimer);
      this.joinRetryTimer = null;
    }
    if (this.peerConnectRetryTimer) {
      clearTimeout(this.peerConnectRetryTimer);
      this.peerConnectRetryTimer = null;
    }
    if (this.reorderGapTimer) {
      clearTimeout(this.reorderGapTimer);
      this.reorderGapTimer = null;
    }
    if (this.relayAckDebounceTimer) {
      clearTimeout(this.relayAckDebounceTimer);
      this.relayAckDebounceTimer = null;
    }
    this.stopQuickMatchLobbyWatch();
    this.closeRoomRelay();

    this.activeConnections.forEach((conn) => {
      try { conn.close(); } catch (e) {}
    });
    this.activeConnections = [];
    this.pendingOutgoingQueue = [];
    if (this.dataConn) {
      try { this.dataConn.close(); } catch (e) {}
      this.dataConn = null;
    }
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
      this.peer = null;
    }
    if (this.mmPeer) {
      try { this.mmPeer.destroy(); } catch (e) {}
      this.mmPeer = null;
    }
  }

  leaveRoom() {
    this.notifyPlayerLeft(false);
    this.cancelQuickMatch();
    this.cleanupPeers();
    this.resetSessionSequencing();
    this.connected = false;
    this.hasAcceptedGuest = false;
    this.roomCode = null;
    this.currentRoomState = null;
    this.playerRole = null;
    this.pendingGuestProfile = null;
    this.pendingJoinResolve = null;
    this.updateConnectionStatus();
  }
}
