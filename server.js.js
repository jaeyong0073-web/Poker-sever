const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ===== 게임 규칙 (어제 만든 것과 동일) =====
const SUITS = ['S','H','D','C'];
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const RANK_VALUE = Object.fromEntries(RANKS.map((r,i)=>[r,i+2]));

function createDeck(){ const d=[]; for(const s of SUITS) for(const r of RANKS) d.push({r,s}); return d; }
function shuffle(d){ for(let i=d.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [d[i],d[j]]=[d[j],d[i]]; } return d; }

function evaluate5(cards){
  const vals=cards.map(c=>RANK_VALUE[c.r]).sort((a,b)=>b-a);
  const suits=cards.map(c=>c.s);
  const isFlush=suits.every(s=>s===suits[0]);
  const counts={}; vals.forEach(v=>counts[v]=(counts[v]||0)+1);
  const groups=Object.entries(counts).map(([v,n])=>({v:+v,n})).sort((a,b)=>b.n-a.n||b.v-a.v);
  let uniq=[...new Set(vals)].sort((a,b)=>b-a);
  let isStraight=false, straightHigh=0;
  if(uniq.length===5){
    if(uniq[0]-uniq[4]===4){isStraight=true;straightHigh=uniq[0];}
    else if(uniq.join(',')==='14,5,4,3,2'){isStraight=true;straightHigh=5;}
  }
  if(isStraight&&isFlush) return {cat:9,tiebreak:[straightHigh]};
  if(groups[0].n===4) return {cat:8,tiebreak:[groups[0].v,groups[1].v]};
  if(groups[0].n===3&&groups[1].n===2) return {cat:7,tiebreak:[groups[0].v,groups[1].v]};
  if(isFlush) return {cat:6,tiebreak:vals};
  if(isStraight) return {cat:5,tiebreak:[straightHigh]};
  if(groups[0].n===3) return {cat:4,tiebreak:[groups[0].v,...groups.slice(1).map(g=>g.v)]};
  if(groups[0].n===2&&groups[1].n===2) return {cat:3,tiebreak:[groups[0].v,groups[1].v,groups[2].v]};
  if(groups[0].n===2) return {cat:2,tiebreak:[groups[0].v,...groups.slice(1).map(g=>g.v)]};
  return {cat:1,tiebreak:vals};
}
function evaluate3(cards){
  const vals=cards.map(c=>RANK_VALUE[c.r]).sort((a,b)=>b-a);
  const counts={}; vals.forEach(v=>counts[v]=(counts[v]||0)+1);
  const groups=Object.entries(counts).map(([v,n])=>({v:+v,n})).sort((a,b)=>b.n-a.n||b.v-a.v);
  if(groups[0].n===3) return {cat:3,tiebreak:[groups[0].v]};
  if(groups[0].n===2) return {cat:2,tiebreak:[groups[0].v,groups[1].v]};
  return {cat:1,tiebreak:vals};
}
function compareEval(a,b){
  if(a.cat!==b.cat) return a.cat-b.cat;
  for(let i=0;i<Math.max(a.tiebreak.length,b.tiebreak.length);i++){
    const x=a.tiebreak[i]||0, y=b.tiebreak[i]||0;
    if(x!==y) return x-y;
  }
  return 0;
}
function validateHand(hand){
  if(!hand||hand.front.length!==3||hand.middle.length!==5||hand.back.length!==5)
    return {ok:false,msg:'카드 수가 맞지 않습니다 (3/5/5)'};
  const all=[...hand.front,...hand.middle,...hand.back];
  if(new Set(all.map(c=>c.r+c.s)).size!==13) return {ok:false,msg:'중복된 카드가 있습니다'};
  const eFront=evaluate3(hand.front), eMiddle=evaluate5(hand.middle), eBack=evaluate5(hand.back);
  if(compareEval(eMiddle,eFront)<0) return {ok:false,msg:'중간이 앞보다 약합니다 (거꾸로)'};
  if(compareEval(eBack,eMiddle)<0) return {ok:false,msg:'뒤가 중간보다 약합니다 (거꾸로)'};
  return {ok:true,eFront,eMiddle,eBack};
}
function zoneScoreFromWins(wins, losses){
  if(wins===3 && losses===0) return 5;
  if(wins===2 && losses===1) return 1;
  if(wins===1 && losses===2) return -1;
  if(wins===0 && losses===3) return -5;
  return wins - losses;
}
function specialBonus(v){
  let bonus=0; const details=[];
  if(v.eFront.cat===3){bonus+=3;details.push('트리플(Top) +3');}
  if(v.eMiddle.cat===8){bonus+=3;details.push('포카드(Middle) +3');}
  if(v.eBack.cat===8){bonus+=3;details.push('포카드(Bottom) +3');}
  if(v.eMiddle.cat===9){ if(v.eMiddle.tiebreak[0]===14){bonus+=10;details.push('로열 플러시(Middle) +10');} else {bonus+=5;details.push('스트레이트 플러시(Middle) +5');} }
  if(v.eBack.cat===9){ if(v.eBack.tiebreak[0]===14){bonus+=10;details.push('로열 플러시(Bottom) +10');} else {bonus+=5;details.push('스트레이트 플러시(Bottom) +5');} }
  return {bonus,details};
}
function duelDetail(handA, handB){
  const va=validateHand(handA), vb=validateHand(handB);
  const noBonus={bonus:0,details:[]};
  if(!va.ok&&!vb.ok) return {pts:[0,0],aSpecial:noBonus,bSpecial:noBonus};
  if(!va.ok) return {pts:[-5,5],aSpecial:noBonus,bSpecial:noBonus};
  if(!vb.ok) return {pts:[5,-5],aSpecial:noBonus,bSpecial:noBonus};
  const aS=specialBonus(va), bS=specialBonus(vb);
  let aw=0,al=0,bw=0,bl=0;
  for(const k of ['front','middle','back']){
    const ea = k==='front'?va.eFront:k==='middle'?va.eMiddle:va.eBack;
    const eb = k==='front'?vb.eFront:k==='middle'?vb.eMiddle:vb.eBack;
    const c = compareEval(ea,eb);
    if(c>0){aw++;bl++;} else if(c<0){al++;bw++;}
  }
  return { pts:[zoneScoreFromWins(aw,al)+aS.bonus, zoneScoreFromWins(bw,bl)+bS.bonus], aSpecial:aS, bSpecial:bS };
}

