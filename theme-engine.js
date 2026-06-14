export const THEME_STORAGE_KEY = 'pressTrackerTheme';

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
  { key:'midnight',   name:'Midnight',   label:'🌙 Midnight',   mode:'dark',  colors:['#0d1117','#f97316','#e6edf3'], vars:{ '--bg':'#0d1117','--bg2':'#161b22','--bg3':'#1c2333','--border':'#30363d','--text':'#e6edf3','--text2':'#8b949e','--text3':'#484f58','--accent':'#f97316','--accent2':'#fb923c','--green':'#22c55e','--red':'#ef4444','--blue':'#3b82f6','--yellow':'#eab308','--orange':'#f97316' }, price:0, order:0 },
  { key:'arctic',     name:'Arctic',     label:'❄️ Arctic',     mode:'light', colors:['#f8fafc','#0ea5e9','#0f172a'], vars:{ '--bg':'#f8fafc','--bg2':'#ffffff','--bg3':'#f1f5f9','--border':'#cbd5e1','--text':'#0f172a','--text2':'#475569','--text3':'#94a3b8','--accent':'#0ea5e9','--accent2':'#38bdf8','--green':'#16a34a','--red':'#dc2626','--blue':'#0284c7','--yellow':'#ca8a04','--orange':'#f97316' }, price:0, order:1 },
  { key:'forest',     name:'Forest',     label:'🌲 Forest',     mode:'dark',  colors:['#0a120e','#10b981','#d1fae5'], vars:{ '--bg':'#0a120e','--bg2':'#0f1a14','--bg3':'#14241a','--border':'#1e3a28','--text':'#d1fae5','--text2':'#6ee7b7','--text3':'#34d399','--accent':'#10b981','--accent2':'#34d399','--green':'#34d399','--red':'#f87171','--blue':'#22d3ee','--yellow':'#facc15','--orange':'#fb923c' }, price:0, order:2 },
  { key:'sunset',     name:'Sunset',     label:'🌅 Sunset',     mode:'dark',  colors:['#1a0f0a','#fb923c','#fef3c7'], vars:{ '--bg':'#1a0f0a','--bg2':'#2d1810','--bg3':'#3d2218','--border':'#54321f','--text':'#fef3c7','--text2':'#fcd34d','--text3':'#f59e0b','--accent':'#fb923c','--accent2':'#fdba74','--green':'#34d399','--red':'#f87171','--blue':'#60a5fa','--yellow':'#facc15','--orange':'#fb923c' }, price:75, order:3 },
  { key:'ocean',      name:'Ocean',      label:'🌊 Ocean',      mode:'dark',  colors:['#0a1628','#38bdf8','#e0f2fe'], vars:{ '--bg':'#0a1628','--bg2':'#0f1e36','--bg3':'#152945','--border':'#1e3a5f','--text':'#e0f2fe','--text2':'#7dd3fc','--text3':'#0ea5e9','--accent':'#38bdf8','--accent2':'#7dd3fc','--green':'#22c55e','--red':'#f87171','--blue':'#38bdf8','--yellow':'#facc15','--orange':'#fb923c' }, price:75, order:4 },
  { key:'royal',      name:'Royal',      label:'👑 Royal',      mode:'dark',  colors:['#18102a','#c084fc','#f3e8ff'], vars:{ '--bg':'#18102a','--bg2':'#251638','--bg3':'#331f4d','--border':'#4a2d6b','--text':'#f3e8ff','--text2':'#d8b4fe','--text3':'#a78bfa','--accent':'#c084fc','--accent2':'#d8b4fe','--green':'#34d399','--red':'#f87171','--blue':'#60a5fa','--yellow':'#facc15','--orange':'#fb923c' }, price:120, order:5 },
  { key:'slate',      name:'Slate',      label:'⚡ Slate',      mode:'dark',  colors:['#0f1419','#64748b','#e2e8f0'], vars:{ '--bg':'#0f1419','--bg2':'#1a1f25','--bg3':'#242a31','--border':'#30363d','--text':'#e2e8f0','--text2':'#94a3b8','--text3':'#64748b','--accent':'#64748b','--accent2':'#94a3b8','--green':'#22c55e','--red':'#ef4444','--blue':'#60a5fa','--yellow':'#eab308','--orange':'#f97316' }, price:0, order:6 },
  { key:'mint',       name:'Mint',       label:'🍃 Mint',       mode:'light', colors:['#f0fdf9','#14b8a6','#064e3b'], vars:{ '--bg':'#f0fdf9','--bg2':'#ffffff','--bg3':'#e6fff8','--border':'#a7f3d0','--text':'#064e3b','--text2':'#065f46','--text3':'#10b981','--accent':'#14b8a6','--accent2':'#10b981','--green':'#059669','--red':'#dc2626','--blue':'#0284c7','--yellow':'#ca8a04','--orange':'#ea580c' }, price:0, order:7 },
  { key:'cyberpunk',  name:'Cyberpunk',  label:'🎮 Cyberpunk',  mode:'dark',  colors:['#0a0014','#ff00ff','#00ffff'], vars:{ '--bg':'#0a0014','--bg2':'#150028','--bg3':'#1f003d','--border':'#3d0066','--text':'#00ffff','--text2':'#ff00ff','--text3':'#9d00ff','--accent':'#ff00ff','--accent2':'#00ffff','--green':'#00ff88','--red':'#ff4d6d','--blue':'#00ffff','--yellow':'#ffee00','--orange':'#ff7a00' }, price:220, order:8 },
  { key:'industrial', name:'Industrial', label:'🏭 Industrial', mode:'dark',  colors:['#1a1a1a','#ff6b00','#e5e5e5'], vars:{ '--bg':'#1a1a1a','--bg2':'#252525','--bg3':'#2f2f2f','--border':'#404040','--text':'#e5e5e5','--text2':'#a0a0a0','--text3':'#707070','--accent':'#ff6b00','--accent2':'#ff8a33','--green':'#4ade80','--red':'#f87171','--blue':'#60a5fa','--yellow':'#facc15','--orange':'#ff6b00' }, price:220, order:9 },
  { key:'starship',   name:'Starship',   label:'🛸 Starship',   mode:'dark',  colors:['#030914','#26d9ff','#ddf6ff'], vars:{ '--bg':'#030914','--bg2':'#071327','--bg3':'#0d1d36','--border':'#16466b','--text':'#ddf6ff','--text2':'#8fc4dd','--text3':'#4a7fa6','--accent':'#26d9ff','--accent2':'#8bf5ff','--green':'#2cff9c','--red':'#ff5a87','--blue':'#26d9ff','--yellow':'#ffd447','--orange':'#ff9f43' }, price:180, order:10 },
  { key:'starforge',  name:'Starforge',  label:'🧱 Starforge',  mode:'dark',  colors:['#100d0a','#ff9f1c','#f2e6d9'], vars:{ '--bg':'#100d0a','--bg2':'#1a1714','--bg3':'#27211b','--border':'#5f4a35','--text':'#f2e6d9','--text2':'#c8b8a5','--text3':'#8c7762','--accent':'#ff9f1c','--accent2':'#ffd166','--green':'#49d987','--red':'#ff6b5e','--blue':'#9aa6b2','--yellow':'#ffd166','--orange':'#ff9f1c' }, price:200, order:11 },
  { key:'starmono',   name:'Star Mono',  label:'📟 Star Mono',  mode:'dark',  colors:['#0f1012','#c6ccd3','#eceff3'], vars:{ '--bg':'#0f1012','--bg2':'#17191c','--bg3':'#24282d','--border':'#424951','--text':'#eceff3','--text2':'#b5bcc5','--text3':'#747e89','--accent':'#c6ccd3','--accent2':'#e2e6ea','--green':'#a3a3a3','--red':'#9a9a9a','--blue':'#b8b8b8','--yellow':'#b0b0b0','--orange':'#c0c0c0' }, price:170, order:12 },
  { key:'engel',      name:'Engel',      label:'🟢 Engel',      mode:'dark',  colors:['#0c1209','#78be20','#e8f5d8'], vars:{ '--bg':'#0c1209','--bg2':'#141e0f','--bg3':'#1b2a14','--border':'#2d4820','--text':'#e8f5d8','--text2':'#8ab870','--text3':'#4d6e38','--accent':'#78be20','--accent2':'#96d63a','--green':'#78be20','--red':'#f87171','--blue':'#00a3b5','--yellow':'#ffc72c','--orange':'#fb923c' }, price:0, order:13 },
  { key:'cardinals',  name:'Cardinals',  label:'🔴 Cardinals',  mode:'dark',  colors:['#0e0303','#c8102e','#f5e8e8'], vars:{ '--bg':'#0e0303','--bg2':'#1c0808','--bg3':'#260c0c','--border':'#3d1515','--text':'#f5e8e8','--text2':'#c48a8a','--text3':'#7a4444','--accent':'#c8102e','--accent2':'#e81f42','--green':'#22c55e','--red':'#ff4444','--blue':'#60a5fa','--yellow':'#eab308','--orange':'#f97316' }, price:25, order:14 },
  { key:'wildcats',   name:'Wildcats',   label:'🔵 Wildcats',   mode:'dark',  colors:['#020814','#0033a0','#e8f0ff'], vars:{ '--bg':'#020814','--bg2':'#051228','--bg3':'#071a38','--border':'#0d2d5e','--text':'#e8f0ff','--text2':'#7da8e8','--text3':'#3d6ab0','--accent':'#0033a0','--accent2':'#1a52cc','--green':'#22c55e','--red':'#ef4444','--blue':'#3b82f6','--yellow':'#eab308','--orange':'#f97316' }, price:25, order:15 }
];

