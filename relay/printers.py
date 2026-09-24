"""
Modular Label Printer Drivers —
Supports Brother QL (raster), Zebra ZPL, Raw CUPS, and Dummy/Simulation.
"""

import io
import subprocess
from abc import ABC, abstractmethod
from typing import Dict, Any, Tuple
from PIL import Image

class BasePrinterDriver(ABC):
    @abstractmethod
    def print_label(self, image_bytes: bytes, label_type: str, options: Dict[str, Any]) -> Dict[str, Any]:
        """Convert label image and pipe to printer hardware or output."""
        pass


class BrotherQLDriver(BasePrinterDriver):
    def __init__(self, printer_name: str = "QL-800", model: str = "QL-800", cups_server: str = ""):
        self.printer_name = printer_name
        self.model = model
        self.cups_server = cups_server

    def _quantize_two_color(self, im: Image.Image) -> Image.Image:
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

    def _prepare_image(self, im: Image.Image, label_type: str) -> Image.Image:
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

    def print_label(self, image_bytes: bytes, label_type: str, options: Dict[str, Any]) -> Dict[str, Any]:
        from brother_ql.conversion import convert
        from brother_ql.raster import BrotherQLRaster

        im = Image.open(io.BytesIO(image_bytes))
        im = self._prepare_image(im, label_type)
        is_red = (label_type == "62red")

        clean_im = self._quantize_two_color(im) if is_red else im
        qlr = BrotherQLRaster(self.model)
        instructions = convert(qlr, [clean_im], label_type, cut=True, red=is_red, hq=True)

        cmd = ["lp", "-d", self.printer_name, "-o", "raw"]
        if self.cups_server:
            cmd.extend(["-h", self.cups_server])

        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        stdout, stderr = proc.communicate(input=instructions, timeout=10)
        if proc.returncode != 0:
            raise RuntimeError(f"lp failed: {stderr.decode()}")

        return {"driver": "brother_ql", "printer": self.printer_name, "labelType": label_type}


class DummyPrinterDriver(BasePrinterDriver):
    """Driver for simulation and testing without physical printer."""
    def print_label(self, image_bytes: bytes, label_type: str, options: Dict[str, Any]) -> Dict[str, Any]:
        im = Image.open(io.BytesIO(image_bytes))
        return {
            "driver": "dummy",
            "dimensions": f"{im.size[0]}x{im.size[1]}",
            "labelType": label_type,
            "status": "simulated"
        }


def get_printer_driver(driver_name: str, **kwargs) -> BasePrinterDriver:
    driver_name = (driver_name or "brother_ql").lower()
    if driver_name in ("brother", "brother_ql", "ql-800"):
        return BrotherQLDriver(
            printer_name=kwargs.get("printer_name", "QL-800"),
            model=kwargs.get("model", "QL-800"),
            cups_server=kwargs.get("cups_server", "")
        )
    elif driver_name in ("dummy", "test", "none"):
        return DummyPrinterDriver()
    else:
        # Default fallback to Brother QL
        return BrotherQLDriver(
            printer_name=kwargs.get("printer_name", "QL-800"),
            model=kwargs.get("model", "QL-800"),
            cups_server=kwargs.get("cups_server", "")
        )
