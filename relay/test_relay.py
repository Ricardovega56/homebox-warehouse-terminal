import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from relay import app

def test_health():
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

@patch("relay.httpx.AsyncClient.get")
@patch("relay.subprocess.run")
def test_print_label_success(mock_subprocess, mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = b"fake png data"
    mock_get.return_value = mock_resp

    mock_subprocess_result = MagicMock()
    mock_subprocess_result.returncode = 0
    mock_subprocess.return_value = mock_subprocess_result

    with TestClient(app) as client:
        response = client.post("/print", json={"entityId": "12345"})
        
    assert response.status_code == 200
    assert response.json() == {"status": "printed", "entityId": "12345"}

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
@patch("relay.subprocess.run")
def test_print_label_lp_fails(mock_subprocess, mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = b"fake png data"
    mock_get.return_value = mock_resp

    mock_subprocess_result = MagicMock()
    mock_subprocess_result.returncode = 1
    mock_subprocess_result.stderr = "lp error"
    mock_subprocess.return_value = mock_subprocess_result

    with TestClient(app) as client:
        response = client.post("/print", json={"entityId": "12345"})
        
    assert response.status_code == 500