const BUILT_IN_THEME_VAR_OVERRIDES = {
  'arctic': {
    '--bg': "#f8fafc",
    '--bg2': "#ffffff",
    '--bg3': "#f1f5f9",
    '--border': "#cbd5e1",
    '--accent': "#0ea5e9",
    '--accent2': "#38bdf8",
    '--accent-glow': "rgba(14,165,233,0.2)",
    '--green': "#16a34a",
    '--green-dim': "rgba(22,163,74,0.12)",
    '--red': "#dc2626",
    '--red-dim': "rgba(220,38,38,0.10)",
    '--blue': "#0284c7",
    '--blue-dim': "rgba(2,132,199,0.12)",
    '--yellow': "#ca8a04",
    '--yellow-dim': "rgba(202,138,4,0.12)",
    '--purple': "#7c3aed",
    '--purple-dim': "rgba(124,58,237,0.12)",
    '--babyblue': "#0ea5e9",
    '--babyblue-dim': "rgba(14,165,233,0.12)",
    '--teal': "#0d9488",
    '--teal-dim': "rgba(13,148,136,0.10)",
    '--orange': "#f97316",
    '--orange-dim': "rgba(249,115,22,0.10)",
    '--text': "#0f172a",
    '--text2': "#475569",
    '--text3': "#94a3b8"
  },
  'forest': {
    '--bg': "#0a120e",
    '--bg2': "#0f1a14",
    '--bg3': "#14241a",
    '--border': "#1e3a28",
    '--accent': "#10b981",
    '--accent2': "#34d399",
    '--accent-glow': "rgba(16,185,129,0.22)",
    '--green': "#34d399",
    '--green-dim': "rgba(52,211,153,0.15)",
    '--red': "#f87171",
    '--red-dim': "rgba(248,113,113,0.15)",
    '--blue': "#22d3ee",
    '--blue-dim': "rgba(34,211,238,0.14)",
    '--yellow': "#facc15",
    '--yellow-dim': "rgba(250,204,21,0.14)",
    '--purple': "#a78bfa",
    '--purple-dim': "rgba(167,139,250,0.14)",
    '--babyblue': "#5eead4",
    '--babyblue-dim': "rgba(94,234,212,0.14)",
    '--teal': "#2dd4bf",
    '--teal-dim': "rgba(45,212,191,0.14)",
    '--orange': "#fb923c",
    '--orange-dim': "rgba(251,146,60,0.14)",
    '--text': "#d1fae5",
    '--text2': "#6ee7b7",
    '--text3': "#34d399"
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
    '--bg': "#0a1628",
    '--bg2': "#0f1e36",
    '--bg3': "#152945",
    '--border': "#1e3a5f",
    '--accent': "#38bdf8",
    '--accent2': "#7dd3fc",
    '--accent-glow': "rgba(56,189,248,0.24)",
    '--green': "#22c55e",
    '--green-dim': "rgba(34,197,94,0.14)",
    '--red': "#f87171",
    '--red-dim': "rgba(248,113,113,0.14)",
    '--blue': "#38bdf8",
    '--blue-dim': "rgba(56,189,248,0.14)",
    '--yellow': "#facc15",
    '--yellow-dim': "rgba(250,204,21,0.14)",
    '--purple': "#a78bfa",
    '--purple-dim': "rgba(167,139,250,0.14)",
    '--babyblue': "#67e8f9",
    '--babyblue-dim': "rgba(103,232,249,0.14)",
    '--teal': "#2dd4bf",
    '--teal-dim': "rgba(45,212,191,0.14)",
    '--orange': "#fb923c",
    '--orange-dim': "rgba(251,146,60,0.14)",
    '--text': "#e0f2fe",
    '--text2': "#7dd3fc",
    '--text3': "#0ea5e9"
  },
  'royal': {
    '--bg': "#18102a",
    '--bg2': "#251638",
    '--bg3': "#331f4d",
    '--border': "#4a2d6b",
    '--accent': "#c084fc",
    '--accent2': "#d8b4fe",
    '--accent-glow': "rgba(192,132,252,0.24)",
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
    '--text': "#f3e8ff",
    '--text2': "#d8b4fe",
    '--text3': "#a78bfa"
  },
  'slate': {
    '--bg': "#0f1419",
    '--bg2': "#1a1f25",
    '--bg3': "#242a31",
    '--border': "#30363d",
    '--accent': "#64748b",
    '--accent2': "#94a3b8",
    '--accent-glow': "rgba(100,116,139,0.22)",
    '--green': "#22c55e",
    '--green-dim': "rgba(34,197,94,0.13)",
    '--red': "#ef4444",
    '--red-dim': "rgba(239,68,68,0.13)",
    '--blue': "#60a5fa",
    '--blue-dim': "rgba(96,165,250,0.13)",
    '--yellow': "#eab308",
    '--yellow-dim': "rgba(234,179,8,0.13)",
    '--purple': "#a78bfa",
    '--purple-dim': "rgba(167,139,250,0.13)",
    '--babyblue': "#38bdf8",
    '--babyblue-dim': "rgba(56,189,248,0.13)",
    '--teal': "#14b8a6",
    '--teal-dim': "rgba(20,184,166,0.13)",
    '--orange': "#f97316",
    '--orange-dim': "rgba(249,115,22,0.13)",
    '--text': "#e2e8f0",
    '--text2': "#94a3b8",
    '--text3': "#64748b"
  },
  'cyberpunk': {
    '--bg': "#0a0014",
    '--bg2': "#150028",
    '--bg3': "#1f003d",
    '--border': "#3d0066",
    '--accent': "#ff00ff",
    '--accent2': "#00ffff",
    '--accent-glow': "rgba(255,0,255,0.28)",
    '--green': "#00ff88",
    '--green-dim': "rgba(0,255,136,0.18)",
    '--red': "#ff4d6d",
    '--red-dim': "rgba(255,77,109,0.18)",
    '--blue': "#00ffff",
    '--blue-dim': "rgba(0,255,255,0.18)",
    '--yellow': "#ffee00",
    '--yellow-dim': "rgba(255,238,0,0.18)",
    '--purple': "#9d00ff",
    '--purple-dim': "rgba(157,0,255,0.18)",
    '--babyblue': "#00e5ff",
    '--babyblue-dim': "rgba(0,229,255,0.18)",
    '--teal': "#00ffc8",
    '--teal-dim': "rgba(0,255,200,0.18)",
    '--orange': "#ff7a00",
    '--orange-dim': "rgba(255,122,0,0.18)",
    '--text': "#00ffff",
    '--text2': "#ff00ff",
    '--text3': "#9d00ff"
  },
  'industrial': {
    '--bg': "#1a1a1a",
    '--bg2': "#252525",
    '--bg3': "#2f2f2f",
    '--border': "#404040",
    '--accent': "#ff6b00",
    '--accent2': "#ff8a33",
    '--accent-glow': "rgba(255,107,0,0.24)",
    '--green': "#4ade80",
    '--green-dim': "rgba(74,222,128,0.14)",
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
    '--orange': "#ff6b00",
    '--orange-dim': "rgba(255,107,0,0.14)",
    '--text': "#e5e5e5",
    '--text2': "#a0a0a0",
    '--text3': "#707070"
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
    '--bg': "#0e0303",
    '--bg2': "#1c0808",
    '--bg3': "#260c0c",
    '--border': "#3d1515",
    '--accent': "#c8102e",
    '--accent2': "#e81f42",
    '--accent-glow': "rgba(200,16,46,0.28)",
    '--green': "#22c55e",
    '--green-dim': "rgba(34,197,94,0.14)",
    '--red': "#ff4444",
    '--red-dim': "rgba(255,68,68,0.18)",
    '--blue': "#60a5fa",
    '--blue-dim': "rgba(96,165,250,0.14)",
    '--yellow': "#eab308",
    '--yellow-dim': "rgba(234,179,8,0.14)",
    '--purple': "#c084fc",
    '--purple-dim': "rgba(192,132,252,0.14)",
    '--babyblue': "#67e8f9",
    '--babyblue-dim': "rgba(103,232,249,0.14)",
    '--teal': "#2dd4bf",
    '--teal-dim': "rgba(45,212,191,0.14)",
    '--orange': "#f97316",
    '--orange-dim': "rgba(249,115,22,0.14)",
    '--text': "#f5e8e8",
    '--text2': "#c48a8a",
    '--text3': "#7a4444"
  },
  'wildcats': {
    '--bg': "#020814",
    '--bg2': "#051228",
    '--bg3': "#071a38",
    '--border': "#0d2d5e",
    '--accent': "#0033a0",
    '--accent2': "#1a52cc",
    '--accent-glow': "rgba(0,51,160,0.30)",
    '--green': "#22c55e",
    '--green-dim': "rgba(34,197,94,0.14)",
    '--red': "#ef4444",
    '--red-dim': "rgba(239,68,68,0.14)",
    '--blue': "#3b82f6",
    '--blue-dim': "rgba(59,130,246,0.18)",
    '--yellow': "#eab308",
    '--yellow-dim': "rgba(234,179,8,0.14)",
    '--purple': "#a78bfa",
    '--purple-dim': "rgba(167,139,250,0.14)",
    '--babyblue': "#38bdf8",
    '--babyblue-dim': "rgba(56,189,248,0.14)",
    '--teal': "#14b8a6",
    '--teal-dim': "rgba(20,184,166,0.14)",
    '--orange': "#f97316",
    '--orange-dim': "rgba(249,115,22,0.14)",
    '--text': "#e8f0ff",
    '--text2': "#7da8e8",
    '--text3': "#3d6ab0"
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
    '--bg': "#0f1012",
    '--bg2': "#17191c",
    '--bg3': "#24282d",
    '--border': "#424951",
    '--accent': "#c6ccd3",
    '--accent2': "#e2e6ea",
    '--accent-glow': "rgba(198,204,211,0.25)",
    '--green': "#a3a3a3",
    '--green-dim': "rgba(163,163,163,0.14)",
    '--red': "#9a9a9a",
    '--red-dim': "rgba(154,154,154,0.14)",
    '--blue': "#b8b8b8",
    '--blue-dim': "rgba(184,184,184,0.14)",
    '--yellow': "#b0b0b0",
    '--yellow-dim': "rgba(176,176,176,0.14)",
    '--purple': "#acacac",
    '--purple-dim': "rgba(172,172,172,0.14)",
    '--babyblue': "#c4c4c4",
    '--babyblue-dim': "rgba(196,196,196,0.14)",
    '--teal': "#b6b6b6",
    '--teal-dim': "rgba(182,182,182,0.14)",
    '--orange': "#c0c0c0",
    '--orange-dim': "rgba(192,192,192,0.14)",
    '--text': "#eceff3",
    '--text2': "#b5bcc5",
    '--text3': "#747e89",
    '--theme-bg-pattern': 'radial-gradient(circle at 20% 12%, rgba(200,205,212,0.10), transparent 34%), radial-gradient(circle at 82% 10%, rgba(132,141,151,0.12), transparent 38%), linear-gradient(transparent 95%, rgba(177,184,191,0.08) 100%), linear-gradient(90deg, transparent 95%, rgba(177,184,191,0.08) 100%)',
    '--theme-bg-pattern-size': 'auto, auto, 28px 28px, 28px 28px',
    '--theme-panel-bg': 'rgba(23,25,28,0.76)',
    '--theme-panel-backdrop-filter': 'blur(3px)',
    '--theme-panel-border-color': 'rgba(198,204,211,0.24)',
    '--theme-card-overlay': 'linear-gradient(120deg, transparent 0%, rgba(198,204,211,0.08) 50%, transparent 82%)',
    '--theme-card-overlay-blend': 'screen',
    '--theme-pill-bg': 'rgba(36,40,45,0.72)',
    '--theme-pill-border-color': 'rgba(198,204,211,0.22)',
    '--theme-pill-text-color': 'var(--color-text-muted, var(--text2))',
    '--theme-active-shadow': '0 0 0 1px rgba(198,204,211,0.32), 0 0 16px rgba(198,204,211,0.18)',
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
    localStorage.setItem(THEME_STORAGE_KEY, themeKey);
  } catch (error) {}
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

