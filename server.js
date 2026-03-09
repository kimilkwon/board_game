import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const app = express();
const http = createServer(app);
const io = new Server(http);
const PORT = process.env.PORT || 3000;

app.use(express.static(join(__dir, 'client')));

// ═══════════════════════════════════════════════════════════
// 말달리자 (HORSE GAME) CONSTANTS & LOGIC
// ═══════════════════════════════════════════════════════════
const GRASS = new Set(['3,5','4,4','4,5','4,6','5,3','5,4','5,6','5,7','6,4','6,5','6,6','7,5']);
const BLACK_START = [[0,0],[0,1],[0,2],[1,0],[2,0],[8,10],[9,10],[10,8],[10,9],[10,10]];
const WHITE_START = [[8,0],[9,0],[10,0],[10,1],[10,2],[0,8],[0,9],[0,10],[1,10],[2,10]];

function ctype(c, r) {
  if (c === 5 && r === 5) return 'oasis';
  if (GRASS.has(`${c},${r}`)) return 'grass';
  return 'desert';
}

function makeGrid() {
  const g = Array.from({ length: 11 }, () => Array(11).fill(null));
  for (const [c, r] of BLACK_START) g[c][r] = 'black';
  for (const [c, r] of WHITE_START) g[c][r] = 'white';
  return g;
}

function slides(grid, c, r) {
  const out = [];
  for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
    let nc = c+dc, nr = r+dr, lc = null, lr = null;
    while (nc>=0 && nc<11 && nr>=0 && nr<11 && !grid[nc][nr]) {
      lc = nc; lr = nr; nc += dc; nr += dr;
    }
    if (lc !== null) out.push([lc, lr]);
  }
  return out;
}

function knights(grid, c, r) {
  return [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]
    .map(([dc,dr]) => [c+dc, r+dr])
    .filter(([nc,nr]) =>
      nc>=0 && nc<11 && nr>=0 && nr<11 &&
      !grid[nc][nr] && ctype(nc,nr) === 'desert'
    );
}

function isValid(grid, fc, fr, tc, tr) {
  return [...slides(grid,fc,fr), ...knights(grid,fc,fr)]
    .some(([c,r]) => c===tc && r===tr);
}

const queue = [];
const rooms = new Map();

function makeRoom(p1, p2) {
  const id = Math.random().toString(36).slice(2,8).toUpperCase();
  const room = {
    id, players: [
      { sid: p1.sid, name: p1.name, color: 'black' },
      { sid: p2.sid, name: p2.name, color: 'white' },
    ],
    grid: makeGrid(), turn: 'black', done: false,
    timerId: null, timeLeft: 60,
  };
  rooms.set(id, room);
  return room;
}

function roomState(room) {
  return { grid: room.grid, turn: room.turn, done: room.done, timeLeft: room.timeLeft };
}

function startTimer(room) {
  clearInterval(room.timerId);
  room.timeLeft = 60;
  room.timerId = setInterval(() => {
    if (room.done) { clearInterval(room.timerId); return; }
    room.timeLeft--;
    io.to(room.id).emit('tick', room.timeLeft);
    if (room.timeLeft <= 0) {
      room.turn = room.turn === 'black' ? 'white' : 'black';
      io.to(room.id).emit('state', roomState(room));
      startTimer(room);
    }
  }, 1000);
}

function tryMatch() {
  while (queue.length >= 2) {
    const p1 = queue.shift(), p2 = queue.shift();
    const s1 = io.sockets.sockets.get(p1.sid);
    const s2 = io.sockets.sockets.get(p2.sid);
    if (!s1 && !s2) continue;
    if (!s1) { queue.unshift(p2); continue; }
    if (!s2) { queue.unshift(p1); continue; }
    const room = makeRoom(p1, p2);
    s1.join(room.id); s2.join(room.id);
    s1.emit('matched', { roomId:room.id, myColor:'black', oppName:p2.name, state:roomState(room) });
    s2.emit('matched', { roomId:room.id, myColor:'white', oppName:p1.name, state:roomState(room) });
    startTimer(room);
  }
}

// ═══════════════════════════════════════════════════════════
// BANG! GAME
// ═══════════════════════════════════════════════════════════

