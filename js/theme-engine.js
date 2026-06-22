export const THEME_STORAGE_KEY = 'pressTrackerTheme';
export const CUSTOM_THEMES_STORAGE_KEY = 'apTracker_customThemes';
export const FALLBACK_THEME_KEY = 'midnight';
export const STORE_THEME_ITEM_PREFIX = 'storeitem:';

export const THEME_TOKEN_MAP = {
  '--bg': '--color-bg',
  '--bg2': '--color-surface',
  '--bg3': '--color-surface-raised',
  '--border': '--color-border',
  '--text': '--color-text',
  '--text2': '--color-text-muted',
  '--text3': '--color-text-subtle',
  '--accent': '--color-accent',
  '--accent2': '--color-accent-strong',
  '--green': '--color-success',
  '--red': '--color-danger',
  '--blue': '--color-info',
  '--yellow': '--color-warning',
  '--orange': '--color-orange',
  '--purple': '--color-purple',
  '--teal': '--color-teal',
  '--babyblue': '--color-babyblue'
};

export const THEME_EDITOR_CORE_VARS = [
  '--color-bg',
  '--color-surface',
  '--color-surface-raised',
  '--color-border',
  '--color-text',
  '--color-text-muted',
  '--color-text-subtle',
  '--color-accent',
  '--color-accent-strong',
  '--focus-ring',
  '--color-success',
  '--color-success-soft',
  '--color-danger',
  '--color-danger-soft',
  '--color-info',
  '--color-info-soft',
  '--color-warning',
  '--color-warning-soft',
  '--color-orange',
  '--color-orange-soft',
  '--color-purple',
  '--color-purple-soft',
  '--color-teal',
  '--color-teal-soft',
  '--color-babyblue',
  '--color-babyblue-soft',
  '--bg-svg',
  '--radius-card',
  '--radius-btn',
  '--font-body',
  '--font-headings',
  '--shadow-card',
  '--glass-blur',
  '--glass-bg',
  '--glass-border',
  '--glass-strength'
];

export const THEME_SOFT_TOKEN_MAP = {
  '--green-dim': '--color-success-soft',
  '--red-dim': '--color-danger-soft',
  '--blue-dim': '--color-info-soft',
  '--yellow-dim': '--color-warning-soft',
  '--orange-dim': '--color-orange-soft',
  '--purple-dim': '--color-purple-soft',
  '--teal-dim': '--color-teal-soft',
  '--babyblue-dim': '--color-babyblue-soft'
};

export const THEME_DEFAULT_VARS = {
  '--bg': '#0d1117',
  '--bg2': '#161b22',
  '--bg3': '#1c2333',
  '--border': '#30363d',
  '--text': '#e6edf3',
  '--text2': '#8b949e',
  '--text3': '#484f58',
  '--accent': '#f97316',
  '--accent2': '#fb923c',
  '--accent-glow': 'rgba(249,115,22,0.25)',
  '--green': '#22c55e',
  '--green-dim': 'rgba(34,197,94,0.15)',
  '--red': '#ef4444',
  '--red-dim': 'rgba(239,68,68,0.12)',
  '--blue': '#3b82f6',
  '--blue-dim': 'rgba(59,130,246,0.12)',
  '--yellow': '#eab308',
  '--yellow-dim': 'rgba(234,179,8,0.12)',
  '--orange': '#f97316',
  '--orange-dim': 'rgba(249,115,22,0.12)',
  '--purple': '#a855f7',
  '--purple-dim': 'rgba(168,85,247,0.12)',
  '--teal': '#14b8a6',
  '--teal-dim': 'rgba(20,184,166,0.12)',
  '--babyblue': '#38bdf8',
  '--babyblue-dim': 'rgba(56,189,248,0.12)',
  '--radius-card': '14px',
  '--radius-btn': '8px',
  '--font-body': "'Nunito', sans-serif",
  '--font-headings': "'Rajdhani', sans-serif",
  '--shadow-card': '0 2px 12px rgba(0,0,0,0.2)',
  '--glass-blur': '0px',
  '--glass-bg': 'var(--bg2)',
  '--glass-border': 'var(--border)',
  '--glass-strength': '4'
};

