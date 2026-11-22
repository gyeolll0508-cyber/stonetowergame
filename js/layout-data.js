/* =========================================================
 * layout-data.js — 관리자 모드(index3d.html?admin)에서 만든 캠퍼스 배치
 *  관리자 모드 → 📥 파일 받기로 받은 파일로 이 파일을 덮어쓰고 커밋·배포하면
 *  모든 사람에게 이 배치(맵 크기·건물·길)가 보여요.
 *  null이면 js/data.js에 적힌 기본 배치를 써요.
 * ========================================================= */
window.LAYOUT_DATA = {"world":{"w":3000,"h":3100,"ox":0,"oy":1000},"start":{"x":1200,"y":2870},"places":[
{"id":"gate","name":"충북대학교 정문","type":"gate","x":1110,"y":3000,"w":180,"h":60},
{"id":"hq","name":"대학본부","type":"building","x":1320,"y":2030,"w":230,"h":130,"wall":"#f4e3c3","roof":"#c76b4f","icon":"🏛️","floors":5,"glass":false},
{"id":"library","name":"중앙도서관","type":"building","x":1350,"y":1170,"w":270,"h":160,"wall":"#e9eef5","roof":"#5b7fb5","icon":"📚","floors":5,"glass":true},
{"id":"union","name":"학생회관","type":"building","x":1350,"y":835,"w":230,"h":130,"wall":"#fbe7d6","roof":"#e0884f","icon":"🍙","floors":4,"glass":false},
{"id":"culture","name":"개신문화관","type":"building","x":860,"y":850,"w":250,"h":140,"wall":"#efe4f6","roof":"#8e6bb8","icon":"🎭","floors":3,"glass":false},
{"id":"eng","name":"공과대학","type":"building","x":1950,"y":880,"w":300,"h":150,"wall":"#e3ecef","roof":"#4f8f97","icon":"⚙️","floors":6,"glass":true},
{"id":"it","name":"전자정보대학","type":"building","x":2410,"y":890,"w":270,"h":140,"wall":"#e6eff7","roof":"#3f7cc0","icon":"💻","floors":6,"glass":true},
{"id":"science","name":"자연과학대학","type":"building","x":1950,"y":1180,"w":270,"h":150,"wall":"#e8f3e2","roof":"#5f9e57","icon":"🔬","floors":5,"glass":false},
{"id":"human","name":"인문대학","type":"building","x":390,"y":1420,"w":250,"h":140,"wall":"#f6ecd9","roof":"#b9874d","icon":"📖","floors":4,"glass":false},
{"id":"social","name":"사회과학대학","type":"building","x":810,"y":1420,"w":250,"h":130,"wall":"#f3e6e6","roof":"#b4645f","icon":"🗳️","floors":5,"glass":false},
{"id":"biz","name":"경영대학","type":"building","x":810,"y":2030,"w":250,"h":130,"wall":"#eef0e2","roof":"#7d8f3f","icon":"📈","floors":5,"glass":false},
{"id":"pond","name":"솔못 연못","type":"pond","x":1340,"y":1520,"w":340,"h":200},
{"id":"field","name":"대운동장","type":"field","x":670,"y":380,"w":440,"h":270},
{"id":"bmwqrczez","name":"농업생명대학","type":"building","x":1870,"y":2350,"w":220,"h":130,"wall":"#e9eef5","roof":"#5b7fb5","icon":"🏫","floors":4,"glass":false},
{"id":"bmwqre20c","name":"생활과학대학","type":"building","x":405,"y":1720,"w":220,"h":130,"wall":"#fbe7d6","roof":"#e0884f","icon":"🏫","floors":4,"glass":false},
{"id":"bmwqrf8lm","name":"의과대학","type":"building","x":1980,"y":315,"w":220,"h":130,"wall":"#e8f3e2","roof":"#5f9e57","icon":"🏫","floors":4,"glass":false},
{"id":"bmwqrfi08","name":"수의과대학","type":"building","x":2460,"y":315,"w":220,"h":130,"wall":"#efe4f6","roof":"#8e6bb8","icon":"🏫","floors":4,"glass":false},
{"id":"bmwqrhj35","name":"사범대학","type":"building","x":390,"y":860,"w":220,"h":130,"wall":"#fbe7d6","roof":"#e0884f","icon":"🏫","floors":4,"glass":false}
],"roads":[
{"x1":1200,"y1":3100,"x2":1200,"y2":110,"w":76},
{"x1":310,"y1":1910,"x2":2720,"y2":1910,"w":60},
{"x1":0,"y1":1140,"x2":2750,"y2":1140,"w":50},
{"x1":300,"y1":2520,"x2":1200,"y2":2520,"w":44},
{"x1":720,"y1":770,"x2":720,"y2":1920,"w":40},
{"x1":2750,"y1":1140,"x2":2750,"y2":2800,"w":44},
{"x1":1190,"y1":2250,"x2":2740,"y2":2250,"w":40},
{"x1":120,"y1":770,"x2":1200,"y2":770,"w":44},
{"x1":1220,"y1":770,"x2":2920,"y2":770,"w":44},
{"x1":1780,"y1":80,"x2":1780,"y2":2250,"w":64}
],"savedAt":"2026-11-21T19:10:47.157Z"};