// ===== AI 배치 (완전 탐색, 파울 없음) =====
function aiArrange(hand){
  const n=hand.length;
  let best=null, bestEval=null;
  const consider=(front,middle,back)=>{
    const eF=evaluate3(front), eM=evaluate5(middle), eB=evaluate5(back);
    if(compareEval(eM,eF)<0) return;
    if(compareEval(eB,eM)<0) return;
    if(!bestEval){best={front,middle,back};bestEval={eF,eM,eB};return;}
    let c=compareEval(eB,bestEval.eB);
    if(c>0){best={front,middle,back};bestEval={eF,eM,eB};return;}
    if(c<0) return;
    c=compareEval(eM,bestEval.eM);
    if(c>0){best={front,middle,back};bestEval={eF,eM,eB};return;}
    if(c<0) return;
    c=compareEval(eF,bestEval.eF);
    if(c>0){best={front,middle,back};bestEval={eF,eM,eB};}
  };
  for(let a=0;a<n-2;a++)for(let b=a+1;b<n-1;b++)for(let c=b+1;c<n;c++){
    const front=[hand[a],hand[b],hand[c]];
    const rest1=hand.filter((_,i)=>i!==a&&i!==b&&i!==c);
    for(let d=0;d<rest1.length-4;d++)for(let e=d+1;e<rest1.length-3;e++)
    for(let f=e+1;f<rest1.length-2;f++)for(let g=f+1;g<rest1.length-1;g++)for(let h=g+1;h<rest1.length;h++){
      const middle=[rest1[d],rest1[e],rest1[f],rest1[g],rest1[h]];
      const used=new Set([...front,...middle].map(x=>x.r+x.s));
      const back=rest1.filter(x=>!used.has(x.r+x.s));
      if(back.length!==5) continue;
      consider(front,middle,back);
    }
  }
  return best || {front:hand.slice(0,3),middle:hand.slice(3,8),back:hand.slice(8,13)};
}

// ===== 방 관리 =====
const rooms = {}; // { roomId: { players: [{id,name,hand,arrangement,submitted}], state } }