const RAW_BUILT_IN_THEME_DEFS = [
  { key:'midnight',   name:'Midnight',   label:'🌙 Midnight',   mode:'dark',  colors:['#101114','#f47c20','#f0f2f5'], vars:{ '--bg':'#101114','--bg2':'#181b20','--bg3':'#20252c','--border':'#343a43','--text':'#f0f2f5','--text2':'#a7adb7','--text3':'#6f7782','--accent':'#f47c20','--accent2':'#ff9a3d','--green':'#22c55e','--red':'#ef4444','--blue':'#3b82f6','--yellow':'#eab308','--orange':'#f47c20' }, price:0, order:0 },
  { key:'arctic',     name:'Arctic',     label:'❄️ Arctic',     mode:'light', colors:['#f6f7f9','#0077b6','#17202a'], vars:{ '--bg':'#f6f7f9','--bg2':'#ffffff','--bg3':'#eef2f6','--border':'#d7dde5','--text':'#17202a','--text2':'#536170','--text3':'#8a96a3','--accent':'#0077b6','--accent2':'#0b7fab','--green':'#16833f','--red':'#c73535','--blue':'#0077b6','--yellow':'#b7791f','--orange':'#e36b2c' }, price:0, order:1 },
  { key:'forest',     name:'Forest',     label:'🌲 Forest',     mode:'dark',  colors:['#0d1411','#2fbf71','#e3f3e8'], vars:{ '--bg':'#0d1411','--bg2':'#151f1a','--bg3':'#1c2a22','--border':'#2c4435','--text':'#e3f3e8','--text2':'#9ab5a4','--text3':'#6f8a79','--accent':'#2fbf71','--accent2':'#65d694','--green':'#38c172','--red':'#ef7676','--blue':'#47b4c8','--yellow':'#d8b94a','--orange':'#d98a45' }, price:0, order:2 },
  { key:'sunset',     name:'Sunset',     label:'🌅 Sunset',     mode:'dark',  colors:['#1a0f0a','#fb923c','#fef3c7'], vars:{ '--bg':'#1a0f0a','--bg2':'#2d1810','--bg3':'#3d2218','--border':'#54321f','--text':'#fef3c7','--text2':'#fcd34d','--text3':'#f59e0b','--accent':'#fb923c','--accent2':'#fdba74','--green':'#34d399','--red':'#f87171','--blue':'#60a5fa','--yellow':'#facc15','--orange':'#fb923c' }, price:75, order:3 },
  { key:'ocean',      name:'Ocean',      label:'🌊 Ocean',      mode:'dark',  colors:['#071421','#25a6d9','#e8f6fb'], vars:{ '--bg':'#071421','--bg2':'#102235','--bg3':'#183047','--border':'#28435c','--text':'#e8f6fb','--text2':'#9cc6d6','--text3':'#638fa5','--accent':'#25a6d9','--accent2':'#5cc8e8','--green':'#2fbf71','--red':'#ef7676','--blue':'#25a6d9','--yellow':'#d8b94a','--orange':'#e08a4f' }, price:75, order:4 },
  { key:'royal',      name:'Royal',      label:'👑 Royal',      mode:'dark',  colors:['#171322','#9d7bea','#f2ecff'], vars:{ '--bg':'#171322','--bg2':'#211a31','--bg3':'#2c2440','--border':'#46365f','--text':'#f2ecff','--text2':'#c7b8e8','--text3':'#8f7db6','--accent':'#9d7bea','--accent2':'#c4a7ff','--green':'#34d399','--red':'#ef7676','--blue':'#71a7f7','--yellow':'#d8b94a','--orange':'#e99a55' }, price:120, order:5 },
  { key:'slate',      name:'Slate',      label:'⚡ Slate',      mode:'dark',  colors:['#11161c','#7d8998','#e7ebf0'], vars:{ '--bg':'#11161c','--bg2':'#1a2028','--bg3':'#252c35','--border':'#3a434e','--text':'#e7ebf0','--text2':'#a4afbb','--text3':'#717d89','--accent':'#7d8998','--accent2':'#a7b1bd','--green':'#22c55e','--red':'#ef4444','--blue':'#60a5fa','--yellow':'#eab308','--orange':'#f47c20' }, price:0, order:6 },
  { key:'mint',       name:'Mint',       label:'🍃 Mint',       mode:'light', colors:['#f0fdf9','#14b8a6','#064e3b'], vars:{ '--bg':'#f0fdf9','--bg2':'#ffffff','--bg3':'#e6fff8','--border':'#a7f3d0','--text':'#064e3b','--text2':'#065f46','--text3':'#10b981','--accent':'#14b8a6','--accent2':'#10b981','--green':'#059669','--red':'#dc2626','--blue':'#0284c7','--yellow':'#ca8a04','--orange':'#ea580c' }, price:0, order:7 },
  { key:'cyberpunk',  name:'Cyberpunk',  label:'🎮 Cyberpunk',  mode:'dark',  colors:['#0b0714','#e43cff','#f4eaff'], vars:{ '--bg':'#0b0714','--bg2':'#171022','--bg3':'#241934','--border':'#46245b','--text':'#f4eaff','--text2':'#b89bcc','--text3':'#8b62a5','--accent':'#e43cff','--accent2':'#38e8ff','--green':'#20e892','--red':'#ff4d79','--blue':'#38e8ff','--yellow':'#f8e85a','--orange':'#ff8a32' }, price:220, order:8 },
  { key:'industrial', name:'Industrial', label:'🏭 Industrial', mode:'dark',  colors:['#151515','#f26a21','#eeeeea'], vars:{ '--bg':'#151515','--bg2':'#202020','--bg3':'#2b2b2b','--border':'#3a3a3a','--text':'#eeeeea','--text2':'#b6b6ae','--text3':'#81817a','--accent':'#f26a21','--accent2':'#ff8c3a','--green':'#4ade80','--red':'#ef6b6b','--blue':'#5fa8d3','--yellow':'#f5c542','--orange':'#f26a21' }, price:220, order:9 },
  { key:'starship',   name:'Starship',   label:'🛸 Starship',   mode:'dark',  colors:['#030914','#26d9ff','#ddf6ff'], vars:{ '--bg':'#030914','--bg2':'#071327','--bg3':'#0d1d36','--border':'#16466b','--text':'#ddf6ff','--text2':'#8fc4dd','--text3':'#4a7fa6','--accent':'#26d9ff','--accent2':'#8bf5ff','--green':'#2cff9c','--red':'#ff5a87','--blue':'#26d9ff','--yellow':'#ffd447','--orange':'#ff9f43' }, price:180, order:10 },
  { key:'starforge',  name:'Starforge',  label:'🧱 Starforge',  mode:'dark',  colors:['#100d0a','#ff9f1c','#f2e6d9'], vars:{ '--bg':'#100d0a','--bg2':'#1a1714','--bg3':'#27211b','--border':'#5f4a35','--text':'#f2e6d9','--text2':'#c8b8a5','--text3':'#8c7762','--accent':'#ff9f1c','--accent2':'#ffd166','--green':'#49d987','--red':'#ff6b5e','--blue':'#9aa6b2','--yellow':'#ffd166','--orange':'#ff9f1c' }, price:200, order:11 },
  { key:'starmono',   name:'Star Mono',  label:'📟 Star Mono',  mode:'dark',  colors:['#0e1011','#d6b56d','#f0f2ee'], vars:{ '--bg':'#0e1011','--bg2':'#16191a','--bg3':'#222627','--border':'#3e4547','--text':'#f0f2ee','--text2':'#b9c0bd','--text3':'#7d8783','--accent':'#d6b56d','--accent2':'#f0cf83','--green':'#62b981','--red':'#d97373','--blue':'#8db5c8','--yellow':'#d6b56d','--orange':'#d69a61' }, price:170, order:12 },
  { key:'engel',      name:'Engel',      label:'🟢 Engel',      mode:'dark',  colors:['#0c1209','#78be20','#e8f5d8'], vars:{ '--bg':'#0c1209','--bg2':'#141e0f','--bg3':'#1b2a14','--border':'#2d4820','--text':'#e8f5d8','--text2':'#8ab870','--text3':'#4d6e38','--accent':'#78be20','--accent2':'#96d63a','--green':'#78be20','--red':'#f87171','--blue':'#00a3b5','--yellow':'#ffc72c','--orange':'#fb923c' }, price:0, order:13 },
  { key:'cardinals',  name:'Cardinals',  label:'🔴 Cardinals',  mode:'dark',  colors:['#170607','#b91f36','#f6eeee'], vars:{ '--bg':'#170607','--bg2':'#240d0f','--bg3':'#321418','--border':'#51232a','--text':'#f6eeee','--text2':'#d7b3b8','--text3':'#956a71','--accent':'#b91f36','--accent2':'#e0465b','--green':'#22c55e','--red':'#e0465b','--blue':'#6da5e8','--yellow':'#d9b64c','--orange':'#e67b3e' }, price:25, order:14 },
  { key:'wildcats',   name:'Wildcats',   label:'🔵 Wildcats',   mode:'dark',  colors:['#061022','#1f5fd0','#eef4ff'], vars:{ '--bg':'#061022','--bg2':'#0b1932','--bg3':'#112447','--border':'#1d3d73','--text':'#eef4ff','--text2':'#a9c1ec','--text3':'#6f8ec7','--accent':'#1f5fd0','--accent2':'#3f7bea','--green':'#22c55e','--red':'#ef6b6b','--blue':'#3f7bea','--yellow':'#e0bc4b','--orange':'#f47c20' }, price:25, order:15 }
];

