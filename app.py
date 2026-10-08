import os
import json
import uvicorn
from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from typing import Optional, Dict, Any
import datetime
import logging

import sheets_sync
import market_engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("StockCopilot")

app = FastAPI(title="台股智能決策戰情室", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory and disk cache for ultra-fast startup and response
CACHE = {
    "macro": None,
    "macro_time": None,
    "portfolios": None,
    "portfolios_time": None,
    "stocks": {}
}

CACHE_TTL_SECONDS = 300 # 5 minutes cache for market data
CACHE_DIR = os.path.dirname(os.path.abspath(__file__))
PORTFOLIOS_CACHE_FILE = os.path.join(CACHE_DIR, "cache_portfolios.json")
MACRO_CACHE_FILE = os.path.join(CACHE_DIR, "cache_macro.json")

# Preload cache from disk on startup if available
if os.path.exists(PORTFOLIOS_CACHE_FILE):
    try:
        with open(PORTFOLIOS_CACHE_FILE, "r", encoding="utf-8") as f:
            CACHE["portfolios"] = json.load(f)
            CACHE["portfolios_time"] = datetime.datetime.now()
            logger.info("Successfully preloaded portfolios cache from disk.")
    except Exception as e:
        logger.warning(f"Failed to preload portfolios cache: {e}")

if os.path.exists(MACRO_CACHE_FILE):
    try:
        with open(MACRO_CACHE_FILE, "r", encoding="utf-8") as f:
            CACHE["macro"] = json.load(f)
            CACHE["macro_time"] = datetime.datetime.now()
            logger.info("Successfully preloaded macro cache from disk.")
    except Exception as e:
        logger.warning(f"Failed to preload macro cache: {e}")

@app.get("/api/macro")
def api_macro(force: bool = False):
    now = datetime.datetime.now()
    if not force and CACHE["macro"] and CACHE["macro_time"]:
        if (now - CACHE["macro_time"]).total_seconds() < CACHE_TTL_SECONDS:
            return CACHE["macro"]
    try:
        data = market_engine.get_macro_overview()
        CACHE["macro"] = data
        CACHE["macro_time"] = now
        try:
            with open(MACRO_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning(f"Could not save macro cache to disk: {e}")
        return data
    except Exception as e:
        logger.error(f"Error getting macro data: {e}")
        if CACHE["macro"]:
            return CACHE["macro"]
        raise HTTPException(status_code=500, detail=str(e))

def enrich_raw_portfolios(raw_portfolios: Dict[str, Any]) -> Dict[str, Any]:
    from concurrent.futures import ThreadPoolExecutor
    now = datetime.datetime.now()

    # 1. Gather all unique stock codes
    unique_codes = set()
    for person, data in raw_portfolios.items():
        for h in data.get("holdings", []):
            code_str = str(h.get("code", "")).strip()
            if code_str:
                unique_codes.add(code_str)
            
    # 2. Fetch 0-latency live quotes from official TWSE MIS in 1 bulk request (~0.1s)
    mis_quotes = {}
    try:
        mis_quotes = market_engine.get_twse_mis_realtime_batch(list(unique_codes))
    except Exception as ex:
        logger.warning(f"Could not batch fetch TWSE MIS quotes: {ex}")
            
    # 3. Fetch stock quotes & indicators concurrently in parallel
    stock_cache_map = {}
    def _fetch_stock_data(c):
        return c, market_engine.get_stock_history_and_indicators(c)
        
    with ThreadPoolExecutor(max_workers=min(len(unique_codes) or 1, 8)) as executor:
        results = executor.map(_fetch_stock_data, list(unique_codes))
        for code, s_data in results:
            if s_data and code in mis_quotes:
                rt = mis_quotes[code]
                s_data["price"] = rt["price"]
                s_data["prev_price"] = rt["prev_price"]
                s_data["change"] = rt["change"]
                s_data["pct_change"] = rt["pct_change"]
                if rt["volume"] > 0:
                    s_data["volume"] = rt["volume"]
                s_data["is_realtime"] = True
            stock_cache_map[code] = s_data

    enriched_portfolios = {}
    all_holdings = []
    
    for person, data in raw_portfolios.items():
        enriched_items = []
        tab_total_cost = 0.0
        tab_total_val = 0.0
        tab_total_annual_div = 0.0
        
        for h in data.get("holdings", []):
            code = str(h.get("code", "")).strip()
            if not code:
                continue
            shares = float(h.get("shares", 0))
            cost = float(h.get("cost_price", 0))
            name = h.get("name") or (mis_quotes.get(code, {}).get("name") if code in mis_quotes else code)
            note = h.get("note", "")
            
            # Fetch stock quote & indicators from memory cache
            stock_data = stock_cache_map.get(code)
            if stock_data:
                diag = market_engine.diagnose_stock_holding(stock_data, cost, shares)
                market_val = round(stock_data["price"] * shares, 0)
                total_c = round(cost * shares, 0)
                annual_div = stock_data.get("annual_dividend", 0.0)
                div_yield = stock_data.get("dividend_yield", 0.0)
                est_annual_div = round(annual_div * shares, 0)
                
                item = {
                    "code": code,
                    "name": name,
                    "shares": shares,
                    "cost_price": cost,
                    "current_price": stock_data["price"],
                    "prev_price": stock_data["prev_price"],
                    "change": stock_data["change"],
                    "pct_change": stock_data["pct_change"],
                    "total_cost": total_c,
                    "market_value": market_val,
                    "pnl": diag["pnl"],
                    "roi_pct": diag["roi_pct"],
                    "action_label": diag["action_label"],
                    "action_type": diag["action_type"],
                    "action_color": diag["action_color"],
                    "stop_loss": diag["stop_loss"],
                    "target_price": diag["target_price"],
                    "guidance": diag["guidance"],
                    "caution": diag["caution"],
                    "annual_dividend": annual_div,
                    "dividend_yield": div_yield,
                    "est_annual_dividend": est_annual_div,
                    "ma20": stock_data["ma20"],
                    "support": stock_data["support"],
                    "resistance": stock_data["resistance"],
                    "bias20": stock_data["bias20"],
                    "k": stock_data["k"],
                    "d": stock_data["d"],
                    "rsi": stock_data["rsi"],
                    "vol_ratio": stock_data["vol_ratio"],
                    "note": note
                }
                tab_total_cost += total_c
                tab_total_val += market_val
                tab_total_annual_div += est_annual_div
            else:
                # Fallback if quote failed
                item = {
                    "code": code,
                    "name": name,
                    "shares": shares,
                    "cost_price": cost,
                    "current_price": cost,
                    "prev_price": cost,
                    "change": 0.0,
                    "pct_change": 0.0,
                    "total_cost": cost * shares,
                    "market_value": cost * shares,
                    "pnl": 0.0,
                    "roi_pct": 0.0,
                    "action_label": "資料載入中",
                    "action_type": "NEUTRAL",
                    "action_color": "#94a3b8",
                    "stop_loss": cost * 0.93,
                    "target_price": cost * 1.1,
                    "guidance": "等待數據連線",
                    "caution": "-",
                    "annual_dividend": 0.0,
                    "dividend_yield": 0.0,
                    "est_annual_dividend": 0.0,
                    "note": note
                }
                tab_total_cost += cost * shares
                tab_total_val += cost * shares
                
            enriched_items.append(item)
            all_holdings.append({**item, "owner": person})
            
        tab_pnl = tab_total_val - tab_total_cost
        tab_roi = (tab_pnl / tab_total_cost * 100) if tab_total_cost > 0 else 0.0
        
        enriched_portfolios[person] = {
            "name": person,
            "gid": data.get("gid", ""),
            "total_cost": round(tab_total_cost, 0),
            "total_market_value": round(tab_total_val, 0),
            "total_pnl": round(tab_pnl, 0),
            "total_roi_pct": round(tab_roi, 2),
            "total_annual_dividend": round(tab_total_annual_div, 0),
            "portfolio_yield": round((tab_total_annual_div / tab_total_val * 100), 2) if tab_total_val > 0 else 0.0,
            "holdings": enriched_items
        }
        
    # Aggregate '全部合併總覽'
    agg_cost = sum(p["total_cost"] for p in enriched_portfolios.values())
    agg_val = sum(p["total_market_value"] for p in enriched_portfolios.values())
    agg_div = sum(p["total_annual_dividend"] for p in enriched_portfolios.values())
    agg_pnl = agg_val - agg_cost
    agg_roi = (agg_pnl / agg_cost * 100) if agg_cost > 0 else 0.0
    agg_yield = round((agg_div / agg_val * 100), 2) if agg_val > 0 else 0.0
    
    return {
        "persons": list(enriched_portfolios.keys()),
        "portfolios": enriched_portfolios,
        "aggregate": {
            "total_cost": round(agg_cost, 0),
            "total_market_value": round(agg_val, 0),
            "total_pnl": round(agg_pnl, 0),
            "total_roi_pct": round(agg_roi, 2),
            "total_annual_dividend": round(agg_div, 0),
            "portfolio_yield": agg_yield,
            "holdings": all_holdings
        },
        "synced_at": now.strftime("%Y-%m-%d %H:%M:%S")
    }

def get_demo_portfolios() -> Dict[str, Any]:
    """公開展示用的示範投資組合（台積電、元大台灣50）"""
    now = datetime.datetime.now()
    if CACHE.get("demo") and CACHE.get("demo_time"):
        if (now - CACHE["demo_time"]).total_seconds() < CACHE_TTL_SECONDS:
            return CACHE["demo"]
            
    demo_raw = {
        "公開示範帳戶": {
            "gid": "demo",
            "holdings": [
                {"code": "2330", "name": "台積電", "shares": 1000, "cost_price": 850.0, "note": "系統公開示範標的"},
                {"code": "0050", "name": "元大台灣50", "shares": 1000, "cost_price": 160.0, "note": "系統公開示範標的"}
            ]
        }
    }
    demo_result = enrich_raw_portfolios(demo_raw)
    demo_result["is_demo"] = True
    CACHE["demo"] = demo_result
    CACHE["demo_time"] = now
    return demo_result

SHEET_CACHE: Dict[str, Any] = {}

@app.get("/api/portfolios")
def api_portfolios(sheet_url: Optional[str] = None, sheet_id: Optional[str] = None, force_sync: bool = False):
    import re
    now = datetime.datetime.now()
    
    target_sheet_id = ""
    if sheet_url:
        m = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', sheet_url)
        if m:
            target_sheet_id = m.group(1)
    elif sheet_id:
        target_sheet_id = sheet_id.strip()

    # 方案 A：未輸入個人試算表時，一律展示安全公開示範範本（絕不洩漏個人資料）
    if not target_sheet_id:
        return get_demo_portfolios()

    # 依使用者輸入的 sheet_id 個別快取（確保彼此完全隔離）
    cache_entry = SHEET_CACHE.get(target_sheet_id)
    if not force_sync and cache_entry:
        cached_data, cached_time = cache_entry
        if (now - cached_time).total_seconds() < CACHE_TTL_SECONDS:
            return cached_data
            
    try:
        raw_portfolios = sheets_sync.get_all_sheet_portfolios(sheet_id=target_sheet_id)
        result = enrich_raw_portfolios(raw_portfolios)
        result["is_demo"] = False
        SHEET_CACHE[target_sheet_id] = (result, now)
        return result
    except Exception as e:
        logger.error(f"Error syncing portfolios: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/portfolios/calculate")
def api_portfolios_calculate(payload: Dict[str, Any]):
    """
    Calculate real-time portfolio metrics for user-submitted holdings (manual input mode).
    Payload format:
    {
       "holdings": [
           {"code": "2330", "name": "台積電", "shares": 1000, "cost_price": 950.0, "account": "我的持股", "note": ""}
       ]
    }
    or
    {
       "portfolios": {
           "我的持股": { "holdings": [...] }
       }
    }
    """
    try:
        raw_portfolios = {}
        if "holdings" in payload and isinstance(payload["holdings"], list):
            for item in payload["holdings"]:
                acct = str(item.get("account") or item.get("owner") or "我的持股").strip()
                if not acct:
                    acct = "我的持股"
                if acct not in raw_portfolios:
                    raw_portfolios[acct] = {"gid": "manual", "holdings": []}
                raw_portfolios[acct]["holdings"].append({
                    "code": str(item.get("code", "")).strip(),
                    "name": str(item.get("name", "")).strip(),
                    "shares": float(item.get("shares", 0)),
                    "cost_price": float(item.get("cost_price", 0)),
                    "note": str(item.get("note", ""))
                })
        elif "portfolios" in payload and isinstance(payload["portfolios"], dict):
            raw_portfolios = payload["portfolios"]

        if not raw_portfolios:
            raw_portfolios = {"我的持股": {"gid": "manual", "holdings": []}}

        return enrich_raw_portfolios(raw_portfolios)
    except Exception as e:
        logger.error(f"Error calculating manual portfolios: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stock-lookup/{code}")
def api_stock_lookup(code: str):
    """
    Quick stock symbol resolution for auto-populating stock name and current price.
    """
    clean_code = str(code).strip()
    try:
        mis = market_engine.get_twse_mis_realtime_batch([clean_code])
        if clean_code in mis:
            return {
                "found": True,
                "code": clean_code,
                "name": mis[clean_code].get("name", clean_code),
                "price": mis[clean_code].get("price", 0),
                "change": mis[clean_code].get("change", 0),
                "pct_change": mis[clean_code].get("pct_change", 0)
            }
        data = market_engine.get_stock_history_and_indicators(clean_code)
        if data:
            return {
                "found": True,
                "code": clean_code,
                "name": data.get("name", clean_code),
                "price": data.get("price", 0),
                "change": data.get("change", 0),
                "pct_change": data.get("pct_change", 0)
            }
    except Exception as e:
        logger.warning(f"Stock lookup error for {clean_code}: {e}")
    return {"found": False, "code": clean_code, "name": clean_code, "price": 0, "change": 0, "pct_change": 0}

def get_tf_config(tf: str):
    t = (tf or "D").upper()
    if t == "M":
        return "1mo", "10y"
    elif t == "W":
        return "1wk", "2y"
    else:
        return "1d", "6mo"

def background_preload_stock_tf(clean_code: str, tf: str):
    """
    Background worker to prefetch and calculate alternate timeframe (e.g. Weekly/Monthly).
    Ensures that when user clicks Day/Week/Month switch, the response is instant (< 5ms).
    """
    try:
        interval, period = get_tf_config(tf)
        cache_key = f"{clean_code}_{interval}"
        now = datetime.datetime.now()
        
        if "stocks" not in CACHE:
            CACHE["stocks"] = {}
            
        if cache_key in CACHE["stocks"]:
            entry = CACHE["stocks"][cache_key]
            if (now - entry["time"]).total_seconds() < 600:
                return
                
        data = market_engine.get_stock_history_and_indicators(clean_code, period=period, interval=interval)
        if data:
            unheld_eval = market_engine.diagnose_unheld_stock(data)
            CACHE["stocks"][cache_key] = {
                "data": {"stock": data, "unheld_eval": unheld_eval},
                "time": now
            }
            logger.info(f"Background preloaded {cache_key} successfully.")
    except Exception as e:
        logger.warning(f"Background preload failed for {clean_code} (tf={tf}): {e}")

@app.get("/api/stock/{code}")
def api_stock_detail(code: str, tf: str = "D", background_tasks: BackgroundTasks = None):
    """
    Get full technical chart data, support/resistance, and unheld evaluation for any stock.
    Supports tf='D' (日K), tf='W' (週K), and tf='M' (月K).
    Automatically schedules background prefetching for the alternate timeframe to make switching instantaneous.
    """
    clean_code = str(code).strip().upper()
    current_tf = (tf or "D").upper()
    interval, period = get_tf_config(current_tf)
    cache_key = f"{clean_code}_{interval}"
    
    now = datetime.datetime.now()
    if "stocks" not in CACHE:
        CACHE["stocks"] = {}
        
    def trigger_prefetch():
        if background_tasks:
            # Prefetch the other timeframes in background
            alternate_tfs = [t for t in ["D", "W", "M"] if t != current_tf]
            for alt in alternate_tfs:
                alt_interval, _ = get_tf_config(alt)
                alt_key = f"{clean_code}_{alt_interval}"
                if alt_key not in CACHE["stocks"] or (now - CACHE["stocks"][alt_key]["time"]).total_seconds() >= 600:
                    background_tasks.add_task(background_preload_stock_tf, clean_code, alt)
        
    if cache_key in CACHE["stocks"]:
        entry = CACHE["stocks"][cache_key]
        if (now - entry["time"]).total_seconds() < 600:
            trigger_prefetch()
            return entry["data"]
            
    data = market_engine.get_stock_history_and_indicators(clean_code, period=period, interval=interval)
    if not data:
        raise HTTPException(status_code=404, detail=f"Stock {code} not found or no historical data.")
        
    unheld_eval = market_engine.diagnose_unheld_stock(data)
    result = {
        "stock": data,
        "unheld_eval": unheld_eval
    }
    CACHE["stocks"][cache_key] = {"data": result, "time": now}
    trigger_prefetch()
    return result

# Bot Helper Endpoints (for LINE Bot, Telegram Bot, or Webhook integration)
@app.get("/api/bot/morning-briefing")
def api_bot_morning_briefing():
    """
    Returns clean text message for external Stock Helper bot to broadcast daily.
    """
    macro = market_engine.get_macro_overview()
    lines = [
        "☀️【晨間全球戰情室與台股開盤前瞻】",
        f"時間：{macro['updated_at']}",
        f"今日偏向：{macro['bias_label']} (情緒評分: {macro['sentiment_score']})",
        "",
        "📊 國際焦點數據：",
    ]
    for item in macro["items"]:
        lines.append(f"• {item['name']}: {item['price']} ({item['pct_change']:+.2f}%)")
    lines.append("")
    lines.append(f"💡 宏觀評述：{macro['summary']}")
    return {"text": "\n".join(lines)}

@app.get("/api/bot/diagnose/{code}")
def api_bot_diagnose_stock(code: str, cost: Optional[float] = None):
    """
    Text response for stock helper bot inquiry.
    """
    data = market_engine.get_stock_history_and_indicators(code)
    if not data:
        return {"text": f"抱歉，查無代號 {code} 之台股數據，請確認代號是否正確。"}
        
    if cost is not None and cost > 0:
        diag = market_engine.diagnose_stock_holding(data, cost, 1000)
        text = (
            f"🔍【{code} 智能個人持股診斷】\n"
            f"現價：{data['price']} (昨收 {data['prev_price']} | {data['pct_change']:+.2f}%)\n"
            f"買進成本：{cost} 元 (報酬率: {diag['roi_pct']:+.2f}%)\n"
            f"👉 決策建議：【{diag['action_label']}】\n"
            f"🛡️ 關鍵防守停損價：{diag['stop_loss']} 元\n"
            f"🎯 預期波段目標價：{diag['target_price']} 元\n"
            f"📌 指引：{diag['guidance']}\n"
            f"⚠️ 注意：{diag['caution']}"
        )
    else:
        unheld = market_engine.diagnose_unheld_stock(data)
        text = (
            f"🔍【{code} 買點評估與技術分析】\n"
            f"現價：{data['price']} (漲跌: {data['pct_change']:+.2f}%)\n"
            f"20日線(月線)：{data['ma20']} | 支撐：{data['support']} | 壓力：{data['resistance']}\n"
            f"👉 買點狀態：{unheld['buy_status']}\n"
            f"🎯 理想低接價位：{unheld['ideal_buy_price']} 元\n"
            f"⚖️ 風險報酬比(損益比)：1 : {unheld['risk_reward_ratio']}\n"
            f"💡 建議：{unheld['advice']}"
        )
    return {"text": text}

# Mount static files
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir, exist_ok=True)

app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.head("/")
@app.head("/health")
@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.get("/favicon.ico")
def favicon():
    favicon_path = os.path.join(static_dir, "favicon.ico")
    if os.path.exists(favicon_path):
        return FileResponse(favicon_path)
    return JSONResponse(status_code=404, content={"message": "No favicon"})

@app.get("/")
def read_root():
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "台股智能決策戰情室後端已就緒"}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8088))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
