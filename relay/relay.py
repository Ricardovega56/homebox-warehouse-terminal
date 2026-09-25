"""
Print Relay & Companion Service —
1. Fetches label PNGs from Homebox, converts to native Brother QL raster commands, and pipes to CUPS.
2. Companion SQLite API for Par Levels, Dynamic Shopping List, and Cycle Count Audit logs.
"""

import io
import os
import subprocess
import warnings
from contextlib import asynccontextmanager

warnings.filterwarnings("ignore")

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
from brother_ql.conversion import convert
from brother_ql.raster import BrotherQLRaster

import database

HOMEBOX_URL = os.environ.get("HOMEBOX_BASE_URL", "http://homebox:7745")
HOMEBOX_TOKEN = os.environ.get("HOMEBOX_API_TOKEN", "")
PRINTER_NAME = os.environ.get("PRINTER_NAME", "QL-800")
PRINTER_MODEL = os.environ.get("PRINTER_MODEL", "QL-800")
LABEL_TYPE = os.environ.get("LABEL_TYPE", "62red")
CUPS_SERVER = os.environ.get("CUPS_SERVER", "")

DEFAULT_WIDTH = 696  # 62mm printable width at 300 DPI

def quantize_two_color(im: Image.Image) -> Image.Image:
    """Strict quantization for two-color thermal paper (DK-2251)."""
    im_rgb = im.convert("RGB")
    data = im_rgb.getdata()
    cleaned = []
    for r, g, b in data:
        if r > 130 and g < 110 and b < 110:
            cleaned.append((255, 0, 0))
        elif r < 128 and g < 128 and b < 128:
            cleaned.append((0, 0, 0))
        else:
            cleaned.append((255, 255, 255))
    out = Image.new("RGB", im_rgb.size)
    out.putdata(cleaned)
    return out

def prepare_image_for_label(im: Image.Image, label_type: str) -> Image.Image:
    """Resize/pad label image to match brother_ql requirements for the given label type."""
    if label_type == "29x90":
        target_w, target_h = 991, 306
        scale = min(target_w / float(im.size[0]), target_h / float(im.size[1]))
        new_w = max(1, int(im.size[0] * scale))
        new_h = max(1, int(im.size[1] * scale))
        resized = im.resize((new_w, new_h), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (target_w, target_h), (255, 255, 255))
        offset_x = (target_w - new_w) // 2
        offset_y = (target_h - new_h) // 2
        canvas.paste(resized, (offset_x, offset_y))
        return canvas
    else:
        target_w = 696
        if im.size[0] != target_w:
            scale = target_w / float(im.size[0])
            new_h = max(int(im.size[1] * scale), 160)
            im = im.resize((target_w, new_h), Image.Resampling.LANCZOS)
        return im

client: httpx.AsyncClient = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global client
    database.init_db()
    client = httpx.AsyncClient(
        base_url=HOMEBOX_URL,
        timeout=10.0,
    )
    yield
    await client.aclose()

app = FastAPI(title="Homebox Warehouse Companion & Print Relay", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# ── Print Models & Routes ──

class PrintRequest(BaseModel):
    entityId: str
    token: str | None = None
    labelType: str | None = None

@app.post("/print")
async def print_label(req: PrintRequest):
    auth_token = req.token or HOMEBOX_TOKEN
    headers = {"Authorization": f"Bearer {auth_token}"} if auth_token else {}

    resp = await client.get(f"/api/v1/labelmaker/entity/{req.entityId}", headers=headers)
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"Homebox returned {resp.status_code}: {resp.text}")

    label_type = req.labelType or LABEL_TYPE
    is_red = (label_type == "62red")

    try:
        im = Image.open(io.BytesIO(resp.content))
        im = prepare_image_for_label(im, label_type)

        clean_im = quantize_two_color(im) if is_red else im
        qlr = BrotherQLRaster(PRINTER_MODEL)
        instructions = convert(qlr, [clean_im], label_type, cut=True, red=is_red, hq=True)

        cmd = ["lp", "-d", PRINTER_NAME, "-o", "raw"]
        if CUPS_SERVER:
            cmd.extend(["-h", CUPS_SERVER])

        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        stdout, stderr = proc.communicate(input=instructions, timeout=10)
        if proc.returncode != 0:
            raise HTTPException(500, f"lp failed: {stderr.decode()}")
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(500, f"Raster conversion/print failed: {str(e)}")

    return {"status": "printed", "entityId": req.entityId, "labelType": label_type}

# ── Companion: Par Levels & Replenishment ──

class ParLevelRequest(BaseModel):
    entityId: str
    minQuantity: float = 1.0
    targetQuantity: float = 5.0
    unit: str = "pcs"
    supplierUrl: str | None = None

@app.get("/companion/par-levels")
def list_par_levels():
    return database.get_all_par_levels()

@app.post("/companion/par-levels")
def set_par_level(req: ParLevelRequest):
    database.set_par_level(
        entity_id=req.entityId,
        min_qty=req.minQuantity,
        target_qty=req.targetQuantity,
        unit=req.unit,
        supplier_url=req.supplierUrl
    )
    return {"status": "saved", "entityId": req.entityId}

