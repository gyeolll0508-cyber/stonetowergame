/* =========================================================
 * js3d/bgm.js — 배경음악 (오리지널 2곡, 음원 파일 없음)
 *  브라우저의 Web Audio로 악기 소리를 직접 합성해 연주해요.
 *  → 외부 음원을 쓰지 않아 저작권·라이선스 걱정이 없어요.
 *
 *  곡 1) campus  캠퍼스 탐험: G장조 · 66BPM · 피아노 + 실로폰, 느긋하고 포근하게
 *  곡 2) stack   돌탑 쌓기:   레트로 아케이드(8비트) 오리지널 · 펄스파 멜로디 + 삼각파 베이스 + 노이즈 드럼
 *       단계 1 (1~3층)  C장조 · 112BPM  귀엽고 경쾌하게
 *       단계 2 (4~6층)  A단조 · 120BPM  16분 아르페지오·스네어가 더해져 촘촘하게
 *       단계 3 (7층~)   A화성단조 · 128BPM  빠른 하이햇·높은 경고음·반음 접근으로 아슬아슬하게
 *       → 단계는 4마디(한 구절) 단위로 바뀌고, 템포는 마디마다 최대 3BPM씩,
 *         더해지는 악기는 몇 초에 걸쳐 서서히 커져요(갑작스럽지 않게).
 *       → 멜로디는 구절마다 새로 만든 짧은 동기(모티브)를 반복·변형해요. 기존 게임 음악을 옮기지 않았어요.
 *   - 곡을 바꾸면 이전 곡이 서서히 작아지고 새 곡이 서서히 커져요(크로스페이드).
 *   - 돌탑 완성 때 짧은 성공 효과음: Bgm.sfx('success')
 *
 *  사용: Bgm.play('campus' | 'stack')  — 화면 전환 때 호출
 *        Bgm.setLevel(층수)            — 돌탑 높이에 따라 돌탑 곡의 단계 조절
 *        ON/OFF: data-bgm-toggle 속성이 있는 버튼 + M 키 (두 화면 공통)
 *  자동재생 정책: 페이지에서 처음 클릭·터치·키 입력이 있을 때 소리를 켜요.
 *  ON/OFF 선택은 이 브라우저에 기억해요(게임 데이터·Supabase와 별개).
 *
 *  잡음 방지
 *   - 모든 음은 5ms 이상 부드럽게 시작하고, 0까지 줄어든 뒤에 멈춰요(클릭음 방지).
 *   - 끝난 음의 오디오 노드는 바로 연결을 끊어 정리해요(오디오 처리 부담 감소).
 *   - 음량 조절은 cancelAndHold + setTarget으로 끊김 없이 이어요.
 *   - 클릭·터치할 때마다 음량을 다시 조절하지 않아요(이미 재생 중이면 그대로 둠).
 *   - 마지막 단계는 평소엔 동작하지 않는 안전 리미터(갑자기 커질 때만 눌러 줌).
 *   - 화면이 잠깐 멈춰 박자가 늦어지면 밀린 음을 몰아 치지 않고 다음 박부터 이어요.
 * ========================================================= */

const PREF_KEY = 'cbnu-stonetower-bgm';
const MASTER = 0.32;          // 전체 음량(작게) — 소리 크기는 이 값으로 조절
const FADE_IN = 1.8, FADE_OUT = 1.2;
const MIN_ATTACK = 0.005;     // 음 시작 최소 시간(초) — 이보다 짧으면 '틱' 소리가 나요
const LOOKAHEAD = 0.6;        // 미리 예약하는 시간(초)

/* ---------------- 공통 도구 ---------------- */

function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function rand(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }

let ctx = null, master = null, sharedIn = null, verb = null, analyser = null, noiseBuf = null, sfxIn = null;
let timer = 0, notes = 0, live = 0, resyncs = 0;
let enabled = readPref();
let current = 'campus';       // 지금 화면에 맞는 곡
const listeners = [];

function readPref() {
  try { return localStorage.getItem(PREF_KEY) !== 'off'; } catch (e) { return true; }
}
function writePref(v) {
  try { localStorage.setItem(PREF_KEY, v ? 'on' : 'off'); } catch (e) { /* 저장 안 돼도 동작 */ }
}

