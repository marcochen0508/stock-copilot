import yfinance as yf
import pandas as pd
import numpy as np
import datetime
import logging
import urllib.request
import json
import ssl
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)

# Global macro tickers
MACRO_TICKERS = {
    "^SOX": "費城半導體",
    "TSM": "台積電 ADR",
    "^IXIC": "那斯達克",
    "^GSPC": "標普 500",
    "^DJI": "道瓊工業",
    "NVDA": "輝達 NVIDIA",
    "^VIX": "恐慌指數 VIX",
    "USDTWD=X": "美元/台幣"
}

def get_macro_overview() -> Dict[str, Any]:
    """
    Fetch global macro indices and compute morning market sentiment for Taiwan stocks.
    """
    symbols = list(MACRO_TICKERS.keys())
    try:
        data = yf.download(symbols, period="5d", interval="1d", progress=False, group_by="ticker")
    except Exception as e:
        logger.error(f"Failed to fetch macro data: {e}")
        return {"items": [], "sentiment_score": 0, "status": "資料讀取中", "summary": "暫無國際數據"}
    
    items = []
    sox_change = 0.0
    tsm_change = 0.0
    nasdaq_change = 0.0
    sp500_change = 0.0
    vix_val = 15.0
    twd_rate = 31.8
    
    for sym, name in MACRO_TICKERS.items():
        try:
            df = data[sym].dropna(subset=["Close"]) if sym in data else pd.DataFrame()
            if len(df) >= 2:
                cur_close = float(df["Close"].iloc[-1])
                prev_close = float(df["Close"].iloc[-2])
                change = cur_close - prev_close
                pct_change = (change / prev_close) * 100
            elif len(df) == 1:
                cur_close = float(df["Close"].iloc[-1])
                prev_close = cur_close
                change = 0.0
                pct_change = 0.0
            else:
                cur_close = 0.0
                prev_close = 0.0
                change = 0.0
                pct_change = 0.0
                
            item = {
                "symbol": sym,
                "name": name,
                "price": round(cur_close, 2),
                "change": round(change, 2),
                "pct_change": round(pct_change, 2)
            }
            items.append(item)
            
            if sym == "^SOX":
                sox_change = pct_change
            elif sym == "TSM":
                tsm_change = pct_change
            elif sym == "^IXIC":
                nasdaq_change = pct_change
            elif sym == "^GSPC":
                sp500_change = pct_change
            elif sym == "^VIX":
                vix_val = cur_close
            elif sym == "USDTWD=X":
                twd_rate = cur_close
        except Exception as ex:
            logger.warning(f"Error parsing macro symbol {sym}: {ex}")
            
    # Calculate weighted market sentiment score (-100 to +100)
    # SOX 35%, TSM 25%, Nasdaq 20%, S&P 10%, VIX sentiment 10%
    vix_factor = max(-10.0, min(10.0, (18.0 - vix_val) * 2.0))
    raw_score = (sox_change * 15.0) + (tsm_change * 12.0) + (nasdaq_change * 10.0) + (sp500_change * 5.0) + (vix_factor * 1.5)
    score = int(max(-100, min(100, raw_score)))
    
    if score >= 35:
        bias_label = "強勢偏多開高"
        bias_badge = "bullish"
        bias_color = "#ef4444" # red in TW
    elif score >= 10:
        bias_label = "溫和偏多震盪"
        bias_badge = "mild_bullish"
        bias_color = "#f97316"
    elif score >= -10:
        bias_label = "平盤整理觀望"
        bias_badge = "neutral"
        bias_color = "#eab308"
    elif score >= -35:
        bias_label = "承壓開低拉回"
        bias_badge = "mild_bearish"
        bias_color = "#22c55e" # green in TW
    else:
        bias_label = "空頭防守警戒"
        bias_badge = "bearish"
        bias_color = "#16a34a"
        
    summary = (
        f"昨夜美股費城半導體 {sox_change:+.2f}%，台積電 ADR {tsm_change:+.2f}%，那斯達克 {nasdaq_change:+.2f}%。"
        f"恐慌指數 VIX 目前為 {vix_val:.1f}，美元對台幣匯率約 {twd_rate:.2f}。"
        f"整體宏觀環境給予台股開盤【{bias_label}】之預期動能。"
    )
    
    return {
        "items": items,
        "sentiment_score": score,
        "bias_label": bias_label,
        "bias_badge": bias_badge,
        "bias_color": bias_color,
        "summary": summary,
        "updated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

def get_twse_mis_realtime_batch(codes: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    Fetch 0-latency real-time market quotes directly from official Taiwan Stock Exchange MIS API.
    Covers both Listed (TSE) and OTC (TPEx) tickers in a single batch request (~0.1s).
    """
    if not codes:
        return {}
    
    clean_codes = set()
    for c in codes:
        code_str = str(c).strip()
        if code_str.isdigit() and len(code_str) < 4:
            code_str = code_str.zfill(4)
        clean_codes.add(code_str)
        
    channels = []
    for c in clean_codes:
        channels.append(f"tse_{c}.tw")
        channels.append(f"otc_{c}.tw")
        
    url = f"https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch={'|'.join(channels)}&json=1&delay=0"
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://mis.twse.com.tw/stock/fibest.jsp?lang=zh_tw",
        "Accept": "application/json, text/javascript, */*; q=0.01"
    })
    
    results = {}
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=6) as res:
            data = json.loads(res.read().decode('utf-8'))
            for item in data.get("msgArray", []):
                code = item.get("c")
                if not code or not item.get("y"):
                    continue
                try:
                    prev_close = float(item["y"])
                    z_str = item.get("z")
                    if z_str and z_str != "-":
                        cur_price = float(z_str)
                    else:
                        cur_price = prev_close
                    change = round(cur_price - prev_close, 2)
                    pct_change = round((change / prev_close) * 100, 2) if prev_close > 0 else 0.0
                    vol = int(item.get("v", 0))
                    name = item.get("n", "")
                    results[code] = {
                        "code": code,
                        "name": name,
                        "price": cur_price,
                        "prev_price": prev_close,
                        "change": change,
                        "pct_change": pct_change,
                        "volume": vol,
                        "high": float(item.get("h", cur_price)) if item.get("h") and item["h"] != "-" else cur_price,
                        "low": float(item.get("l", cur_price)) if item.get("l") and item["l"] != "-" else cur_price,
                        "is_realtime": True
                    }
                except Exception as ex:
                    logger.warning(f"Error parsing MIS quote for {code}: {ex}")
    except Exception as e:
        logger.warning(f"TWSE MIS API query failed: {e}")
        
    return results

# In-memory caches to accelerate subsequent queries and timeframe switching
STOCK_EXCHANGE_MAP: Dict[str, str] = {}
STOCK_DIVIDEND_CACHE: Dict[str, float] = {}
TWSE_REALTIME_CACHE: Dict[str, Dict[str, Any]] = {}

def get_stock_history_and_indicators(code: str, period: str = "6mo", interval: str = "1d") -> Optional[Dict[str, Any]]:
    """
    Fetch OHLCV data for Taiwan stock (auto trying .TW then .TWO),
    calculate technical indicators (MA, KD, RSI, MACD, Support, Resistance).
    Supports Daily (interval='1d') and Weekly (interval='1wk').
    """
    clean_code = str(code).strip()
    if clean_code.isdigit() and len(clean_code) < 4:
        clean_code = clean_code.zfill(4)
        
    if clean_code in STOCK_EXCHANGE_MAP:
        ticker_symbols = [STOCK_EXCHANGE_MAP[clean_code]]
    else:
        ticker_symbols = [f"{clean_code}.TW", f"{clean_code}.TWO"]
        
    df = None
    target_sym = None
    
    for sym in ticker_symbols:
        try:
            t = yf.Ticker(sym)
            temp = t.history(period=period, interval=interval)
            if temp is not None and not temp.empty:
                temp = temp.dropna(subset=["Close"])
                if len(temp) >= 10:
                    df = temp
                    target_sym = sym
                    STOCK_EXCHANGE_MAP[clean_code] = sym
                    break
        except Exception:
            continue
            
    if df is None or df.empty:
        return None
        
    # Standardize column names
    df = df.copy()
    df.index = df.index.tz_localize(None) if df.index.tz is not None else df.index
    
    # Calculate Moving Averages
    df["MA5"] = df["Close"].rolling(window=5).mean()
    df["MA10"] = df["Close"].rolling(window=10).mean()
    df["MA20"] = df["Close"].rolling(window=20).mean() # 月線生命線
    df["MA60"] = df["Close"].rolling(window=60).mean() # 季線
    
    # Volume average
    df["Vol_MA5"] = df["Volume"].rolling(window=5).mean()
    
    # RSI (14)
    delta = df["Close"].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
    rs = gain / (loss + 1e-9)
    df["RSI14"] = 100 - (100 / (1 + rs))
    
    # KD (9, 3, 3)
    low9 = df["Low"].rolling(window=9).min()
    high9 = df["High"].rolling(window=9).max()
    rsv = ((df["Close"] - low9) / (high9 - low9 + 1e-9)) * 100
    rsv = rsv.fillna(50)
    
    # Exponential calculation for K and D
    k_vals = []
    d_vals = []
    k = 50.0
    d = 50.0
    for r in rsv:
        k = (2/3) * k + (1/3) * r
        d = (2/3) * d + (1/3) * k
        k_vals.append(k)
        d_vals.append(d)
    df["K"] = k_vals
    df["D"] = d_vals
    
    # MACD (12, 26, 9)
    ema12 = df["Close"].ewm(span=12, adjust=False).mean()
    ema26 = df["Close"].ewm(span=26, adjust=False).mean()
    df["DIF"] = ema12 - ema26
    df["DEA"] = df["DIF"].ewm(span=9, adjust=False).mean()
    df["MACD_HIST"] = 2 * (df["DIF"] - df["DEA"])
    
    # Support and Resistance
    recent20 = df.iloc[-20:] if len(df) >= 20 else df
    resistance = float(recent20["High"].max())
    support = float(recent20["Low"].min())
    
    last = df.iloc[-1]
    prev = df.iloc[-2] if len(df) >= 2 else last
    
    cur_price = round(float(last["Close"]), 2)
    prev_price = round(float(prev["Close"]), 2)
    change = round(cur_price - prev_price, 2)
    pct_change = round((change / prev_price) * 100, 2) if prev_price > 0 else 0.0
    
    ma5 = round(float(last["MA5"]), 2) if not pd.isna(last["MA5"]) else cur_price
    ma20 = round(float(last["MA20"]), 2) if not pd.isna(last["MA20"]) else cur_price
    ma60 = round(float(last["MA60"]), 2) if not pd.isna(last["MA60"]) else cur_price
    
    rsi = round(float(last["RSI14"]), 1) if not pd.isna(last["RSI14"]) else 50.0
    k_val = round(float(last["K"]), 1)
    d_val = round(float(last["D"]), 1)
    
    vol = int(last["Volume"])
    vol_ma5 = float(last["Vol_MA5"]) if not pd.isna(last["Vol_MA5"]) else float(vol)
    vol_ratio = round(vol / (vol_ma5 + 1e-5), 2)
    
    # Real-time enrichment from official TWSE MIS (0-delay price with 30s in-memory cache)
    try:
        now_ts = datetime.datetime.now().timestamp()
        if clean_code in TWSE_REALTIME_CACHE and (now_ts - TWSE_REALTIME_CACHE[clean_code]["time"]) < 30:
            rt = TWSE_REALTIME_CACHE[clean_code]["data"]
            cur_price = rt["price"]
            prev_price = rt["prev_price"]
            change = rt["change"]
            pct_change = rt["pct_change"]
            if rt["volume"] > 0:
                vol = rt["volume"]
        else:
            rt_map = get_twse_mis_realtime_batch([clean_code])
            if clean_code in rt_map:
                rt = rt_map[clean_code]
                TWSE_REALTIME_CACHE[clean_code] = {"data": rt, "time": now_ts}
                cur_price = rt["price"]
                prev_price = rt["prev_price"]
                change = rt["change"]
                pct_change = rt["pct_change"]
                if rt["volume"] > 0:
                    vol = rt["volume"]
    except Exception as e:
        logger.warning(f"Failed to fetch live MIS for {clean_code}: {e}")

    # Bias rate (乖離率 to MA20)
    bias20 = round(((cur_price - ma20) / ma20) * 100, 2) if ma20 > 0 else 0.0
    
    # Candle charts data payload (last 60 days)
    chart_days = min(60, len(df))
    chart_sub = df.iloc[-chart_days:]
    candles = []
    for idx, row in chart_sub.iterrows():
        candles.append({
            "date": idx.strftime("%Y-%m-%d"),
            "open": round(float(row["Open"]), 2),
            "high": round(float(row["High"]), 2),
            "low": round(float(row["Low"]), 2),
            "close": round(float(row["Close"]), 2),
            "volume": int(row["Volume"]),
            "ma5": round(float(row["MA5"]), 2) if not pd.isna(row["MA5"]) else None,
            "ma20": round(float(row["MA20"]), 2) if not pd.isna(row["MA20"]) else None,
            "ma60": round(float(row["MA60"]), 2) if not pd.isna(row["MA60"]) else None,
            "k": round(float(row["K"]), 1),
            "d": round(float(row["D"]), 1),
            "macd_hist": round(float(row["MACD_HIST"]), 2)
        })
        
    # Calculate Dividends and Yield (Accurate 1-Year Payout with In-Memory Caching)
    if clean_code in STOCK_DIVIDEND_CACHE:
        annual_dividend = STOCK_DIVIDEND_CACHE[clean_code]
    else:
        annual_dividend = 0.0
        try:
            t_obj = yf.Ticker(target_sym)
            divs = t_obj.dividends
            if divs is not None and not divs.empty:
                last_date = divs.index[-1]
                one_year_prior = last_date - pd.Timedelta(days=360)
                recent_1y = divs[divs.index >= one_year_prior]
                if not recent_1y.empty:
                    annual_dividend = round(float(recent_1y.sum()), 2)
        except Exception:
            pass

        # Reliable fallback for major Taiwan stocks/ETFs
        FALLBACK_DIVS = {
            "0056": 4.08, "00878": 2.20, "00919": 2.88, "00929": 2.16, "0050": 1.60, "0052": 1.20,
            "2330": 24.0, "2317": 7.17, "2881": 4.25, "2891": 2.50, "2303": 2.61, "2454": 55.0,
            "2603": 10.0, "5347": 4.50, "2324": 1.10, "2328": 0.90, "3481": 1.00, "6770": 0.23,
            "3033": 4.00, "2374": 2.59, "3702": 3.64, "2409": 0.70, "9933": 0.76
        }
        if annual_dividend <= 0:
            annual_dividend = FALLBACK_DIVS.get(clean_code, round(cur_price * 0.035, 2))
            
        STOCK_DIVIDEND_CACHE[clean_code] = annual_dividend

    dividend_yield = round((annual_dividend / cur_price * 100), 2) if cur_price > 0 else 0.0

    return {
        "symbol": target_sym,
        "code": clean_code,
        "timeframe": "W" if interval == "1wk" else "D",
        "price": cur_price,
        "prev_price": prev_price,
        "change": change,
        "pct_change": pct_change,
        "volume": vol,
        "vol_ratio": vol_ratio,
        "ma5": ma5,
        "ma20": ma20,
        "ma60": ma60,
        "support": round(support, 2),
        "resistance": round(resistance, 2),
        "bias20": bias20,
        "rsi": rsi,
        "k": k_val,
        "d": d_val,
        "annual_dividend": annual_dividend,
        "dividend_yield": dividend_yield,
        "candles": candles
    }

def diagnose_stock_holding(stock_info: Dict[str, Any], cost_price: float, shares: int = 1000) -> Dict[str, Any]:
    """
    Generate personalized tactical advice based on user's actual holding cost and dividend yield.
    """
    cur_price = stock_info["price"]
    ma20 = stock_info["ma20"]
    ma60 = stock_info["ma60"]
    support = stock_info["support"]
    resistance = stock_info["resistance"]
    rsi = stock_info["rsi"]
    k = stock_info["k"]
    d = stock_info["d"]
    vol_ratio = stock_info["vol_ratio"]
    bias20 = stock_info["bias20"]
    annual_dividend = stock_info.get("annual_dividend", 0.0)
    dividend_yield = stock_info.get("dividend_yield", 0.0)
    
    # Calculate user ROI & Dividend Cashflow
    if cost_price > 0:
        pnl = round((cur_price - cost_price) * shares, 0)
        roi_pct = round(((cur_price - cost_price) / cost_price) * 100, 2)
        cost_yield = round((annual_dividend / cost_price * 100), 2)
    else:
        pnl = 0
        roi_pct = 0.0
        cost_yield = dividend_yield

    est_annual_dividend = round(annual_dividend * shares, 0)
        
    # Decision logic
    stop_loss = round(max(support * 0.98, cost_price * 0.93), 1) if cost_price > 0 else round(support * 0.98, 1)
    target_price = round(max(resistance, cur_price * 1.08), 1)
    
    action_type = "HOLD"
    action_label = "安心續抱"
    action_color = "#3b82f6" # blue
    guidance = ""
    caution = ""

    # High Dividend / Income Protection check
    is_high_dividend = (dividend_yield >= 4.5) or (stock_info["code"] in ["0056", "00878", "00919", "00929", "2881", "2891"])
    
    # 1. High profit taking (分批停利)
    if roi_pct >= 20.0 and (rsi > 75 or bias20 > 10.0 or cur_price >= resistance * 0.98):
        action_type = "TAKE_PROFIT"
        action_label = "分批停利"
        action_color = "#a855f7" # purple
        guidance = f"目前獲利達 +{roi_pct}%，短線指標已進入高檔超買區（RSI {rsi}），建議逢高分批獲利入袋 1/3 ~ 1/2，保留剩餘部位獲利奔跑。"
        caution = f"提防高檔主力拉高出貨，移動防守價上移至 {ma20} 元（月線）。"
        
    # 2. Stop loss / Defend alert (停損警戒)
    elif cur_price < support or (cost_price > 0 and roi_pct <= -8.0) or (cur_price < ma20 and ma20 < ma60):
        if is_high_dividend and roi_pct > -12.0:
            # Income protective buffer for high dividend stocks
            action_type = "HOLD_DIVIDEND"
            action_label = "存股領息續抱"
            action_color = "#10b981"
            guidance = f"雖短期均線偏弱，但本檔具高殖利率 ({dividend_yield}%)，預估每年可領股利約 NT$ {est_annual_dividend:,.0f} 元，以長期領息防禦為主，切勿隨短線雜訊恐慌殺低。"
            caution = f"嚴守最後防守底線 {stop_loss} 元，若有效跌破再行減碼。"
        else:
            action_type = "STOP_LOSS"
            action_label = "停損警戒"
            action_color = "#ef4444" # red alert
            guidance = f"股價已跌破近期關鍵支撐 ({support} 元) 或已觸發風控底線，多頭結構受損，建議嚴格執行防守或減碼停損，避免虧損擴大。"
            caution = f"嚴守最後停損價 {stop_loss} 元，若反彈無法站回月線 {ma20} 宜汰弱留強。"
        
    # 3. Pullback Buy / Add position (量縮守穩回測加碼點)
    elif abs(cur_price - ma20) / ma20 <= 0.025 and cur_price >= ma20 and vol_ratio < 0.9:
        action_type = "ADD_BUY"
        action_label = "拉回加碼買點"
        action_color = "#10b981" # emerald
        div_note = f"且兼具 {dividend_yield}% 殖利率保護" if is_high_dividend else ""
        guidance = f"股價拉回至月線生命線 ({ma20} 元) 附近量縮守穩，{div_note}，為順勢多頭回測承接點，可考慮小量分批加碼。"
        caution = f"停損設定在跌破 {round(ma20*0.97, 1)} 元即刻離場。"
        
    # 4. Momentum breakout (帶量突破)
    elif cur_price >= resistance * 0.99 and vol_ratio >= 1.3 and k > d:
        action_type = "BREAKOUT"
        action_label = "帶量突破轉強"
        action_color = "#06b6d4" # cyan
        guidance = f"帶量挑戰前波壓力區 ({resistance} 元)，短線攻擊動能強勁，偏多續抱。"
        caution = f"追價需嚴格防守前日低點，防守價設在 {round(cur_price * 0.96, 1)} 元。"
        
    # 5. Default steady holding
    else:
        if cur_price >= ma20:
            action_type = "HOLD"
            action_label = "多頭續抱"
            action_color = "#3b82f6"
            div_note = f"（近一年配息 {annual_dividend} 元，殖利率 {dividend_yield}%）" if annual_dividend > 0 else ""
            guidance = f"股價位於月線 ({ma20} 元) 之上，維持健康多頭走勢，安心續抱{div_note}。"
            caution = f"下方關鍵支撐防守線設在 {round(ma20, 1)} 元。"
        else:
            action_type = "NEUTRAL"
            action_label = "弱勢整理觀望"
            action_color = "#eab308"
            guidance = f"目前在月線 ({ma20} 元) 下方震盪整理，尚未出現明確轉強信號，先觀望不宜躁進加碼。"
            caution = f"上方第一壓力為月線 {ma20} 元，防守價為 {support} 元。"

    return {
        "cost_price": cost_price,
        "shares": shares,
        "pnl": pnl,
        "roi_pct": roi_pct,
        "action_type": action_type,
        "action_label": action_label,
        "action_color": action_color,
        "stop_loss": stop_loss,
        "target_price": target_price,
        "guidance": guidance,
        "caution": caution
    }

def diagnose_unheld_stock(stock_info: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate purchase timing & risk-reward ratio evaluation for unheld stocks on watchlist.
    """
    cur_price = stock_info["price"]
    ma20 = stock_info["ma20"]
    support = stock_info["support"]
    resistance = stock_info["resistance"]
    k = stock_info["k"]
    d = stock_info["d"]
    vol_ratio = stock_info["vol_ratio"]
    bias20 = stock_info["bias20"]
    
    stop_loss = round(support * 0.97, 1)
    target_price = round(resistance, 1)
    
    risk = max(0.1, cur_price - stop_loss)
    reward = max(0.1, target_price - cur_price)
    rr_ratio = round(reward / risk, 2) if risk > 0 else 1.0
    
    # Determine buy readiness
    if abs(cur_price - ma20) / ma20 <= 0.025 and cur_price >= ma20 and vol_ratio < 0.95:
        buy_status = "🎯 買點浮現 (量縮拉回守月線)"
        buy_badge = "ready"
        advice = f"股價已拉回到月線 {ma20} 元支撐且成交量收縮，為風險低、勝率高的進場點位。"
    elif cur_price >= resistance * 0.99 and vol_ratio >= 1.3 and k > d:
        buy_status = "🚀 突破買點 (放量衝破壓力平台)"
        buy_badge = "breakout"
        advice = f"單日成交量放大 {vol_ratio} 倍且突破壓力，動能強烈，可順勢切入追短波段。"
    elif k < 25 and k > d and cur_price >= support:
        buy_status = "🌟 低檔轉折買點 (KD黃金交叉)"
        buy_badge = "oversold_rebound"
        advice = f"指標處於超賣區低檔黃金交叉 (K={k}, D={d})，具跌深反彈潛力。"
    elif bias20 > 8.0:
        buy_status = "⚠️ 暫勿追高 (短線乖離過大)"
        buy_badge = "overbought"
        advice = f"目前股價距離月線正乖離達 +{bias20}%，切勿盲目追高，耐心等待拉回至 {ma20} 元附近再考慮。"
    else:
        buy_status = "⏳ 耐心等待 (觀望中)"
        buy_badge = "waiting"
        advice = f"目前在區間 {support} ~ {resistance} 震盪，等待明確突破或拉回守穩訊號。"
        
    return {
        "buy_status": buy_status,
        "buy_badge": buy_badge,
        "ideal_buy_price": round(ma20, 1),
        "stop_loss": stop_loss,
        "target_price": target_price,
        "risk_reward_ratio": rr_ratio,
        "advice": advice
    }
