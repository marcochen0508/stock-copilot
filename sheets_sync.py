import urllib.request
import re
import csv
import io
import json
import logging
from typing import Dict, List, Any

logger = logging.getLogger(__name__)

DEFAULT_SHEET_ID = "1-V4symZ1Ku_sqCDYlbvppRVVcryey5JJ7P5WE2SPZhQ"

def fetch_sheet_tabs_metadata(sheet_id: str = DEFAULT_SHEET_ID) -> List[Dict[str, str]]:
    """
    Dynamically discover all tabs and their gids from the public Google Sheet HTML.
    """
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit?usp=sharing"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    
    tabs = []
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
        
        # Google Sheets serializes tabs in its topsnapshot / bootstrapData HTML.
        # Format can be escaped JSON (\\\"gid\\\",[{\\\"1\\\":[[0,0,\\\"TabName\\\"]]) or unescaped (\")
        patterns = [
            r'\\\"(\d+)\\\",\[\{\\\"1\\\":\[\[\d+,\d+,\\\"([^\\\"]+)\\\"',
            r'\"(\d+)\",\[\{\"1\":\[\[\d+,\d+,\"([^\"]+)\"\]',
        ]
        for pat in patterns:
            matches = re.findall(pat, html)
            for gid, name in matches:
                if '\\u' in name:
                    try:
                        name = name.encode('utf-8').decode('unicode-escape')
                    except Exception:
                        pass
                name = name.strip()
                if not any(t["gid"] == gid for t in tabs):
                    tabs.append({"name": name, "gid": gid})
            if tabs:
                break
    except Exception as e:
        logger.error(f"Error discovering tabs via HTML: {e}")
    
    # Fallback if dynamic discovery fails
    if not tabs:
        if sheet_id == DEFAULT_SHEET_ID:
            tabs = [
                {"name": "台北-阿良", "gid": "0"},
                {"name": "三重-甘露涓", "gid": "1890723779"},
                {"name": "景維", "gid": "1905018479"},
                {"name": "阿輝", "gid": "605317612"}
            ]
        else:
            # For user's custom sheet, fallback to default main sheet
            tabs = [{"name": "持股清單", "gid": "0"}]
    return tabs

def fetch_tab_holdings(sheet_id: str, gid: str) -> List[Dict[str, Any]]:
    """
    Download CSV for a specific sheet tab and parse holding rows.
    """
    csv_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
    req = urllib.request.Request(csv_url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    
    holdings = []
    with urllib.request.urlopen(req, timeout=10) as resp:
        text = resp.read().decode("utf-8")
        reader = csv.reader(io.StringIO(text))
        rows = list(reader)
        if not rows:
            return []
        
        # Header is usually row 0: ['股票代號', '股票名稱', '股數', '每股成本', '總成本']
        header = [c.strip() for c in rows[0]]
        
        # Find column indices with smart fuzzy matching
        code_idx = None
        name_idx = None
        shares_idx = None
        cost_idx = None
        total_idx = None
        
        for i, h_raw in enumerate(header):
            h = h_raw.strip().lower()
            if any(k in h for k in ["代號", "代碼", "code", "symbol", "股票"]):
                if code_idx is None:
                    code_idx = i
            elif any(k in h for k in ["名稱", "股名", "name"]):
                if name_idx is None:
                    name_idx = i
            elif any(k in h for k in ["股數", "數量", "庫存", "shares", "qty", "張數"]):
                if shares_idx is None:
                    shares_idx = i
            elif any(k in h for k in ["每股成本", "均價", "買進價", "成本", "買入", "cost", "avg"]):
                if "總" not in h and cost_idx is None:
                    cost_idx = i
            elif any(k in h for k in ["總成本", "總價", "投入金額", "total"]):
                if total_idx is None:
                    total_idx = i
                    
        # Defaults if not matched
        code_idx = 0 if code_idx is None else code_idx
        name_idx = (1 if len(header) > 1 else 0) if name_idx is None else name_idx
        shares_idx = (2 if len(header) > 2 else 1) if shares_idx is None else shares_idx
        cost_idx = (3 if len(header) > 3 else 2) if cost_idx is None else cost_idx
                
        for row in rows[1:]:
            if not row or len(row) <= code_idx:
                continue
            code = row[code_idx].strip()
            if not code or not (code[0].isdigit() or code.startswith("00")):
                continue
                
            # Clean stock code: ensure 4 digits or leading 0s
            if code.isdigit() and len(code) < 4:
                code = code.zfill(4)
                
            name = row[name_idx].strip() if len(row) > name_idx else code
            
            # Parse shares (support comma separators and string floats)
            try:
                shares_str = row[shares_idx].replace(",", "").strip() if len(row) > shares_idx else "0"
                shares = float(shares_str) if shares_str else 0.0
            except:
                shares = 0.0
                
            # Parse per-share cost
            cost = 0.0
            try:
                cost_str = row[cost_idx].replace(",", "").strip() if len(row) > cost_idx else "0"
                cost = float(cost_str) if cost_str else 0.0
            except:
                cost = 0.0
                
            # Fallback: if per-share cost is missing but total cost exists, compute it
            if cost <= 0 and total_idx is not None and len(row) > total_idx and shares > 0:
                try:
                    tot_str = row[total_idx].replace(",", "").strip()
                    tot_val = float(tot_str) if tot_str else 0.0
                    if tot_val > 0:
                        cost = round(tot_val / shares, 2)
                except:
                    pass
                
            # Parse total cost
            try:
                total_str = row[total_idx].replace(",", "").strip() if len(row) > total_idx else "0"
                total_cost = float(total_str) if total_str else (shares * cost)
            except:
                total_cost = shares * cost
                
            if shares > 0 or cost > 0:
                holdings.append({
                    "code": code,
                    "name": name,
                    "shares": int(shares),
                    "cost_price": cost,
                    "total_cost": total_cost
                })
    return holdings

def clean_person_name(name: str) -> str:
    """直接採用試算表的分頁名稱（例如「台北-阿良」、「三重-甘露涓」），完整保留分頁命名"""
    return name.strip()

def get_all_sheet_portfolios(sheet_id: str = DEFAULT_SHEET_ID) -> Dict[str, Any]:
    from concurrent.futures import ThreadPoolExecutor
    tabs = fetch_sheet_tabs_metadata(sheet_id)
    portfolios = {}
    
    def _fetch_single_tab(tab):
        display_name = clean_person_name(tab["name"])
        try:
            items = fetch_tab_holdings(sheet_id, tab["gid"])
            return display_name, {
                "name": display_name,
                "raw_tab_name": tab["name"],
                "gid": tab["gid"],
                "holdings": items
            }
        except Exception as e:
            logger.error(f"Error fetching holdings for {tab['name']}: {e}")
            return display_name, {
                "name": display_name,
                "raw_tab_name": tab["name"],
                "gid": tab["gid"],
                "holdings": [],
                "error": str(e)
            }

    with ThreadPoolExecutor(max_workers=len(tabs) or 4) as executor:
        results = executor.map(_fetch_single_tab, tabs)
        for display_name, data in results:
            portfolios[display_name] = data
            
    return portfolios
