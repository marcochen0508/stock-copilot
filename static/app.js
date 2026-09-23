let currentPortfolios = null;
let currentTab = "all";
let activeStockCode = "2330";
let activeHoldingContext = null;
let chartInstance = null;
let currentStockTimeframe = "D";
// High-speed client cache for stock detail & timeframe switching (Instant 0ms render)
const stockDetailClientCache = new Map(); // key: `${code}_${tf}` -> { data, timestamp }
const STOCK_CLIENT_CACHE_TTL = 300000; // 5 minutes
let stockDetailAbortController = null;

// TradingView Lightweight Charts Instances
let tvChart = null;
let tvCandleSeries = null;
let tvVolumeSeries = null;
let tvMa5Series = null;
let tvMa20Series = null;
let tvMa60Series = null;

// Sector Analysis & Asset Risk Management
let sectorDoughnutChart = null;

const SECTOR_MAP = {
  // 半導體 / IC設計
  "2330": "半導體", "2454": "半導體", "2303": "半導體", "3037": "半導體", "2379": "半導體",
  "3443": "半導體", "3661": "半導體", "6415": "半導體", "6770": "半導體", "5347": "半導體", "2408": "半導體",
  // AI伺服器 / 電子代工
  "2317": "AI代工", "2382": "AI代工", "3231": "AI代工", "2356": "AI代工", "6669": "AI代工",
  "2376": "AI代工", "2357": "AI代工", "2301": "AI代工",
  // 綠能 / 散熱 / 電源
  "2308": "散熱綠能", "3017": "散熱綠能", "3324": "散熱綠能", "1519": "散熱綠能", "1503": "散熱綠能",
  // 金融金控
  "2881": "金融金控", "2882": "金融金控", "2886": "金融金控", "2891": "金融金控", "2884": "金融金控",
  "2890": "金融金控", "2885": "金融金控", "2880": "金融金控", "2883": "金融金控", "2887": "金融金控", "5880": "金融金控",
  // 航運 / 傳產
  "2603": "航運傳產", "2609": "航運傳產", "2615": "航運傳產", "2618": "航運傳產", "1101": "航運傳產", "1301": "航運傳產", "2002": "航運傳產",
  // 高股息 ETF
  "0056": "高股息ETF", "00878": "高股息ETF", "00919": "高股息ETF", "00929": "高股息ETF", "00940": "高股息ETF", "00713": "高股息ETF", "00915": "高股息ETF",
  // 市值型 / 科技 ETF
  "0050": "市值型ETF", "0052": "科技型ETF", "006208": "市值型ETF", "00881": "科技型ETF", "00935": "科技型ETF"
};

const SECTOR_COLORS = {
  "半導體": "#3b82f6",     // 藍色
  "AI代工": "#a855f7",     // 紫色
  "散熱綠能": "#10b981",   // 翠綠
  "金融金控": "#f59e0b",   // 金黃
  "航運傳產": "#06b6d4",   // 青藍
  "高股息ETF": "#ef4444",  // 鮮紅
  "市值型ETF": "#ec4899",  // 粉紅
  "科技型ETF": "#8b5cf6",  // 靛紫
  "其他成長股": "#64748b"  // 灰藍
};

function getStockSector(code, name = "") {
  const c = String(code).trim();
  if (SECTOR_MAP[c]) return SECTOR_MAP[c];
  if (name.includes("高股息") || name.includes("高息")) return "高股息ETF";
  if (name.includes("ETF") || name.includes("00")) return "市值型ETF";
  if (name.includes("金控") || name.includes("銀") || name.includes("壽")) return "金融金控";
  if (name.includes("電") || name.includes("晶") || name.includes("科")) return "半導體";
  if (name.includes("航") || name.includes("海") || name.includes("運")) return "航運傳產";
  return "其他成長股";
}

// Rich default watchlist of 12 top Taiwan stocks
const DEFAULT_WATCHLIST = [
  { code: "2454", name: "聯發科", note: "IC設計龍頭" },
  { code: "2308", name: "台達電", note: "散熱/綠能/電源" },
  { code: "3037", name: "欣興", note: "ABF載板概念" },
  { code: "2379", name: "瑞昱", note: "網通晶片" },
  { code: "2603", name: "長榮", note: "航運龍頭" },
  { code: "2382", name: "廣達", note: "AI代工龍頭" },
  { code: "3231", name: "緯創", note: "AI伺服器" },
  { code: "00878", name: "國泰永續高股息", note: "存股熱門ETF" },
  { code: "00919", name: "群益精選高息", note: "高殖利率ETF" },
  { code: "2886", name: "兆豐金", note: "官股金控" },
  { code: "2356", name: "英業達", note: "伺服器代工" },
  { code: "2408", name: "南亞科", note: "記憶體DRAM" }
];

