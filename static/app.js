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

  // Global Escape key: closes stock modal or bot modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (stockModal && stockModal.classList.contains("active")) {
        closeStockModal();
      } else if (botModal && botModal.classList.contains("active")) {
        botModal.classList.remove("active");
      }
    }
  });

  // Timeframe selector (日K / 週K 切換)
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

    const card = document.createElement("div");
    card.className = "macro-card";
    card.innerHTML = `
      <div class="macro-card-title">${item.name}</div>
      <div class="macro-card-price">${item.price.toLocaleString()}</div>
      <div class="macro-card-change ${colorClass}">
        ${prefix}${item.pct_change}%
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

  // Render Table Rows
  holdings.forEach((h) => {
    const tr = document.createElement("tr");
    if (h.code === activeStockCode) {
      tr.classList.add("selected");
    }

    const isHProfit = h.pnl >= 0;
    const pnlClass = isHProfit ? "color-up" : "color-down";
    const changeClass = h.change >= 0 ? "color-up" : "color-down";

    tr.innerHTML = `
      <td>
        <div class="stock-code-cell">
          <span class="code">${h.code}</span>
          <span class="name">${h.name}</span>
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
        <button class="btn-chart-view" data-code="${h.code}">查線圖</button>
      </td>
    `;

    tr.addEventListener("click", () => {
      document.querySelectorAll("#stockTableBody tr").forEach(r => r.classList.remove("selected"));
      tr.classList.add("selected");
      activeStockCode = h.code;
      activeHoldingContext = h;
      loadStockDetail(h.code, h, true);
    });

    tbody.appendChild(tr);
  });

  // Store references for live cash input updates
  window._currentHoldings = holdings;
  window._currentTotalVal = totalVal;

  // Render Sector Exposure & Asset Risk Management Dashboard
  renderSectorRiskDashboard(holdings, totalVal);
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

      rowsHtml.push(`
        <tr data-code="${s.code}">
          <td>
            <div class="stock-code-cell">
              <span class="code">${s.code}</span>
              <span class="name">${item.name || s.code}</span>
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
            <button class="btn-chart-view" data-code="${s.code}">深度診斷</button>
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
  const isW = (stock.timeframe === "W");
  const lvlMA20El = document.getElementById("lvlMA20");
  if (lvlMA20El && lvlMA20El.previousElementSibling) {
    lvlMA20El.previousElementSibling.textContent = isW ? "20週均線：" : "20MA月線：";
  }
  lvlMA20El.textContent = stock.ma20;
  document.getElementById("lvlSupport").textContent = stock.support;
  document.getElementById("lvlResistance").textContent = stock.resistance;
  document.getElementById("lvlKD").textContent = `K: ${stock.k} / D: ${stock.d}`;
  document.getElementById("lvlRSI").textContent = `${stock.rsi} (${stock.rsi > 70 ? '過熱' : (stock.rsi < 30 ? '超賣' : '健康')})`;

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

// Background prefetch alternate timeframe (e.g. fetch Weekly while viewing Daily)
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
      
      // Background prefetch the alternate timeframe
      const altTf = (currentStockTimeframe === "D") ? "W" : "D";
      prefetchAlternateTimeframe(cleanCode, altTf);
      return;
    }
  }

  // 2. SLOW PATH: Show immediate loading feedback & fetch from server
  if (overlay) {
    if (loaderText) {
      loaderText.textContent = (currentStockTimeframe === "W") ? "正在載入週K走勢中..." : "正在載入日K走勢中...";
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

    // Prefetch alternate timeframe quietly for instant future switching
    const altTf = (currentStockTimeframe === "D") ? "W" : "D";
    prefetchAlternateTimeframe(cleanCode, altTf);

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
