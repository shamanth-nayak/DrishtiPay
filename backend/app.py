import os
import logging
import re
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
from verification import (
    VerificationRequest,
    VerificationResponse,
    verify_transaction,
)


load_dotenv(Path(__file__).resolve().parent / ".env")

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 8 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}

# Primary and fallback vision models to prevent single-tier quota exhaustion
MODEL_POOL = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.7-flash",
    "gemini-3.8-flash"
]


class FieldExtraction(BaseModel):
    value: str | None = Field(description="Exact label value, or null when unreadable or absent.")
    status: Literal["found", "unreadable", "absent"]
    supporting_text: str | None = Field(description="Short text visibly supporting the value, or null.")

    @model_validator(mode="after")
    def validate_value_status(self):
        if self.status == "found" and not self.value:
            raise ValueError("A found field must include a label value.")
        if self.status != "found" and self.value is not None:
            raise ValueError("Unreadable or absent fields must have a null value.")
        return self


class ProductLabelResult(BaseModel):
    product_name: FieldExtraction
    brand: FieldExtraction
    package_size: FieldExtraction
    printed_mrp: FieldExtraction
    manufacturing_date: FieldExtraction
    expiry_date: FieldExtraction
    review_status: Literal["needs_review"] = "needs_review"
    disclaimer: str = "AI extraction from a label image requires user review; it is not independently verified."


app = FastAPI(title="DrishtiPay Vision API")
origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins else ["*"],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def image_mime_is_consistent(image: bytes, mime_type: str) -> bool:
    signatures = {
        "image/jpeg": image.startswith(b"\xff\xd8\xff"),
        "image/png": image.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": image.startswith(b"RIFF") and image[8:12] == b"WEBP",
    }
    return signatures.get(mime_type, False)


def safe_upstream_message(error: Exception) -> str:
    message = str(getattr(error, "message", error))
    message = re.sub(r"AIza[\w-]+", "[REDACTED]", message)
    return message[:500]


def extract_label(image: bytes, mime_type: str) -> ProductLabelResult:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("Gemini API key is not configured.")
    prompt = """Analyze this image of a retail product label or package.
Identify and extract:
1. Product name and brand.
2. Printed MRP (Maximum Retail Price): Look closely for any price markings, including 'MRP', 'M.R.P.', '₹', 'Rs', or printed retail price stamps on the packaging, cap, or crimp. Extract the numeric price value.
3. Package size, manufacturing date, and expiry date if visible.

For each field:
- If a value is visible anywhere on the packaging, set status to 'found', value to the extracted text, and supporting_text to the surrounding snippet.
- If completely absent or unreadable, set status to 'absent' or 'unreadable' and value to null.
- For printed_mrp: Extract the clean numeric price (e.g. '10', '10.00', '35').
Review_status must be 'needs_review'."""
    last_exception = None
    for model_name in MODEL_POOL:
        client = genai.Client(api_key=api_key)
        try:
            logger.info("Calling vision model: %s", model_name)
            response = client.models.generate_content(
                model=model_name,
                contents=[prompt, types.Part.from_bytes(data=image, mime_type=mime_type)],
                config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=ProductLabelResult),
            )
            return ProductLabelResult.model_validate_json(response.text)
        except genai_errors.APIError as err:
            code = getattr(err, "code", None)
            last_exception = err
            if code in (429, 503):
                reason = "quota limit (429)" if code == 429 else "high demand spike (503)"
                logger.warning("Model %s experienced %s. Failing over to next model in pool...", model_name, reason)
                continue
            raise err
        except Exception as err:
            last_exception = err
            logger.warning("Model %s failed (%s). Trying next...", model_name, type(err).__name__)
            continue

    if last_exception:
        raise last_exception
    raise RuntimeError("All models in MODEL_POOL failed.")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/vision/read-price", response_model=ProductLabelResult)