// 음량을 끊김 없이 목표값으로 (지금 값에서 이어서 부드럽게)
function glide(param, value, seconds) {
  const now = ctx.currentTime;
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
  else { param.cancelScheduledValues(now); param.setValueAtTime(param.value, now); }
  param.setTargetAtTime(value, now, Math.max(0.01, seconds / 4)); // 약 seconds 뒤 거의 도달
}

/* ---------------- 소리 장치 ---------------- */

function impulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const fadeIn = Math.floor(ctx.sampleRate * 0.01);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, decay) * Math.min(1, i / fadeIn); // 첫 10ms 부드럽게
      d[i] = (Math.random() * 2 - 1) * env;
    }
  }
  return buf;
}

function setup() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC({ latencyHint: 'playback' }); // 게임 효과음이 아닌 배경음악 → 여유 있는 버퍼로 끊김 줄이기
  master = ctx.createGain();
  master.gain.value = enabled ? MASTER : 0;
  // 안전 리미터: 평소 음량(약 -30dB)에서는 동작하지 않고, 혹시 너무 커질 때만 눌러 줘요
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  master.connect(limiter);
  limiter.connect(analyser);
  analyser.connect(ctx.destination);

  // 모든 곡 → 부드럽게(lowpass) → 원음 + 잔향
  sharedIn = ctx.createBiquadFilter();
  sharedIn.type = 'lowpass';
  sharedIn.frequency.value = 6000;
  const dry = ctx.createGain(); dry.gain.value = 0.78;
  sharedIn.connect(dry); dry.connect(master);
  verb = ctx.createConvolver(); verb.buffer = impulse(2.4, 2.6);
  verb.connect(master);

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  Object.keys(TRACKS).forEach(function (id) {
    const tr = TRACKS[id];
    tr.bus = ctx.createGain();
    tr.bus.gain.value = 0;
    tr.bus.connect(sharedIn);
    const send = ctx.createGain();
    send.gain.value = tr.reverb;
    tr.bus.connect(send);
    send.connect(verb);
    // 곡마다 한 번만 만드는 필터(음마다 만들지 않아 처리 부담 감소)
    tr.padIn = ctx.createBiquadFilter();
    tr.padIn.type = 'lowpass';
    tr.padIn.frequency.value = 850;
    tr.padIn.connect(tr.bus);
    tr.softIn = ctx.createBiquadFilter();
    tr.softIn.type = 'lowpass';
    tr.softIn.frequency.value = 2200;
    tr.softIn.connect(tr.bus);
    tr.hiIn = ctx.createBiquadFilter();
    tr.hiIn.type = 'highpass';
    tr.hiIn.frequency.value = 5000;
    tr.hiIn.connect(tr.bus);
  });

  // 8비트 돌탑 곡 전용: 펄스파 음색, 부드럽게 깎는 필터, 단계별로 더해지는 악기층
  pulse.p25 = pulseWave(0.25);
  pulse.p125 = pulseWave(0.125);
  const st = TRACKS.stack;
  st.chipIn = ctx.createBiquadFilter();       // 네모파의 날카로운 고음을 살짝 깎아 귀에 편하게
  st.chipIn.type = 'lowpass';
  st.chipIn.frequency.value = 4200;
  st.chipIn.connect(st.bus);
  st.drive = ctx.createGain(); st.drive.gain.value = 0; st.drive.connect(st.chipIn);   // 단계 2층
  st.tense = ctx.createGain(); st.tense.gain.value = 0; st.tense.connect(st.chipIn);   // 단계 3층
  st.tenseHat = ctx.createGain(); st.tenseHat.gain.value = 0; st.tenseHat.connect(st.hiIn);
  st.snIn = ctx.createBiquadFilter();
  st.snIn.type = 'bandpass';
  st.snIn.frequency.value = 1800;
  st.snIn.Q.value = 0.7;
  st.snIn.connect(st.drive);

  // 효과음: 음악 볼륨(곡 페이드)과 별개, 음소거는 함께 적용(master 거침)
  sfxIn = ctx.createGain();
  sfxIn.gain.value = 0.9;
  const sfxSoft = ctx.createBiquadFilter();
  sfxSoft.type = 'lowpass';
  sfxSoft.frequency.value = 5200;
  sfxIn.connect(sfxSoft);
  sfxSoft.connect(master);

  document.addEventListener('visibilitychange', function () {
    if (!ctx || !enabled) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });
  timer = setInterval(tick, 100);
  return true;
}