function getSavedWatchlist() {
  try {
    const saved = localStorage.getItem("my_watchlist_stocks");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return DEFAULT_WATCHLIST;
}

function saveWatchlist(list) {
  try {
    localStorage.setItem("my_watchlist_stocks", JSON.stringify(list));
  } catch (e) {}
}

let watchlistStocks = getSavedWatchlist();

// Instant LocalStorage Cache Keys for 0-second page load
const LS_PORTFOLIOS_KEY = "tw_portfolios_instant_cache_v1";
const LS_MACRO_KEY = "tw_macro_instant_cache_v1";

// -------------------------------------------------------------
// 全域排序狀態與欄位定義
// -------------------------------------------------------------
let currentSort = {
  key: null,      // 欄位名稱
  order: 'desc'   // 'asc' 或 'desc'
};

// -------------------------------------------------------------
// 股票小白白話辭典資料庫 (生動大白話比喻 + 實戰操作指南)
// -------------------------------------------------------------
const STOCK_GLOSSARY = {
  "yield": {
    term: "現金殖利率",
    plain: "【就像銀行存款利率！】把錢買這檔股票，每年能拿到多少%的現金利息。計算公式是（每年發放的現金股利 ÷ 目前股價）。例如買 100 元的股票，今年發 5 元現金，殖利率就是 5%。",
    action: "殖利率 5% 以上通常是熱門的高股息收息股！但小白切記：要挑選獲利穩定能『填息』的公司，才不會『賺了股息，卻賠了股價價差』。"
  },
  "dividend": {
    term: "預估年股利",
    plain: "【今年預計能領到多少新台幣紅包！】系統根據你持有的所有股數，乘以這檔股票近一年的每股配息金額，幫你算出來一年總共會匯進你銀行的現金總額。",
    action: "存股領息族最在意的數字！如果目標是每個月替自己加薪 1 萬元（一年 12 萬），可以觀察這個欄位有沒有逐年達標。"
  },
  "pnl": {
    term: "未實現損益",
    plain: "【紙上富貴或暫時虧損！】如果你『今天此時此刻』把手上的股票全部在市場上賣掉，扣掉當初買進的總成本後，帳面上賺或賠多少新台幣。因為還沒真正按『賣出』，所以叫做『未實現』。",
    action: "紅色代表目前帳面有賺錢（獲利中）；綠色代表暫時虧損（套牢中）。短線波動不用每天自己嚇自己，關鍵看公司的基本面與防守線。"
  },
  "roi": {
    term: "報酬率 (ROI)",
    plain: "【賺或賠的趴數（%）！】你投入的本金，目前總共賺了或賠了幾百分比。計算是（未實現損益 ÷ 投入總成本）× 100%。",
    action: "報酬率超過 +20% ~ +30% 時，小白可以考慮先賣出一半把本金拿回來（獲利入袋放口袋），剩下的部位零成本安心讓它繼續跑！"
  },
  "decision": {
    term: "智能決策系統",
    plain: "【你的專屬量化副駕駛！】系統自動結合均線生命線（20MA）、壓力支撐、KD過熱度、以及外資投信三大法人進出，每分每秒替你持有的個股做出最理性的買賣診斷。",
    action: "看到『多頭續抱』就安心坐好；看到『拉回加碼買點』可小額補貨；看到『停損警戒』代表破線轉弱，一定要遵守紀律保本為上！"
  },
  "support_loss": {
    term: "關鍵防守價（關鍵支撐 / 停損點）",
    plain: "【股價跌下來時的彈簧床與地板！】大戶法人通常會在某些重要價位（如月線、前波低點）防守。一旦股價跌破這個底線，就像踩破地板一樣，下方可能深不見底！",
    action: "【小白保命最重要的心法】收盤如果有效跌破這個關鍵防守價，建議壯士斷腕嚴格停損！寧可小賠幾千元，也絕對不要變成套牢幾十萬的萬年冤大頭。"
  },
  "notes": {
    term: "股票專屬備忘與操作策略",
    plain: "【每檔股票專屬的作戰筆記本！】每個人對每檔股票的想法不同，有人想領股息、有人想波段停利。按一下『備註』就可以寫下你對這檔股票接下來的計畫！",
    action: "直接儲存在您現在的瀏覽器中，別人看不到，換頁也不會消失。寫下『1050 先賣一半』或『跌到 900 加碼 1 張』，能幫助你克服市場貪婪與恐懼！"
  },
  "stock_type": {
    term: "高息型 vs 價差成長型",
    plain: "【買這檔股票到底是為了領利息，還是賺價差？】<br>💰 <b>高息型</b>：每年固定發放優渥現金（殖利率通常 > 5%），像包租公收房租，股價通常比較穩健。<br>🚀 <b>價差成長型</b>：公司賺的錢拿去再投資建廠（如台積電），股利可能發得少，但股價一漲可能就是翻倍，重點在賺資本利得（價差）！<br>🌱 <b>配股型</b>：除了發現金還送股票（配股），適合張數快速翻倍複利。",
    action: "買之前先想清楚：想每個月領生活費就選『高息型』；想賺幾十萬大波段價差就選『價差成長型』，策略不要混淆！"
  },
  "ma5": {
    term: "5MA（5日均線 / 週線）",
    plain: "【極短線溫度計！】過去 5 個交易日所有買進這檔股票的人的平均成本。5 天剛好是一個禮拜的開盤天數。",
    action: "股價在 5 日線之上代表超短線強勢噴出；一旦跌破 5 日線代表短線衝刺動能趨緩，衝浪客通常會先減碼。"
  },
  "ma20": {
    term: "20MA（生命線：月線 / 20週均線 / 20月均線）",
    plain: "【波段多空的生命線！】<br>• <b>日K看『20MA月線』</b>：過去約 1 個月所有買進者的平均成交成本。<br>• <b>週K看『20週均線』</b>：過去約 5 個月的中期多空分水嶺。<br>• <b>月K看『20月均線』</b>：過去近 2 年的長線大循環基石！",
    action: "只要股價站在 20MA 生命線之上，代表近期的投資人大多獲利，容易延續漲勢（安心續抱）；一旦有效跌破且均線下彎，代表大家開始虧錢逃命，多頭結構轉弱，切忌盲目凹單！"
  },
  "ma60": {
    term: "60MA（60日均線 / 季線）",
    plain: "【中長線大趨勢方向！】過去一季（約 3 個月）的市場平均成本，是大戶與投信法人的多空格局分水嶺。",
    action: "季線走平向上代表中長線大趨勢健康偏多；季線向下彎而且股價在季線下面，千萬不要隨便大筆抄底。"
  },
  "kd": {
    term: "KD 指標（隨機指標）",
    plain: "【短線跑步有沒有衝太快？】由快線 K 與慢線 D 組成，範圍在 0 到 100 之間：<br>• K > 80（超買區）：代表衝刺衝太兇，短線隨時會喘口氣拉回回檔。<br>• K < 20（超賣區）：代表被打太慘跌過頭，隨時會出現反彈跌深反彈。<br>• 黃金交叉（K往上穿過D）：通常是短線轉強買進訊號；死亡交叉（K往下跌破D）則是轉弱賣出訊號。",
    action: "高檔鈍化時不用自己嚇自己，但若看到高檔死亡交叉且跌破短均線，短線可先落袋為安。"
  },
  "rsi": {
    term: "RSI 強弱指標（相對強弱指標）",
    plain: "【買方跟賣方拔河誰力氣大！】數值介於 0 到 100：<br>• RSI > 70：買方力氣非常猛烈，但有點過熱。<br>• RSI < 30：賣方力氣佔上風，但可能過度恐慌甩轎。",
    action: "搭配趨勢使用，強勢股拉回 RSI 來到 50 附近守穩，往往是波段很好的切入點。"
  },
  "chips": {
    term: "三大法人籌碼（外資 / 投信 / 自營商）",
    plain: "【市場上的三隻超級大鯨魚！】<br>• 外資：國外的超大機構資金，資金最雄厚。<br>• 投信：台灣國內基金經理人，選股精準、最懂中小型飆股與認養作帳！<br>• 自營商：證券商自己的操盤部，通常愛做極短線沖銷。",
    action: "【主力密碼】只要看到『外資 + 投信同買（土洋齊買）』連續好幾天，通常股價易漲難跌；若雙方聯手大賣，一定要提防大戶出貨！"
  },
  "resistance": {
    term: "短線壓力（天花板）",
    plain: "【股價往上撞到的天花板！】以前很多人在那個價格買進被套牢，現在股價漲回那個價位，那些被套牢的人終於能解套，紛紛急著賣掉換現金，造成上方一堆賣壓。",
    action: "若挑戰壓力位但沒有足夠的成交量（量縮），很容易被敲下來，這時候切忌追高；唯有『帶大成交量突破』才是強勢發動訊號！"
  },
  "support": {
    term: "關鍵支撐（防守地板價）",
    plain: "【股價跌下來時的彈簧床與地板！】大戶或買方通常會在某些重要價位（如月線、前波低點）進場承接。只要股價沒跌破這個地板，代表多頭防守意志堅定！",
    action: "只要股價守在關鍵支撐之上，就可以安心續抱；一旦收盤跌破關鍵支撐，代表多頭防線失守，請嚴格執行防守或停損減碼，切勿心存僥倖！"
  },
  "bias": {
    term: "乖離率 (BIAS)",
    plain: "【牽著小狗散步的皮帶！】股價就像小狗，月線就像主人。小狗往前跑太遠（正乖離過大），皮帶拉緊了早晚要回頭跑回主人身邊；被踹太遠（負乖離過大），也會彈回主人身邊。",
    action: "正乖離率太高（例如股價距離 20MA 超過 8%~10%）時千萬不要衝動追高，容易買在最高點；等它拉回靠近主人（均線）再買最安全。"
  }
};

// -------------------------------------------------------------
// 股票特性膠囊標籤判斷 (高息型 / 價差成長 / 股利配股)
// -------------------------------------------------------------
function getStockStrategyTag(stock) {
  const code = String(stock.code || "").trim();
  const name = String(stock.name || "").trim();
  const y = Number(stock.dividend_yield || 0);

  // 1. 配股型（股票股利代表）
  const stockDivCodes = ["2884", "2834", "2812", "5880", "2886", "2801"];
  if (stockDivCodes.includes(code)) {
    return {
      type: "stock-div",
      className: "type-stock-div",
      icon: "🌱",
      label: "配股複利",
      tooltip: "本檔常年有股票股利（配股），適合長期靠配股張數自我繁殖複利！"
    };
  }

  // 2. 高息型（高殖利率或高股息ETF）
  if (name.includes("高股息") || name.includes("高息") || ["0056", "00878", "00919", "00929", "00713", "00940", "00934", "00936"].includes(code) || y >= 4.5) {
    return {
      type: "income",
      className: "type-income",
      icon: "💰",
      label: "高息型",
      tooltip: `現金殖利率約 ${y}%，著重穩定領取現金股利，防守收息為主！`
    };
  }

  // 3. 價差成長型（科技股、權值成長股）
  if (["2330", "2454", "2382", "3231", "2317", "2308", "3035", "6669", "3443", "3661"].includes(code) || y < 3.5) {
    return {
      type: "growth",
      className: "type-growth",
      icon: "🚀",
      label: "價差成長",
      tooltip: "著重營收獲利爆發力與股價漲幅（資本利得），目標是賺取波段大價差而非死存領息！"
    };
  }

  // 4. 穩健收息
  return {
    type: "income",
    className: "type-income",
    icon: "💵",
    label: "穩健收息",
    tooltip: `殖利率約 ${y}%，具有穩定營運與防禦收息特性。`
  };
}

// -------------------------------------------------------------
// 個人股票獨立備忘錄 (LocalStorage) 管理
// -------------------------------------------------------------
function getStockNote(code) {
  try {
    const raw = localStorage.getItem(`stock_note_${code}`);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

function saveStockNote(code, noteText) {
  try {
    const data = {
      note: noteText.trim(),
      updated_at: new Date().toLocaleString('zh-TW', { hour12: false })
    };
    localStorage.setItem(`stock_note_${code}`, JSON.stringify(data));
    return data;
  } catch (e) {}
  return null;
}

function deleteStockNote(code) {
  try {
    localStorage.removeItem(`stock_note_${code}`);
  } catch (e) {}
}

let activeEditingNoteCode = null;
let activeEditingNoteName = null;

function openStockNoteModal(code, name) {
  activeEditingNoteCode = String(code).trim();
  activeEditingNoteName = name || code;

  const modal = document.getElementById("stockNoteModal");
  const titleEl = document.getElementById("noteModalStockTitle");
  const textarea = document.getElementById("stockNoteTextarea");
  const savedTimeEl = document.getElementById("noteSavedTime");

  if (!modal || !textarea) return;

  titleEl.textContent = `📝 【${activeEditingNoteCode} ${activeEditingNoteName}】個人操作策略與備忘`;
  const existing = getStockNote(activeEditingNoteCode);
  if (existing && existing.note) {
    textarea.value = existing.note;
    savedTimeEl.textContent = `最後儲存時間: ${existing.updated_at}`;
  } else {
    textarea.value = "";
    savedTimeEl.textContent = "尚未儲存備忘";
  }

  modal.classList.add("active");
  textarea.focus();
}

function closeStockNoteModal() {
  const modal = document.getElementById("stockNoteModal");
  if (modal) modal.classList.remove("active");
  activeEditingNoteCode = null;
  activeEditingNoteName = null;
}

// -------------------------------------------------------------
// 小白術語大白話視窗 (Glossary Modal)
// -------------------------------------------------------------
function openGlossaryModal(termKey) {
  const modal = document.getElementById("glossaryModal");
  if (!modal) return;

  const g = STOCK_GLOSSARY[termKey] || {
    term: "股市名詞",
    plain: "此名詞專為投資人量化分析設計，請參考相關數值變化。",
    action: "建議搭配均線防守價與法人籌碼同步觀察。"
  };

  const nameEl = document.getElementById("glossaryTermName");
  const plainEl = document.getElementById("glossaryPlainExplain");
  const actionEl = document.getElementById("glossaryActionAdvice");

  if (nameEl) nameEl.textContent = g.term;
  if (plainEl) plainEl.innerHTML = g.plain.replace(/\n/g, '<br>');
  if (actionEl) actionEl.innerHTML = g.action.replace(/\n/g, '<br>');

  modal.classList.add("active");
}

function closeGlossaryModal() {
  const modal = document.getElementById("glossaryModal");
  if (modal) modal.classList.remove("active");
}

function loadFromLocalInstantCache() {
  try {
    const rawMacro = localStorage.getItem(LS_MACRO_KEY);
    if (rawMacro) {
      const data = JSON.parse(rawMacro);
      renderMacro(data);
    }
    const rawPort = localStorage.getItem(LS_PORTFOLIOS_KEY);
    if (rawPort) {
      const data = JSON.parse(rawPort);
      currentPortfolios = data;
      renderPersonTabs();
      renderActiveTabContent();
      const syncStatus = document.getElementById("syncText");
      if (syncStatus) {
        syncStatus.textContent = `🟢 已即時載入 (背景同步最新報價中...)`;
      }
    }
  } catch (e) {
    console.warn("Instant cache load warning:", e);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // 1. Immediately render cached data in 0.001s so user NEVER waits
  loadFromLocalInstantCache();
  
  // 2. Setup listeners & fetch fresh data in background
  initApp();
  setupEventListeners();
});

async function initApp() {
  // Preload default stock chart in background without popping modal
  loadStockDetail(activeStockCode, null, false);

  // Smoothly fetch fresh data from backend
  await Promise.all([
    loadMacroData(),
    loadPortfolioData()
  ]);
}

function setupEventListeners() {
  document.getElementById("btnSyncSheet").addEventListener("click", () => {
    loadPortfolioData(true);
  });

  // Account dropdown switcher
  const dropdown = document.getElementById("accountDropdown");
  if (dropdown) {
    dropdown.addEventListener("change", (e) => {
      switchTab(e.target.value);
    });
  }

  document.getElementById("btnStockSearch").addEventListener("click", () => {
    const code = document.getElementById("stockSearchInput").value.trim();
    if (code) {
      loadStockDetail(code);
    }
  });

  document.getElementById("stockSearchInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      const code = e.target.value.trim();
      if (code) {
        loadStockDetail(code);
      }
    }
  });

  // Watchlist custom adder
  const btnAdd = document.getElementById("btnAddWatchlist");
  const inputAdd = document.getElementById("inputAddWatchlist");
  if (btnAdd && inputAdd) {
    const doAdd = () => {
      const code = inputAdd.value.trim();
      if (code) {
        addNewWatchlistStock(code);
        inputAdd.value = "";
      }
    };
    btnAdd.addEventListener("click", doAdd);
    inputAdd.addEventListener("keypress", (e) => {
      if (e.key === "Enter") doAdd();
    });
  }

  // Quick tag pills in watchlist
  document.querySelectorAll(".tag-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      const code = pill.getAttribute("data-code");
      const name = pill.getAttribute("data-name");
      addNewWatchlistStock(code, name);
    });
  });

  // Stock Detail Modal Controls (點擊股票展開大視窗)
  const stockModal = document.getElementById("stockModal");
  const btnCloseStockModal = document.getElementById("btnCloseStockModal");

  function openStockModal() {
    if (stockModal) {
      stockModal.classList.add("active");
      if (chartInstance) {
        setTimeout(() => chartInstance.resize(), 80);
        setTimeout(() => chartInstance.resize(), 260);
      }
    }
  }

  function closeStockModal() {
    if (stockModal) {
      stockModal.classList.remove("active");
    }
  }

  // Export functions to global scope
  window.openStockModal = openStockModal;
  window.closeStockModal = closeStockModal;

  if (btnCloseStockModal) {
    btnCloseStockModal.addEventListener("click", closeStockModal);
  }

  if (stockModal) {
    stockModal.addEventListener("click", (e) => {
      if (e.target === stockModal) {
        closeStockModal();
      }
    });
  }

  // Global Escape key: closes stock modal, note modal, glossary modal, or bot modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const stockModal = document.getElementById("stockModal");
      const noteModal = document.getElementById("stockNoteModal");
      const glossaryModal = document.getElementById("glossaryModal");
      const botModal = document.getElementById("botModal");

      if (glossaryModal && glossaryModal.classList.contains("active")) {
        closeGlossaryModal();
      } else if (noteModal && noteModal.classList.contains("active")) {
        closeStockNoteModal();
      } else if (stockModal && stockModal.classList.contains("active")) {
        closeStockModal();
      } else if (botModal && botModal.classList.contains("active")) {
        botModal.classList.remove("active");
      }
    }
  });

  // Setup Sort Headers on Stock Table
  function setupSortHeaders() {
    document.querySelectorAll("th.th-sortable").forEach(th => {
      th.addEventListener("click", (e) => {
        if (e.target.closest(".term-help")) return;

        const sortKey = th.getAttribute("data-sort");
        if (!sortKey) return;

        if (currentSort.key === sortKey) {
          currentSort.order = (currentSort.order === 'asc' ? 'desc' : 'asc');
        } else {
          currentSort.key = sortKey;
          // 代號與名稱預設升冪(小到大)，其他數值預設降冪(大到小)
          currentSort.order = (sortKey === 'code' || sortKey === 'owner' || sortKey === 'action_label') ? 'asc' : 'desc';
        }

        document.querySelectorAll("th.th-sortable").forEach(h => {
          const icon = h.querySelector(".sort-icon");
          h.classList.remove("sorted-asc", "sorted-desc");
          if (icon) icon.textContent = "↕";
        });

        th.classList.add(currentSort.order === 'asc' ? 'sorted-asc' : 'sorted-desc');
        const curIcon = th.querySelector(".sort-icon");
        if (curIcon) {
          curIcon.textContent = (currentSort.order === 'asc' ? '▲' : '▼');
        }

        renderActiveTabContent();
      });
    });
  }
  setupSortHeaders();

  // Stock Note Modal Buttons & Quick Tags
  const noteModal = document.getElementById("stockNoteModal");
  const btnCloseNoteModal = document.getElementById("btnCloseNoteModal");
  const btnCancelNoteModal = document.getElementById("btnCancelNoteModal");
  const btnSaveStockNote = document.getElementById("btnSaveStockNote");
  const btnClearNote = document.getElementById("btnClearNote");
  const textareaNote = document.getElementById("stockNoteTextarea");

  if (btnCloseNoteModal) btnCloseNoteModal.addEventListener("click", closeStockNoteModal);
  if (btnCancelNoteModal) btnCancelNoteModal.addEventListener("click", closeStockNoteModal);
  if (noteModal) {
    noteModal.addEventListener("click", (e) => {
      if (e.target === noteModal) closeStockNoteModal();
    });
  }

  // Quick Strategy Tags in Note Modal
  document.querySelectorAll(".btn-quick-note").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!textareaNote) return;
      const textToInsert = btn.getAttribute("data-insert") || btn.textContent.trim();
      if (textareaNote.value.trim().length > 0) {
        textareaNote.value += `\n• ${textToInsert}：`;
      } else {
        textareaNote.value = `• ${textToInsert}：`;
      }
      textareaNote.focus();
    });
  });

  if (btnSaveStockNote) {
    btnSaveStockNote.addEventListener("click", () => {
      if (!activeEditingNoteCode || !textareaNote) return;
      const content = textareaNote.value.trim();
      if (content) {
        saveStockNote(activeEditingNoteCode, content);
      } else {
        deleteStockNote(activeEditingNoteCode);
      }
      closeStockNoteModal();
      // Re-render table to immediately reflect note indicator and tooltip
      renderActiveTabContent();
    });
  }

  if (btnClearNote) {
    btnClearNote.addEventListener("click", () => {
      if (!activeEditingNoteCode || !textareaNote) return;
      if (confirm(`確定要清空股票 ${activeEditingNoteCode} 的備忘紀錄嗎？`)) {
        deleteStockNote(activeEditingNoteCode);
        textareaNote.value = "";
        const savedTimeEl = document.getElementById("noteSavedTime");
        if (savedTimeEl) savedTimeEl.textContent = "已清空備忘";
        renderActiveTabContent();
      }
    });
  }

  // Glossary Modal Buttons
  const glossaryModal = document.getElementById("glossaryModal");
  const btnCloseGlossaryModal = document.getElementById("btnCloseGlossaryModal");
  const btnOkGlossaryModal = document.getElementById("btnOkGlossaryModal");

  if (btnCloseGlossaryModal) btnCloseGlossaryModal.addEventListener("click", closeGlossaryModal);
  if (btnOkGlossaryModal) btnOkGlossaryModal.addEventListener("click", closeGlossaryModal);
  if (glossaryModal) {
    glossaryModal.addEventListener("click", (e) => {
      if (e.target === glossaryModal) closeGlossaryModal();
    });
  }

  // Global delegation for glossary term clicks (❓ and clickable terms)
  document.addEventListener("click", (e) => {
    const termTarget = e.target.closest("[data-term]");
    if (termTarget) {
      e.stopPropagation();
      const termKey = termTarget.getAttribute("data-term");
      if (termKey) openGlossaryModal(termKey);
    }
  });

  // Timeframe selector (日K / 週K / 月K 切換)
  document.querySelectorAll(".timeframe-selector .tf-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const newTf = btn.getAttribute("data-tf");
      if (!newTf || newTf === currentStockTimeframe) return;
      document.querySelectorAll(".timeframe-selector .tf-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentStockTimeframe = newTf;
      if (activeStockCode) {
        loadStockDetail(activeStockCode, activeHoldingContext, false);
      }
    });
  });

  // Cash Reserve Input Listener for Asset Risk Allocation
  const cashInput = document.getElementById("inputCashReserve");
  if (cashInput) {
    cashInput.addEventListener("input", () => {
      if (window._currentHoldings && window._currentTotalVal) {
        renderSectorRiskDashboard(window._currentHoldings, window._currentTotalVal);
      }
    });
  }


  // Sheet Config Modal controls
  const sheetConfigModal = document.getElementById("sheetConfigModal");
  const btnConfigSheet = document.getElementById("btnConfigSheet");
  const btnCloseSheetModal = document.getElementById("btnCloseSheetModal");
  const btnCancelSheetModal = document.getElementById("btnCancelSheetModal");
  const btnSaveSheetConfig = document.getElementById("btnSaveSheetConfig");
  const btnResetDefaultSheet = document.getElementById("btnResetDefaultSheet");
  const customSheetUrlInput = document.getElementById("customSheetUrlInput");

  if (btnConfigSheet) {
    btnConfigSheet.addEventListener("click", () => {
      const savedUrl = localStorage.getItem("my_custom_sheet_url") || "";
      if (customSheetUrlInput) customSheetUrlInput.value = savedUrl;
      sheetConfigModal.classList.add("active");
    });
  }

  function closeSheetModal() {
    if (sheetConfigModal) sheetConfigModal.classList.remove("active");
  }

  if (btnCloseSheetModal) btnCloseSheetModal.addEventListener("click", closeSheetModal);
  if (btnCancelSheetModal) btnCancelSheetModal.addEventListener("click", closeSheetModal);

  if (sheetConfigModal) {
    sheetConfigModal.addEventListener("click", (e) => {
      if (e.target === sheetConfigModal) closeSheetModal();
    });
  }

  if (btnSaveSheetConfig) {
    btnSaveSheetConfig.addEventListener("click", () => {
      const url = customSheetUrlInput.value.trim();
      if (!url) {
        alert("請輸入有效的 Google 試算表網址，或點選下方「重設為預設範例表」。");
        return;
      }
      localStorage.setItem("my_custom_sheet_url", url);
      // Clear instant cache to force re-fetch from user's custom sheet
      localStorage.removeItem(LS_PORTFOLIOS_KEY);
      closeSheetModal();
      loadPortfolioData(true);
    });
  }

  if (btnResetDefaultSheet) {
    btnResetDefaultSheet.addEventListener("click", () => {
      if (confirm("確定要重設並切換回系統內建的預設範例試算表嗎？")) {
        localStorage.removeItem("my_custom_sheet_url");
        localStorage.removeItem(LS_PORTFOLIOS_KEY);
        if (customSheetUrlInput) customSheetUrlInput.value = "";
        closeSheetModal();
        loadPortfolioData(true);
      }
    });
  }
}

