import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import app


class VisionEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app.app)

    def test_rejects_non_image_without_calling_gemini(self):
        response = self.client.post("/api/v1/vision/read-price", files={"image": ("label.txt", b"not an image", "text/plain")})
        self.assertEqual(response.status_code, 415)

    def test_rejects_empty_image_without_calling_gemini(self):
        response = self.client.post("/api/v1/vision/read-price", files={"image": ("label.jpg", b"", "image/jpeg")})
        self.assertEqual(response.status_code, 400)

    def test_returns_structured_result_when_extractor_is_stubbed(self):
        expected = app.ProductLabelResult.model_validate({
            name: {"value": None, "status": "unreadable", "supporting_text": None}
            for name in ("product_name", "brand", "package_size", "printed_mrp", "manufacturing_date", "expiry_date")
        })
        with patch.object(app, "extract_label", return_value=expected):
            response = self.client.post("/api/v1/vision/read-price", files={"image": ("label.jpg", b"\xff\xd8\xfftest", "image/jpeg")})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["printed_mrp"], {"value": None, "status": "unreadable", "supporting_text": None})
        self.assertEqual(response.json()["review_status"], "needs_review")


if __name__ == "__main__":
    unittest.main()