/* ---------------- 음 하나(보이스): 시작·끝을 부드럽게, 끝나면 정리 ---------------- */

// 음량 봉투: 부드럽게 커졌다가 0까지 줄어들어요. 연결된 소리가 다 끝나면 스스로 연결을 끊어요.
// hold: 다 커진 뒤 그대로 유지하는 시간(패드처럼 길게 울리는 음)
function voice(dest, t, peak, attack, decay, hold) {
  const g = ctx.createGain();
  const a = Math.max(MIN_ATTACK, attack);
  const h = Math.max(0, hold || 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  if (h) g.gain.linearRampToValueAtTime(peak * 0.8, t + a + h);
  g.gain.setTargetAtTime(0, t + a + h, decay / 5);   // 자연스러운 감쇠
  g.gain.setValueAtTime(0, t + a + h + decay * 1.3);  // 완전히 0이 된 뒤에
  g.connect(dest);
  g._pending = 0;
  g._end = t + a + h + decay * 1.3;                   // 소리가 멈춰도 되는 시각
  live++;
  return g;
}
function release(g) {
  if (--g._pending <= 0) { g.disconnect(); live--; }
}
// 소리 내기: 봉투가 0이 된 뒤에 멈추고, 멈추면 바로 연결 해제
function tone(type, freq, t, g, detune, wave) {
  const o = ctx.createOscillator();
  if (wave) o.setPeriodicWave(wave); else o.type = type;
  o.frequency.value = freq;
  if (detune) o.detune.value = detune;
  o.connect(g);
  g._pending++;
  o.onended = function () { o.disconnect(); release(g); };
  o.start(t);
  o.stop(g._end + 0.02);
  notes++;
  return o;
}

/* ---------------- 악기 (tr = 곡) ---------------- */

// 부드러운 피아노: 기본음 + 옅은 배음
function piano(tr, t, midi, vel) {
  const f = mtof(midi);
  tone('triangle', f, t, voice(tr.softIn, t, 0.11 * vel, 0.006, 2.6));
  tone('sine', f * 2, t, voice(tr.softIn, t, 0.035 * vel, 0.006, 1.0));
  tone('sine', f * 3, t, voice(tr.softIn, t, 0.012 * vel, 0.006, 0.4));
}
// 실로폰: 맑고 짧은 고음
function xylophone(tr, t, midi, vel) {
  const f = mtof(midi);
  tone('sine', f, t, voice(tr.bus, t, 0.09 * vel, 0.005, 0.8));
  tone('sine', f * 3.0, t, voice(tr.bus, t, 0.02 * vel, 0.005, 0.12));
}
// 패드: 천천히 부풀었다 사라지는 화음 (곡 공용 필터 사용)
function pad(tr, t, midi, dur, level) {
  const g = voice(tr.padIn, t, level, 1.2, 1.6, dur - 1.2); // 1.2초 부풀고 → 마디 끝까지 유지 → 1.6초 사라짐
  tone('triangle', mtof(midi), t, g, -6);
  tone('triangle', mtof(midi), t, g, 6);
}
// 베이스: 둥근 저음 (len: 울리는 길이)
function bass(tr, t, midi, level, len) {
  tone('sine', mtof(midi), t, voice(tr.bus, t, level, 0.02, len));
}
// 가벼운 킥(8비트 드럼)
function kick(tr, t, level) {
  const g = voice(tr.bus, t, level, 0.005, 0.2);
  const o = tone('sine', 130, t, g);
  o.frequency.setValueAtTime(130, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
}

/* ---------------- 곡 1: 캠퍼스 탐험 ----------------
 *  G장조, 66BPM, 8분음표 단위. 피아노가 분산화음으로 천천히 흐르고
 *  실로폰이 띄엄띄엄 멜로디를 얹어요. 잔향을 넉넉하게.
 * --------------------------------------------------- */
const CAMPUS_CHORDS = [
  { root: 43, notes: [55, 59, 62, 66] }, // Gmaj7
  { root: 40, notes: [52, 55, 59, 62] }, // Em7
  { root: 36, notes: [48, 52, 55, 59] }, // Cmaj7
  { root: 38, notes: [50, 55, 57, 59] }, // Dsus(6)
  { root: 43, notes: [55, 59, 62, 66] }, // Gmaj7
  { root: 35, notes: [47, 50, 54, 57] }, // Bm7
  { root: 36, notes: [48, 52, 55, 62] }, // Cadd9
  { root: 38, notes: [50, 54, 57, 62] }  // D
];
const G_PENTA = [74, 76, 79, 81, 83, 86, 88]; // 레·미·솔·라·시 (높은 음)

/* ---------------- 곡 2: 돌탑 쌓기 (레트로 아케이드, 오리지널) ----------------
 *  4마디 = 한 구절. 구절이 시작될 때 돌탑 높이로 단계(1~3)를 정해요.
 *  화음(triad)과 음계는 단계마다 다르고, 서로 관계조(C장조 ↔ A단조)라 자연스럽게 이어져요.
 *  리듬 틀은 16분음표 위치(0~15)예요.
 * ---------------------------------------------------------------------------- */
const STAGES = {
  1: { // 1~3층: 귀엽고 경쾌하게 (C장조)
    bpm: 112,
    chords: [{ root: 36, tri: [60, 64, 67] }, { root: 33, tri: [57, 60, 64] }, { root: 41, tri: [57, 60, 65] }, { root: 43, tri: [59, 62, 67] }],
    scale: [72, 74, 76, 79, 81, 84],
    rhythms: [[0, 4, 6, 8, 12], [0, 2, 4, 8, 10, 12], [0, 6, 8, 12, 14], [0, 4, 8, 10, 12]]
  },
  2: { // 4~6층: 촘촘하게, 긴장감 상승 (A단조)
    bpm: 120,
    chords: [{ root: 33, tri: [57, 60, 64] }, { root: 41, tri: [57, 60, 65] }, { root: 36, tri: [60, 64, 67] }, { root: 43, tri: [59, 62, 67] }],
    scale: [69, 72, 74, 76, 79, 81, 84],
    rhythms: [[0, 2, 4, 6, 8, 10, 12, 14], [0, 3, 4, 6, 8, 11, 12, 14], [0, 2, 3, 4, 8, 10, 11, 12]]
  },
  3: { // 7층~: 아슬아슬하게 (A화성단조, E장화음으로 긴장)
    bpm: 128,
    chords: [{ root: 33, tri: [57, 60, 64] }, { root: 41, tri: [57, 60, 65] }, { root: 38, tri: [57, 62, 65] }, { root: 40, tri: [56, 59, 64] }],
    scale: [69, 71, 72, 74, 76, 77, 80, 81, 83, 84],
    rhythms: [[0, 1, 2, 4, 6, 8, 9, 10, 12, 14], [0, 2, 4, 5, 6, 8, 10, 12, 13, 14], [0, 3, 6, 8, 11, 12, 14, 15]]
  }
};
const pulse = {};   // 8비트 펄스파 음색 (setup에서 만듦)

// 펄스파(듀티비: 0.5=네모파, 0.25·0.125=더 얇고 귀여운 소리)
function pulseWave(duty) {
  const N = 40, real = new Float32Array(N), imag = new Float32Array(N);
  for (let n = 1; n < N; n++) real[n] = (2 / (n * Math.PI)) * Math.sin(Math.PI * n * duty);
  return ctx.createPeriodicWave(real, imag);
}
// 8비트 음: 정해진 길이만큼 울리고 짧게(클릭 없이) 사라져요
function chip(dest, t, midi, peak, len, wave) {
  const g = voice(dest, t, peak, 0.005, 0.05, Math.max(0, len - 0.005));
  tone('square', mtof(midi), t, g, 0, wave);
}
// 노이즈 드럼(하이햇·스네어용)
function noiseHit(dest, t, level, decay) {
  const g = voice(dest, t, level, 0.003, decay);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.connect(g);
  g._pending++;
  src.onended = function () { src.disconnect(); release(g); };
  src.start(t, Math.random() * 0.5);
  src.stop(g._end + 0.02);
  notes++;
}
// 삼각파 베이스(8비트 게임기 베이스 느낌), 통통 끊어서
function chipBass(tr, t, midi, len) {
  tone('triangle', mtof(midi), t, voice(tr.bus, t, 0.13, 0.005, 0.06, Math.max(0, len - 0.03)));
}

// 단계가 바뀌면 더해지는 악기층을 그 구절 시작 시각부터 몇 초에 걸쳐 서서히
function fadeLayers(tr, at) {
  [[tr.drive, tr.stage >= 2], [tr.tense, tr.stage >= 3], [tr.tenseHat, tr.stage >= 3]].forEach(function (p) {
    p[0].gain.cancelScheduledValues(at);
    p[0].gain.setTargetAtTime(p[1] ? 1 : 0, at, 1.0);   // 약 3~4초에 걸쳐
  });
  if (tr.stage < 2) tr.driveTail = at + 5;              // 사라지는 동안은 계속 연주
  if (tr.stage < 3) tr.tenseTail = at + 5;
}

// 한 마디 멜로디: rhythm(16분 위치)과 steps(음계 이동)로 연주
function melody(tr, t, S, chord, rhythm, steps, endOnRoot) {
  const s16 = tr.step8 / 2;
  const scale = S.scale;
  const nearest = function (m) {
    let bi = 0;
    scale.forEach(function (n, i) { if (Math.abs(n - m) < Math.abs(scale[bi] - m)) bi = i; });
    return bi;
  };
  let idx = nearest(chord.tri[(steps.start || 0) % 3] + 12);
  rhythm.forEach(function (pos, i) {
    if (i > 0) idx = Math.max(0, Math.min(scale.length - 1, idx + steps[i]));
    if (endOnRoot && i === rhythm.length - 1) idx = nearest(chord.tri[0] + 12);
    const next = i + 1 < rhythm.length ? rhythm[i + 1] : 16;
    const len = (next - pos) * s16 * (next - pos > 2 ? 0.6 : 0.75);
    chip(tr.chipIn, t + pos * s16, scale[idx], (pos % 4 === 0 ? 0.055 : 0.042), len, pulse.p25);
  });
}
// 짧은 동기(모티브): 리듬 + 음 이동. 위아래로 오르내리는 모양을 만들어요
function makeMotif(r, S) {
  const rhythm = pick(r, S.rhythms);
  let dir = r() < 0.5 ? 1 : -1;
  const steps = rhythm.map(function (_, i) {
    if (i === 0) return 0;
    if (r() < 0.3) dir = -dir;
    return dir * (r() < 0.7 ? 1 : 2);
  });
  steps.start = Math.floor(r() * 3);
  return { rhythm: rhythm, steps: steps };
}

const TRACKS = {
  campus: {
    bpm: 66, reverb: 0.55, level: 1.3,   // 피아노가 잔잔해서 돌탑 곡과 비슷하게 들리도록 조금 크게
    barsPerCycle: 8, calmEvery: 4,
    bpmTarget: function () { return 66; },
    bar: function (tr, t, b, r, calm) {
      const chord = CAMPUS_CHORDS[b];
      const barLen = tr.step8 * 8;
      chord.notes.forEach(function (n) { pad(tr, t, n, barLen, 0.012); });
      bass(tr, t, chord.root, 0.1, 3.2);
      // 피아노 분산화음: 4분음표마다, 올라갔다 내려오기
      const order = r() < 0.5 ? [0, 1, 2, 3] : [0, 2, 1, 3];
      order.forEach(function (idx, k) {
        if (k === 3 && r() < 0.3) return;            // 가끔 쉬기
        const n = chord.notes[idx] + (k >= 2 ? 12 : 0);
        piano(tr, t + tr.step8 * 2 * k, n, k === 0 ? 0.9 : 0.6);
      });
      // 실로폰: 한 마디에 1~3음, 띄엄띄엄
      const count = calm ? (r() < 0.5 ? 0 : 1) : 1 + Math.floor(r() * 3);
      const slots = [1, 3, 5, 6, 7].sort(function () { return r() - 0.5; }).slice(0, count).sort();
      slots.forEach(function (s) {
        const near = G_PENTA.filter(function (n) { return Math.abs(n - tr.last) <= 5; });
        const n = pick(r, near.length ? near : G_PENTA);
        tr.last = n;
        xylophone(tr, t + tr.step8 * s, n, 0.7 + r() * 0.3);
      });
    }
  },
  stack: {
    bpm: 112, reverb: 0.18, level: 0.9,
    barsPerCycle: 4, calmEvery: 0,
    bpmTarget: function (tr) { return STAGES[tr.stage].bpm; },
    bar: function (tr, t, b, r) {
      if (b === 0) {
        // 새 구절: 돌탑 높이로 단계를 정하고, 새 동기(모티브)를 만들어요
        if (tr.stage !== tr.levelWanted) { tr.stage = tr.levelWanted; fadeLayers(tr, t); }
        tr.motif = makeMotif(r, STAGES[tr.stage]);
      }
      const S = STAGES[tr.stage];
      const chord = S.chords[b];
      const s16 = tr.step8 / 2;
      const at = function (p) { return t + p * s16; };
      const driveOn = tr.stage >= 2 || t < tr.driveTail;
      const tenseOn = tr.stage >= 3 || t < tr.tenseTail;

      // 드럼: 킥(1·3박) + 엇박 하이햇
      kick(tr, at(0), 0.12);
      kick(tr, at(8), 0.1);
      [2, 6, 10, 14].forEach(function (p) { noiseHit(tr.hiIn, at(p), 0.016, 0.03); });

      // 베이스: 단계 1은 통통 튀는 4분음, 2부터는 8분음 옥타브 왕복
      if (tr.stage === 1) {
        [[0, 0], [4, 12], [8, 7], [12, 12]].forEach(function (x) { chipBass(tr, at(x[0]), chord.root + x[1], s16 * 2.5); });
      } else {
        for (let p = 0; p < 16; p += 2) {
          let m = chord.root + (p % 4 === 2 ? 12 : 0);
          if (tr.stage >= 3 && p === 14) m = S.chords[(b + 1) % 4].root - 1;   // 다음 화음으로 반음 접근(긴장)
          chipBass(tr, at(p), m, s16 * 1.4);
        }
      }

      // 멜로디: 구절의 1·3마디는 같은 동기, 2마디는 새 리듬, 4마디는 동기로 마무리(으뜸음에 착지)
      const motif = tr.motif;
      if (b === 0 || b === 2) melody(tr, t, S, chord, motif.rhythm, motif.steps, false);
      else if (b === 1) { const v = makeMotif(r, S); melody(tr, t, S, chord, v.rhythm, v.steps, false); }
      else melody(tr, t, S, chord, motif.rhythm, motif.steps.map(function (s) { return -s; }), true);

      // 단계 2층: 16분 아르페지오 + 2·4박 스네어
      if (driveOn) {
        for (let p = 0; p < 16; p++) {
          const n = chord.tri[[0, 1, 2, 1][p % 4]] + 12 + (p >= 8 ? 12 : 0);
          chip(tr.drive, at(p), n, 0.018, s16 * 0.6, pulse.p125);
        }
        [4, 12].forEach(function (p) {
          noiseHit(tr.snIn, at(p), 0.05, 0.09);
          tone('triangle', 190, at(p), voice(tr.drive, at(p), 0.05, 0.003, 0.05));
        });
      }
      // 단계 3층: 16분 하이햇 + 높은 경고음(똑딱)
      if (tenseOn) {
        for (let p = 1; p < 16; p += 2) noiseHit(tr.tenseHat, at(p), 0.009, 0.02);
        [0, 4, 8, 12].forEach(function (p, i) {
          chip(tr.tense, at(p + 2), i % 2 ? 89 : 88, 0.012, s16 * 0.7, pulse.p125);
        });
      }
    }
  }
};
Object.keys(TRACKS).forEach(function (id) {
  const tr = TRACKS[id];
  tr.id = id;
  tr.bpmNow = tr.bpm;
  tr.step8 = 60 / tr.bpm / 2;
  tr.stage = 1;
  tr.levelWanted = 1;
  tr.driveTail = 0;
  tr.tenseTail = 0;
  tr.running = false;
  tr.stopAt = null;
  tr.target = 0;        // 지금 향하고 있는 음량(같은 값이면 다시 조절하지 않음)
  tr.barIndex = 0;
  tr.cycle = 0;
  tr.nextBar = 0;
  tr.last = 76;
});

/* ---------------- 진행·전환 ---------------- */

function scheduleBar(tr) {
  const b = tr.barIndex % tr.barsPerCycle;
  if (b === 0) tr.cycle++;
  // 템포는 마디마다 최대 3BPM씩만 바뀌어요(갑작스럽지 않게)
  const want = tr.bpmTarget(tr);
  tr.bpmNow += Math.max(-3, Math.min(3, want - tr.bpmNow));
  tr.step8 = 60 / tr.bpmNow / 2;
  const r = rand(tr.cycle * 131 + b * 17 + (tr.id === 'stack' ? 999 : 7));
  const calm = !!tr.calmEvery && tr.cycle % tr.calmEvery === 0;   // 몇 바퀴에 한 번은 조용히 쉬어 가기
  tr.bar(tr, tr.nextBar, b, r, calm);
  tr.barIndex++;
  tr.nextBar += tr.step8 * 8;
}

function tick() {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  Object.keys(TRACKS).forEach(function (id) {
    const tr = TRACKS[id];
    if (!tr.running) return;
    if (tr.stopAt !== null && now >= tr.stopAt) { tr.running = false; tr.stopAt = null; return; }
    // 화면이 잠깐 멈춰 예약이 늦었으면, 지난 음을 몰아서 치지 않고 조금 뒤부터 이어요
    if (tr.nextBar < now + 0.05) { tr.nextBar = now + 0.1; resyncs++; }
    while (tr.nextBar < now + LOOKAHEAD && (tr.stopAt === null || tr.nextBar < tr.stopAt)) scheduleBar(tr);
  });
}

function startTrack(tr) {
  if (!tr.running) {
    tr.running = true;
    tr.barIndex = 0;
    tr.nextBar = ctx.currentTime + 0.12;
  }
  tr.stopAt = null;
  if (tr.target !== tr.level) { tr.target = tr.level; glide(tr.bus.gain, tr.level, FADE_IN); }
}

function stopTrack(tr, seconds) {
  if (!tr.running || tr.target === 0) return;
  tr.target = 0;
  glide(tr.bus.gain, 0, seconds);
  tr.stopAt = ctx.currentTime + seconds + 0.6; // 소리가 충분히 작아진 뒤 예약 중지
}

// 지금 곡(current)만 재생하고 나머지는 서서히 끄기 (이미 그 상태면 아무것도 안 바꿔요)
function apply() {
  if (!ctx || !enabled) return;
  if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
  Object.keys(TRACKS).forEach(function (id) {
    if (id === current) startTrack(TRACKS[id]);
    else stopTrack(TRACKS[id], FADE_OUT);
  });
  tick();
}

function audible() {
  return !!ctx && ctx.state === 'running' && enabled && TRACKS[current].running && TRACKS[current].stopAt === null;
}

/* ---------------- 버튼·단축키 (두 화면 공통) ---------------- */

function refreshButtons() {
  document.querySelectorAll('[data-bgm-toggle]').forEach(function (b) {
    b.textContent = enabled ? '🎵' : '🔇';
    b.classList.toggle('off', !enabled);
    b.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    b.title = enabled ? '배경음악 끄기 (M)' : '배경음악 켜기 (M)';
  });
  listeners.forEach(function (fn) { try { fn(enabled); } catch (e) { console.error(e); } });
}

// 버튼·M 키: 아직 소리가 안 켜졌으면(자동재생 대기) 켜고, 아니면 ON/OFF 전환
function onToggleIntent() {
  if (enabled && !audible()) Bgm.unlock();
  else Bgm.toggle();
}

function isTyping(e) {
  const tg = e.target;
  return tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable);
}

function bindPage() {
  refreshButtons();
  document.addEventListener('click', function (e) {
    const b = e.target.closest && e.target.closest('[data-bgm-toggle]');
    if (b) { e.preventDefault(); onToggleIntent(); }
  });
  window.addEventListener('keydown', function (e) {
    if (e.code !== 'KeyM' || e.repeat || isTyping(e)) return;
    onToggleIntent();
  });
  // 자동재생 정책: 첫 클릭·터치·키 입력 때 소리 켜기 (이미 들리고 있으면 아무것도 안 함)
  const first = function (e) {
    if (audible()) return;
    if (e.type === 'keydown' && (e.code === 'KeyM' || isTyping(e))) return;
    if (e.target && e.target.closest && e.target.closest('[data-bgm-toggle]')) return;
    Bgm.unlock();
  };
  ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) { document.addEventListener(ev, first, true); });
}

