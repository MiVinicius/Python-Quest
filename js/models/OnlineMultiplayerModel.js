/**
 * OnlineMultiplayerModel.js
 * Sistema Multiplayer Serverless 100% compatível com GitHub Pages e Execução Local.
 * Combina 3 camadas simultâneas com deduplicação automática por seqId/actionId:
 * 1. BroadcastChannel + Storage Events para sincronização instantânea (< 1ms) entre abas do mesmo navegador.
 * 2. WebRTC Peer-to-Peer (PeerJS DataChannel com STUN + TURN) entre navegadores/computadores diferentes.
 * 3. WebSocket Serverless Relay (WSS/HTTPS) como fallback automático contra bloqueios de mDNS/Firewall/NAT no Windows.
 * 4. Matchmaking Automático ("⚡ Partida Rápida") com descoberta ativa de Host e proteção contra slots fantasmas.
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

    this.outgoingSeqId = 0;
    this.processedActionIds = new Set();

    // WebRTC (PeerJS)
    this.PeerClass = null;
    this.peer = null;
    this.dataConn = null;
    this.activeConnections = [];
    this.pendingOutgoingQueue = [];
    this.mmPeer = null;

    // WebSocket Serverless Relay (para 2 navegadores diferentes no mesmo PC quando mDNS/UDP falha)
    this.roomWs = null;
    this.roomWsTopic = null;
    this.qmWs = null;
    this.qmAnnounceTimer = null;
    this.joinRetryTimer = null;

    // Canal local para sincronização instantânea entre abas do mesmo navegador
    this.channel = null;
    this.setupSyncChannel();
    this.setupUnloadCleanup();
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
      console.info('PeerJS CDN indisponível: usando BroadcastChannel / WebSocket Relay.');
      return null;
    }
  }

  setupSyncChannel() {
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        this.channel = new BroadcastChannel('python_quest_p2p_sync');
        this.channel.onmessage = (event) => {
          this.handleIncomingMessage(event.data);
        };
      }
      if (typeof window !== 'undefined') {
        window.addEventListener('storage', (event) => {
          if (event.key && event.key.startsWith('py_sync_evt_') && event.newValue) {
            try {
              const data = JSON.parse(event.newValue);
              this.handleIncomingMessage(data);
            } catch (e) {}
          }
        });
      }
    } catch (err) {
      console.warn('BroadcastChannel não suportado:', err);
    }
  }

  setupUnloadCleanup() {
    if (typeof window === 'undefined') return;
    const cleanup = () => {
      this.clearQuickMatchQueueIfMine();
      this.cleanupPeers();
    };
    window.addEventListener('beforeunload', cleanup);
    window.addEventListener('pagehide', cleanup);
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

  /**
   * Conecta ao canal WebSocket Serverless da sala (funciona entre Chrome, Edge, Firefox, Anônimo, etc.)
   */
  connectRoomRelay(roomCode) {
    if (typeof WebSocket === 'undefined') return;
    const topic = this.getRelayRoomTopic(roomCode);
    if (this.roomWs && this.roomWsTopic === topic && this.roomWs.readyState <= 1) {
      return;
    }

    this.closeRoomRelay();
    this.roomWsTopic = topic;

    try {
      const ws = new WebSocket(`wss://ntfy.sh/${topic}/ws?since=15s`);
      this.roomWs = ws;

      ws.onmessage = (evt) => {
        try {
          const wrapper = JSON.parse(evt.data);
          if (wrapper && wrapper.event === 'message' && wrapper.message) {
            const payload = JSON.parse(wrapper.message);
            if (payload && payload.senderTabId !== this.tabId) {
              this.handleIncomingMessage(payload);
            }
          }
        } catch (_) {}
      };

      ws.onerror = () => {};
    } catch (_) {}
  }

  closeRoomRelay() {
    if (this.roomWs) {
      try {
        this.roomWs.onmessage = null;
        this.roomWs.close();
      } catch (_) {}
      this.roomWs = null;
      this.roomWsTopic = null;
    }
  }

  sendToRelayTopic(topic, payload) {
    if (!topic || typeof fetch === 'undefined') return;
    const packet = {
      ...payload,
      senderTabId: this.tabId,
      sentAt: Date.now()
    };
    try {
      fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        body: JSON.stringify(packet)
      }).catch(() => {});
    } catch (_) {}
  }

  sendRoomRelay(payload) {
    if (!this.roomCode) return;
    const topic = this.getRelayRoomTopic(this.roomCode);
    this.sendToRelayTopic(topic, {
      ...payload,
      roomCode: this.roomCode
    });
  }

  /**
   * Cria uma sala privada com código PY-XXXX (Host).
   */
  async createRoom(userProfile, customCode = null) {
    this.cleanupPeers();
    this.processedActionIds.clear();
    this.outgoingSeqId = 0;
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
      status: 'waiting', // 'waiting' | 'ready' | 'playing' | 'ended'
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

    // 1. Conecta imediatamente ao Relay WebSocket da sala (entre navegadores diferentes)
    this.connectRoomRelay(this.roomCode);

    // 2. Notifica abas do mesmo navegador
    this.broadcastMessage({
      type: 'ROOM_CREATED',
      roomCode: this.roomCode,
      roomState: initialRoomState
    });

    // 3. Inicializa Host WebRTC Peer (aguarda até estar registrado ou timeout rápido de 1.8s)
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

      const timer = setTimeout(() => done(false), 1800);

      try {
        const peerId = this.getPeerRoomId(roomState.code);
        this.peer = new Peer(peerId, this.getPeerOptions());

        this.peer.on('open', () => {
          clearTimeout(timer);
          done(true);
        });

        this.peer.on('connection', (conn) => {
          this.dataConn = conn;
          this.setupDataConnection(conn, roomState);
        });

        this.peer.on('error', (err) => {
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
    this.flushPendingOutgoing();
  }

  flushPendingOutgoing() {
    if (!this.pendingOutgoingQueue.length) return;
    const openConns = this.activeConnections.filter((c) => c && c.open);
    if (!openConns.length && !(this.dataConn && this.dataConn.open)) return;

    while (this.pendingOutgoingQueue.length > 0) {
      const pkt = this.pendingOutgoingQueue.shift();
      this.sendRawWebRTC(pkt);
    }
  }

  sendRawWebRTC(pkt) {
    const targets = new Set(this.activeConnections.filter((c) => c && c.open));
    if (this.dataConn && this.dataConn.open) {
      targets.add(this.dataConn);
    }
    if (targets.size === 0) {
      if (this.pendingOutgoingQueue.length < 50) {
        this.pendingOutgoingQueue.push(pkt);
      }
      return;
    }
    targets.forEach((conn) => {
      try {
        conn.send(pkt);
      } catch (e) {
        console.warn('Erro ao enviar pacote WebRTC:', e);
      }
    });
  }

  /**
   * Processa a entrada de um Guest no Host de forma idempotente
   * (funciona via BroadcastChannel, WebRTC DataChannel ou WebSocket Relay).
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

    // Envia confirmação por TODOS os canais para garantir que o Guest receba imediatamente
    if (sourceConn) {
      if (sourceConn.open) {
        try { sourceConn.send(acceptPacket); } catch (_) {}
      } else {
        sourceConn.on('open', () => {
          try { sourceConn.send(acceptPacket); } catch (_) {}
        });
      }
    }
    this.sendRawWebRTC(acceptPacket);
    this.broadcastMessage(acceptPacket);
    this.sendRoomRelay(acceptPacket);

    // Só dispara OPPONENT_CONNECTED uma única vez por partida no Host
    if (!this.hasAcceptedGuest) {
      this.hasAcceptedGuest = true;
      this.isQuickMatchSearching = false;
      this.stopQuickMatchLobbyWatch();
      this.clearQuickMatchQueueIfMine();
      this.notifyListeners({ type: 'OPPONENT_CONNECTED', room, role: 'host' });
    }
  }

  setupDataConnection(conn, roomStateRef = null) {
    if (!conn) return;

    const sendJoinIfGuest = () => {
      this.registerActiveConn(conn);
      if (this.playerRole === 'guest' && this.pendingGuestProfile) {
        try {
          conn.send({
            type: 'P2P_JOIN_REQUEST',
            roomCode: this.roomCode,
            guest: this.pendingGuestProfile,
            senderTabId: this.tabId
          });
        } catch (_) {}
      }
    };

    if (conn.open) {
      sendJoinIfGuest();
    }

    conn.on('open', () => {
      sendJoinIfGuest();
    });

    conn.on('data', (data) => {
      this.registerActiveConn(conn);
      if (!data || typeof data !== 'object') return;

      if (data.type === 'P2P_JOIN_REQUEST' && this.playerRole === 'host') {
        this.acceptGuestOnHost(data.guest, roomStateRef, conn);
      } else if (data.type === 'P2P_JOIN_ACCEPTED' && this.playerRole === 'guest') {
        this.handleJoinAcceptedOnGuest(data);
      } else {
        this.handleIncomingMessage(data);
      }
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
    this.processedActionIds.clear();
    this.outgoingSeqId = 0;
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

      return { success: true, room: localRoom };
    }

    // 2. Dois navegadores diferentes (ou PCs diferentes): usa WebSocket Relay + WebRTC (PeerJS) em paralelo!
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
      this.pendingJoinResolve = finish;

      const timeout = setTimeout(() => {
        finish({
          success: false,
          message: `Sala ${formattedCode} não encontrada ou o anfitrião já iniciou a partida.`
        });
      }, 8000);

      const wrappedFinish = (res) => {
        clearTimeout(timeout);
        finish(res);
      };
      this.pendingJoinResolve = wrappedFinish;

      // Envia pedido de entrada imediato pelo WebSocket Relay e BroadcastChannel
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
      this.joinRetryTimer = setInterval(sendJoinSignals, 950);

      // Também inicia conexão direta WebRTC via PeerJS com auto-retry se o Host ainda estiver abrindo
      if (Peer) {
        try {
          this.peer = new Peer(this.getPeerOptions());
          const hostPeerId = this.getPeerRoomId(formattedCode);

          const attemptPeerConnect = () => {
            if (settled || !this.peer || this.peer.destroyed) return;
            try {
              const conn = this.peer.connect(hostPeerId, {
                reliable: true,
                serialization: 'json'
              });
              this.dataConn = conn;
              this.connected = true;
              this.setupDataConnection(conn);
            } catch (_) {}
          };

          this.peer.on('open', () => {
            attemptPeerConnect();
          });

          this.peer.on('error', (err) => {
            // Se o Host ainda estiver registrando o Peer ou se o WebSocket Relay resolver, tentamos novamente sem abortar
            if (!settled && err && err.type === 'peer-unavailable') {
              setTimeout(() => attemptPeerConnect(), 900);
            }
          });
        } catch (_) {}
      }
    });
  }

  /**
   * ⚡ PARTIDA RÁPIDA (Matchmaking Automático sem precisar digitar código).
   * Conecta instantaneamente dois jogadores que clicarem em "Partida Rápida"
   * (seja em abas do mesmo navegador, em 2 navegadores diferentes no mesmo PC, ou em PCs diferentes).
   */
  async startQuickMatch(userProfile) {
    this.isQuickMatchSearching = true;
    this.hasAcceptedGuest = false;

    // 1. Verifica fila local imediata (outra aba no mesmo navegador já aguardando Partida Rápida)
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

    // 2. Procura oponente aguardando em outro navegador via WebSocket Lobby (rápido: ~950ms)
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

    // 3. Nenhum Host encontrado: criamos nossa sala IMEDIATAMENTE e registramos na fila local + global!
    const room = await this.createRoom(userProfile);
    if (!this.isQuickMatchSearching) return null;

    this.setQuickMatchWaitingRoom(room.code);
    this.startQuickMatchHostWatch(room, userProfile);

    // Também escuta no primeiro slot livre do PeerJS para compatibilidade P2P pura
    this.claimPeerJSMatchmakingSlotInBackground(room);

    return {
      mode: 'waiting_as_host',
      roomCode: room.code,
      room
    };
  }

  /**
   * Procura por ~950ms se já há outro navegador aguardando na Partida Rápida.
   */
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
      const timer = setTimeout(() => done(null), 950);

      try {
        const ws = new WebSocket(`wss://ntfy.sh/${topic}/ws?since=20s`);
        this.qmWs = ws;

        ws.onopen = () => {
          this.sendToRelayTopic(topic, {
            type: 'QM_SEEK_HOST',
            seekerTabId: this.tabId
          });
        };

        ws.onmessage = (evt) => {
          try {
            const wrapper = JSON.parse(evt.data);
            if (!wrapper || wrapper.event !== 'message' || !wrapper.message) return;
            const msg = JSON.parse(wrapper.message);
            if (!msg || msg.senderTabId === this.tabId) return;

            // Ignora mensagens antigas (> 25s)
            if (msg.sentAt && Date.now() - msg.sentAt > 25000) return;

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

  /**
   * Enquanto aguardamos como Host na Partida Rápida:
   * - Responde a qualquer outro navegador que enviar QM_SEEK_HOST
   * - Resolve empate automaticamente caso 2 navegadores tenham clicado em "Partida Rápida" no mesmo instante!
   */
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
      this.sendToRelayTopic(topic, packet);
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
              });
            } else if (
              (msg.type === 'QM_HOST_ANNOUNCEMENT' || msg.type === 'QM_HOST_AVAILABLE') &&
              msg.roomCode &&
              msg.roomCode !== room.code
            ) {
              // Desempate determinístico se 2 navegadores criaram sala ao mesmo tempo:
              // O navegador que criou depois (ou com tabId maior) conecta como Guest na sala do outro!
              const otherTime = msg.createdAt || 0;
              const myTime = room.createdAt || 0;
              const shouldYieldToOtherHost =
                otherTime < myTime || (otherTime === myTime && String(msg.senderTabId) < String(this.tabId));

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
    this.qmAnnounceTimer = setInterval(announceHost, 2200);
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
      // Expira em 45 segundos
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

  /**
   * Envia uma ação de turno (ROLL, MOVE, CHALLENGE_START, CHALLENGE_RESULT, TILE_EFFECT, END_TURN, REMATCH)
   * com número de sequência único (seqId) nas 3 camadas para nunca perder eventos.
   */
  async sendTurnAction(actionType, payload) {
    if (!this.connected || !this.roomCode) return;

    this.outgoingSeqId += 1;
    const now = Date.now();
    const action = {
      type: 'PLAYER_ACTION',
      actionId: `${this.playerRole}_${this.outgoingSeqId}_${now}`,
      seqId: this.outgoingSeqId,
      actionName: actionType,
      roomCode: this.roomCode,
      senderRole: this.playerRole,
      senderTabId: this.tabId,
      payload,
      timestamp: now
    };

    this.processedActionIds.add(action.actionId);

    // 1. Envia via WebRTC DataChannel
    this.sendRawWebRTC(action);

    // 2. Envia no BroadcastChannel + Storage Event (para abas locais do mesmo navegador)
    this.broadcastMessage(action);

    // 3. Envia via WebSocket Serverless Relay (para navegadores diferentes quando WebRTC falha)
    this.sendRoomRelay(action);
  }

  handleIncomingMessage(data) {
    if (!data || typeof data !== 'object') return;
    if (data.senderTabId && data.senderTabId === this.tabId) return;

    // Desempate de QuickMatch entre abas locais
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
    } else if (data.type === 'PLAYER_ACTION' && data.senderRole !== this.playerRole) {
      const uniqueKey = data.actionId || `${data.senderRole}_${data.actionName}_${data.timestamp}`;
      if (this.processedActionIds.has(uniqueKey)) return;
      this.processedActionIds.add(uniqueKey);

      this.notifyListeners({ type: 'REMOTE_ACTION', ...data });
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
    if (this.joinRetryTimer) {
      clearInterval(this.joinRetryTimer);
      this.joinRetryTimer = null;
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
    this.cancelQuickMatch();
    this.cleanupPeers();
    this.connected = false;
    this.hasAcceptedGuest = false;
    this.roomCode = null;
    this.currentRoomState = null;
    this.playerRole = null;
  }
}