const BUILT_IN_THEME_VAR_OVERRIDES = {
  'midnight': {
    '--bg': "#101114",
    '--bg2': "#181b20",
    '--bg3': "#20252c",
    '--border': "#343a43",
    '--accent': "#f47c20",
    '--accent2': "#ff9a3d",
    '--accent-glow': "rgba(244,124,32,0.22)",
    '--green': "#22c55e",
    '--green-dim': "rgba(34,197,94,0.13)",
    '--red': "#ef4444",
    '--red-dim': "rgba(239,68,68,0.12)",
    '--blue': "#3b82f6",
    '--blue-dim': "rgba(59,130,246,0.12)",
    '--yellow': "#eab308",
    '--yellow-dim': "rgba(234,179,8,0.12)",
    '--purple': "#a78bfa",
    '--purple-dim': "rgba(167,139,250,0.12)",
    '--babyblue': "#38bdf8",
    '--babyblue-dim': "rgba(56,189,248,0.12)",
    '--teal': "#14b8a6",
    '--teal-dim': "rgba(20,184,166,0.12)",
    '--orange': "#f47c20",
    '--orange-dim': "rgba(244,124,32,0.12)",
    '--text': "#f0f2f5",
    '--text2': "#a7adb7",
    '--text3': "#6f7782"
  },
  'arctic': {
    '--bg': "#f6f7f9",
    '--bg2': "#ffffff",
    '--bg3': "#eef2f6",
    '--border': "#d7dde5",
    '--accent': "#0077b6",
    '--accent2': "#0b7fab",
    '--accent-glow': "rgba(0,119,182,0.18)",
    '--green': "#16833f",
    '--green-dim': "rgba(22,131,63,0.11)",
    '--red': "#c73535",
    '--red-dim': "rgba(199,53,53,0.10)",
    '--blue': "#0077b6",
    '--blue-dim': "rgba(0,119,182,0.11)",
    '--yellow': "#b7791f",
    '--yellow-dim': "rgba(183,121,31,0.11)",
    '--purple': "#6750a4",
    '--purple-dim': "rgba(103,80,164,0.10)",
    '--babyblue': "#0b7fab",
    '--babyblue-dim': "rgba(11,127,171,0.10)",
    '--teal': "#147d74",
    '--teal-dim': "rgba(20,125,116,0.10)",
    '--orange': "#e36b2c",
    '--orange-dim': "rgba(227,107,44,0.10)",
    '--text': "#17202a",
    '--text2': "#536170",
    '--text3': "#8a96a3"
  },
  'forest': {
    '--bg': "#0d1411",
    '--bg2': "#151f1a",
    '--bg3': "#1c2a22",
    '--border': "#2c4435",
    '--accent': "#2fbf71",
    '--accent2': "#65d694",
    '--accent-glow': "rgba(47,191,113,0.22)",
    '--green': "#38c172",
    '--green-dim': "rgba(56,193,114,0.14)",
    '--red': "#ef7676",
    '--red-dim': "rgba(239,118,118,0.13)",
    '--blue': "#47b4c8",
    '--blue-dim': "rgba(71,180,200,0.13)",
    '--yellow': "#d8b94a",
    '--yellow-dim': "rgba(216,185,74,0.13)",
    '--purple': "#a78bfa",
    '--purple-dim': "rgba(167,139,250,0.12)",
    '--babyblue': "#7bd0dc",
    '--babyblue-dim': "rgba(123,208,220,0.12)",
    '--teal': "#38bfa0",
    '--teal-dim': "rgba(56,191,160,0.13)",
    '--orange': "#d98a45",
    '--orange-dim': "rgba(217,138,69,0.13)",
    '--text': "#e3f3e8",
    '--text2': "#9ab5a4",
    '--text3': "#6f8a79"
  },
  'sunset': {
    '--bg': "#1a0f0a",
    '--bg2': "#2d1810",
    '--bg3': "#3d2218",
    '--border': "#54321f",
    '--accent': "#fb923c",
    '--accent2': "#fdba74",
    '--accent-glow': "rgba(251,146,60,0.24)",
    '--green': "#34d399",
    '--green-dim': "rgba(52,211,153,0.14)",
    '--red': "#f87171",
    '--red-dim': "rgba(248,113,113,0.14)",
    '--blue': "#60a5fa",
    '--blue-dim': "rgba(96,165,250,0.14)",
    '--yellow': "#facc15",
    '--yellow-dim': "rgba(250,204,21,0.14)",
    '--purple': "#c084fc",
    '--purple-dim': "rgba(192,132,252,0.14)",
    '--babyblue': "#67e8f9",
    '--babyblue-dim': "rgba(103,232,249,0.14)",
    '--teal': "#2dd4bf",
    '--teal-dim': "rgba(45,212,191,0.14)",
    '--orange': "#fb923c",
    '--orange-dim': "rgba(251,146,60,0.14)",
    '--text': "#fef3c7",
    '--text2': "#fcd34d",
    '--text3': "#f59e0b"
  },
  'ocean': {
    '--bg': "#071421",
    '--bg2': "#102235",
    '--bg3': "#183047",
    '--border': "#28435c",
    '--accent': "#25a6d9",
    '--accent2': "#5cc8e8",
    '--accent-glow': "rgba(37,166,217,0.22)",
    '--green': "#2fbf71",
    '--green-dim': "rgba(47,191,113,0.13)",
    '--red': "#ef7676",
    '--red-dim': "rgba(239,118,118,0.13)",
    '--blue': "#25a6d9",
    '--blue-dim': "rgba(37,166,217,0.13)",
    '--yellow': "#d8b94a",
    '--yellow-dim': "rgba(216,185,74,0.13)",
    '--purple': "#a78bfa",
    '--purple-dim': "rgba(167,139,250,0.12)",
    '--babyblue': "#7bd7ec",
    '--babyblue-dim': "rgba(123,215,236,0.13)",
    '--teal': "#3fc4b8",
    '--teal-dim': "rgba(63,196,184,0.13)",
    '--orange': "#e08a4f",
    '--orange-dim': "rgba(224,138,79,0.13)",
    '--text': "#e8f6fb",
    '--text2': "#9cc6d6",
    '--text3': "#638fa5"
  },
  'royal': {
    '--bg': "#171322",
    '--bg2': "#211a31",
    '--bg3': "#2c2440",
    '--border': "#46365f",
    '--accent': "#9d7bea",
    '--accent2': "#c4a7ff",
    '--accent-glow': "rgba(157,123,234,0.23)",
    '--green': "#34d399",
    '--green-dim': "rgba(52,211,153,0.14)",
    '--red': "#ef7676",
    '--red-dim': "rgba(239,118,118,0.13)",
    '--blue': "#71a7f7",
    '--blue-dim': "rgba(113,167,247,0.13)",
    '--yellow': "#d8b94a",
    '--yellow-dim': "rgba(216,185,74,0.13)",
    '--purple': "#9d7bea",
    '--purple-dim': "rgba(157,123,234,0.14)",
    '--babyblue': "#8ed8ef",
    '--babyblue-dim': "rgba(142,216,239,0.12)",
    '--teal': "#2dd4bf",
    '--teal-dim': "rgba(45,212,191,0.14)",
    '--orange': "#e99a55",
    '--orange-dim': "rgba(233,154,85,0.13)",
    '--text': "#f2ecff",
    '--text2': "#c7b8e8",
    '--text3': "#8f7db6"
  },
  'slate': {
    '--bg': "#11161c",
    '--bg2': "#1a2028",
    '--bg3': "#252c35",
    '--border': "#3a434e",
    '--accent': "#7d8998",
    '--accent2': "#a7b1bd",
    '--accent-glow': "rgba(125,137,152,0.20)",
    '--green': "#22c55e",
    '--green-dim': "rgba(34,197,94,0.13)",
    '--red': "#ef4444",
    '--red-dim': "rgba(239,68,68,0.13)",
    '--blue': "#6aa9e9",
    '--blue-dim': "rgba(106,169,233,0.13)",
    '--yellow': "#eab308",
    '--yellow-dim': "rgba(234,179,8,0.13)",
    '--purple': "#a78bfa",
    '--purple-dim': "rgba(167,139,250,0.13)",
    '--babyblue': "#38bdf8",
    '--babyblue-dim': "rgba(56,189,248,0.13)",
    '--teal': "#14b8a6",
    '--teal-dim': "rgba(20,184,166,0.13)",
    '--orange': "#f47c20",
    '--orange-dim': "rgba(244,124,32,0.13)",
    '--text': "#e7ebf0",
    '--text2': "#a4afbb",
    '--text3': "#717d89"
  },
  'cyberpunk': {
    '--bg': "#0b0714",
    '--bg2': "#171022",
    '--bg3': "#241934",
    '--border': "#46245b",
    '--accent': "#e43cff",
    '--accent2': "#38e8ff",
    '--accent-glow': "rgba(228,60,255,0.28)",
    '--green': "#20e892",
    '--green-dim': "rgba(32,232,146,0.16)",
    '--red': "#ff4d79",
    '--red-dim': "rgba(255,77,121,0.16)",
    '--blue': "#38e8ff",
    '--blue-dim': "rgba(56,232,255,0.16)",
    '--yellow': "#f8e85a",
    '--yellow-dim': "rgba(248,232,90,0.15)",
    '--purple': "#b866ff",
    '--purple-dim': "rgba(184,102,255,0.16)",
    '--babyblue': "#7df3ff",
    '--babyblue-dim': "rgba(125,243,255,0.15)",
    '--teal': "#38f5d4",
    '--teal-dim': "rgba(56,245,212,0.15)",
    '--orange': "#ff8a32",
    '--orange-dim': "rgba(255,138,50,0.15)",
    '--text': "#f4eaff",
    '--text2': "#b89bcc",
    '--text3': "#8b62a5"
  },
  'industrial': {
    '--bg': "#151515",
    '--bg2': "#202020",
    '--bg3': "#2b2b2b",
    '--border': "#3a3a3a",
    '--accent': "#f26a21",
    '--accent2': "#ff8c3a",
    '--accent-glow': "rgba(242,106,33,0.24)",
    '--green': "#4ade80",
    '--green-dim': "rgba(74,222,128,0.14)",
    '--red': "#ef6b6b",
    '--red-dim': "rgba(239,107,107,0.14)",
    '--blue': "#5fa8d3",
    '--blue-dim': "rgba(95,168,211,0.13)",
    '--yellow': "#f5c542",
    '--yellow-dim': "rgba(245,197,66,0.14)",
    '--purple': "#c084fc",
    '--purple-dim': "rgba(192,132,252,0.14)",
    '--babyblue': "#67e8f9",
    '--babyblue-dim': "rgba(103,232,249,0.14)",
    '--teal': "#2dd4bf",
    '--teal-dim': "rgba(45,212,191,0.14)",
    '--orange': "#f26a21",
    '--orange-dim': "rgba(242,106,33,0.14)",
    '--text': "#eeeeea",
    '--text2': "#b6b6ae",
    '--text3': "#81817a"
  },
  'mint': {
    '--bg': "#f0fdf9",
    '--bg2': "#ffffff",
    '--bg3': "#e6fff8",
    '--border': "#a7f3d0",
    '--accent': "#14b8a6",
    '--accent2': "#10b981",
    '--accent-glow': "rgba(20,184,166,0.18)",
    '--green': "#059669",
    '--green-dim': "rgba(5,150,105,0.11)",
    '--red': "#dc2626",
    '--red-dim': "rgba(220,38,38,0.10)",
    '--blue': "#0284c7",
    '--blue-dim': "rgba(2,132,199,0.10)",
    '--yellow': "#ca8a04",
    '--yellow-dim': "rgba(202,138,4,0.10)",
    '--purple': "#7c3aed",
    '--purple-dim': "rgba(124,58,237,0.10)",
    '--babyblue': "#0891b2",
    '--babyblue-dim': "rgba(8,145,178,0.10)",
    '--teal': "#0f766e",
    '--teal-dim': "rgba(15,118,110,0.10)",
    '--orange': "#ea580c",
    '--orange-dim': "rgba(234,88,12,0.10)",
    '--text': "#064e3b",
    '--text2': "#065f46",
    '--text3': "#10b981"
  },
  'engel': {
    '--bg': "#0c1209",
    '--bg2': "#141e0f",
    '--bg3': "#1b2a14",
    '--border': "#2d4820",
    '--accent': "#78be20",
    '--accent2': "#96d63a",
    '--accent-glow': "rgba(120,190,32,0.28)",
    '--green': "#78be20",
    '--green-dim': "rgba(120,190,32,0.15)",
    '--red': "#f87171",
    '--red-dim': "rgba(248,113,113,0.14)",
    '--blue': "#00a3b5",
    '--blue-dim': "rgba(0,163,181,0.14)",
    '--yellow': "#ffc72c",
    '--yellow-dim': "rgba(255,199,44,0.14)",
    '--purple': "#c084fc",
    '--purple-dim': "rgba(192,132,252,0.14)",
    '--babyblue': "#22d3ee",
    '--babyblue-dim': "rgba(34,211,238,0.14)",
    '--teal': "#00a3b5",
    '--teal-dim': "rgba(0,163,181,0.14)",
    '--orange': "#fb923c",
    '--orange-dim': "rgba(251,146,60,0.14)",
    '--text': "#e8f5d8",
    '--text2': "#8ab870",
    '--text3': "#4d6e38"
  },
  'cardinals': {
    '--bg': "#170607",
    '--bg2': "#240d0f",
    '--bg3': "#321418",
    '--border': "#51232a",
    '--accent': "#b91f36",
    '--accent2': "#e0465b",
    '--accent-glow': "rgba(185,31,54,0.25)",
    '--green': "#22c55e",
    '--green-dim': "rgba(34,197,94,0.14)",
    '--red': "#e0465b",
    '--red-dim': "rgba(224,70,91,0.16)",
    '--blue': "#6da5e8",
    '--blue-dim': "rgba(109,165,232,0.13)",
    '--yellow': "#d9b64c",
    '--yellow-dim': "rgba(217,182,76,0.13)",
    '--purple': "#c084fc",
    '--purple-dim': "rgba(192,132,252,0.14)",
    '--babyblue': "#67e8f9",
    '--babyblue-dim': "rgba(103,232,249,0.14)",
    '--teal': "#2dd4bf",
    '--teal-dim': "rgba(45,212,191,0.14)",
    '--orange': "#e67b3e",
    '--orange-dim': "rgba(230,123,62,0.13)",
    '--text': "#f6eeee",
    '--text2': "#d7b3b8",
    '--text3': "#956a71"
  },
  'wildcats': {
    '--bg': "#061022",
    '--bg2': "#0b1932",
    '--bg3': "#112447",
    '--border': "#1d3d73",
    '--accent': "#1f5fd0",
    '--accent2': "#3f7bea",
    '--accent-glow': "rgba(31,95,208,0.28)",
    '--green': "#22c55e",
    '--green-dim': "rgba(34,197,94,0.14)",
    '--red': "#ef6b6b",
    '--red-dim': "rgba(239,107,107,0.13)",
    '--blue': "#3f7bea",
    '--blue-dim': "rgba(63,123,234,0.16)",
    '--yellow': "#e0bc4b",
    '--yellow-dim': "rgba(224,188,75,0.13)",
    '--purple': "#a78bfa",
    '--purple-dim': "rgba(167,139,250,0.14)",
    '--babyblue': "#38bdf8",
    '--babyblue-dim': "rgba(56,189,248,0.14)",
    '--teal': "#14b8a6",
    '--teal-dim': "rgba(20,184,166,0.14)",
    '--orange': "#f47c20",
    '--orange-dim': "rgba(244,124,32,0.13)",
    '--text': "#eef4ff",
    '--text2': "#a9c1ec",
    '--text3': "#6f8ec7"
  },
  'starship': {
    '--bg': "#030914",
    '--bg2': "#071327",
    '--bg3': "#0d1d36",
    '--border': "#16466b",
    '--accent': "#26d9ff",
    '--accent2': "#8bf5ff",
    '--accent-glow': "rgba(38,217,255,0.32)",
    '--green': "#2cff9c",
    '--green-dim': "rgba(44,255,156,0.16)",
    '--red': "#ff5a87",
    '--red-dim': "rgba(255,90,135,0.16)",
    '--blue': "#26d9ff",
    '--blue-dim': "rgba(38,217,255,0.18)",
    '--yellow': "#ffd447",
    '--yellow-dim': "rgba(255,212,71,0.16)",
    '--purple': "#7e82ff",
    '--purple-dim': "rgba(126,130,255,0.16)",
    '--babyblue': "#76ecff",
    '--babyblue-dim': "rgba(118,236,255,0.16)",
    '--teal': "#00e9c9",
    '--teal-dim': "rgba(0,233,201,0.16)",
    '--orange': "#ff9f43",
    '--orange-dim': "rgba(255,159,67,0.16)",
    '--text': "#ddf6ff",
    '--text2': "#8fc4dd",
    '--text3': "#4a7fa6",
    '--theme-bg-pattern': 'radial-gradient(circle at 20% 10%, rgba(38,217,255,0.10), transparent 30%), radial-gradient(circle at 85% 20%, rgba(126,130,255,0.13), transparent 36%), linear-gradient(to right, rgba(255, 255, 255, 0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.15) 1px, transparent 1px)',
    '--theme-bg-pattern-size': '100% 100%, 100% 100%, 32px 32px, 32px 32px',
    '--theme-panel-shadow': '0 0 0 1px rgba(38,217,255,0.18), 0 14px 34px rgba(0,0,0,0.45)',
    '--theme-active-shadow': '0 0 0 1px rgba(38,217,255,0.35), 0 0 18px rgba(38,217,255,0.28)',
    '--theme-pill-border-color': 'rgba(118,236,255,0.24)',
    '--theme-pill-bg': 'linear-gradient(135deg, rgba(13,29,54,0.96), rgba(8,25,42,0.96))'
  },
  'starforge': {
    '--bg': "#100d0a",
    '--bg2': "#1a1714",
    '--bg3': "#27211b",
    '--border': "#5f4a35",
    '--accent': "#ff9f1c",
    '--accent2': "#ffd166",
    '--accent-glow': "rgba(255,159,28,0.30)",
    '--green': "#49d987",
    '--green-dim': "rgba(73,217,135,0.14)",
    '--red': "#ff6b5e",
    '--red-dim': "rgba(255,107,94,0.16)",
    '--blue': "#9aa6b2",
    '--blue-dim': "rgba(154,166,178,0.14)",
    '--yellow': "#ffd166",
    '--yellow-dim': "rgba(255,209,102,0.16)",
    '--purple': "#bfa48a",
    '--purple-dim': "rgba(191,164,138,0.14)",
    '--babyblue': "#c5ced6",
    '--babyblue-dim': "rgba(197,206,214,0.14)",
    '--teal': "#f4a261",
    '--teal-dim': "rgba(244,162,97,0.14)",
    '--orange': "#ff9f1c",
    '--orange-dim': "rgba(255,159,28,0.16)",
    '--text': "#f2e6d9",
    '--text2': "#c8b8a5",
    '--text3': "#8c7762",
    '--theme-bg-pattern': 'radial-gradient(circle at 16% 14%, rgba(255,159,28,0.11), transparent 32%), radial-gradient(circle at 82% 12%, rgba(255,209,102,0.10), transparent 36%), linear-gradient(to right, rgba(255, 209, 102, 0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 209, 102, 0.15) 1px, transparent 1px)',
    '--theme-bg-pattern-size': '100% 100%, 100% 100%, 32px 32px, 32px 32px',
    '--theme-panel-bg': 'rgba(26,23,20,0.78)',
    '--theme-panel-backdrop-filter': 'blur(3px)',
    '--theme-panel-border-color': 'rgba(255,159,28,0.30)',
    '--theme-card-overlay': 'linear-gradient(120deg, transparent 0%, rgba(255,209,102,0.08) 45%, transparent 80%)',
    '--theme-card-overlay-blend': 'screen',
    '--theme-pill-bg': 'rgba(39,33,27,0.75)',
    '--theme-pill-border-color': 'rgba(255,209,102,0.22)',
    '--theme-active-shadow': '0 0 0 1px rgba(255,209,102,0.34), 0 0 20px rgba(255,159,28,0.24)'
  },
  'starmono': {
    '--bg': "#0e1011",
    '--bg2': "#16191a",
    '--bg3': "#222627",
    '--border': "#3e4547",
    '--accent': "#d6b56d",
    '--accent2': "#f0cf83",
    '--accent-glow': "rgba(214,181,109,0.22)",
    '--green': "#62b981",
    '--green-dim': "rgba(98,185,129,0.13)",
    '--red': "#d97373",
    '--red-dim': "rgba(217,115,115,0.13)",
    '--blue': "#8db5c8",
    '--blue-dim': "rgba(141,181,200,0.13)",
    '--yellow': "#d6b56d",
    '--yellow-dim': "rgba(214,181,109,0.13)",
    '--purple': "#b59ed1",
    '--purple-dim': "rgba(181,158,209,0.12)",
    '--babyblue': "#a8c8d4",
    '--babyblue-dim': "rgba(168,200,212,0.12)",
    '--teal': "#8cc8b7",
    '--teal-dim': "rgba(140,200,183,0.12)",
    '--orange': "#d69a61",
    '--orange-dim': "rgba(214,154,97,0.13)",
    '--text': "#f0f2ee",
    '--text2': "#b9c0bd",
    '--text3': "#7d8783",
    '--theme-bg-pattern': 'radial-gradient(circle at 20% 12%, rgba(214,181,109,0.09), transparent 34%), radial-gradient(circle at 82% 10%, rgba(141,181,200,0.08), transparent 38%), linear-gradient(transparent 95%, rgba(214,181,109,0.07) 100%), linear-gradient(90deg, transparent 95%, rgba(214,181,109,0.07) 100%)',
    '--theme-bg-pattern-size': 'auto, auto, 28px 28px, 28px 28px',
    '--theme-panel-bg': 'rgba(22,25,26,0.78)',
    '--theme-panel-backdrop-filter': 'blur(3px)',
    '--theme-panel-border-color': 'rgba(214,181,109,0.22)',
    '--theme-card-overlay': 'linear-gradient(120deg, transparent 0%, rgba(214,181,109,0.07) 50%, transparent 82%)',
    '--theme-card-overlay-blend': 'screen',
    '--theme-pill-bg': 'rgba(34,38,39,0.74)',
    '--theme-pill-border-color': 'rgba(214,181,109,0.20)',
    '--theme-pill-text-color': 'var(--color-text-muted, var(--text2))',
    '--theme-active-shadow': '0 0 0 1px rgba(214,181,109,0.34), 0 0 16px rgba(214,181,109,0.16)',
    '--status-color-red': '#ff6b6b',
    '--status-color-red-dim': 'rgba(255,107,107,0.14)',
    '--status-color-alert': '#f43f5e',
    '--status-color-alert-dim': 'rgba(244,63,94,0.14)',
    '--status-color-yellow': '#fbbf24',
    '--status-color-yellow-dim': 'rgba(251,191,36,0.14)',
    '--status-color-materials': '#a78bfa',
    '--status-color-materials-dim': 'rgba(167,139,250,0.14)',
    '--status-color-purple': '#c084fc',
    '--status-color-purple-dim': 'rgba(192,132,252,0.14)',
    '--status-color-quality': '#22d3ee',
    '--status-color-quality-dim': 'rgba(34,211,238,0.14)',
    '--status-color-orange': '#fb923c',
    '--status-color-orange-dim': 'rgba(251,146,60,0.14)',
    '--status-color-baby': '#38bdf8',
    '--status-color-baby-dim': 'rgba(56,189,248,0.14)',
    '--status-color-teal': '#2dd4bf',
    '--status-color-teal-dim': 'rgba(45,212,191,0.14)',
    '--status-color-green': '#4ade80',
    '--status-color-green-dim': 'rgba(74,222,128,0.14)'
  }
};

