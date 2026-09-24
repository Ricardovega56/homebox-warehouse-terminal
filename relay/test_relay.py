import io
import pytest
from PIL import Image
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from relay import app

def make_test_png_bytes():
    buf = io.BytesIO()
    im = Image.new("RGB", (696, 200), (255, 255, 255))
    im.save(buf, format="PNG")
    return buf.getvalue()

def test_health():
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        assert response.json()["labelType"] == "62red"

@patch("relay.httpx.AsyncClient.get")
@patch("relay.subprocess.Popen")
def test_print_label_success(mock_popen, mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = make_test_png_bytes()
    mock_get.return_value = mock_resp

    proc = MagicMock()
    proc.returncode = 0
    proc.communicate.return_value = (b"", b"")
    mock_popen.return_value = proc

    with TestClient(app) as client:
        response = client.post("/print", json={"entityId": "12345"})

    assert response.status_code == 200
    assert response.json()["status"] == "printed"
    assert response.json()["entityId"] == "12345"
    assert response.json()["labelType"] == "62red"
    assert mock_popen.call_args[0][0] == ["lp", "-d", "QL-800", "-o", "raw"]

@patch("relay.httpx.AsyncClient.get")
@patch("relay.subprocess.Popen")
def test_print_label_with_token_and_label_type(mock_popen, mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = make_test_png_bytes()
    mock_get.return_value = mock_resp

    proc = MagicMock()
    proc.returncode = 0
    proc.communicate.return_value = (b"", b"")
    mock_popen.return_value = proc

    with TestClient(app) as client:
        response = client.post("/print", json={"entityId": "12345", "token": "hb_mytoken", "labelType": "62red"})

    assert response.status_code == 200
    assert response.json()["labelType"] == "62red"
    assert mock_get.call_args[1]["headers"]["Authorization"] == "Bearer hb_mytoken"
    assert mock_popen.call_args[0][0] == ["lp", "-d", "QL-800", "-o", "raw"]

@patch("relay.httpx.AsyncClient.get")
@patch("relay.subprocess.Popen")
def test_print_label_remote_cups(mock_popen, mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = make_test_png_bytes()
    mock_get.return_value = mock_resp

    proc = MagicMock()
    proc.returncode = 0
    proc.communicate.return_value = (b"", b"")
    mock_popen.return_value = proc

    with patch("relay.CUPS_SERVER", "192.168.0.186:631"):
        with TestClient(app) as client:
            response = client.post("/print", json={"entityId": "12345"})

    assert response.status_code == 200
    cmd = mock_popen.call_args[0][0]
    assert "-h" in cmd
    idx = cmd.index("-h")
    assert cmd[idx + 1] == "192.168.0.186:631"

@patch("relay.httpx.AsyncClient.get")
def test_print_label_homebox_down(mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 502
    mock_resp.text = "Bad Gateway"
    mock_get.return_value = mock_resp

    with TestClient(app) as client:
        response = client.post("/print", json={"entityId": "12345"})

    assert response.status_code == 502

@patch("relay.httpx.AsyncClient.get")
@patch("relay.subprocess.Popen")
def test_print_label_lp_fails(mock_popen, mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = make_test_png_bytes()
    mock_get.return_value = mock_resp

    proc = MagicMock()
    proc.returncode = 1
    proc.communicate.return_value = (b"", b"lp: Error - broken pipe")
    mock_popen.return_value = proc

    with TestClient(app) as client:
        response = client.post("/print", json={"entityId": "12345"})

    assert response.status_code == 500
