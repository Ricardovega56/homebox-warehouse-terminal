"""
Print Relay — Fetches label PNGs from Homebox and pipes them to CUPS.

POST /print { "entityId": "<uuid>" }
  1. GET /api/v1/labelmaker/entity/{id} from Homebox → PNG bytes
  2. Write to temp file
  3. lp -d <PRINTER_NAME> -o media=29x90mm /tmp/label.png
"""

import os
import subprocess
import tempfile
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

HOMEBOX_URL = os.environ.get("HOMEBOX_BASE_URL", "http://homebox:7745")
HOMEBOX_TOKEN = os.environ.get("HOMEBOX_API_TOKEN", "")
PRINTER_NAME = os.environ.get("PRINTER_NAME", "Brother_QL_800")

client: httpx.AsyncClient = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global client
    client = httpx.AsyncClient(
        base_url=HOMEBOX_URL,
        headers={"Authorization": f"Bearer {HOMEBOX_TOKEN}"},
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

@app.post("/print")
async def print_label(req: PrintRequest):
    # Fetch label PNG from Homebox
    resp = await client.get(f"/api/v1/labelmaker/entity/{req.entityId}")
    if resp.status_code != 200:
        raise HTTPException(502, f"Homebox returned {resp.status_code}: {resp.text}")

    # Write to temp file and send to CUPS
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        f.write(resp.content)
        tmp_path = f.name

    try:
        result = subprocess.run(
            ["lp", "-d", PRINTER_NAME, "-o", "media=29x90mm", tmp_path],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            raise HTTPException(500, f"lp failed: {result.stderr}")
    finally:
        os.unlink(tmp_path)

    return {"status": "printed", "entityId": req.entityId}

@app.get("/health")
async def health():
    return {"status": "ok", "printer": PRINTER_NAME}