export const BUILT_IN_THEME_DEFS = RAW_BUILT_IN_THEME_DEFS.map(theme => ({
  ...theme,
  vars: normalizeThemeVars({
    ...theme.vars,
    ...(BUILT_IN_THEME_VAR_OVERRIDES[theme.key] || {})
  })
}));

const DERIVED_LEGACY_KEYS = [
  '--accent-glow',
  '--green-dim',
  '--red-dim',
  '--blue-dim',
  '--yellow-dim',
  '--orange-dim',
  '--purple-dim',
  '--teal-dim',
  '--babyblue-dim',
  '--bg-svg-image',
  '--bg-svg-size'
];

const DERIVED_TOKEN_KEYS = [
  '--color-accent-soft',
  '--color-success-soft',
  '--color-danger-soft',
  '--color-info-soft',
  '--color-warning-soft',
  '--color-orange-soft',
  '--color-purple-soft',
  '--color-teal-soft',
  '--color-babyblue-soft',
  '--focus-ring',
  '--shadow-color'
];

let appliedKeys = new Set();

function normalizeHex(value) {
  const raw = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return '#' + raw.slice(1).split('').map(ch => ch + ch).join('').toLowerCase();
  }
  return '';
}

export function hexToRgba(hex, alpha) {
  const normalized = normalizeHex(hex);
  if (!normalized) return `rgba(0,0,0,${Math.max(0, Math.min(1, Number(alpha) || 0))})`;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  const a = Math.max(0, Math.min(1, Number(alpha) || 0));
  return `rgba(${r},${g},${b},${a})`;
}