function addNewWatchlistStock(code, name = null) {
  const cleanCode = code.trim().toUpperCase();
  if (watchlistStocks.some(s => s.code === cleanCode)) {
    alert(`代號 ${cleanCode} 已在觀察名單中！`);
    return;
  }
  watchlistStocks.unshift({
    code: cleanCode,
    name: name || cleanCode,
    note: "自選新增"
  });
  saveWatchlist(watchlistStocks);
  renderPersonTabs();
  renderWatchlistView();
}

function removeWatchlistStock(code) {
  watchlistStocks = watchlistStocks.filter(s => s.code !== code);
  saveWatchlist(watchlistStocks);
  renderPersonTabs();
  renderWatchlistView();
}

// Load Global Macro & Morning Sentiment
async function loadMacroData() {
  try {
    const res = await fetch("/api/macro");
    const data = await res.json();
    renderMacro(data);
    try {
      localStorage.setItem(LS_MACRO_KEY, JSON.stringify(data));
    } catch(e) {}
  } catch (err) {
    console.error("Macro data error:", err);
  }
}

function renderMacro(data) {
  const biasBadge = document.getElementById("macroBiasBadge");
  biasBadge.textContent = `${data.bias_label} (${data.sentiment_score > 0 ? '+' : ''}${data.sentiment_score}分)`;
  biasBadge.style.color = data.bias_color;
  biasBadge.style.borderColor = data.bias_color;
  biasBadge.style.backgroundColor = `${data.bias_color}25`;

  document.getElementById("morningBriefingText").textContent = data.summary;

  const grid = document.getElementById("macroGrid");
  grid.innerHTML = "";

  data.items.forEach(item => {
    const isUp = item.pct_change > 0;
    const isDown = item.pct_change < 0;
    const colorClass = isUp ? "color-up" : (isDown ? "color-down" : "color-flat");
    const prefix = isUp ? "+" : "";
    const changeVal = (item.change !== undefined && item.change !== null) ? Number(item.change) : 0;
    const changeSign = changeVal > 0 ? "+" : "";
    const changePtsStr = `${changeSign}${changeVal.toLocaleString()}`;
    const pctStr = `${prefix}${item.pct_change}%`;

    const card = document.createElement("div");
    card.className = "macro-card";
    card.innerHTML = `
      <div class="macro-card-title">${item.name}</div>
      <div class="macro-card-price">${item.price.toLocaleString()}</div>
      <div class="macro-card-change ${colorClass}">
        <span class="change-pts">${changePtsStr}</span>
        <span class="change-pct">(${pctStr})</span>
      </div>
    `;
    grid.appendChild(card);
  });
}