const B_ROLES = {
  4:['sheriff','renegade','outlaw','outlaw'],
  5:['sheriff','renegade','outlaw','outlaw','deputy'],
  6:['sheriff','renegade','outlaw','outlaw','outlaw','deputy'],
  7:['sheriff','renegade','outlaw','outlaw','outlaw','deputy','deputy'],
  8:['sheriff','renegade','outlaw','outlaw','outlaw','outlaw','deputy','deputy'],
};
const B_WEAPONS = new Set(['volcanic','schofield','remington','rev_carabiner','winchester']);
const B_WEAPON_RANGE = {volcanic:1,schofield:2,remington:3,rev_carabiner:4,winchester:5};

function shuffle(arr) {
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}

function makeBangDeck() {
  const d=[]; let id=0;
  const add=(type,suit,value,n=1)=>{for(let i=0;i<n;i++) d.push({id:id++,type,suit,value});};
  // BANG! 25
  [2,3,4,5,6,7,8,9].forEach(v=>add('bang','♠',v));
  ['A',2,3,4,5,6,7,8,9].forEach(v=>add('bang','♥',v));
  add('bang','♦','A');
  [2,3,4,5,6,7,8].forEach(v=>add('bang','♣',v));
  // MISSED! 12
  [10,'J','Q','K'].forEach(v=>add('missed','♠',v));
  [2,3,4,5,6,7,8,9].forEach(v=>add('missed','♦',v));
  // Beer 8
  [6,7,8,9,10,'J','Q','K'].forEach(v=>add('beer','♥',v));
  // Draw
  add('stagecoach','♠','A',2); add('wells_fargo','♥',3);
  // Action
  add('indians','♦','K'); add('indians','♦','A');
  add('duel','♠','J'); add('duel','♦','J'); add('duel','♣','J');
  add('gatling','♥',10); add('saloon','♥','A');
  // Equipment
  add('barrel','♠','Q',2);
  add('dynamite','♥',2);
  add('jail','♠',4); add('jail','♠',10); add('jail','♥','J');
  // Weapons
  add('volcanic','♠',10); add('volcanic','♣',10);
  add('schofield','♣','J'); add('schofield','♦','J'); add('schofield','♣','Q');
  add('remington','♣','K'); add('remington','♦','K');
  add('rev_carabiner','♦','Q');
  add('winchester','♠',8);
  // Extras
  add('scope','♠','A',2); add('mustang','♥',8,2);
  return d;
}

function cardNameKr(type) {
  const m={bang:'BANG!',missed:'MISSED!',beer:'맥주',stagecoach:'역마차',wells_fargo:'웹스파고',
    indians:'인디언',duel:'결투',gatling:'개틀링',saloon:'살롱',barrel:'통(배럴)',
    dynamite:'다이너마이트',jail:'감옥',volcanic:'볼카닉',schofield:'스코필드',
    remington:'레미턴',rev_carabiner:'리볼버 카빈',winchester:'윈체스터',
    scope:'조준경',mustang:'무스탙'};
  return m[type]||type;
}
function roleKr(r){return {sheriff:'보안관',deputy:'부관',outlaw:'무법자',renegade:'불한당'}[r]||r;}

// ── Deck helpers ─────────────────────────────────────────────────────
function bFlip(room) {
  if(room.bdeck.length===0){room.bdeck=shuffle(room.bdisc);room.bdisc=[];}
  if(!room.bdeck.length) return null;
  const c=room.bdeck.pop(); room.bdisc.push(c); return c;
}
function bDraw(room,n) {
  const out=[];
  for(let i=0;i<n;i++){
    if(room.bdeck.length===0){room.bdeck=shuffle(room.bdisc);room.bdisc=[];}
    if(room.bdeck.length) out.push(room.bdeck.pop());
  }
  return out;
}

// ── Distance ────────────────────────────────────────────────────────────
function bDist(room,fi,ti) {
  const alive=room.bplayers.filter(p=>p.alive);
  const fp=alive.indexOf(room.bplayers[fi]);
  const tp=alive.indexOf(room.bplayers[ti]);
  if(fp===-1||tp===-1) return 999;
  const n=alive.length;
  let dist=Math.min(Math.abs(fp-tp),n-Math.abs(fp-tp));
  if(room.bplayers[ti].equip.some(e=>e.type==='mustang')) dist++;
  if(room.bplayers[fi].equip.some(e=>e.type==='scope')) dist=Math.max(1,dist-1);
  return dist;
}
function bWeaponRange(p){
  const w=p.equip.find(e=>B_WEAPONS.has(e.type));
  return w?B_WEAPON_RANGE[w.type]:1;
}