export function inferThemeModeFromVars(vars = {}) {
  const bg = normalizeHex(vars['--bg'] || vars['--color-bg']);
  if (!bg) return 'dark';
  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  if ([r, g, b].some(Number.isNaN)) return 'dark';
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? 'light' : 'dark';
}

export function themeLabelSansIcon(label) {
  return String(label || '').replace(/^[^\s]+\s/, '');
}

export function normalizeThemeColors(colors, vars = {}) {
  const merged = normalizeThemeVars(vars);
  const fallback = [
    merged['--bg'] || THEME_DEFAULT_VARS['--bg'],
    merged['--accent'] || THEME_DEFAULT_VARS['--accent'],
    merged['--text'] || THEME_DEFAULT_VARS['--text']
  ];
  return Array.isArray(colors) && colors.length >= 3 ? colors : fallback;
}

export function getThemePreviewColors(theme) {
  const vars = theme && typeof theme === 'object' ? (theme.vars || {}) : {};
  return normalizeThemeColors(theme?.colors, vars);
}

export function normalizeThemeVars(vars = {}) {
  const out = { ...THEME_DEFAULT_VARS };
  
  // 1. Copy all variables directly to out first
  Object.entries(vars || {}).forEach(([key, value]) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey.startsWith('--')) return;
    out[normalizedKey] = String(value || '').trim();
  });

  // 2. Synchronize legacy and modern tokens based on what actually changed
  Object.entries(THEME_TOKEN_MAP).forEach(([legacyKey, tokenKey]) => {
    const legacyVal = out[legacyKey];
    const tokenVal = out[tokenKey];
    const defaultLegacy = THEME_DEFAULT_VARS[legacyKey];
    const defaultToken = THEME_DEFAULT_VARS[tokenKey];

    const legacyChanged = legacyVal !== undefined && legacyVal !== defaultLegacy;
    const tokenChanged = tokenVal !== undefined && tokenVal !== defaultToken;

    if (legacyChanged && !tokenChanged) {
      out[tokenKey] = legacyVal;
    } else if (tokenChanged && !legacyChanged) {
      out[legacyKey] = tokenVal;
    } else {
      if (vars[legacyKey] !== undefined) {
        out[tokenKey] = legacyVal;
      } else if (vars[tokenKey] !== undefined) {
        out[legacyKey] = tokenVal;
      } else if (legacyVal !== undefined) {
        out[tokenKey] = legacyVal;
      }
    }
  });

  // 3. Synchronize soft tokens
  Object.entries(THEME_SOFT_TOKEN_MAP).forEach(([legacyKey, tokenKey]) => {
    const legacyVal = out[legacyKey];
    const tokenVal = out[tokenKey];
    const defaultLegacy = THEME_DEFAULT_VARS[legacyKey];
    const defaultToken = THEME_DEFAULT_VARS[tokenKey];

    const legacyChanged = legacyVal !== undefined && legacyVal !== defaultLegacy;
    const tokenChanged = tokenVal !== undefined && tokenVal !== defaultToken;

    if (legacyChanged && !tokenChanged) {
      out[tokenKey] = legacyVal;
    } else if (tokenChanged && !legacyChanged) {
      out[legacyKey] = tokenVal;
    } else {
      if (vars[legacyKey] !== undefined) {
        out[tokenKey] = legacyVal;
      } else if (vars[tokenKey] !== undefined) {
        out[legacyKey] = tokenVal;
      } else if (legacyVal !== undefined) {
        out[tokenKey] = legacyVal;
      }
    }
  });

  return out;
}