// Load Portfolio Data from Google Sheets
async function loadPortfolioData(forceSync = false) {
  const syncStatus = document.getElementById("syncText");
  const btnSync = document.getElementById("btnSyncSheet");
  if (forceSync) {
    syncStatus.textContent = "正在同步 Google 試算表...";
    btnSync.classList.add("loading");
  }

  const customUrl = localStorage.getItem("my_custom_sheet_url") || "";
  let apiUrl = `/api/portfolios?force_sync=${forceSync}`;
  if (customUrl) {
    apiUrl += `&sheet_url=${encodeURIComponent(customUrl)}`;
  }

  try {
    const res = await fetch(apiUrl);
    const data = await res.json();
    currentPortfolios = data;
    try {
      localStorage.setItem(LS_PORTFOLIOS_KEY, JSON.stringify(data));
    } catch(e) {}
    const isCustom = !!customUrl;
    syncStatus.textContent = `🟢 已連線${isCustom ? '個人' : ''}試算表 (更新: ${data.synced_at.split(' ')[1]})`;
    renderPersonTabs();
    renderActiveTabContent();
  } catch (err) {
    syncStatus.textContent = "試算表連線失敗";
    console.error("Error loading portfolios:", err);
  } finally {
    btnSync.classList.remove("loading");
  }
}

// Render dynamic tabs: [全部總覽], [阿良], [甘露涓], [景維], [阿輝], [未持股觀察名單]
function renderPersonTabs() {
  if (!currentPortfolios) return;
  const tabsContainer = document.getElementById("personTabs");
  const dropdown = document.getElementById("accountDropdown");
  tabsContainer.innerHTML = "";

  // Dropdown options
  if (dropdown) {
    dropdown.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "all";
    optAll.textContent = `👨‍👩‍👧‍👦 全部合併總覽 (${currentPortfolios.aggregate.holdings.length}檔)`;
    dropdown.appendChild(optAll);

    currentPortfolios.persons.forEach(person => {
      const p = currentPortfolios.portfolios[person];
      const opt = document.createElement("option");
      opt.value = person;
      opt.textContent = `👤 ${person} (${p ? p.holdings.length : 0}檔)`;
      dropdown.appendChild(opt);
    });

    const optWatch = document.createElement("option");
    optWatch.value = "watchlist";
    optWatch.textContent = `🎯 未持股觀察雷達 (${watchlistStocks.length}檔)`;
    dropdown.appendChild(optWatch);

    dropdown.value = currentTab;
  }

  // 1. All tab button
  const allCount = currentPortfolios.aggregate.holdings.length;
  const allBtn = document.createElement("button");
  allBtn.className = `tab-btn ${currentTab === "all" ? "active" : ""}`;
  allBtn.innerHTML = `
    <span class="tab-icon">👨‍👩‍👧‍👦</span>
    <span class="tab-text">全部合併總覽</span>
    <span class="tab-badge-count">${allCount}檔</span>
  `;
  allBtn.addEventListener("click", () => switchTab("all"));
  tabsContainer.appendChild(allBtn);

  // 2. Individual person tab buttons (阿良, 甘露涓, 景維, 阿輝)
  currentPortfolios.persons.forEach(person => {
    const p = currentPortfolios.portfolios[person];
    const pCount = p ? p.holdings.length : 0;
    const btn = document.createElement("button");
    btn.className = `tab-btn ${currentTab === person ? "active" : ""}`;
    btn.innerHTML = `
      <span class="tab-icon">👤</span>
      <span class="tab-text">${person}</span>
      <span class="tab-badge-count">${pCount}檔</span>
    `;
    btn.addEventListener("click", () => switchTab(person));
    tabsContainer.appendChild(btn);
  });

  // 3. Watchlist tab button
  const watchBtn = document.createElement("button");
  watchBtn.className = `tab-btn watchlist-tab ${currentTab === "watchlist" ? "active" : ""}`;
  watchBtn.innerHTML = `
    <span class="tab-icon">🎯</span>
    <span class="tab-text">未持股觀察雷達</span>
    <span class="tab-badge-count">${watchlistStocks.length}檔</span>
  `;
  watchBtn.addEventListener("click", () => switchTab("watchlist"));
  tabsContainer.appendChild(watchBtn);
}

function switchTab(tabId) {
  currentTab = tabId;
  const dropdown = document.getElementById("accountDropdown");
  if (dropdown) {
    dropdown.value = tabId;
  }
  renderPersonTabs();
  renderActiveTabContent();
}

