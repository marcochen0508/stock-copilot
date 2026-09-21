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
}

// Watchlist View Handler
async function renderWatchlistView() {
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
    setTimeout(() => { if (chartInstance) chartInstance.resize(); }, 100);
    setTimeout(() => { if (chartInstance) chartInstance.resize(); }, 300);
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

// Draw Professional Candlestick & Moving Averages Chart
function drawCandleChart(candles, support, resistance, timeframe = "D") {
  const canvas = document.getElementById("klineCanvas");
  const ctx = canvas.getContext("2d");

  if (chartInstance) {
    chartInstance.destroy();
  }

  const isW = (timeframe === "W");
  const ma5Label = isW ? "5週線" : "5MA (週線)";
  const ma20Label = isW ? "20週線 (季線生命線)" : "20MA (月線生命線)";
  const ma60Label = isW ? "60週線 (年線)" : "60MA (季線)";

  const labels = candles.map(c => c.date);
  const closePrices = candles.map(c => c.close);
  const ma5 = candles.map(c => c.ma5);
  const ma20 = candles.map(c => c.ma20);
  const ma60 = candles.map(c => c.ma60);

  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, "rgba(59, 130, 246, 0.35)");
  gradient.addColorStop(1, "rgba(59, 130, 246, 0.0)");

  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: isW ? "週收盤價" : "日收盤價",
          data: closePrices,
          borderColor: "#3b82f6",
          borderWidth: 2.5,
          backgroundColor: gradient,
          fill: true,
          tension: 0.15,
          pointRadius: isW ? 2 : 0,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: "#60a5fa"
        },
        {
          label: ma5Label,
          data: ma5,
          borderColor: "#f59e0b",
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0.1
        },
        {
          label: ma20Label,
          data: ma20,
          borderColor: "#10b981",
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          tension: 0.1
        },
        {
          label: ma60Label,
          data: ma60,
          borderColor: "#a855f7",
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0.1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: {
          position: "top",
          labels: {
            color: "#94a3b8",
            font: { size: 12, family: "Plus Jakarta Sans" },
            boxWidth: 14,
            boxHeight: 14
          }
        },
        tooltip: {
          backgroundColor: "#0f172a",
          titleColor: "#f8fafc",
          bodyColor: "#cbd5e1",
          borderColor: "rgba(255, 255, 255, 0.15)",
          borderWidth: 1,
          padding: 12,
          bodyFont: { family: "JetBrains Mono", size: 13 }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(255, 255, 255, 0.04)" },
          ticks: {
            color: "#64748b",
            maxTicksLimit: 14,
            font: { family: "JetBrains Mono", size: 11 }
          }
        },
        y: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: {
            color: "#94a3b8",
            font: { family: "JetBrains Mono", size: 12 }
          }
        }
      }
    }
  });
}
