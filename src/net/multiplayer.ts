import type { Res, Species, UnitKind, World } from '../sim/types';
import { SPECIES } from '../data/species';
import { makeUnit, spawnSpot } from '../sim/world';
import { setOrder } from '../sim/units';
import { bCenter, emit, log } from '../sim/util';

export type ChatChannel = 'global' | 'matchmaking' | 'strategy' | 'room';
export type MpMode = 'versus' | 'coop';

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  senderId: string;
  senderName: string;
  species: Species;
  banner: string;
  text: string;
  ts: number;
  system?: boolean;
}

export interface PeerStatus {
  id: string;
  name: string;
  species: Species;
  banner: string;
  roomCode?: string;
  mode?: MpMode;
  mapId?: string;
  gen: number;
  pop: number;
  army: number;
  hearthHp: number;
  kills: number;
  pingMs: number;
  lastSeen: number;
  isBotPeer?: boolean;
}

export interface RoomListing {
  code: string;
  hostId: string;
  hostName: string;
  species: Species;
  mode: MpMode;
  mapId: string;
  seed: number;
  players: number;
  createdAt: number;
}

export type NetPacket =
  | { t: 'chat'; msg: ChatMessage }
  | { t: 'presence'; peer: PeerStatus }
  | { t: 'room_open'; room: RoomListing }
  | { t: 'room_join'; code: string; peer: PeerStatus }
  | { t: 'room_start'; code: string; mapId: string; seed: number; mode: MpMode; hostSpecies: Species; guestSpecies: Species }
  | { t: 'game_action'; code: string; fromId: string; fromName: string; fromSpecies: Species; act: 'tribute' | 'reinforce' | 'strike' | 'ping' | 'gen_up' | 'victory'; res?: Res; amount?: number; unitKind?: UnitKind; count?: number; x?: number; y?: number; gen?: number; text?: string };

const PROFILE_KEY = 'lineage-rts:mp:profile:v1';
const MQTT_TOPIC = 'lineage-rts/v1/global';

function encodeMqttRemainingLength(len: number): number[] {
  const out: number[] = [];
  do {
    let b = len % 128;
    len = Math.floor(len / 128);
    if (len > 0) b |= 128;
    out.push(b);
  } while (len > 0);
  return out;
}

function encodeUtf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function buildMqttConnect(clientId: string): Uint8Array {
  const idBytes = encodeUtf8(clientId);
  const vh = [0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3c]; // MQTT 3.1.1, clean session, 60s keepalive
  const pl = [idBytes.length >> 8, idBytes.length & 0xff, ...idBytes];
  const rem = vh.length + pl.length;
  return new Uint8Array([0x10, ...encodeMqttRemainingLength(rem), ...vh, ...pl]);
}

function buildMqttSubscribe(topic: string): Uint8Array {
  const tb = encodeUtf8(topic);
  const pl = [0x00, 0x01, tb.length >> 8, tb.length & 0xff, ...tb, 0x00];
  return new Uint8Array([0x82, ...encodeMqttRemainingLength(pl.length), ...pl]);
}

function buildMqttPublish(topic: string, payload: string): Uint8Array {
  const tb = encodeUtf8(topic);
  const pb = encodeUtf8(payload);
  const body = [tb.length >> 8, tb.length & 0xff, ...tb, ...pb];
  return new Uint8Array([0x30, ...encodeMqttRemainingLength(body.length), ...body]);
}

export class MultiplayerClient {
  myId: string;
  myName: string;
  mySpecies: Species;
  myBanner: string;

  channel: ChatChannel = 'global';
  messages: ChatMessage[] = [];
  peers = new Map<string, PeerStatus>();
  rooms = new Map<string, RoomListing>();

  activeRoom: RoomListing | null = null;
  inMatch = false;
  matchMode: MpMode = 'versus';
  unread = 0;
  chatOpen = false;
  cloudConnected = false;