function renderActiveTabContent() {
  if (!currentPortfolios) return;

  const thOwner = document.getElementById("thOwner");
  const tbody = document.getElementById("stockTableBody");
  const bannerTitle = document.getElementById("bannerAccountTitle");
  const wlToolbar = document.getElementById("watchlistToolbar");
  tbody.innerHTML = "";

  if (wlToolbar) {
    wlToolbar.style.display = (currentTab === "watchlist") ? "block" : "none";
  }

  if (currentTab === "watchlist") {
    if (bannerTitle) {
      bannerTitle.textContent = `【未持股觀察雷達】目前追蹤 ${watchlistStocks.length} 檔優質標的（嚴格把關進場買點與損益比，可自由新增/移除股票）`;
    }
    renderWatchlistView();
    return;
  }

  let totalCost = 0;
  let totalVal = 0;
  let totalPnL = 0;
  let totalROI = 0;
  let totalAnnualDiv = 0;
  let portfolioYield = 0;
  let holdings = [];

  if (currentTab === "all") {
    thOwner.style.display = "";
    document.getElementById("tableSectionTitle").textContent = "家族全部合併持股體檢總覽";
    const agg = currentPortfolios.aggregate;
    totalCost = agg.total_cost;
    totalVal = agg.total_market_value;
    totalPnL = agg.total_pnl;
    totalROI = agg.total_roi_pct;
    totalAnnualDiv = agg.total_annual_dividend || 0;
    portfolioYield = agg.portfolio_yield || 0;
    holdings = agg.holdings;

    if (bannerTitle) {
      const personListStr = currentPortfolios.persons ? currentPortfolios.persons.join("、") : "";
      const personCount = currentPortfolios.persons ? currentPortfolios.persons.length : 0;
      bannerTitle.textContent = `【全部合併總覽】包含 ${personListStr} 共 ${personCount} 個帳戶（合計 ${holdings.length} 檔持股，總市值 NT$ ${totalVal.toLocaleString()} 元，每年預估股利 NT$ ${totalAnnualDiv.toLocaleString()} 元）`;
    }
  } else {
    thOwner.style.display = "none";
    document.getElementById("tableSectionTitle").textContent = `【${currentTab}】專屬持股健康度與決策清單`;
    const p = currentPortfolios.portfolios[currentTab];
    if (p) {
      totalCost = p.total_cost;
      totalVal = p.total_market_value;
      totalPnL = p.total_pnl;
      totalROI = p.total_roi_pct;
      totalAnnualDiv = p.total_annual_dividend || 0;
      portfolioYield = p.portfolio_yield || 0;
      holdings = p.holdings;
    }

    if (bannerTitle) {
      const isProfit = totalPnL >= 0;
      bannerTitle.textContent = `【${currentTab}】專屬個人持股（共 ${holdings.length} 檔標的，累計成本 NT$ ${totalCost.toLocaleString()} 元，目前損益: ${isProfit ? '+' : ''}NT$ ${totalPnL.toLocaleString()} 元 / ${isProfit ? '+' : ''}${totalROI}%，預估年領股利 NT$ ${totalAnnualDiv.toLocaleString()} 元）`;
    }
  }

  // Update Summary Cards
  document.getElementById("valTotalCost").textContent = `NT$ ${totalCost.toLocaleString()}`;
  document.getElementById("valTotalValue").textContent = `NT$ ${totalVal.toLocaleString()}`;
  
  const pnlEl = document.getElementById("valTotalPnL");
  const roiEl = document.getElementById("valTotalROI");
  const isProfit = totalPnL >= 0;
  
  pnlEl.textContent = `${isProfit ? '+' : ''}NT$ ${totalPnL.toLocaleString()}`;
  pnlEl.className = `card-value ${isProfit ? 'color-up' : 'color-down'}`;
  
  roiEl.textContent = `${isProfit ? '+' : ''}${totalROI}%`;
  roiEl.className = `card-value ${isProfit ? 'color-up' : 'color-down'}`;

  // Dividend Card
  document.getElementById("valTotalDividend").textContent = `NT$ ${totalAnnualDiv.toLocaleString()}`;
  document.getElementById("subTotalDividend").textContent = `平均年化殖利率 ${portfolioYield}%`;

  document.getElementById("tableCountBadge").textContent = `共 ${holdings.length} 檔`;

  // Sort holdings according to user selection
  function sortHoldingList(list) {
    if (!currentSort.key || !Array.isArray(list)) return list;
    const { key, order } = currentSort;
    const isAsc = (order === 'asc');

    return [...list].sort((a, b) => {
      let valA = a[key];
      let valB = b[key];

      if (key === 'code') {
        valA = String(a.code || "");
        valB = String(b.code || "");
        return isAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      if (key === 'owner') {
        valA = String(a.owner || "");
        valB = String(b.owner || "");
        return isAsc ? valA.localeCompare(valB, 'zh-TW') : valB.localeCompare(valA, 'zh-TW');
      }
      if (key === 'action_label') {
        valA = String(a.action_label || "");
        valB = String(b.action_label || "");
        return isAsc ? valA.localeCompare(valB, 'zh-TW') : valB.localeCompare(valA, 'zh-TW');
      }

      valA = (valA !== undefined && valA !== null && !isNaN(valA)) ? Number(valA) : -99999999;
      valB = (valB !== undefined && valB !== null && !isNaN(valB)) ? Number(valB) : -99999999;
      return isAsc ? (valA - valB) : (valB - valA);
    });
  }

  const sortedHoldings = sortHoldingList(holdings);

  // Render Table Rows
  sortedHoldings.forEach((h) => {
    const tr = document.createElement("tr");
    if (h.code === activeStockCode) {
      tr.classList.add("selected");
    }

    const isHProfit = h.pnl >= 0;
    const pnlClass = isHProfit ? "color-up" : "color-down";
    const changeClass = h.change >= 0 ? "color-up" : "color-down";
    const stratTag = getStockStrategyTag(h);
    const existingNote = getStockNote(h.code);
    const hasNote = existingNote && existingNote.note;
    const notePreview = hasNote ? `備忘: ${existingNote.note}` : "點擊填寫個人操作策略備忘";

    tr.innerHTML = `
      <td>
        <div class="stock-code-cell">
          <span class="code">${h.code}</span>
          <div class="stock-title-badge-row">
            <span class="name">${h.name}</span>
            <span class="badge-stock-type ${stratTag.className}" data-term="stock_type" title="${stratTag.tooltip}">
              ${stratTag.icon} ${stratTag.label}
            </span>
          </div>
        </div>
      </td>
      ${currentTab === "all" ? `<td class="td-owner"><span class="pill-info">${h.owner || '-'}</span></td>` : ""}
      <td class="stock-num">${h.shares.toLocaleString()}</td>
      <td class="stock-num">${h.cost_price.toLocaleString()}</td>
      <td class="stock-num font-bold">${h.current_price.toLocaleString()}</td>
      <td class="stock-num ${changeClass}">${h.change >= 0 ? '+' : ''}${h.change} (${h.pct_change >= 0 ? '+' : ''}${h.pct_change}%)</td>
      <td class="stock-num ${pnlClass}">${isHProfit ? '+' : ''}${h.pnl.toLocaleString()}</td>
      <td class="stock-num ${pnlClass}">${isHProfit ? '+' : ''}${h.roi_pct}%</td>
      <td class="stock-num color-gold font-bold">${h.dividend_yield ? h.dividend_yield + '%' : '-'}</td>
      <td class="stock-num color-up">NT$ ${h.est_annual_dividend ? h.est_annual_dividend.toLocaleString() : '0'}</td>
      <td>
        <span class="action-badge" style="background: ${h.action_color}25; color: ${h.action_color}; border: 1px solid ${h.action_color}50">
          ${h.action_label}
        </span>
      </td>
      <td class="stock-num color-down">${h.stop_loss}</td>
      <td>
        <button class="btn-note-view ${hasNote ? 'has-note' : ''}" data-code="${h.code}" data-name="${h.name}" title="${notePreview}">
          📝 ${hasNote ? '備註(已填)' : '備註'}
        </button>
      </td>
    `;

    // 點擊整列開啟走勢線圖
    tr.addEventListener("click", () => {
      document.querySelectorAll("#stockTableBody tr").forEach(r => r.classList.remove("selected"));
      tr.classList.add("selected");
      activeStockCode = h.code;
      activeHoldingContext = h;
      loadStockDetail(h.code, h, true);
    });

    // 點擊備註按鈕開啟備忘視窗，阻止事件冒泡！
    const btnNote = tr.querySelector(".btn-note-view");
    if (btnNote) {
      btnNote.addEventListener("click", (e) => {
        e.stopPropagation(); // 阻止開啟線圖
        openStockNoteModal(h.code, h.name);
      });
    }

    // 點擊特性標籤觸發小白名詞說明
    const badgeType = tr.querySelector(".badge-stock-type");
    if (badgeType) {
      badgeType.addEventListener("click", (e) => {
        e.stopPropagation();
        openGlossaryModal("stock_type");
      });
    }

    tbody.appendChild(tr);
  });

  // Store references for live cash input updates
  window._currentHoldings = sortedHoldings;
  window._currentTotalVal = totalVal;

  // Render Sector Exposure & Asset Risk Management Dashboard
  renderSectorRiskDashboard(sortedHoldings, totalVal);
}

// Render Sector Exposure & Asset Risk Management Dashboard
function renderSectorRiskDashboard(holdings, totalVal) {
  const section = document.getElementById("sectorRiskSection");
  if (!section) return;

  if (!holdings || holdings.length === 0 || totalVal <= 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";

  // Account tag
  const tagEl = document.getElementById("riskAccountTag");
  if (tagEl) {
    tagEl.textContent = (currentTab === "all") ? "全部合併總覽" : `【${currentTab}】帳戶`;
  }

  // Calculate sector weights
  const sectorTotals = {};
  holdings.forEach(h => {
    const sector = getStockSector(h.code, h.name);
    const mVal = (h.current_price || h.cost_price || 0) * (h.shares || 0);
    sectorTotals[sector] = (sectorTotals[sector] || 0) + mVal;
  });

  const sectorList = Object.keys(sectorTotals)
    .map(s => ({
      name: s,
      val: sectorTotals[s],
      pct: totalVal > 0 ? (sectorTotals[s] / totalVal) * 100 : 0,
      color: SECTOR_COLORS[s] || "#64748b"
    }))
    .sort((a, b) => b.val - a.val);

  // Center Value
  const centerValEl = document.getElementById("riskCenterValue");
  if (centerValEl) {
    centerValEl.textContent = `NT$ ${Math.round(totalVal / 10000)}萬`;
  }

  // Draw Doughnut Chart
  const canvas = document.getElementById("sectorDoughnutCanvas");
  if (canvas) {
    const ctx = canvas.getContext("2d");
    if (sectorDoughnutChart) {
      sectorDoughnutChart.destroy();
    }
    sectorDoughnutChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: sectorList.map(s => s.name),
        datasets: [{
          data: sectorList.map(s => s.val),
          backgroundColor: sectorList.map(s => s.color),
          borderWidth: 2,
          borderColor: "#0f172a",
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "70%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const item = sectorList[ctx.dataIndex];
                return ` ${item.name}: NT$ ${Math.round(item.val).toLocaleString()} 元 (${item.pct.toFixed(1)}%)`;
              }
            }
          }
        }
      }
    });
  }

  // Render Bars List
  const barsContainer = document.getElementById("sectorBarsList");
  if (barsContainer) {
    barsContainer.innerHTML = sectorList.map(s => `
      <div class="sector-bar-row">
        <div class="sector-bar-meta">
          <div class="sector-name-box">
            <span class="sector-color-dot" style="background: ${s.color};"></span>
            <span>${s.name}</span>
          </div>
          <div class="sector-val-box">
            <b>${s.pct.toFixed(1)}%</b> · NT$ ${Math.round(s.val).toLocaleString()}
          </div>
        </div>
        <div class="sector-progress-track">
          <div class="sector-progress-fill" style="width: ${Math.min(100, s.pct)}%; background: ${s.color};"></div>
        </div>
      </div>
    `).join("");
  }

  // Update Cash Reserve and Risk Advice
  updateCashReserveAndRiskAdvice(totalVal, sectorList);
}