export function svgToDataUrl(svgMarkup) {
  const source = String(svgMarkup || '').trim();
  if (!source) return '';
  const normalized = source.replace(/\r\n?/g, '\n').replace(/\t/g, '  ');
  return `url("data:image/svg+xml,${encodeURIComponent(normalized)}")`;
}

export function clearThemeVars(extraKeys = []) {
  const root = document.documentElement.style;
  const keys = new Set([
    ...Object.keys(THEME_DEFAULT_VARS),
    ...Object.values(THEME_TOKEN_MAP),
    ...DERIVED_LEGACY_KEYS,
    ...DERIVED_TOKEN_KEYS,
    '--bg-svg',
    ...appliedKeys,
    ...extraKeys
  ]);
  keys.forEach(key => root.removeProperty(key));
  appliedKeys = new Set();
}

export function removeThemeClasses(themeKeys = []) {
  document.body.classList.remove(...themeKeys.map(key => `theme-${key}`));
}

export function resolveSvgVariables(svgMarkup, vars = {}) {
  const accent = vars['--accent'] || vars['--color-accent'] || THEME_DEFAULT_VARS['--accent'];
  const text = vars['--text'] || vars['--color-text'] || THEME_DEFAULT_VARS['--text'];
  return (svgMarkup || '')
    .replace(/var\(--color-accent,\s*[^)]+\)/g, accent)
    .replace(/var\(--color-accent\)/g, accent)
    .replace(/var\(--color-text,\s*[^)]+\)/g, text)
    .replace(/var\(--color-text\)/g, text)
    .replace(/var\(--accent\)/g, accent)
    .replace(/var\(--text\)/g, text);
}

