
from decimal import Decimal, InvalidOperation
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class VerificationRequest(BaseModel):
    expected_price_paise: int = Field(gt=0)
    requested_amount_paise: int = Field(gt=0)

    expected_merchant_vpa: str | None = None
    requested_merchant_vpa: str | None = None

    @field_validator(
        "expected_merchant_vpa",
        "requested_merchant_vpa",
    )
    @classmethod
    def normalize_vpa(cls, value: str | None):
        if value is None:
            return None
        return value.strip().casefold() or None


class VerificationResponse(BaseModel):
    verified: bool
    decision: Literal["ALLOW_CONFIRMATION", "BLOCK", "REVIEW"]
    reason: str
    message: str
    amount_match: bool
    merchant_match: bool | None


def rupees_to_paise(value: str) -> int:
    """Convert a decimal rupee string into exact integer paise."""
    try:
        amount = Decimal(value)
    except (InvalidOperation, ValueError):
        raise ValueError("Invalid rupee amount")

    if not amount.is_finite() or amount <= 0:
        raise ValueError("Amount must be positive and finite")

    if amount.as_tuple().exponent < -2:
        raise ValueError("Maximum two decimal places are allowed")

    return int(amount * 100)


def verify_transaction(
    data: VerificationRequest,
) -> VerificationResponse:

    amount_match = (
        data.expected_price_paise
        == data.requested_amount_paise
    )

    if not amount_match:
        return VerificationResponse(
            verified=False,
            decision="BLOCK",
            reason="AMOUNT_MISMATCH",
            message="Requested amount differs from product price.",
            amount_match=False,
            merchant_match=None,
        )

    expected_vpa = data.expected_merchant_vpa
    requested_vpa = data.requested_merchant_vpa

    if not expected_vpa or not requested_vpa:
        return VerificationResponse(
            verified=False,
            decision="REVIEW",
            reason="MERCHANT_REFERENCE_MISSING",
            message="Merchant identity could not be verified.",
            amount_match=True,
            merchant_match=None,
        )

    if expected_vpa != requested_vpa:
        return VerificationResponse(
            verified=False,
            decision="BLOCK",
            reason="MERCHANT_MISMATCH",
            message="Requested merchant does not match the reference.",
            amount_match=True,
            merchant_match=False,
        )

    return VerificationResponse(
        verified=True,
        decision="ALLOW_CONFIRMATION",
        reason="CHECKS_PASSED",
        message=(
            "Amount and merchant reference match. "
            "Review and confirm before proceeding."
        ),
        amount_match=True,
        merchant_match=True,
    )