@app.delete("/companion/par-levels/{entity_id}")
def delete_par_level(entity_id: str):
    database.delete_par_level(entity_id)
    return {"status": "deleted", "entityId": entity_id}

# ── Companion: Shopping List ──

class ShoppingItemRequest(BaseModel):
    name: str
    quantityNeeded: float = 1.0
    unit: str = "pcs"
    entityId: str | None = None
    source: str = "manual"

class ShoppingItemUpdateRequest(BaseModel):
    completed: bool

@app.get("/companion/shopping-list")
def list_shopping_items():
    return database.get_shopping_items()

@app.post("/companion/shopping-list")
def add_shopping_item(req: ShoppingItemRequest):
    item_id = database.add_shopping_item(
        name=req.name,
        quantity_needed=req.quantityNeeded,
        unit=req.unit,
        entity_id=req.entityId,
        source=req.source
    )
    return {"status": "added", "id": item_id}

@app.patch("/companion/shopping-list/{item_id}")
def update_shopping_item(item_id: int, req: ShoppingItemUpdateRequest):
    database.update_shopping_item(item_id, req.completed)
    return {"status": "updated", "id": item_id, "completed": req.completed}

@app.delete("/companion/shopping-list/{item_id}")
def delete_shopping_item(item_id: int):
    database.delete_shopping_item(item_id)
    return {"status": "deleted", "id": item_id}

@app.delete("/companion/shopping-list-clear-completed")
def clear_completed_shopping():
    database.clear_completed_shopping_items()
    return {"status": "cleared"}

# ── Companion: Cycle Count Audits ──

class CycleCountLogRequest(BaseModel):
    locationId: str
    locationName: str
    itemsExpected: int
    itemsVerified: int
    discrepancies: int
    notes: str | None = None

@app.post("/companion/cycle-counts")
def log_cycle_count(req: CycleCountLogRequest):
    audit_id = database.record_cycle_count(
        location_id=req.locationId,
        location_name=req.locationName,
        items_expected=req.itemsExpected,
        items_verified=req.itemsVerified,
        discrepancies=req.discrepancies,
        notes=req.notes
    )
    return {"status": "recorded", "id": audit_id}

@app.get("/companion/cycle-counts")
def list_cycle_counts():
    return database.get_recent_cycle_counts()

# ── Companion: Global Barcode Lookup (UPC/EAN) ──

@app.get("/companion/barcode-lookup/{barcode}")
async def lookup_barcode(barcode: str):
    clean_code = barcode.strip()
    
    # 1. Query Open Food Facts (Groceries, toiletries, household consumables)
    try:
        off_url = f"https://world.openfoodfacts.org/api/v2/product/{clean_code}.json"
        async with httpx.AsyncClient(timeout=4.0) as http_client:
            res = await http_client.get(off_url)
            if res.status_code == 200:
                data = res.json()
                if data.get("status") == 1 and "product" in data:
                    p = data["product"]
                    name = p.get("product_name") or p.get("product_name_en")
                    if name:
                        return {
                            "found": True,
                            "barcode": clean_code,
                            "name": name.strip(),
                            "brand": (p.get("brands") or "").strip(),
                            "description": (p.get("generic_name") or p.get("categories") or "").strip(),
                            "imageUrl": p.get("image_front_url") or p.get("image_url"),
                            "source": "OpenFoodFacts"
                        }
    except Exception:
        pass

    # 2. Query UPCitemdb (Tools, hardware, electronics, general retail)
    try:
        upc_url = f"https://api.upcitemdb.com/prod/trial/lookup?upc={clean_code}"
        async with httpx.AsyncClient(timeout=4.0) as http_client:
            res = await http_client.get(upc_url)
            if res.status_code == 200:
                data = res.json()
                items = data.get("items", [])
                if items:
                    item = items[0]
                    name = item.get("title")
                    if name:
                        images = item.get("images", [])
                        return {
                            "found": True,
                            "barcode": clean_code,
                            "name": name.strip(),
                            "brand": (item.get("brand") or "").strip(),
                            "description": (item.get("description") or "").strip(),
                            "imageUrl": images[0] if images else None,
                            "source": "UPCitemdb"
                        }
    except Exception:
        pass

    return {"found": False, "barcode": clean_code}

@app.get("/companion/proxy-image")
async def proxy_image(url: str):
    if not url.startswith("http://") and not url.startswith("https://"):
        raise HTTPException(400, "Invalid image URL")
    try:
        async with httpx.AsyncClient(timeout=6.0) as http_client:
            res = await http_client.get(url)
            if res.status_code != 200:
                raise HTTPException(res.status_code, "Failed to download remote image")
            content_type = res.headers.get("content-type", "image/jpeg")
            from fastapi.responses import Response
            return Response(content=res.content, media_type=content_type)
    except Exception as e:
        raise HTTPException(500, f"Proxy failed: {str(e)}")

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "hwt-companion-relay",
        "printer": PRINTER_NAME,
        "model": PRINTER_MODEL,
        "labelType": LABEL_TYPE,
        "cups_server": CUPS_SERVER or "local"
    }