/* ---------------- 공개 API ---------------- */

const Bgm = {
  // 화면 전환 때 호출: 'campus'(캠퍼스) | 'stack'(돌탑 쌓기)
  play: function (id) {
    if (!TRACKS[id]) return;
    current = id;
    apply();
  },
  // 사용자 입력 직후 호출 → 소리 장치를 켜고 지금 곡 재생
  unlock: function () {
    if (!enabled) return;
    if (!setup()) return;
    apply();
  },
  // 돌탑 높이(층) → 돌탑 곡 단계 (1~3층: 1, 4~6층: 2, 7층~: 3). 다음 구절부터 자연스럽게 반영돼요.
  setLevel: function (floors) {
    const h = floors | 0;
    TRACKS.stack.levelWanted = h >= 7 ? 3 : h >= 4 ? 2 : 1;
  },
  // 효과음: 'success' = 돌탑 완성 때 짧고 귀여운 성공음 (음소거면 소리 안 남)
  sfx: function (name) {
    if (name !== 'success' || !enabled || !ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.03;
    // 도·미·솔·도 빠르게 올라가고 → 높은 미에서 반짝
    [72, 76, 79, 84].forEach(function (m, i) { chip(sfxIn, t + i * 0.075, m, 0.06, 0.07, pulse.p25); });
    chip(sfxIn, t + 0.3, 88, 0.06, 0.32, pulse.p25);
    tone('triangle', mtof(76), t + 0.3, voice(sfxIn, t + 0.3, 0.07, 0.005, 0.3, 0.2));
    tone('sine', mtof(100), t + 0.36, voice(sfxIn, t + 0.36, 0.025, 0.005, 0.4));
    // 효과음이 잘 들리게 돌탑 곡을 잠깐 작게 했다가 되돌리기
    const st = TRACKS.stack;
    if (st.running && st.target > 0) {
      const g = st.bus.gain, now = ctx.currentTime;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now); else { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); }
      g.setTargetAtTime(st.target * 0.35, now, 0.05);
      g.setTargetAtTime(st.target, now + 0.8, 0.2);
    }
  },
  toggle: function () { Bgm.setEnabled(!enabled); return enabled; },
  setEnabled: function (v) {
    enabled = !!v;
    writePref(enabled);
    if (enabled) {
      if (setup()) {
        glide(master.gain, MASTER, 0.6);
        apply();
      }
    } else if (ctx) {
      glide(master.gain, 0, 0.6);                           // 서서히 끄기
      Object.keys(TRACKS).forEach(function (id) { stopTrack(TRACKS[id], 0.7); });
    }
    refreshButtons();
  },
  isEnabled: function () { return enabled; },
  current: function () { return current; },
  onChange: function (fn) { listeners.push(fn); },
  // 테스트용(읽기 전용): 상태, 현재 음량(RMS)·최대치(peak), 살아 있는 음 수
  debug: function () {
    let rms = 0, peak = 0;
    if (analyser) {
      const d = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(d);
      let s = 0;
      for (let i = 0; i < d.length; i++) { s += d[i] * d[i]; peak = Math.max(peak, Math.abs(d[i])); }
      rms = Math.sqrt(s / d.length);
    }
    const tracks = {};
    Object.keys(TRACKS).forEach(function (id) {
      const tr = TRACKS[id];
      tracks[id] = { running: tr.running, fading: tr.stopAt !== null, gain: tr.bus ? +tr.bus.gain.value.toFixed(3) : 0, cycle: tr.cycle, bpm: tr.bpmNow };
    });
    const st = TRACKS.stack;
    tracks.stack.stage = st.stage;
    tracks.stack.levelWanted = st.levelWanted;
    tracks.stack.layers = st.drive ? { drive: +st.drive.gain.value.toFixed(2), tense: +st.tense.gain.value.toFixed(2) } : null;
    return { enabled: enabled, current: current, state: ctx ? ctx.state : 'none', notes: notes, live: live, resyncs: resyncs, rms: rms, peak: peak, tracks: tracks };
  }
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindPage);
else bindPage();

window.Bgm = Bgm; // 테스트·디버그용
export default Bgm;