function makeRoomId(){ return Math.random().toString(36).slice(2,7).toUpperCase(); }

io.on('connection', socket => {
  socket.on('create-room', ({name}, cb) => {
    const id = makeRoomId();
    rooms[id] = { players: [{ id: socket.id, name, hand:[], arrangement:null, submitted:false }], started:false, round:0 };
    socket.join(id);
    socket.roomId = id;
    cb({ ok:true, roomId:id });
    io.to(id).emit('room-update', publicRoom(rooms[id]));
  });

  socket.on('join-room', ({name, roomId}, cb) => {
    const room = rooms[roomId];
    if(!room) return cb({ ok:false, msg:'방이 없습니다' });
    if(room.players.length >= 4) return cb({ ok:false, msg:'방이 가득 찼습니다' });
    room.players.push({ id: socket.id, name, hand:[], arrangement:null, submitted:false });
    socket.join(roomId);
    socket.roomId = roomId;
    cb({ ok:true });
    io.to(roomId).emit('room-update', publicRoom(room));
  });

  socket.on('start-game', () => {
    const room = rooms[socket.roomId];
    if(!room || room.players.length < 2) return;
    startRound(room);
  });

  socket.on('submit', (arrangement) => {
    const room = rooms[socket.roomId];
    if(!room || !room.started) return;
    const p = room.players.find(p=>p.id===socket.id);
    if(!p || p.submitted) return;
    const v = validateHand(arrangement);
    if(!v.ok){ socket.emit('error-msg', v.msg); return; }
    p.arrangement = arrangement;
    p.submitted = true;
    io.to(socket.roomId).emit('room-update', publicRoom(room));
    if(room.players.every(p=>p.submitted)) endRound(room);
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if(!roomId || !rooms[roomId]) return;
    rooms[roomId].players = rooms[roomId].players.filter(p=>p.id!==socket.id);
    if(rooms[roomId].players.length===0) delete rooms[roomId];
    else io.to(roomId).emit('room-update', publicRoom(rooms[roomId]));
  });
});

function publicRoom(room){
  return {
    started: room.started,
    round: room.round,
    players: room.players.map(p=>({
      name: p.name, submitted: p.submitted,
      // 제출 전에는 다른 사람 카드 안 보임
      hand: p.submitted ? p.hand : null
    }))
  };
}

function startRound(room){
  const deck = shuffle(createDeck());
  const count = room.players.length;
  room.players.forEach((p,i)=>{
    p.hand = deck.slice(i*13, i*13+13);
    p.arrangement = null;
    p.submitted = false;
  });
  // 4명 미만이면 AI로 채움
  room.aiHands = [];
  for(let i=count;i<4;i++) room.aiHands.push(deck.slice(i*13,i*13+13));
  room.started = true;
  room.round++;
  // 각 플레이어에게 자기 패만 개별 전송
  room.players.forEach(p=>{
    io.to(p.id).emit('your-hand', { hand: p.hand, round: room.round });
  });
  io.to(room.players[0].id).emit('room-update', publicRoom(room));
  room.players.forEach(p=>io.to(p.id).emit('room-update', publicRoom(room)));
}

function endRound(room){
  // AI 배치 생성
  const aiArrs = (room.aiHands||[]).map(h=>aiArrange(h));
  const allHands = [...room.players.map(p=>p.arrangement), ...aiArrs];
  const names = [...room.players.map(p=>p.name), ...aiArrs.map((_,i)=>'AI'+(i+1))];
  const n = allHands.length;
  const round = names.map(()=>0);
  const pairs = [];
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
    const d = duelDetail(allHands[i], allHands[j]);
    round[i]+=d.pts[0]; round[j]+=d.pts[1];
    pairs.push({i,j,d});
  }
  io.to(room.players[0].id).emit('noop'); // 트리거용
  // 모든 플레이어에게 결과 브로드캐스트
  room.players.forEach((p, idx)=>{
    const myPairs = pairs.filter(pr=>pr.i===idx||pr.j===idx);
    io.to(p.id).emit('round-result', {
      names, hands: allHands, round, pairs: myPairs, myIndex: idx
    });
  });
  room.started = false;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>console.log('서버 실행 중: http://localhost:'+PORT));