function updateCashReserveAndRiskAdvice(totalVal, sectorList) {
  const cashInput = document.getElementById("inputCashReserve");
  const cashValTenThousand = parseFloat(cashInput ? cashInput.value : 50) || 0;
  const cashTotal = cashValTenThousand * 10000;
  const grandTotal = totalVal + cashTotal;

  const stockPct = grandTotal > 0 ? Math.round((totalVal / grandTotal) * 100) : 100;
  const cashPct = 100 - stockPct;

  const pill = document.getElementById("cashRatioPill");
  if (pill) {
    pill.textContent = `股票 ${stockPct}% : 現金 ${cashPct}%`;
  }

  // Risk health check
  const maxSector = sectorList && sectorList.length > 0 ? sectorList[0] : null;
  const healthBadge = document.getElementById("riskHealthBadge");
  const healthText = document.getElementById("riskHealthText");
  const healthIcon = document.getElementById("riskHealthIcon");
  const diagMsg = document.getElementById("riskDiagMessage");

  if (maxSector && maxSector.pct >= 45.0) {
    if (healthBadge) healthBadge.className = "risk-health-badge health-warning";
    if (healthIcon) healthIcon.textContent = "⚠️";
    if (healthText) healthText.textContent = "族群集中度過高";
    if (diagMsg) {
      diagMsg.innerHTML = `⚠️ <b>【族群過度集中警示】</b>目前 <b>${maxSector.name}</b> 族群佔比達 <b>${maxSector.pct.toFixed(1)}%</b>，資金高度偏重單一族群。若遇族群性系統修正回檔波動較劇烈，建議適度將獲利配置至防守型資產或高股息 ETF。`;
    }
  } else if (stockPct >= 90) {
    if (healthBadge) healthBadge.className = "risk-health-badge health-warning";
    if (healthIcon) healthIcon.textContent = "⚠️";
    if (healthText) healthText.textContent = "滿倉現金偏低";
    if (diagMsg) {
      diagMsg.innerHTML = `⚠️ <b>【高水位風控提醒】</b>整體股票部位已達 <b>${stockPct}%</b>，手邊備用現金僅佔 <b>${cashPct}%</b>。建議維持至少 15%~20% 現金儲備，以因應大盤系統性波動。`;
    }
  } else {
    if (healthBadge) healthBadge.className = "risk-health-badge health-good";
    if (healthIcon) healthIcon.textContent = "🛡️";
    if (healthText) healthText.textContent = "族群配置健康";
    if (diagMsg) {
      const topName = maxSector ? maxSector.name : "核心持股";
      const topPct = maxSector ? maxSector.pct.toFixed(1) : "0";
      diagMsg.innerHTML = `🛡️ <b>【資產防守體質優異】</b>最大產業（${topName} ${topPct}%）未超過 45% 警戒線，持股分佈均衡且保有 <b>${cashPct}%</b> 彈性現金，兼具獲利攻擊力與下檔抗震韌性！`;
    }
  }
}

// Watchlist View Handler
async function renderWatchlistView() {
  const sectorSection = document.getElementById("sectorRiskSection");
  if (sectorSection) sectorSection.style.display = "none";

  document.getElementById("thOwner").style.display = "none";
  document.getElementById("tableSectionTitle").textContent = "🎯 未持股買點雷達（進場時機與損益比把關）";
  document.getElementById("tableCountBadge").textContent = `觀察中 ${watchlistStocks.length} 檔`;

  // Summary cards for watchlist
  document.getElementById("valTotalCost").textContent = "觀望中";
  document.getElementById("valTotalValue").textContent = "未投入資金";
  document.getElementById("valTotalPnL").textContent = "0";
  document.getElementById("valTotalPnL").className = "card-value";
  document.getElementById("valTotalROI").textContent = "0.0%";
  document.getElementById("valTotalROI").className = "card-value";
  document.getElementById("valTotalDividend").textContent = "NT$ 0";
  document.getElementById("subTotalDividend").textContent = "等待伺機進場";

  const tbody = document.getElementById("stockTableBody");
  tbody.innerHTML = `<tr><td colspan="13" class="text-center">正在評估觀察名單之最佳買點與殖利率...</td></tr>`;

  const rowsHtml = [];
  for (const item of watchlistStocks) {
    try {
      const res = await fetch(`/api/stock/${item.code}`);
      const data = await res.json();
      const s = data.stock;
      const u = data.unheld_eval;
      const changeClass = s.change >= 0 ? "color-up" : "color-down";
      const stratTag = getStockStrategyTag(s);
      const existingNote = getStockNote(s.code);
      const hasNote = existingNote && existingNote.note;
      const notePreview = hasNote ? `備忘: ${existingNote.note}` : "點擊填寫個人操作策略備忘";

      rowsHtml.push(`
        <tr data-code="${s.code}">
          <td>
            <div class="stock-code-cell">
              <span class="code">${s.code}</span>
              <div class="stock-title-badge-row">
                <span class="name">${item.name || s.code}</span>
                <span class="badge-stock-type ${stratTag.className}" data-term="stock_type" title="${stratTag.tooltip}">
                  ${stratTag.icon} ${stratTag.label}
                </span>
              </div>
            </div>
          </td>
          <td class="stock-num">-</td>
          <td class="stock-num">-</td>
          <td class="stock-num font-bold">${s.price}</td>
          <td class="stock-num ${changeClass}">${s.change >= 0 ? '+' : ''}${s.change} (${s.pct_change}%)</td>
          <td class="stock-num">-</td>
          <td class="stock-num">-</td>
          <td class="stock-num color-gold font-bold">${s.dividend_yield}%</td>
          <td class="stock-num">-</td>
          <td>
            <span class="action-badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid #38bdf840;">
              ${u.buy_status}
            </span>
          </td>
          <td class="stock-num">理想買: ${u.ideal_buy_price}</td>
          <td>
            <button class="btn-note-view ${hasNote ? 'has-note' : ''}" data-code="${s.code}" data-name="${item.name || s.code}" title="${notePreview}">
              📝 ${hasNote ? '備註(已填)' : '備註'}
            </button>
            <button class="btn-chart-view btn-remove-wl" data-code="${s.code}" title="移除觀察" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.3); margin-left: 4px;">移除</button>
          </td>
        </tr>
      `);
    } catch (e) {
      console.error(e);
    }
  }

  tbody.innerHTML = rowsHtml.join("");

  tbody.querySelectorAll("tr").forEach(tr => {
    tr.addEventListener("click", (e) => {
      if (e.target.classList.contains("btn-remove-wl")) {
        e.stopPropagation();
        const code = e.target.getAttribute("data-code");
        removeWatchlistStock(code);
        return;
      }
      if (e.target.closest(".btn-note-view")) {
        e.stopPropagation();
        const code = tr.getAttribute("data-code");
        const name = tr.querySelector(".name") ? tr.querySelector(".name").textContent : code;
        openStockNoteModal(code, name);
        return;
      }
      if (e.target.closest(".badge-stock-type")) {
        e.stopPropagation();
        openGlossaryModal("stock_type");
        return;
      }
      tbody.querySelectorAll("tr").forEach(r => r.classList.remove("selected"));
      tr.classList.add("selected");
      const code = tr.getAttribute("data-code");
      loadStockDetail(code, null, true);
    });
  });
}