// ── Broadcast ──────────────────────────────────────────────────────────
function bBroadcast(room) {
  if(room.bdone && !room._finalBroadcast) return;
  for(const p of room.bplayers) {
    io.to(p.sid).emit('bang_state',{
      players:room.bplayers.map(q=>({
        sid:q.sid, name:q.name,
        role:(q.sid===p.sid||q.role==='sheriff')?q.role:'?',
        hp:q.hp, maxHp:q.maxHp,
        handCount:q.hand.length,
        hand:q.sid===p.sid?q.hand:[],
        equip:q.equip, alive:q.alive,
      })),
      turnIdx:room.bturn,
      deckCount:room.bdeck.length,
      discardTop:room.bdisc[room.bdisc.length-1]||null,
      phase:room.bphase,
      pending:room.bpending?{
        type:room.bpending.type,
        attackerSid:room.bplayers[room.bpending.attackerIdx]?.sid,
        targetSid:room.bpending.targetIdx!=null?room.bplayers[room.bpending.targetIdx]?.sid:null,
        pendingSids:(room.bpending.pendingList||[]).map(i=>room.bplayers[i]?.sid),
        duelCurrentSid:room.bpending.duelCurrent!=null?room.bplayers[room.bpending.duelCurrent]?.sid:null,
      }:null,
      log:room.blog.slice(-14),
    });
  }
}
function bLog(room,msg){room.blog.push(msg);if(room.blog.length>60)room.blog.shift();}

// ── Damage & Death ─────────────────────────────────────────────────────
function bDamage(room,targetIdx,attackerIdx,amount=1) {
  const t=room.bplayers[targetIdx];
  t.hp=Math.max(0,t.hp-amount);
  if(t.hp>0) return;
  t.alive=false; t.hp=0;
  bLog(room,`💧 ${t.name} 사망! [${roleKr(t.role)}]`);
  // Outlaw killed => killer draws 3
  if(t.role==='outlaw'&&attackerIdx!=null) {
    const k=room.bplayers[attackerIdx];
    const drawn=bDraw(room,3);
    k.hand.push(...drawn);
    bLog(room,`🃏 ${k.name}이 ${t.name} 처치 보상으로 카드 3장 획득`);
  }
  // Sheriff kills deputy => sheriff loses all cards
  if(t.role==='deputy'&&attackerIdx!=null&&room.bplayers[attackerIdx]?.role==='sheriff') {
    const s=room.bplayers[attackerIdx];
    bLog(room,`⚠️ 보안관이 부관을 죽였다! ${s.name}의 모든 카드 폐기`);
    room.bdisc.push(...s.hand,...s.equip);
    s.hand=[]; s.equip=[];
  }
  room.bdisc.push(...t.hand,...t.equip);
  t.hand=[]; t.equip=[];
  bCheckWin(room);
}

function bCheckWin(room) {
  if(room.bdone) return;
  const alive=room.bplayers.filter(p=>p.alive);
  const sheriff=room.bplayers.find(p=>p.role==='sheriff');
  if(!sheriff?.alive) {
    const ren=room.bplayers.find(p=>p.role==='renegade');
    if(alive.length===1&&ren?.alive) bEnd(room,'renegade','불한당 승리! 모두를 혼자 제거했다!');
    else bEnd(room,'outlaw','무법자 승리! 보안관을 처치했다!');
    return;
  }
  if(!room.bplayers.some(p=>p.role==='outlaw'&&p.alive)&&!room.bplayers.some(p=>p.role==='renegade'&&p.alive))
    bEnd(room,'sheriff','보안관 승리! 모든 적을 제거했다!');
}

function bEnd(room,winner,reason) {
  room.bdone=true;
  bLog(room,`🏆 ${reason}`);
  room._finalBroadcast=true;
  io.to(room.id).emit('bang_game_over',{winner,reason,roles:room.bplayers.map(p=>({sid:p.sid,name:p.name,role:p.role}))});
  bBroadcast(room);
  setTimeout(()=>bangRooms.delete(room.id),60000);
}

