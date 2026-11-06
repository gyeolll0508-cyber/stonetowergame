/* =========================================================
 * data.js — 게임 전체에서 쓰는 기본 데이터
 *  - 캠퍼스 지도(건물·길·연못 위치)
 *  - 소원 카테고리, 캐릭터 색, 응원 문구
 *  - 처음 실행할 때 보여 줄 예시 돌탑
 *  ※ 캠퍼스 배치는 게임용으로 단순화한 것이며 실제 지도와 다를 수 있어요.
 * ========================================================= */
(function () {
  'use strict';

  // 캠퍼스 월드 크기(픽셀 단위)
  const WORLD = { w: 2400, h: 1700 };

  // 플레이어 시작 위치(정문 바로 안쪽)
  const START = { x: 1200, y: 1470 };

  // 소원 기원 게이지가 100%가 되는 층수
  const GAUGE_MAX = 15;

  // 건물·연못·운동장·정문
  //  type: building(통과 불가) / pond(통과 불가) / field(통과 가능, 돌탑 불가) / gate(장식)
  const PLACES = [
    { id: 'gate',    name: '충북대학교 정문', type: 'gate',     x: 1110, y: 1600, w: 180, h: 60 },
    { id: 'hq',      name: '대학본부',        type: 'building', x: 860,  y: 1160, w: 230, h: 130, wall: '#f4e3c3', roof: '#c76b4f', icon: '🏛️' },
    { id: 'library', name: '중앙도서관',      type: 'building', x: 1320, y: 1080, w: 270, h: 160, wall: '#e9eef5', roof: '#5b7fb5', icon: '📚' },
    { id: 'union',   name: '학생회관',        type: 'building', x: 860,  y: 700,  w: 230, h: 130, wall: '#fbe7d6', roof: '#e0884f', icon: '🍙' },
    { id: 'culture', name: '개신문화관',      type: 'building', x: 1320, y: 660,  w: 250, h: 140, wall: '#efe4f6', roof: '#8e6bb8', icon: '🎭' },
    { id: 'eng',     name: '공과대학',        type: 'building', x: 1720, y: 1000, w: 300, h: 150, wall: '#e3ecef', roof: '#4f8f97', icon: '⚙️' },
    { id: 'it',      name: '전자정보대학',    type: 'building', x: 1760, y: 590,  w: 270, h: 140, wall: '#e6eff7', roof: '#3f7cc0', icon: '💻' },
    { id: 'science', name: '자연과학대학',    type: 'building', x: 420,  y: 1000, w: 270, h: 150, wall: '#e8f3e2', roof: '#5f9e57', icon: '🔬' },
    { id: 'human',   name: '인문대학',        type: 'building', x: 420,  y: 590,  w: 250, h: 140, wall: '#f6ecd9', roof: '#b9874d', icon: '📖' },
    { id: 'social',  name: '사회과학대학',    type: 'building', x: 700,  y: 210,  w: 250, h: 130, wall: '#f3e6e6', roof: '#b4645f', icon: '🗳️' },
    { id: 'biz',     name: '경영대학',        type: 'building', x: 1330, y: 210,  w: 250, h: 130, wall: '#eef0e2', roof: '#7d8f3f', icon: '📈' },
    { id: 'dorm',    name: '기숙사',          type: 'building', x: 1930, y: 170,  w: 270, h: 170, wall: '#fdf0e3', roof: '#d0745c', icon: '🛏️' },
    { id: 'pond',    name: '솔못 연못',       type: 'pond',     x: 470,  y: 1260, w: 340, h: 200 },
    { id: 'field',   name: '대운동장',        type: 'field',    x: 1680, y: 1270, w: 440, h: 270 }
  ];

  // 길(선분 + 폭)
  const ROADS = [
    { x1: 1200, y1: 1700, x2: 1200, y2: 150, w: 76 },  // 정문에서 북쪽으로 가는 큰길
    { x1: 180,  y1: 920,  x2: 2240, y2: 920, w: 60 },  // 동서 중앙로
    { x1: 420,  y1: 470,  x2: 2120, y2: 470, w: 50 },  // 북쪽 길
    { x1: 300,  y1: 1520, x2: 1200, y2: 1520, w: 44 }, // 연못 산책로
    { x1: 765,  y1: 470,  x2: 765,  y2: 920, w: 40 },  // 서쪽 샛길(인문대·학생회관 사이)
    { x1: 2120, y1: 470,  x2: 2120, y2: 920, w: 40 }   // 동쪽 샛길
  ];

  // 소원 카테고리
  const CATEGORIES = [
    { id: 'study',  label: '학업', emoji: '📚', color: '#6c9ef0' },
    { id: 'job',    label: '취업', emoji: '💼', color: '#f0a64a' },
    { id: 'love',   label: '연애', emoji: '💘', color: '#f27a9b' },
    { id: 'health', label: '건강', emoji: '🍀', color: '#5cb87a' },
    { id: 'friend', label: '우정', emoji: '🤝', color: '#a083e0' },
    { id: 'etc',    label: '기타', emoji: '✨', color: '#8a9aa8' }
  ];

  // 캐릭터 색
  const COLORS = ['#ff8a80', '#ffb74d', '#ffd54f', '#81c784', '#4fc3f7', '#7986cb', '#ba68c8', '#f48fb1'];

  // 빠른 응원 문구
  const QUICK_CHEERS = ['꼭 이뤄질 거예요! ✨', '화이팅! 💪', '저도 응원해요 🙌', '같이 힘내요 🍀', '돌탑 멋져요 🪨'];

  // 캠퍼스를 돌아다니는 다른 학생(NPC)
  const NPCS = [
    { name: '새내기', color: '#4fc3f7' },
    { name: '과대표', color: '#ffb74d' },
    { name: '복학생', color: '#81c784' },
    { name: '교환학생', color: '#ba68c8' }
  ];

  // 처음 실행할 때 캠퍼스에 세워 둘 예시 돌탑
  const DEMO_TOWERS = [
    { id: 'demo1', name: '개신동 다람쥐', color: '#ffb74d', x: 1040, y: 1010, cat: 'study',  wish: '이번 학기 전공 A+ 받게 해주세요!', best: 9,  likes: 12,
      cheers: [['도서관 메이트', '같이 A+ 가요! 📚'], ['선배', '할 수 있어요!']] },
    { id: 'demo2', name: '솔못 오리',     color: '#4fc3f7', x: 900,  y: 1350, cat: 'job',    wish: '원하는 회사 최종 합격하기 🙏',   best: 15, likes: 27,
      cheers: [['취준생', '저도 같이 붙어요!'], ['익명', '꼭 이뤄질 거예요! ✨']] },
    { id: 'demo3', name: '중도 지박령',   color: '#7986cb', x: 1650, y: 820,  cat: 'health', wish: '시험기간에도 아프지 않기',         best: 5,  likes: 6,
      cheers: [['룸메', '밥 잘 챙겨 먹어!']] },
    { id: 'demo4', name: '벚꽃 엔딩',     color: '#f48fb1', x: 670,  y: 810,  cat: 'love',   wish: '봄 축제 전에 썸 성공!',            best: 11, likes: 19,
      cheers: [['동기', '화이팅! 💪']] },
    { id: 'demo5', name: '공대 곰돌이',   color: '#81c784', x: 2240, y: 760,  cat: 'friend', wish: '팀플 조원들이랑 끝까지 사이좋게',   best: 3,  likes: 4,  cheers: [] },
    { id: 'demo6', name: '기숙사 야식왕', color: '#ff8a80', x: 1700, y: 380,  cat: 'etc',    wish: '기숙사 추첨 꼭 붙게 해주세요',     best: 7,  likes: 9,
      cheers: [['옆방', '같이 살아요 🛏️']] }
  ];

  function category(id) {
    return CATEGORIES.find(function (c) { return c.id === id; }) || CATEGORIES[CATEGORIES.length - 1];
  }

  // 최고 층수 → 게이지 비율과 문구
  function gauge(best) {
    const h = Math.max(0, best | 0);
    const pct = Math.min(100, Math.round((h / GAUGE_MAX) * 100));
    let label;
    if (h <= 0) label = '돌탑을 쌓아 소원을 빌어요';
    else if (h < 5) label = '소원이 싹트는 중 🌱 (' + pct + '%)';
    else if (h < 10) label = '소원이 자라는 중 🌿 (' + pct + '%)';
    else if (h < GAUGE_MAX) label = '소원이 거의 닿았어요 ✨ (' + pct + '%)';
    else label = '소원 기원 완료! 🌟 (100%)';
    return { pct: pct, label: label };
  }

  // "3분 전" 같은 상대 시간
  function timeAgo(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return '방금 전';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    if (s < 86400 * 30) return Math.floor(s / 86400) + '일 전';
    const d = new Date(t);
    return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate();
  }

  window.DATA = {
    WORLD: WORLD,
    START: START,
    GAUGE_MAX: GAUGE_MAX,
    PLACES: PLACES,
    ROADS: ROADS,
    CATEGORIES: CATEGORIES,
    COLORS: COLORS,
    QUICK_CHEERS: QUICK_CHEERS,
    NPCS: NPCS,
    DEMO_TOWERS: DEMO_TOWERS,
    category: category,
    gauge: gauge,
    timeAgo: timeAgo
  };
})();
