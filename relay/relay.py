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
PRINTER_NAME = os.environ.get("PRINTER_NAME", "QL-800")
CUPS_SERVER = os.environ.get("CUPS_SERVER", "")
MEDIA_SIZE = os.environ.get("MEDIA_SIZE", "62X1")

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
    media: str | None = None

@app.post("/print")
async def print_label(req: PrintRequest):
    # Fetch label PNG from Homebox
    auth_token = req.token or HOMEBOX_TOKEN
    headers = {"Authorization": f"Bearer {auth_token}"} if auth_token else {}
    resp = await client.get(f"/api/v1/labelmaker/entity/{req.entityId}", headers=headers)
    if resp.status_code != 200:
        raise HTTPException(502, f"Homebox returned {resp.status_code}: {resp.text}")

    # Write to temp file and send to CUPS
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        f.write(resp.content)
        tmp_path = f.name

    try:
        media = req.media or MEDIA_SIZE
        cmd = ["lp", "-d", PRINTER_NAME]
        if media:
            cmd.extend(["-o", f"media={media}"])
        if CUPS_SERVER:
            cmd.extend(["-h", CUPS_SERVER])
        cmd.append(tmp_path)

        result = subprocess.run(
            cmd,
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            raise HTTPException(500, f"lp failed: {result.stderr}")
    finally:
        os.unlink(tmp_path)

    return {"status": "printed", "entityId": req.entityId, "media": media}

@app.get("/health")
async def health():
    return {"status": "ok", "printer": PRINTER_NAME, "cups_server": CUPS_SERVER or "local", "media": MEDIA_SIZE}