// ── Turn management ─────────────────────────────────────────────────────────
function bNextAlive(room,from) {
  const n=room.bplayers.length;
  for(let i=1;i<=n;i++){const idx=(from+i)%n;if(room.bplayers[idx].alive)return idx;}
  return from;
}

function bAdvanceTurn(room) {
  if(room.bdone) return;
  room.bpending=null;
  room.bturn=bNextAlive(room,room.bturn);
  setTimeout(()=>bStartTurn(room),400);
}

function bStartTurn(room) {
  if(room.bdone) return;
  const p=room.bplayers[room.bturn];
  bLog(room,`─── ${p.name}의 턴 시작 ───`);
  room.bphase='start'; room.bpending=null;

  // Dynamite check
  const dynI=p.equip.findIndex(e=>e.type==='dynamite');
  if(dynI!==-1) {
    const card=bFlip(room);
    if(card&&card.suit==='♠'&&typeof card.value==='number'&&card.value>=2&&card.value<=9) {
      const dyn=p.equip.splice(dynI,1)[0]; room.bdisc.push(dyn);
      bLog(room,`💣 ${p.name}의 다이너마이트 폭발! -3HP`);
      bDamage(room,room.bturn,null,3);
      if(room.bdone) return;
      if(!p.alive){bAdvanceTurn(room);return;}
    } else {
      const dyn=p.equip.splice(dynI,1)[0];
      const ni=bNextAlive(room,room.bturn);
      room.bplayers[ni].equip.push(dyn);
      bLog(room,`💣 다이너마이트 불발 (${card?.suit||'?'}${card?.value||'?'}) → ${room.bplayers[ni].name}에게 이동`);
    }
  }
  if(room.bdone||!p.alive){bAdvanceTurn(room);return;}

  // Jail check
  const jailI=p.equip.findIndex(e=>e.type==='jail');
  if(jailI!==-1) {
    const card=bFlip(room);
    const jail=p.equip.splice(jailI,1)[0]; room.bdisc.push(jail);
    if(card?.suit!=='♥') {
      bLog(room,`🔒 ${p.name}이 감옥에서 턴 스킵 (${card?.suit||'?'}${card?.value||'?'})`);
      bBroadcast(room);
      bAdvanceTurn(room); return;
    }
    bLog(room,`🔓 ${p.name}이 감옥 탈출! (♥)`);
  }

  // Draw 2
  const drawn=bDraw(room,2);
  p.hand.push(...drawn);
  p.bangCount=0;
  room.bphase='play';
  bLog(room,`🃏 ${p.name}이 카드 2장 덧음`);
  bBroadcast(room);
}

