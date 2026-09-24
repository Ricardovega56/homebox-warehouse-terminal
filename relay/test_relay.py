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

@patch("relay.httpx.AsyncClient.get")
@patch("relay.subprocess.Popen")
def test_print_label_dk2205_62mm_black(mock_popen, mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = make_test_png_bytes()
    mock_get.return_value = mock_resp

    proc = MagicMock()
    proc.returncode = 0
    proc.communicate.return_value = (b"", b"")
    mock_popen.return_value = proc

    with TestClient(app) as client:
        response = client.post("/print", json={"entityId": "12345", "labelType": "62"})

    assert response.status_code == 200
    assert response.json()["labelType"] == "62"
    assert mock_popen.call_args[0][0] == ["lp", "-d", "QL-800", "-o", "raw"]

@patch("relay.httpx.AsyncClient.get")
@patch("relay.subprocess.Popen")
def test_print_label_dk1201_diecut_29x90(mock_popen, mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = make_test_png_bytes()
    mock_get.return_value = mock_resp

    proc = MagicMock()
    proc.returncode = 0
    proc.communicate.return_value = (b"", b"")
    mock_popen.return_value = proc

    with TestClient(app) as client:
        response = client.post("/print", json={"entityId": "12345", "labelType": "29x90"})

    assert response.status_code == 200
    assert response.json()["labelType"] == "29x90"
    assert mock_popen.call_args[0][0] == ["lp", "-d", "QL-800", "-o", "raw"]

def test_companion_par_levels():
    with TestClient(app) as client:
        # Create par level
        res = client.post("/companion/par-levels", json={
            "entityId": "test-entity-1",
            "minQuantity": 2.0,
            "targetQuantity": 10.0,
            "unit": "boxes"
        })
        assert res.status_code == 200
        assert res.json()["status"] == "saved"

        # List par levels
        list_res = client.get("/companion/par-levels")
        assert list_res.status_code == 200
        items = list_res.json()
        match = next((i for i in items if i["entity_id"] == "test-entity-1"), None)
        assert match is not None
        assert match["min_quantity"] == 2.0
        assert match["target_quantity"] == 10.0

        # Delete par level
        del_res = client.delete("/companion/par-levels/test-entity-1")
        assert del_res.status_code == 200

def test_companion_shopping_list():
    with TestClient(app) as client:
        # Add item
        add_res = client.post("/companion/shopping-list", json={
            "name": "M4 Hex Nuts",
            "quantityNeeded": 50.0,
            "unit": "pcs",
            "source": "manual"
        })
        assert add_res.status_code == 200
        item_id = add_res.json()["id"]

        # Toggle item
        patch_res = client.patch(f"/companion/shopping-list/{item_id}", json={"completed": True})
        assert patch_res.status_code == 200
        assert patch_res.json()["completed"] is True

        # Clear completed
        clear_res = client.delete("/companion/shopping-list-clear-completed")
        assert clear_res.status_code == 200

def test_companion_cycle_counts():
    with TestClient(app) as client:
        log_res = client.post("/companion/cycle-counts", json={
            "locationId": "loc-bin-1",
            "locationName": "BIN-A1-01",
            "itemsExpected": 5,
            "itemsVerified": 5,
            "discrepancies": 0,
            "notes": "All items matched"
        })
        assert log_res.status_code == 200
        assert log_res.json()["status"] == "recorded"

        list_res = client.get("/companion/cycle-counts")
        assert list_res.status_code == 200
        assert len(list_res.json()) >= 1