// Render stock detail modal UI synchronously
function renderStockDetail(result, holdingContext = null, shouldOpenModal = true) {
  const stock = result.stock;
  const unheld = result.unheld_eval;

  activeStockCode = stock.code;

  // Header info
  const isUp = stock.change >= 0;
  const changeClass = isUp ? "color-up" : "color-down";
  document.getElementById("chartStockTitle").textContent = `${stock.code} ${holdingContext ? holdingContext.name : ''}`;
  document.getElementById("chartStockPrice").textContent = `NT$ ${stock.price.toLocaleString()}`;
  
  const changeEl = document.getElementById("chartStockChange");
  changeEl.textContent = `${isUp ? '+' : ''}${stock.change} (${isUp ? '+' : ''}${stock.pct_change}%)`;
  changeEl.className = `badge-change ${changeClass}`;

  // Diagnostic Banner
  const diagTag = document.getElementById("diagActionTag");
  const diagGuidance = document.getElementById("diagGuidance");
  const diagCaution = document.getElementById("diagCaution");

  if (holdingContext && holdingContext.cost_price > 0) {
    diagTag.textContent = holdingContext.action_label;
    diagTag.style.backgroundColor = holdingContext.action_color;
    diagGuidance.textContent = holdingContext.guidance;
    diagCaution.textContent = holdingContext.caution;
  } else {
    diagTag.textContent = unheld.buy_status;
    diagTag.style.backgroundColor = "#0284c7";
    diagGuidance.textContent = `【未持股評估】${unheld.advice} 建議理想承接區間約落在 ${unheld.ideal_buy_price} 元。`;
    diagCaution.textContent = `若在此進場，風險防守停損價設為 ${unheld.stop_loss} 元，預估上檔壓力在 ${unheld.target_price} 元，損益比為 1 : ${unheld.risk_reward_ratio}。`;
  }

  // Dividend Box
  document.getElementById("divStockYieldBadge").textContent = `殖利率 ${stock.dividend_yield}%`;
  document.getElementById("divAnnualPayout").textContent = `${stock.annual_dividend} 元/股`;
  document.getElementById("divStockYield").textContent = `${stock.dividend_yield}%`;
  if (holdingContext && holdingContext.shares > 0) {
    const estDiv = holdingContext.est_annual_dividend || Math.round(stock.annual_dividend * holdingContext.shares);
    document.getElementById("divUserEstPayout").textContent = `NT$ ${estDiv.toLocaleString()} 元 (${holdingContext.shares.toLocaleString()}股)`;
  } else {
    document.getElementById("divUserEstPayout").textContent = `以 1,000 股估: NT$ ${Math.round(stock.annual_dividend * 1000).toLocaleString()} 元`;
  }
  document.getElementById("divFillRating").textContent = (stock.dividend_yield >= 4.0) ? "高殖利率存股標的，具優異除息防守力" : "成長型權值股，以價差回報為主";

  // Institutional Chips Rendering
  const inst = stock.institutional || {};
  const chipsBox = document.getElementById("chipsBox");
  if (chipsBox) {
    if (inst && inst.available) {
      chipsBox.style.display = "block";
      document.getElementById("chipsDate").textContent = inst.date ? `資料日期: ${inst.date}` : "";
      
      const tagEl = document.getElementById("chipsStatusTag");
      tagEl.textContent = inst.chips_status || "三大法人分析";
      tagEl.style.color = inst.chips_color || "#38bdf8";
      tagEl.style.borderColor = inst.chips_color || "#38bdf8";
      tagEl.style.backgroundColor = `${inst.chips_color}22` || "rgba(56, 189, 248, 0.15)";
      
      // Foreign
      const fVal = inst.foreign || 0;
      const fEl = document.getElementById("chipsForeign");
      fEl.textContent = `${fVal > 0 ? '+' : ''}${fVal.toLocaleString()} 張`;
      fEl.className = `m-val ${fVal > 0 ? 'color-up' : (fVal < 0 ? 'color-down' : '')}`;
      
      // Trust & Streak
      const tVal = inst.trust || 0;
      const tEl = document.getElementById("chipsTrust");
      tEl.textContent = `${tVal > 0 ? '+' : ''}${tVal.toLocaleString()} 張`;
      tEl.className = `m-val ${tVal > 0 ? 'color-up' : (tVal < 0 ? 'color-down' : '')}`;
      
      const streakEl = document.getElementById("chipsTrustStreak");
      const streak = inst.trust_streak || 0;
      if (streak > 0) {
        streakEl.textContent = `連買 ${streak} 天 🔥`;
        streakEl.style.display = "inline-flex";
        streakEl.style.color = "#f97316";
        streakEl.style.borderColor = "rgba(249, 115, 22, 0.4)";
      } else if (streak < 0) {
        streakEl.textContent = `連賣 ${Math.abs(streak)} 天 ⚠️`;
        streakEl.style.display = "inline-flex";
        streakEl.style.color = "#22c55e";
        streakEl.style.borderColor = "rgba(34, 197, 94, 0.4)";
      } else {
        streakEl.textContent = "轉折觀望";
        streakEl.style.display = "inline-flex";
        streakEl.style.color = "#94a3b8";
        streakEl.style.borderColor = "rgba(148, 163, 184, 0.3)";
      }

      // Dealer
      const dVal = inst.dealer || 0;
      const dEl = document.getElementById("chipsDealer");
      dEl.textContent = `${dVal > 0 ? '+' : ''}${dVal.toLocaleString()} 張`;
      dEl.className = `m-val ${dVal > 0 ? 'color-up' : (dVal < 0 ? 'color-down' : '')}`;

      // Total
      const totVal = inst.total || 0;
      const totEl = document.getElementById("chipsTotal");
      totEl.textContent = `${totVal > 0 ? '+' : ''}${totVal.toLocaleString()} 張`;
      totEl.className = `m-val ${totVal > 0 ? 'color-up' : (totVal < 0 ? 'color-down' : '')}`;

      // Summary
      document.getElementById("chipsSummary").textContent = inst.chips_summary || "三大法人數據持續追蹤中。";
    } else {
      chipsBox.style.display = "none";
    }
  }

  // Key Levels
  const isM = (stock.timeframe === "M");
  const isW = (stock.timeframe === "W");
  const lvlMA20El = document.getElementById("lvlMA20");
  if (lvlMA20El && lvlMA20El.previousElementSibling) {
    lvlMA20El.previousElementSibling.textContent = isM ? "20月均線：" : (isW ? "20週均線：" : "20MA月線：");
  }
  lvlMA20El.textContent = stock.ma20;
  document.getElementById("lvlSupport").textContent = stock.support;
  document.getElementById("lvlResistance").textContent = stock.resistance;
  document.getElementById("lvlKD").textContent = `K: ${stock.k} / D: ${stock.d}`;
  document.getElementById("lvlRSI").textContent = `${stock.rsi} (${stock.rsi > 70 ? '過熱' : (stock.rsi < 30 ? '超賣' : '健康')})`;

  const tvTfTag = document.getElementById("tvTfTag");
  if (tvTfTag) {
    tvTfTag.textContent = isM ? "月K" : (isW ? "週K" : "日K");
  }

  // Draw Chart
  drawCandleChart(stock.candles, stock.support, stock.resistance, stock.timeframe);
  if (shouldOpenModal) {
    setTimeout(() => {
      const container = document.getElementById("tvChartContainer");
      if (tvChart && container) {
        tvChart.applyOptions({
          width: container.clientWidth,
          height: container.clientHeight || 560
        });
        tvChart.timeScale().fitContent();
      }
    }, 150);
  }
}

// Background prefetch alternate timeframe (e.g. fetch Weekly/Monthly while viewing Daily)
function prefetchAlternateTimeframe(code, targetTf) {
  if (!code) return;
  const cleanCode = String(code).trim().toUpperCase();
  const cacheKey = `${cleanCode}_${targetTf}`;
  const now = Date.now();
  if (stockDetailClientCache.has(cacheKey)) {
    const entry = stockDetailClientCache.get(cacheKey);
    if (now - entry.timestamp < STOCK_CLIENT_CACHE_TTL) return;
  }
  
  const runPrefetch = () => {
    fetch(`/api/stock/${cleanCode}?tf=${targetTf}`)
      .then(res => res.ok ? res.json() : null)
      .then(result => {
        if (result && result.stock) {
          stockDetailClientCache.set(cacheKey, { data: result, timestamp: Date.now() });
        }
      })
      .catch(() => {});
  };

  if (window.requestIdleCallback) {
    window.requestIdleCallback(runPrefetch, { timeout: 2000 });
  } else {
    setTimeout(runPrefetch, 250);
  }
}