// ── Play card ────────────────────────────────────────────────────────────
function bPlayCard(room,playerIdx,cardId,targetSid) {
  if(room.bdone||room.bphase!=='play'||room.bturn!==playerIdx) return {ok:false,msg:'지금은 카드를 낼 수 없습니다'};
  if(room.bpending) return {ok:false,msg:'응답 대기 중'};
  const pl=room.bplayers[playerIdx];
  const ci=pl.hand.findIndex(c=>c.id===cardId);
  if(ci===-1) return {ok:false,msg:'카드 없음'};
  const card=pl.hand[ci];
  const ti=targetSid?room.bplayers.findIndex(p=>p.sid===targetSid):-1;

  // Validations
  if(['bang','jail','duel'].includes(card.type)){
    if(ti===-1||!room.bplayers[ti]?.alive) return {ok:false,msg:'대상 선택 필요'};
    if(ti===playerIdx) return {ok:false,msg:'자신은 대상 불가'};
  }
  if(card.type==='bang'){
    const range=bWeaponRange(pl);
    const dist=bDist(room,playerIdx,ti);
    if(dist>range) return {ok:false,msg:`사거리 초과 (사거리:${range}, 거리:${dist})`};
    const isVolcanic=pl.equip.some(e=>e.type==='volcanic');
    if(!isVolcanic&&pl.bangCount>=1) return {ok:false,msg:'이미 BANG! 사용 (볼카닉 필요)'};
  }
  if(card.type==='jail'){
    if(room.bplayers[ti].role==='sheriff') return {ok:false,msg:'보안관은 감옥 불가'};
    if(room.bplayers[ti].equip.some(e=>e.type==='jail')) return {ok:false,msg:'이미 감옥 중'};
  }

  // Remove from hand
  pl.hand.splice(ci,1);

  switch(card.type){
    case 'bang':
      pl.bangCount++;
      room.bdisc.push(card);
      bLog(room,`🔫 ${pl.name} → ${room.bplayers[ti].name}에게 BANG!`);
      bInitBangResponse(room,playerIdx,ti);
      break;
    case 'missed':
      pl.hand.splice(ci,0,card); // put back
      return {ok:false,msg:'MISSED!는 BANG! 응답용입니다'};
    case 'beer':
      room.bdisc.push(card);
      if(pl.hp<pl.maxHp){pl.hp++;bLog(room,`🍺 ${pl.name}이 맥주 마싘 (+1 HP, ${pl.hp}/${pl.maxHp})`);}
      else bLog(room,`🍺 ${pl.name}이 맥주 마싘 (이미 최대 HP)`);
      bBroadcast(room); break;
    case 'stagecoach':{
      room.bdisc.push(card);
      const dr=bDraw(room,2); pl.hand.push(...dr);
      bLog(room,`🚌 ${pl.name}이 역마차 (카드 2장 획득)`);
      bBroadcast(room); break;}
    case 'wells_fargo':{
      room.bdisc.push(card);
      const dr=bDraw(room,3); pl.hand.push(...dr);
      bLog(room,`🏦 ${pl.name}이 웹스파고 (카드 3장 획득)`);
      bBroadcast(room); break;}
    case 'indians':{
      room.bdisc.push(card);
      const plist=room.bplayers.map((_,i)=>i).filter(i=>i!==playerIdx&&room.bplayers[i].alive);
      bLog(room,`🏹 ${pl.name}이 인디언! 모두 BANG! 또는 피해`);
      room.bpending={type:'indians',attackerIdx:playerIdx,pendingList:[...plist]};
      bBroadcast(room); break;}
    case 'gatling':{
      room.bdisc.push(card);
      const plist=room.bplayers.map((_,i)=>i).filter(i=>i!==playerIdx&&room.bplayers[i].alive);
      bLog(room,`💥 ${pl.name}이 개틀링 건! 모든 플레이어 -1HP`);
      // Gatling is instant (no response in simplified version)
      for(const idx of plist){
        bLog(room,`💥 ${room.bplayers[idx].name} -1HP`);
        bDamage(room,idx,playerIdx,1);
        if(room.bdone) return {ok:true};
      }
      bBroadcast(room); break;}
    case 'saloon':
      room.bdisc.push(card);
      for(const p of room.bplayers) if(p.alive&&p.hp<p.maxHp) p.hp++;
      bLog(room,`🍻 ${pl.name}이 살롱! 모든 플레이어 +1HP`);
      bBroadcast(room); break;
    case 'barrel':
      if(pl.equip.some(e=>e.type==='barrel')){pl.hand.splice(ci,0,card);return {ok:false,msg:'이미 통(배럴) 보유'};}
      pl.equip.push(card);
      bLog(room,`🛡️ ${pl.name}이 통(배럴) 설치`);
      bBroadcast(room); break;
    case 'dynamite':
      if(pl.equip.some(e=>e.type==='dynamite')){pl.hand.splice(ci,0,card);return {ok:false,msg:'이미 다이너마이트 보유'};}
      pl.equip.push(card);
      bLog(room,`💣 ${pl.name}이 다이너마이트 설치`);
      bBroadcast(room); break;
    case 'jail':
      room.bplayers[ti].equip.push(card);
      bLog(room,`🔒 ${pl.name}이 ${room.bplayers[ti].name}을 감옥에 보냄`);
      bBroadcast(room); break;
    case 'scope':
      if(pl.equip.some(e=>e.type==='scope')){pl.hand.splice(ci,0,card);return {ok:false,msg:'이미 조준경 보유'};}
      pl.equip.push(card);
      bLog(room,`🔭 ${pl.name}이 조준경 장착`);
      bBroadcast(room); break;
    case 'mustang':
      if(pl.equip.some(e=>e.type==='mustang')){pl.hand.splice(ci,0,card);return {ok:false,msg:'이미 무스탙 보유'};}
      pl.equip.push(card);
      bLog(room,`🐴 ${pl.name}이 무스탙 장착`);
      bBroadcast(room); break;
    case 'volcanic':case 'schofield':case 'remington':case 'rev_carabiner':case 'winchester':{
      const oi=pl.equip.findIndex(e=>B_WEAPONS.has(e.type));
      if(oi!==-1){room.bdisc.push(pl.equip.splice(oi,1)[0]);}
      pl.equip.push(card);
      bLog(room,`🔫 ${pl.name}이 ${cardNameKr(card.type)} 장착 (사거리 ${B_WEAPON_RANGE[card.type]})`);
      bBroadcast(room); break;}
    default:
      room.bdisc.push(card); bBroadcast(room);
  }
  return {ok:true};
}

