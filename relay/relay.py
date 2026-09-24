"""
Print Relay — Fetches label PNGs from Homebox, converts to native Brother QL
raster commands, and pipes them directly to CUPS (-o raw).
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
        # Die-cut 29mm x 90mm label (991 x 306 dots in landscape)
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
        # Endless rolls (62mm: 62red or 62)
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
    client = httpx.AsyncClient(
        base_url=HOMEBOX_URL,
        timeout=10.0,
    )
    yield
    await client.aclose()

app = FastAPI(title="Homebox Print Relay", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

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

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "printer": PRINTER_NAME,
        "model": PRINTER_MODEL,
        "labelType": LABEL_TYPE,
        "cups_server": CUPS_SERVER or "local"
    }