  private bc: BroadcastChannel | null = null;
  private ws: WebSocket | null = null;
  private onUpdate?: () => void;
  private onMatchStart?: (room: RoomListing, peerSpecies: Species) => void;
  private onToast?: (text: string, kind: 'info' | 'good' | 'bad') => void;
  private lastSync = 0;
  private seenIds = new Set<string>();

  constructor() {
    let saved: { id?: string; name?: string; species?: Species; banner?: string } = {};
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch { /* ignore */ }
    this.myId = saved.id || `clan-${Math.random().toString(36).slice(2, 8)}`;
    this.myName = saved.name || `Chieftain_${Math.floor(100 + Math.random() * 899)}`;
    this.mySpecies = saved.species || 'human';
    this.myBanner = saved.banner || '#27b7c6';
    this.saveProfile();
    this.seedInitialLobby();
    this.initTransports();
  }

  bindCallbacks(cbs: {
    onUpdate: () => void;
    onMatchStart: (room: RoomListing, peerSpecies: Species) => void;
    onToast: (text: string, kind: 'info' | 'good' | 'bad') => void;
  }) {
    this.onUpdate = cbs.onUpdate;
    this.onMatchStart = cbs.onMatchStart;
    this.onToast = cbs.onToast;
  }

  saveProfile(name?: string, species?: Species, banner?: string) {
    if (name && name.trim()) this.myName = name.trim().slice(0, 18);
    if (species) this.mySpecies = species;
    if (banner) this.myBanner = banner;
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify({
        id: this.myId, name: this.myName, species: this.mySpecies, banner: this.myBanner,
      }));
    } catch { /* ignore */ }
  }

  private seedInitialLobby() {
    const now = Date.now();
    const botPeers: PeerStatus[] = [
      { id: 'peer-torag', name: 'Warchief_Torag', species: 'neanderthal', banner: '#e89a3c', gen: 2, pop: 18, army: 7, hearthHp: 500, kills: 9, pingMs: 28, lastSeen: now, isBotPeer: true },
      { id: 'peer-zhur', name: 'Altai_Seer', species: 'denisovan', banner: '#38d39c', gen: 3, pop: 22, army: 9, hearthHp: 680, kills: 14, pingMs: 34, lastSeen: now, isBotPeer: true },
      { id: 'peer-sora', name: 'Sora_SunSpear', species: 'human', banner: '#27b7c6', gen: 1, pop: 12, army: 4, hearthHp: 500, kills: 3, pingMs: 19, lastSeen: now, isBotPeer: true },
    ];
    for (const p of botPeers) this.peers.set(p.id, p);

    const openRooms: RoomListing[] = [
      { code: 'FROST1', hostId: 'peer-torag', hostName: 'Warchief_Torag', species: 'neanderthal', mode: 'versus', mapId: 'glasswater', seed: 77412, players: 1, createdAt: now - 40000 },
      { code: 'VALLEY', hostId: 'peer-sora', hostName: 'Sora_SunSpear', species: 'human', mode: 'coop', mapId: 'valley', seed: 88219, players: 1, createdAt: now - 15000 },
    ];
    for (const r of openRooms) this.rooms.set(r.code, r);

    this.messages.push(
      { id: 'm-welcome', channel: 'global', senderId: 'sys', senderName: 'Council of Fires', species: 'human', banner: '#e8bd63', text: 'Welcome to the Lineage Global Hearth! Create or join a room code to play 1v1 Versus or 2-Player Allied Co-op across any device.', ts: now - 60000, system: true },
      { id: 'm-1', channel: 'global', senderId: 'peer-torag', senderName: 'Warchief_Torag', species: 'neanderthal', banner: '#e89a3c', text: 'Hosting 1v1 on Glasswater (Room: FROST1) — watch out when the lake freezes!', ts: now - 35000 },
      { id: 'm-2', channel: 'global', senderId: 'peer-zhur', senderName: 'Altai_Seer', species: 'denisovan', banner: '#38d39c', text: 'Tip: Always preserve Cooking & Smoke Preservation at a Teaching Circle before Gen II so Pottery & Farming cost 30% less.', ts: now - 18000 },
      { id: 'm-3', channel: 'matchmaking', senderId: 'peer-sora', senderName: 'Sora_SunSpear', species: 'human', banner: '#27b7c6', text: 'Room VALLEY open for 2-Player Co-op Survival! Join up!', ts: now - 12000 },
      { id: 'm-4', channel: 'strategy', senderId: 'peer-zhur', senderName: 'Altai_Seer', species: 'denisovan', banner: '#38d39c', text: 'Denisovan Stalkers + Eagle Flare let you spot the Ember Cave and Ancestral Megalith in the first 60 seconds.', ts: now - 25000 },
    );
  }

  private initTransports() {
    if (typeof window === 'undefined') return;
    // 1. Local multi-tab BroadcastChannel
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.bc = new BroadcastChannel('lineage-rts-net-v1');
        this.bc.onmessage = (ev) => {
          if (ev.data && typeof ev.data === 'string') this.onRawPacket(ev.data);
        };
      }
    } catch { /* ignore */ }

    // 2. Public WebSocket MQTT v3.1.1 Cloud Relay (works in any browser on Vercel)
    try {
      if (typeof WebSocket !== 'undefined' && !navigator.userAgent.includes('HappyDOM')) {
        const ws = new WebSocket('wss://broker.emqx.io:8084/mqtt', 'mqtt');
        ws.binaryType = 'arraybuffer';
        this.ws = ws;
        ws.onopen = () => {
          try {
            ws.send(buildMqttConnect(`lineage_${this.myId}_${Math.floor(Math.random() * 999)}`));
          } catch { /* ignore */ }
        };
        ws.onmessage = (ev) => {
          try {
            const buf = new Uint8Array(ev.data as ArrayBuffer);
            if (!buf.length) return;
            const packetType = buf[0] >> 4;
            if (packetType === 2) {
              // CONNACK -> Subscribe to global topic & announce presence
              this.cloudConnected = true;
              ws.send(buildMqttSubscribe(MQTT_TOPIC));
              this.broadcastPresence();
              this.onUpdate?.();
            } else if (packetType === 3) {
              // PUBLISH -> Decode topic and UTF-8 JSON payload
              let idx = 1;
              let mult = 1;
              let remLen = 0;
              while (idx < buf.length) {
                const b = buf[idx++];
                remLen += (b & 127) * mult;
                mult *= 128;
                if ((b & 128) === 0) break;
              }
              if (idx + 2 > buf.length) return;
              const topicLen = (buf[idx] << 8) | buf[idx + 1];
              const payloadStart = idx + 2 + topicLen;
              const payloadBytes = buf.slice(payloadStart, idx + remLen);
              const text = new TextDecoder().decode(payloadBytes);
              this.onRawPacket(text);
            }
          } catch { /* ignore malformed packet */ }
        };
        ws.onclose = () => { this.cloudConnected = false; };
        ws.onerror = () => { this.cloudConnected = false; };
      }
    } catch { /* ignore */ }

    // Check URL for ?room=CODE auto-join
    try {
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room')?.toUpperCase().trim();
      if (roomParam && roomParam.length >= 4) {
        setTimeout(() => this.joinRoom(roomParam), 600);
      }
    } catch { /* ignore */ }
  }

  private sendPacket(pkt: NetPacket) {
    const raw = JSON.stringify(pkt);
    try { this.bc?.postMessage(raw); } catch { /* ignore */ }
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.cloudConnected) {
        this.ws.send(buildMqttPublish(MQTT_TOPIC, raw));
      }
    } catch { /* ignore */ }
  }

  private onRawPacket(raw: string) {
    let pkt: NetPacket;
    try { pkt = JSON.parse(raw) as NetPacket; } catch { return; }
    if (!pkt || typeof pkt !== 'object') return;

    if (pkt.t === 'chat') {
      if (this.seenIds.has(pkt.msg.id)) return;
      this.seenIds.add(pkt.msg.id);
      this.messages.push(pkt.msg);
      if (this.messages.length > 80) this.messages.shift();
      if (!this.chatOpen && pkt.msg.senderId !== this.myId) {
        this.unread++;
        if (pkt.msg.channel === 'room') {
          this.onToast?.(`[Room] ${pkt.msg.senderName}: ${pkt.msg.text}`, 'info');
        }
      }
      this.onUpdate?.();
    } else if (pkt.t === 'presence') {
      if (pkt.peer.id === this.myId) return;
      pkt.peer.lastSeen = Date.now();
      this.peers.set(pkt.peer.id, pkt.peer);
      this.onUpdate?.();
    } else if (pkt.t === 'room_open') {
      this.rooms.set(pkt.room.code, pkt.room);
      this.onUpdate?.();
    } else if (pkt.t === 'room_join') {
      this.peers.set(pkt.peer.id, pkt.peer);
      if (this.activeRoom && this.activeRoom.code === pkt.code) {
        this.activeRoom.players = 2;
        this.pushSystemMessage('room', `${pkt.peer.name} (${SPECIES[pkt.peer.species].name}) joined room ${pkt.code}!`);
        this.onUpdate?.();
      }
    } else if (pkt.t === 'room_start') {
      if (this.activeRoom && this.activeRoom.code === pkt.code && !this.inMatch) {
        this.inMatch = true;
        this.matchMode = pkt.mode;
        this.activeRoom.mapId = pkt.mapId;
        this.activeRoom.seed = pkt.seed;
        const peerSp = pkt.hostSpecies === this.mySpecies ? pkt.guestSpecies : pkt.hostSpecies;
        this.onMatchStart?.(this.activeRoom, peerSp);
      }
    } else if (pkt.t === 'game_action') {
      if (!this.activeRoom || pkt.code !== this.activeRoom.code || pkt.fromId === this.myId) return;
      this.pendingActions.push(pkt);
    }
  }

  private pendingActions: Extract<NetPacket, { t: 'game_action' }>[] = [];

  pushSystemMessage(channel: ChatChannel, text: string) {
    const msg: ChatMessage = {
      id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      channel,
      senderId: 'sys',
      senderName: 'Clan Herald',
      species: 'human',
      banner: '#e8bd63',
      text,
      ts: Date.now(),
      system: true,
    };
    this.seenIds.add(msg.id);
    this.messages.push(msg);
    this.onUpdate?.();
  }

  sendChat(text: string, channel = this.channel) {
    const clean = text.trim().slice(0, 220);
    if (!clean) return;
    const msg: ChatMessage = {
      id: `${this.myId}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      channel,
      senderId: this.myId,
      senderName: this.myName,
      species: this.mySpecies,
      banner: this.myBanner,
      text: clean,
      ts: Date.now(),
    };
    this.seenIds.add(msg.id);
    this.messages.push(msg);
    this.sendPacket({ t: 'chat', msg });
    this.onUpdate?.();

    // Contextual reply from simulated Clan Peers if no human peer replied
    setTimeout(() => this.maybeBotReply(clean, channel), 1400);
  }

  private maybeBotReply(userText: string, channel: ChatChannel) {
    const low = userText.toLowerCase();
    let responder = this.peers.get('peer-zhur');
    let reply = '';
    if (low.includes('gg') || low.includes('good game')) {
      responder = this.peers.get('peer-torag');
      reply = 'GG well fought! May your hearth burn through the frost.';
    } else if (low.includes('food') || low.includes('winter') || low.includes('starv')) {
      reply = 'Build a Smoking Rack early! Smoked provisions never rot during Winter and feed your Far Meadow expedition.';
    } else if (low.includes('join') || low.includes('room') || low.includes('1v1') || low.includes('coop')) {
      responder = this.peers.get('peer-sora');
      reply = this.activeRoom
        ? `Joining room ${this.activeRoom.code}! Ready when you are, ${this.myName}!`
        : 'Create a Room Code on the right or join FROST1 / VALLEY to jump into a match!';
    }
    if (reply && responder) {
      const botMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        channel,
        senderId: responder.id,
        senderName: responder.name,
        species: responder.species,
        banner: responder.banner,
        text: reply,
        ts: Date.now(),
      };
      this.seenIds.add(botMsg.id);
      this.messages.push(botMsg);
      this.onUpdate?.();
    }
  }

  createRoom(mode: MpMode, mapId: string): RoomListing {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const room: RoomListing = {
      code,
      hostId: this.myId,
      hostName: this.myName,
      species: this.mySpecies,
      mode,
      mapId,
      seed: 10000 + Math.floor(Math.random() * 89999),
      players: 1,
      createdAt: Date.now(),
    };
    this.activeRoom = room;
    this.matchMode = mode;
    this.channel = 'room';
    this.rooms.set(code, room);
    this.sendPacket({ t: 'room_open', room });
    this.pushSystemMessage('room', `Created ${mode === 'coop' ? '2P Allied Co-op' : '1v1 Versus'} Room [${code}] on ${mapId}. Share the room code or link with a friend, or press Launch Match!`);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('room', code);
      window.history.replaceState({}, '', url.toString());
    } catch { /* ignore */ }
    return room;
  }

  joinRoom(codeInput: string): RoomListing | null {
    const code = codeInput.trim().toUpperCase();
    if (!code) return null;
    let room = this.rooms.get(code);
    if (!room) {
      room = {
        code,
        hostId: 'remote-host',
        hostName: 'Remote Chieftain',
        species: SPECIES[this.mySpecies].rival,
        mode: 'versus',
        mapId: 'valley',
        seed: code.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 1337) & 0x7ffff,
        players: 2,
        createdAt: Date.now(),
      };
      this.rooms.set(code, room);
    } else {
      room.players = 2;
    }
    this.activeRoom = room;
    this.matchMode = room.mode;
    this.channel = 'room';
    this.sendPacket({
      t: 'room_join',
      code,
      peer: this.buildMyStatus(),
    });
    this.pushSystemMessage('room', `Joined Room [${code}] (${room.mode === 'coop' ? 'Allied Co-op' : '1v1 Versus'}). Press Launch Match to begin!`);
    this.onUpdate?.();
    return room;
  }

  leaveRoom() {
    this.activeRoom = null;
    this.inMatch = false;
    this.channel = 'global';
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());
    } catch { /* ignore */ }
    this.onUpdate?.();
  }

  launchRoomMatch() {
    if (!this.activeRoom) return;
    this.inMatch = true;
    const peer = this.getRoomPartner();
    const guestSpecies = peer?.species ?? SPECIES[this.mySpecies].rival;
    this.sendPacket({
      t: 'room_start',
      code: this.activeRoom.code,
      mapId: this.activeRoom.mapId,
      seed: this.activeRoom.seed,
      mode: this.activeRoom.mode,
      hostSpecies: this.mySpecies,
      guestSpecies,
    });
    this.onMatchStart?.(this.activeRoom, guestSpecies);
  }

  getRoomPartner(): PeerStatus | undefined {
    if (!this.activeRoom) return undefined;
    for (const p of this.peers.values()) {
      if (p.id !== this.myId && (p.roomCode === this.activeRoom.code || p.id === this.activeRoom.hostId)) return p;
    }
    // Fallback to an active clan partner so single-device / instant play works seamlessly
    return this.peers.get(this.mySpecies === 'neanderthal' ? 'peer-sora' : 'peer-torag');
  }

  private buildMyStatus(w?: World): PeerStatus {
    const mine = w ? w.units.filter(u => u.owner === 0) : [];
    const army = mine.filter(u => u.kind !== 'gatherer').length;
    const hearth = w?.buildings.find(b => b.owner === 0 && b.kind === 'hearth');
    return {
      id: this.myId,
      name: this.myName,
      species: w?.species ?? this.mySpecies,
      banner: w?.bannerColor ?? this.myBanner,
      roomCode: this.activeRoom?.code,
      mode: this.activeRoom?.mode,
      mapId: w?.map ?? this.activeRoom?.mapId,
      gen: w?.gen ?? 1,
      pop: mine.length,
      army,
      hearthHp: Math.ceil(hearth?.hp ?? 500),
      kills: w?.stats.kills ?? 0,
      pingMs: this.cloudConnected ? 24 : 12,
      lastSeen: Date.now(),
    };
  }

  broadcastPresence(w?: World) {
    this.sendPacket({ t: 'presence', peer: this.buildMyStatus(w) });
  }

  /** Send a real-time multiplayer action (Co-op Tribute, Allied Reinforcements, or 1v1 Warband Strike). */
  sendGameAction(w: World, act: 'tribute' | 'reinforce' | 'strike' | 'ping', res?: Res) {
    if (!this.activeRoom) return { ok: false, reason: 'Join or create an Online Room first.' };
    if (act === 'tribute' && res) {
      const amt = res === 'stone' ? 20 : 30;
      if (w.res[res] < amt) return { ok: false, reason: `Need ${amt} ${res} to send a caravan.` };
      w.res[res] -= amt;
      this.sendPacket({
        t: 'game_action',
        code: this.activeRoom.code,
        fromId: this.myId,
        fromName: this.myName,
        fromSpecies: w.species,
        act: 'tribute',
        res,
        amount: amt,
      });
      log(w, `Sent a caravan of ${amt} ${res} to your ally!`, 'good');
      // If playing with an AI/simulated partner in Co-op, they reciprocate after a short delay with a needed resource!
      const partner = this.getRoomPartner();
      if (partner?.isBotPeer) {
        const giftRes: Res = res === 'food' ? 'wood' : res === 'wood' ? 'stone' : 'food';
        setTimeout(() => {
          this.pendingActions.push({
            t: 'game_action',
            code: this.activeRoom!.code,
            fromId: partner.id,
            fromName: partner.name,
            fromSpecies: partner.species,
            act: 'tribute',
            res: giftRes,
            amount: 35,
          });
        }, 3500);
      }
      return { ok: true, reason: '' };
    }
    if (act === 'reinforce') {
      if (w.res.food < 45 || w.res.wood < 25) return { ok: false, reason: 'Reinforcements cost 45 food and 25 wood.' };
      w.res.food -= 45; w.res.wood -= 25;
      const uKind = SPECIES[w.species].unique;
      this.sendPacket({
        t: 'game_action',
        code: this.activeRoom.code,
        fromId: this.myId,
        fromName: this.myName,
        fromSpecies: w.species,
        act: 'reinforce',
        unitKind: uKind,
        count: 2,
      });
      log(w, `Dispatched 2 ${SPECIES[w.species].name} warband reinforcements to your ally!`, 'good');
      return { ok: true, reason: '' };
    }
    if (act === 'strike') {
      if (w.res.food < 50 || w.res.wood < 30) return { ok: false, reason: 'Launching a Warband Strike costs 50 food and 30 wood.' };
      w.res.food -= 50; w.res.wood -= 30;
      const uKind = SPECIES[w.species].unique;
      this.sendPacket({
        t: 'game_action',
        code: this.activeRoom.code,
        fromId: this.myId,
        fromName: this.myName,
        fromSpecies: w.species,
        act: 'strike',
        unitKind: uKind,
        count: 3,
      });
      // Also spawn friendly strike vanguard at our forward pass in local world
      const h = w.buildings.find(b => b.owner === 0 && b.kind === 'hearth');
      const rHearth = w.buildings.find(b => b.owner === 1 && b.kind === 'hearth');
      if (h && rHearth) {
        const sp = spawnSpot(w, h);
        const rc = bCenter(rHearth);
        for (let i = 0; i < 2; i++) {
          const u = makeUnit(w, uKind, 0, sp.x + i * 0.8, sp.y);
          u.species = w.species;
          setOrder(u, { t: 'amove', x: rc.x, y: rc.y });
        }
      }
      log(w, `Warband Strike launched against opponent (${SPECIES[w.species].name} vanguard deployed)!`, 'good');
      return { ok: true, reason: '' };
    }
    return { ok: false, reason: 'Unknown action.' };
  }

  /** Called periodically during gameplay to apply incoming network actions and update peer telemetry. */
  tickWorld(w: World, nowMs: number) {
    if (nowMs - this.lastSync > 2500) {
      this.lastSync = nowMs;
      if (this.inMatch || this.activeRoom) {
        this.broadcastPresence(w);
        // Evolve simulated peer stats alongside game time so the scoreboard stays dynamic
        const partner = this.getRoomPartner();
        if (partner?.isBotPeer) {
          partner.gen = Math.max(partner.gen, w.gen);
          partner.pop = Math.min(28, 9 + Math.floor(w.time / 45));
          partner.army = Math.min(14, 3 + Math.floor(w.time / 80));
          const rHearth = w.buildings.find(b => b.owner === 1 && b.kind === 'hearth');
          partner.hearthHp = rHearth ? Math.ceil(rHearth.hp) : 0;
        }
      }
    }

    while (this.pendingActions.length > 0) {
      const a = this.pendingActions.shift()!;
      if (a.act === 'tribute' && a.res && a.amount) {
        w.res[a.res] += a.amount;
        const h = w.buildings.find(b => b.owner === 0 && b.kind === 'hearth');
        if (h) emit(w, { k: 'deliver', x: h.x + 1.5, y: h.y + 1.5, owner: 0, res: a.res, n: a.amount });
        log(w, `Allied caravan from ${a.fromName} arrived: +${a.amount} ${a.res}!`, 'good');
      } else if (a.act === 'reinforce') {
        const h = w.buildings.find(b => b.owner === 0 && b.kind === 'hearth');
        if (h) {
          const sp = spawnSpot(w, h);
          const kind = a.unitKind ?? 'guard';
          for (let i = 0; i < (a.count ?? 2); i++) {
            const u = makeUnit(w, kind, 0, sp.x + i * 0.8, sp.y);
            u.species = a.fromSpecies;
            u.name = `${a.fromName.slice(0, 8)}'s ${u.name}`;
          }
          emit(w, { k: 'rally', x: sp.x, y: sp.y, owner: 0 });
          log(w, `${a.fromName} sent allied ${SPECIES[a.fromSpecies].name} reinforcements to your Hearth!`, 'good');
        }
      } else if (a.act === 'strike') {
        const rHearth = w.buildings.find(b => b.owner === 1 && b.kind === 'hearth');
        const pHearth = w.buildings.find(b => b.owner === 0 && b.kind === 'hearth');
        if (rHearth && pHearth) {
          const sp = spawnSpot(w, rHearth);
          const tc = bCenter(pHearth);
          const kind = a.unitKind ?? 'raider';
          for (let i = 0; i < (a.count ?? 3); i++) {
            const u = makeUnit(w, kind, 1, sp.x + i * 0.8, sp.y);
            u.species = a.fromSpecies;
            u.role = 'raid';
            setOrder(u, { t: 'amove', x: tc.x, y: tc.y });
          }
          log(w, `WARNING: ${a.fromName} launched a ${SPECIES[a.fromSpecies].name} Warband Strike against your camp!`, 'bad');
        }
      }
    }
  }
}

export const mp = new MultiplayerClient();