function bInitBangResponse(room,attackerIdx,targetIdx) {
  const t=room.bplayers[targetIdx];
  // Auto-check barrel
  if(t.equip.some(e=>e.type==='barrel')){
    const card=bFlip(room);
    if(card?.suit==='♥'){
      bLog(room,`🛡️ ${t.name}의 통(배럴)이 막음! (♥${card.value})`);
      bBroadcast(room); return;
    }
    bLog(room,`🛡️ ${t.name}의 통(배럴) 실패 (${card?.suit||'?'}${card?.value||'?'})`);
  }
  room.bpending={type:'bang',attackerIdx,targetIdx};
  bBroadcast(room);
}

// ── Response ───────────────────────────────────────────────────────────────
function bRespond(room,playerIdx,cardId) {
  const pend=room.bpending;
  if(!pend) return;
  const pl=room.bplayers[playerIdx];

  if(pend.type==='bang'){
    if(playerIdx!==pend.targetIdx) return;
    if(cardId!=null){
      const ci=pl.hand.findIndex(c=>c.id===cardId);
      if(ci===-1) return;
      const card=pl.hand[ci];
      if(card.type!=='missed'&&!(card.type==='beer'&&pl.hp===1)) return;
      pl.hand.splice(ci,1); room.bdisc.push(card);
      bLog(room,`🤚 ${pl.name}이 ${cardNameKr(card.type)}로 막음!`);
      room.bpending=null; bBroadcast(room);
    } else {
      room.bpending=null;
      bLog(room,`💥 ${pl.name}이 BANG! 맞음 -1HP`);
      bDamage(room,playerIdx,pend.attackerIdx,1);
      if(!room.bdone) bBroadcast(room);
    }
  } else if(pend.type==='indians'){
    const expected=pend.pendingList[0];
    if(playerIdx!==expected) return;
    if(cardId!=null){
      const ci=pl.hand.findIndex(c=>c.id===cardId);
      if(ci===-1) return;
      const card=pl.hand[ci];
      if(card.type!=='bang') return;
      pl.hand.splice(ci,1); room.bdisc.push(card);
      bLog(room,`🏹 ${pl.name}이 BANG!으로 인디언 막음`);
    } else {
      bLog(room,`💥 ${pl.name}이 인디언에 맞음 -1HP`);
      bDamage(room,playerIdx,pend.attackerIdx,1);
      if(room.bdone) return;
    }
    pend.pendingList.shift();
    if(pend.pendingList.length>0){bBroadcast(room);}
    else{room.bpending=null;bBroadcast(room);}
  } else if(pend.type==='duel'){
    if(playerIdx!==pend.duelCurrent) return;
    if(cardId!=null){
      const ci=pl.hand.findIndex(c=>c.id===cardId);
      if(ci===-1) return;
      const card=pl.hand[ci];
      if(card.type!=='bang') return;
      pl.hand.splice(ci,1); room.bdisc.push(card);
      bLog(room,`⚔️ ${pl.name}이 결투에서 BANG!`);
      [pend.duelCurrent,pend.duelOther]=[pend.duelOther,pend.duelCurrent];
      bBroadcast(room);
    } else {
      const attackerIdx=pend.duelOther;
      bLog(room,`⚔️ ${pl.name}이 결투 패배 -1HP`);
      room.bpending=null;
      bDamage(room,playerIdx,attackerIdx,1);
      if(!room.bdone) bBroadcast(room);
    }
  }
}