async def read_price(image: UploadFile = File(...)) -> ProductLabelResult:
    mime_type = (image.content_type or "").lower()
    if mime_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Upload a JPEG, PNG, or WebP product-label image.")
    content = await image.read(MAX_IMAGE_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="The image must be 8 MB or smaller.")
    if not image_mime_is_consistent(content, mime_type):
        raise HTTPException(status_code=415, detail="The file contents do not match its image type.")
    retries = 2
    last_err = None
    for attempt in range(retries + 1):
        try:
            result = extract_label(content, mime_type)
            logger.info("Extraction result: product=%s mrp=%s (status=%s, support=%s)", 
                        result.product_name.value, 
                        result.printed_mrp.value, 
                        result.printed_mrp.status,
                        result.printed_mrp.supporting_text)
            print(f"DEBUG: product_name='{result.product_name.value}', printed_mrp='{result.printed_mrp.value}' (status={result.printed_mrp.status})")
            return result
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        except genai_errors.APIError as error:
            code = getattr(error, "code", None)
            logger.warning("Gemini API request failed: type=%s status=%s message=%s", type(error).__name__, code, safe_upstream_message(error))
            if code in (401, 403):
                detail = "Gemini authentication or permission failed. Check the configured API key and its project access."
            elif code == 404:
                detail = "The configured Gemini model was not found or is unavailable for this API key."
            elif code == 429:
                detail = "Gemini quota or rate limit was reached. Try again later or check quota."
            elif code == 400:
                detail = "Gemini rejected the image or request format."
            else:
                detail = f"Gemini request failed with HTTP status {code or 'unknown'}."
            raise HTTPException(status_code=503 if code == 429 or (isinstance(code, int) and code >= 500) else 502, detail=detail) from error
        except ValidationError as error:
            logger.warning("Gemini returned a response that did not match the extraction schema: %s", error)
            raise HTTPException(status_code=502, detail="The vision service returned an invalid extraction response.") from error
        except Exception as error:
            err_type = type(error).__name__
            last_err = error
            logger.warning("Vision pipeline failed (attempt %d/%d): type=%s message=%s", attempt + 1, retries + 1, err_type, safe_upstream_message(error))
            if any(k in err_type for k in ("Connect", "Timeout", "Read", "RemoteProtocol", "Protocol")):
                if attempt < retries:
                    import time
                    time.sleep(1.0)
                    continue
                raise HTTPException(
                    status_code=503,
                    detail="Could not reach Gemini vision servers (connection timeout). Please check your internet connection and try again."
                ) from error
            raise HTTPException(status_code=502, detail=f"Vision pipeline error: {err_type}. Please try again.") from error


class TranscribeResponse(BaseModel):
    text: str
    command: str | None = None
    amount_rupees: str | None = None


@app.post("/api/v1/voice/transcribe", response_model=TranscribeResponse)
async def transcribe_audio(audio: UploadFile = File(...)) -> TranscribeResponse:
    """Transcribes user voice command using Gemini audio model, immune to Chrome network drops."""
    content = await audio.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty audio recording.")
    
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Gemini API key is not configured.")
    
    mime_type = audio.content_type or "audio/webm"
    # Normalize common browser audio mimes
    if "webm" in mime_type:
        mime_type = "audio/webm"
    elif "wav" in mime_type:
        mime_type = "audio/wav"
    elif "ogg" in mime_type:
        mime_type = "audio/ogg"
    elif "mp4" in mime_type or "m4a" in mime_type:
        mime_type = "audio/mp4"

    client = genai.Client(api_key=api_key)
    prompt = """Listen to this user audio recording.
Transcribe the speech accurately in English.
Respond with JSON matching this structure:
{
  "text": "exact words spoken",
  "command": "one of: start, scan, confirm, cancel, repeat, pay, or null",
  "amount_rupees": "numeric amount if user stated a price or money amount (e.g. '35' or '35.50'), else null"
}"""

    last_error = None
    for model_name in MODEL_POOL:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=[prompt, types.Part.from_bytes(data=content, mime_type=mime_type)],
                config=types.GenerateContentConfig(response_mime_type="application/json")
            )
            import json
            data = json.loads(response.text)
            return TranscribeResponse(
                text=data.get("text") or "",
                command=data.get("command"),
                amount_rupees=str(data.get("amount_rupees")) if data.get("amount_rupees") is not None else None
            )
        except genai_errors.APIError as err:
            code = getattr(err, "code", None)
            last_error = err
            if code in (429, 503):
                reason = "quota (429)" if code == 429 else "high demand (503)"
                logger.warning("Audio model %s hit %s. Failing over to next...", model_name, reason)
                continue
            raise err
        except Exception as err:
            last_error = err
            logger.warning("Audio model %s failed. Trying next...", model_name)
            continue

    logger.warning("All audio transcription models exhausted: %s", last_error)
    raise HTTPException(status_code=502, detail="Voice transcription currently unavailable across model pool.")


@app.post(
    "/api/v1/verification/verify",
    response_model=VerificationResponse,
)
def verify_payment_details(
    request: VerificationRequest,
) -> VerificationResponse:
    return verify_transaction(request)

class PaymentDetails(BaseModel):
    payee_name: str = Field(min_length=1, max_length=100)
    vpa: str = Field(min_length=3, max_length=100)
    amount: float | None = Field(default=None, gt=0, le=1_000_000)
    currency: str = "INR"

    @field_validator("payee_name", "vpa")
    @classmethod
    def strip_whitespace(cls, value: str) -> str:
        return value.strip()

    @field_validator("payee_name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        if not value:
            raise ValueError("Payee name cannot be blank")
        return value

    @field_validator("vpa")
    @classmethod
    def validate_vpa_format(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9._-]{2,256}@[A-Za-z0-9.-]{2,64}", value):
            raise ValueError("Invalid UPI ID format")
        return value

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, value: str) -> str:
        if value.upper() != "INR":
            raise ValueError("Only INR is supported in this demo")
        return "INR"


@app.post("/api/v1/verify-payment-details")
def verify_payment_details_endpoint(payment: PaymentDetails):
    return {
        "status": "caution",
        "verified": False,
        "payee_name": payment.payee_name,
        "vpa": payment.vpa,
        "amount": payment.amount,
        "currency": payment.currency,
        "message": "Only input format was checked. Merchant identity, payment destination and payment status have NOT been independently verified."
    }