// Fetch and render stock chart & diagnosis with Instant Cache & Visual Feedback
async function loadStockDetail(code, holdingContext = null, shouldOpenModal = true) {
  if (shouldOpenModal && typeof window.openStockModal === "function") {
    window.openStockModal();
  }

  const cleanCode = String(code).trim().toUpperCase();
  activeStockCode = cleanCode;
  activeHoldingContext = holdingContext;

  // Update timeframe buttons active state immediately
  const tfBtns = document.querySelectorAll(".timeframe-selector .tf-btn");
  tfBtns.forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-tf") === currentStockTimeframe);
  });

  const overlay = document.getElementById("chartLoadingOverlay");
  const loaderText = document.getElementById("chartLoaderText");
  const cacheKey = `${cleanCode}_${currentStockTimeframe}`;
  const now = Date.now();

  // 1. FAST PATH: Check Client-side Cache (0ms Instant Switch)
  if (stockDetailClientCache.has(cacheKey)) {
    const cached = stockDetailClientCache.get(cacheKey);
    if (now - cached.timestamp < STOCK_CLIENT_CACHE_TTL) {
      if (overlay) overlay.classList.remove("active");
      tfBtns.forEach(b => b.classList.remove("loading"));
      renderStockDetail(cached.data, holdingContext, shouldOpenModal);
      
      // Background prefetch the other timeframes
      const altTfs = ["D", "W", "M"].filter(t => t !== currentStockTimeframe);
      altTfs.forEach(t => prefetchAlternateTimeframe(cleanCode, t));
      return;
    }
  }

  // 2. SLOW PATH: Show immediate loading feedback & fetch from server
  if (overlay) {
    if (loaderText) {
      if (currentStockTimeframe === "M") {
        loaderText.textContent = "正在載入月K走勢中...";
      } else if (currentStockTimeframe === "W") {
        loaderText.textContent = "正在載入週K走勢中...";
      } else {
        loaderText.textContent = "正在載入日K走勢中...";
      }
    }
    overlay.classList.add("active");
  }
  const activeBtn = document.querySelector(`.timeframe-selector .tf-btn[data-tf="${currentStockTimeframe}"]`);
  if (activeBtn) activeBtn.classList.add("loading");

  // Abort previous in-flight request if user rapidly switches
  if (stockDetailAbortController) {
    stockDetailAbortController.abort();
  }
  stockDetailAbortController = new AbortController();

  try {
    const res = await fetch(`/api/stock/${cleanCode}?tf=${currentStockTimeframe}`, {
      signal: stockDetailAbortController.signal
    });
    if (!res.ok) {
      alert(`查無股票代號 ${cleanCode} 之歷史數據`);
      return;
    }
    const result = await res.json();
    
    // Cache result in client memory
    stockDetailClientCache.set(cacheKey, { data: result, timestamp: Date.now() });

    // Render immediately
    renderStockDetail(result, holdingContext, shouldOpenModal);

    // Prefetch alternate timeframes quietly for instant future switching
    const altTfs = ["D", "W", "M"].filter(t => t !== currentStockTimeframe);
    altTfs.forEach(t => prefetchAlternateTimeframe(cleanCode, t));

  } catch (err) {
    if (err.name === "AbortError") {
      // Switched timeframe again, silently ignore
      return;
    }
    console.error("Error loading stock detail:", err);
  } finally {
    if (overlay) overlay.classList.remove("active");
    tfBtns.forEach(b => b.classList.remove("loading"));
  }
}

// Update live OHLC crosshair bar
function updateOhlcBar(candle, volData) {
  if (!candle) return;
  const openEl = document.getElementById("tvOpen");
  const highEl = document.getElementById("tvHigh");
  const lowEl = document.getElementById("tvLow");
  const closeEl = document.getElementById("tvClose");
  const changeEl = document.getElementById("tvChange");
  const volEl = document.getElementById("tvVol");

  if (openEl) openEl.textContent = (candle.open != null) ? candle.open.toFixed(2) : "--";
  if (highEl) highEl.textContent = (candle.high != null) ? candle.high.toFixed(2) : "--";
  if (lowEl) lowEl.textContent = (candle.low != null) ? candle.low.toFixed(2) : "--";
  if (closeEl) {
    closeEl.textContent = (candle.close != null) ? candle.close.toFixed(2) : "--";
    const isUp = (candle.close >= candle.open);
    closeEl.style.color = isUp ? "#ef4444" : "#22c55e";
  }
  if (changeEl && candle.open != null && candle.close != null) {
    const diff = candle.close - candle.open;
    const pct = candle.open > 0 ? (diff / candle.open) * 100 : 0;
    changeEl.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${diff >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
    changeEl.style.color = diff >= 0 ? "#ef4444" : "#22c55e";
  }
  if (volEl) {
    const v = (volData && volData.value != null) ? volData.value : (candle.volume || 0);
    volEl.textContent = `${Math.round(v).toLocaleString()} 張`;
  }
}

// Draw Professional TradingView Candlestick & Volume Histogram Chart
function drawCandleChart(candles, support, resistance, timeframe = "D") {
  const container = document.getElementById("tvChartContainer");
  if (!container) return;

  const isW = (timeframe === "W");
  const tfTag = document.getElementById("tvTfTag");
  if (tfTag) tfTag.textContent = isW ? "週K" : "日K";

  // Clean old instance
  if (tvChart) {
    try {
      tvChart.remove();
    } catch (e) {}
    tvChart = null;
  }
  container.innerHTML = "";

  if (!window.LightweightCharts) {
    console.error("TradingView LightweightCharts library not loaded, falling back");
    return;
  }

  // Create TradingView Chart
  const width = container.clientWidth || 800;
  const height = container.clientHeight || 560;

  tvChart = window.LightweightCharts.createChart(container, {
    width: width,
    height: height,
    layout: {
      background: { type: "solid", color: "#090d16" },
      textColor: "#94a3b8",
      fontSize: 12,
      fontFamily: "JetBrains Mono, -apple-system, BlinkMacSystemFont, sans-serif"
    },
    grid: {
      vertLines: { color: "rgba(255, 255, 255, 0.04)" },
      horzLines: { color: "rgba(255, 255, 255, 0.04)" }
    },
    crosshair: {
      mode: window.LightweightCharts.CrosshairMode.Normal,
      vertLine: {
        color: "rgba(59, 130, 246, 0.4)",
        width: 1,
        style: 3,
        labelBackgroundColor: "#1e3a8a"
      },
      horzLine: {
        color: "rgba(59, 130, 246, 0.4)",
        width: 1,
        style: 3,
        labelBackgroundColor: "#1e3a8a"
      }
    },
    rightPriceScale: {
      borderColor: "rgba(255, 255, 255, 0.1)",
      scaleMargins: {
        top: 0.1,
        bottom: 0.25
      }
    },
    timeScale: {
      borderColor: "rgba(255, 255, 255, 0.1)",
      timeVisible: true,
      secondsVisible: false
    }
  });

  // 1. Volume Series (Histogram at bottom)
  tvVolumeSeries = tvChart.addHistogramSeries({
    color: "#26a69a",
    priceFormat: {
      type: "volume"
    },
    priceScaleId: "",
    scaleMargins: {
      top: 0.78,
      bottom: 0
    }
  });

  const volData = candles.map(c => ({
    time: c.date,
    value: c.volume || 0,
    color: (c.close >= c.open) ? "rgba(239, 68, 68, 0.55)" : "rgba(34, 197, 94, 0.55)"
  }));
  tvVolumeSeries.setData(volData);

  // 2. Candlestick Series (Taiwan Red for Gain, Green for Loss)
  tvCandleSeries = tvChart.addCandlestickSeries({
    upColor: "#ef4444",
    downColor: "#22c55e",
    borderUpColor: "#ef4444",
    borderDownColor: "#22c55e",
    wickUpColor: "#ef4444",
    wickDownColor: "#22c55e"
  });

  const candleData = candles.map(c => ({
    time: c.date,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close
  }));
  tvCandleSeries.setData(candleData);

  // 3. Moving Averages (MA5, MA20, MA60)
  tvMa5Series = tvChart.addLineSeries({
    color: "#f59e0b",
    lineWidth: 1.5,
    title: isW ? "5週線" : "5MA",
    priceLineVisible: false
  });
  const ma5Data = candles.filter(c => c.ma5 != null).map(c => ({ time: c.date, value: c.ma5 }));
  tvMa5Series.setData(ma5Data);

  tvMa20Series = tvChart.addLineSeries({
    color: "#3b82f6",
    lineWidth: 2,
    title: isW ? "20週線" : "20MA",
    priceLineVisible: false
  });
  const ma20Data = candles.filter(c => c.ma20 != null).map(c => ({ time: c.date, value: c.ma20 }));
  tvMa20Series.setData(ma20Data);

  tvMa60Series = tvChart.addLineSeries({
    color: "#a855f7",
    lineWidth: 1.5,
    title: isW ? "60週線" : "60MA",
    priceLineVisible: false
  });
  const ma60Data = candles.filter(c => c.ma60 != null).map(c => ({ time: c.date, value: c.ma60 }));
  tvMa60Series.setData(ma60Data);

  // 4. Support and Resistance Lines
  if (support > 0) {
    tvCandleSeries.createPriceLine({
      price: support,
      color: "#22c55e",
      lineWidth: 1.5,
      lineStyle: window.LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: "關鍵支撐"
    });
  }

  if (resistance > 0) {
    tvCandleSeries.createPriceLine({
      price: resistance,
      color: "#ef4444",
      lineWidth: 1.5,
      lineStyle: window.LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: "短線壓力"
    });
  }

  // Update initial OHLC bar with the latest candle
  if (candles.length > 0) {
    const lastCandle = candles[candles.length - 1];
    updateOhlcBar(lastCandle, { value: lastCandle.volume });
  }

  // Crosshair move subscription for live OHLC values
  tvChart.subscribeCrosshairMove(param => {
    if (!param || !param.time) {
      if (candles.length > 0) {
        const lastCandle = candles[candles.length - 1];
        updateOhlcBar(lastCandle, { value: lastCandle.volume });
      }
      return;
    }
    const cData = param.seriesData.get(tvCandleSeries);
    const vData = param.seriesData.get(tvVolumeSeries);
    if (cData) {
      updateOhlcBar(cData, vData);
    }
  });

  // Fit content
  tvChart.timeScale().fitContent();

  // Resize handler
  const resizeHandler = () => {
    if (tvChart && container) {
      tvChart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight || 560
      });
    }
  };
  window.removeEventListener("resize", window._tvChartResizeHandler);
  window._tvChartResizeHandler = resizeHandler;
  window.addEventListener("resize", resizeHandler);
}