// ── End turn & Discard ─────────────────────────────────────────────────────────
function bEndTurn(room,playerIdx) {
  if(room.bturn!==playerIdx||room.bpending) return;
  if(room.bphase!=='play') return;
  const pl=room.bplayers[playerIdx];
  if(pl.hand.length>pl.hp){room.bphase='discard';bBroadcast(room);}
  else bAdvanceTurn(room);
}

function bDiscardCard(room,playerIdx,cardId) {
  if(room.bphase!=='discard'||room.bturn!==playerIdx) return;
  const pl=room.bplayers[playerIdx];
  const ci=pl.hand.findIndex(c=>c.id===cardId);
  if(ci===-1) return;
  const card=pl.hand.splice(ci,1)[0];
  room.bdisc.push(card);
  bLog(room,`🗑️ ${pl.name}이 ${cardNameKr(card.type)} 버렸`);
  if(pl.hand.length<=pl.hp) bAdvanceTurn(room);
  else bBroadcast(room);
}

// ── Lobby ──────────────────────────────────────────────────────────────────
const bangRooms = new Map();
let bangLobby={id:'BANG0',players:[],started:false};

function bLobbyBroadcast() {
  for(const p of bangLobby.players)
    io.to(p.sid).emit('bang_lobby',{
      players:bangLobby.players.map(q=>({sid:q.sid,name:q.name})),
      hostSid:bangLobby.players[0]?.sid,
      minPlayers:4, maxPlayers:8,
    });
}

function bStartGame() {
  if(bangLobby.started||bangLobby.players.length<4) return;
  bangLobby.started=true;
  const n=bangLobby.players.length;
  const roles=shuffle(B_ROLES[Math.min(n,8)]||B_ROLES[8]);
  const deck=shuffle(makeBangDeck());
  const room={
    id:bangLobby.id,
    bplayers:bangLobby.players.map((p,i)=>({
      sid:p.sid,name:p.name,role:roles[i],
      hp:roles[i]==='sheriff'?5:4,maxHp:roles[i]==='sheriff'?5:4,
      hand:[],equip:[],alive:true,bangCount:0,
    })),
    bdeck:deck,bdisc:[],bturn:0,bphase:'start',
    bpending:null,bdone:false,blog:[],
  };
  // Sheriff goes first
  const si=room.bplayers.findIndex(p=>p.role==='sheriff');
  if(si>0){const s=room.bplayers.splice(si,1)[0];room.bplayers.unshift(s);}
  room.bturn=0;
  // Deal initial hands (equal to max HP)
  for(const p of room.bplayers) p.hand=bDraw(room,p.maxHp);
  bangRooms.set(room.id,room);
  for(const p of room.bplayers){
    const s=io.sockets.sockets.get(p.sid);
    if(s) s.join(room.id);
  }
  io.to(room.id).emit('bang_game_start',{roomId:room.id});
  bLog(room,'게임 시작! 🤠 보안관 역할은 공개됩니다.');
  bStartTurn(room);
  // Reset lobby
  bangLobby={id:'BANG'+Date.now().toString(36),players:[],started:false};
}