function applyDerivedVars(vars) {
  const root = document.documentElement.style;
  const accent = vars['--accent'] || THEME_DEFAULT_VARS['--accent'];
  const accentGlow = vars['--accent-glow'] || hexToRgba(accent, 0.22);
  root.setProperty('--accent-glow', accentGlow);
  root.setProperty('--color-accent-soft', vars['--color-accent-soft'] || hexToRgba(accent, 0.12));
  root.setProperty('--focus-ring', vars['--focus-ring'] || hexToRgba(accent, 0.38));
  root.setProperty('--shadow-color', hexToRgba(vars['--bg'] || THEME_DEFAULT_VARS['--bg'], 0.34));

  [
    ['--green', '--color-success-soft'],
    ['--red', '--color-danger-soft'],
    ['--blue', '--color-info-soft'],
    ['--yellow', '--color-warning-soft'],
    ['--orange', '--color-orange-soft'],
    ['--purple', '--color-purple-soft'],
    ['--teal', '--color-teal-soft'],
    ['--babyblue', '--color-babyblue-soft']
  ].forEach(([legacyKey, tokenSoftKey]) => {
    const value = vars[legacyKey];
    if (!value) return;
    const dimValue = vars[legacyKey + '-dim'] || vars[tokenSoftKey] || hexToRgba(value, 0.12);
    root.setProperty(legacyKey + '-dim', dimValue);
    root.setProperty(tokenSoftKey, dimValue);
  });

  if (typeof vars['--bg-svg'] === 'string' && vars['--bg-svg'].trim()) {
    const resolvedSvg = resolveSvgVariables(vars['--bg-svg'], vars);
    root.setProperty('--bg-svg-image', svgToDataUrl(resolvedSvg));
    root.setProperty('--bg-svg-size', 'auto');
  } else {
    root.removeProperty('--bg-svg-image');
    root.removeProperty('--bg-svg-size');
  }
}