// ═══════════════════════════════════════════════════════════
// SOCKET HANDLERS
// ═══════════════════════════════════════════════════════════
io.on('connection', socket => {
  console.log('connect:', socket.id);

  // ── 말달리자 ────────────────────────────────────────────────────────────
  socket.on('join', ({ name }) => {
    const i = queue.findIndex(p => p.sid === socket.id);
    if (i >= 0) queue.splice(i, 1);
    queue.push({ sid: socket.id, name: (name || '플레이어').slice(0, 14) });
    socket.emit('waiting');
    tryMatch();
  });

  socket.on('cancel', () => {
    const i = queue.findIndex(p => p.sid === socket.id);
    if (i >= 0) queue.splice(i, 1);
  });

  socket.on('move', ({ roomId, fc, fr, tc, tr }) => {
    const room = rooms.get(roomId);
    if (!room || room.done) return;
    const me = room.players.find(p => p.sid === socket.id);
    if (!me || me.color !== room.turn) return;
    if (!room.grid[fc]?.[fr] || room.grid[fc][fr] !== me.color) return;
    if (!isValid(room.grid, fc, fr, tc, tr)) return;
    room.grid[tc][tr] = room.grid[fc][fr];
    room.grid[fc][fr] = null;
    if (tc === 5 && tr === 5) {
      room.done = true; clearInterval(room.timerId);
      io.to(room.id).emit('winner', { color: me.color, name: me.name }); return;
    }
    room.turn = room.turn === 'black' ? 'white' : 'black';
    io.to(room.id).emit('state', roomState(room));
    startTimer(room);
  });

  // ── BANG! lobby ────────────────────────────────────────────────────────────
  socket.on('bang_join', ({name}) => {
    // Leave if already in lobby
    bangLobby.players = bangLobby.players.filter(p=>p.sid!==socket.id);
    if(bangLobby.started||bangLobby.players.length>=8){
      bangLobby={id:'BANG'+Date.now().toString(36),players:[],started:false};
    }
    bangLobby.players.push({sid:socket.id, name:(name||'플레이어').slice(0,14)});
    socket.emit('bang_joined',{roomId:bangLobby.id});
    bLobbyBroadcast();
  });

  socket.on('bang_leave_lobby', () => {
    bangLobby.players=bangLobby.players.filter(p=>p.sid!==socket.id);
    bLobbyBroadcast();
  });

  socket.on('bang_host_start', () => {
    if(bangLobby.players[0]?.sid!==socket.id) return;
    if(bangLobby.players.length<4){
      socket.emit('bang_err','최소 4명 필요');return;
    }
    bStartGame();
  });

  // ── BANG! game ──────────────────────────────────────────────────────────────
  socket.on('bang_play', ({roomId, cardId, targetSid}) => {
    const room=bangRooms.get(roomId);
    if(!room) return;
    const idx=room.bplayers.findIndex(p=>p.sid===socket.id);
    if(idx===-1) return;
    const res=bPlayCard(room,idx,cardId,targetSid);
    if(!res.ok) socket.emit('bang_err',res.msg);
  });

  socket.on('bang_respond', ({roomId, cardId}) => {
    const room=bangRooms.get(roomId);
    if(!room) return;
    const idx=room.bplayers.findIndex(p=>p.sid===socket.id);
    if(idx===-1) return;
    bRespond(room,idx,cardId||null);
  });

  socket.on('bang_end_turn', ({roomId}) => {
    const room=bangRooms.get(roomId);
    if(!room) return;
    const idx=room.bplayers.findIndex(p=>p.sid===socket.id);
    if(idx===-1) return;
    bEndTurn(room,idx);
  });

  socket.on('bang_discard', ({roomId, cardId}) => {
    const room=bangRooms.get(roomId);
    if(!room) return;
    const idx=room.bplayers.findIndex(p=>p.sid===socket.id);
    if(idx===-1) return;
    bDiscardCard(room,idx,cardId);
  });

  // ── Disconnect ──────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    // 말달리자
    const qi = queue.findIndex(p => p.sid === socket.id);
    if (qi >= 0) queue.splice(qi, 1);
    for (const [, room] of rooms) {
      if (room.done) continue;
      if (!room.players.some(p => p.sid === socket.id)) continue;
      clearInterval(room.timerId); room.done = true;
      const opp = room.players.find(p => p.sid !== socket.id);
      if (opp) io.to(opp.sid).emit('opp_left');
    }
    // Bang! lobby
    if(bangLobby.players.some(p=>p.sid===socket.id)){
      bangLobby.players=bangLobby.players.filter(p=>p.sid!==socket.id);
      bLobbyBroadcast();
    }
    // Bang! game
    for(const [,room] of bangRooms){
      if(room.bdone) continue;
      const pi=room.bplayers.findIndex(p=>p.sid===socket.id);
      if(pi===-1) continue;
      room.bplayers[pi].alive=false;
      room.bplayers[pi].hand=[]; room.bplayers[pi].equip=[];
      bLog(room,`🚪 ${room.bplayers[pi].name}이 게임을 나갔습니다`);
      bCheckWin(room);
      if(!room.bdone) bBroadcast(room);
    }
  });
});

http.listen(PORT, () => console.log(`서버 시작: http://localhost:${PORT}`));