export function applyThemeVars(vars = {}, options = {}) {
  const {
    themeKeys = [],
    classThemeKey = '',
    mode = inferThemeModeFromVars(vars),
    clearExtraKeys = []
  } = options;
  const normalized = normalizeThemeVars(vars);
  clearThemeVars(clearExtraKeys);
  removeThemeClasses(themeKeys);

  if (classThemeKey && classThemeKey !== 'midnight') {
    document.body.classList.add(`theme-${classThemeKey}`);
  }

  Object.entries(normalized).forEach(([key, value]) => {
    if (!String(key || '').startsWith('--')) return;
    if (value === undefined || value === null || value === '') return;
    document.documentElement.style.setProperty(key, String(value));
    appliedKeys.add(key);
  });
  applyDerivedVars(normalized);
  document.body.dataset.themeMode = mode || inferThemeModeFromVars(normalized);
  return normalized;
}

export function readSavedTheme(fallback = 'midnight') {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || fallback;
  } catch (error) {
    return fallback;
  }
}

export function saveThemeSelection(themeKey) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, normalizeThemeSelectionKey(themeKey));
  } catch (error) {}
}

export function normalizeThemeSelectionKey(selection, options = {}) {
  const { storeItems = [], fallback = FALLBACK_THEME_KEY } = options;
  const raw = String(selection || '').trim();
  if (!raw) return fallback;
  if (raw === 'dark') return 'midnight';
  if (raw === 'light') return 'arctic';
  if (raw.startsWith(STORE_THEME_ITEM_PREFIX)) {
    const itemId = raw.slice(STORE_THEME_ITEM_PREFIX.length);
    const item = (Array.isArray(storeItems) ? storeItems : [])
      .find(entry => String(entry?.id || '') === itemId && entry?.type === 'theme');
    return item?.themeKey ? item.themeKey : `storetheme_${itemId}`;
  }
  return raw;
}

export function getCustomThemeKey(id) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  return raw.startsWith('custom_') ? raw : `custom_${raw}`;
}

export function normalizeCustomThemeStorage(data = {}) {
  const customThemes = (Array.isArray(data.customThemes) ? data.customThemes : [])
    .filter(theme => theme && typeof theme === 'object')
    .map((theme, idx) => {
      const id = String(theme.id || `custom_${Date.now()}_${idx}`).trim();
      const createdAt = Number(theme.createdAt || Date.now());
      const updatedAt = theme.updatedAt === undefined ? undefined : Number(theme.updatedAt || Date.now());
      return {
        ...theme,
        id,
        name: String(theme.name || 'Custom Theme').trim() || 'Custom Theme',
        vars: normalizeThemeVars(theme.vars || {}),
        createdAt,
        ...(Number.isFinite(updatedAt) ? { updatedAt } : {})
      };
    });
  const activeCustomId = data.activeCustomId && customThemes.some(theme => theme.id === data.activeCustomId)
    ? data.activeCustomId
    : null;
  return { customThemes, activeCustomId };
}

export function loadCustomThemes(storage = localStorage) {
  try {
    return normalizeCustomThemeStorage(JSON.parse(storage.getItem(CUSTOM_THEMES_STORAGE_KEY) || '{"customThemes":[],"activeCustomId":null}'));
  } catch (error) {
    return normalizeCustomThemeStorage();
  }
}

export function saveCustomThemes(data, storage = localStorage) {
  const normalized = normalizeCustomThemeStorage(data);
  try {
    storage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(normalized));
  } catch (error) {}
  return normalized;
}

export function resolveThemeSelection(selection, catalog = [], options = {}) {
  const key = normalizeThemeSelectionKey(selection, options);
  const entry = (Array.isArray(catalog) ? catalog : []).find(theme => theme?.key === key) || null;
  return {
    key: entry?.key || key,
    entry,
    isFallback: !entry
  };
}

export function applyResolvedTheme(entry, options = {}) {
  const {
    themeKeys = BUILT_IN_THEME_DEFS.map(theme => theme.key),
    clearExtraKeys = [],
    classThemeKey = entry?.source === 'builtin' ? entry.key : '',
    mode = entry?.mode
  } = options;
  if (!entry?.vars) return null;
  return applyThemeVars(entry.vars, {
    themeKeys,
    classThemeKey,
    mode: mode || inferThemeModeFromVars(entry.vars),
    clearExtraKeys
  });
}

export function hexToRgb(hex) {
  const normalized = normalizeHex(hex);
  if (!normalized) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16)
  };
}

export function getRelativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  const a = [rgb.r, rgb.g, rgb.b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

export function getContrastRatio(hex1, hex2) {
  const l1 = getRelativeLuminance(hex1);
  const l2 = getRelativeLuminance(hex2);
  const brightest = Math.max(l1, l2);
  const darkest = Math.min(l1, l2);
  return (brightest + 0.05) / (darkest + 0.05);
}
