
import unittest

from verification import (
    VerificationRequest,
    verify_transaction,
    rupees_to_paise,
)


class TestPaymentVerification(unittest.TestCase):

    def test_matching_amount_and_merchant(self):
        request = VerificationRequest(
            expected_price_paise=3500,
            requested_amount_paise=3500,
            expected_merchant_vpa="shop@upi",
            requested_merchant_vpa="shop@upi",
        )

        result = verify_transaction(request)

        self.assertTrue(result.verified)
        self.assertEqual(result.decision, "ALLOW_CONFIRMATION")
        self.assertTrue(result.amount_match)
        self.assertTrue(result.merchant_match)

    def test_amount_mismatch(self):
        request = VerificationRequest(
            expected_price_paise=3500,
            requested_amount_paise=35000,
            expected_merchant_vpa="shop@upi",
            requested_merchant_vpa="shop@upi",
        )

        result = verify_transaction(request)

        self.assertFalse(result.verified)
        self.assertEqual(result.decision, "BLOCK")
        self.assertEqual(result.reason, "AMOUNT_MISMATCH")
        self.assertFalse(result.amount_match)

    def test_merchant_mismatch(self):
        request = VerificationRequest(
            expected_price_paise=3500,
            requested_amount_paise=3500,
            expected_merchant_vpa="shop@upi",
            requested_merchant_vpa="other@upi",
        )

        result = verify_transaction(request)

        self.assertFalse(result.verified)
        self.assertEqual(result.decision, "BLOCK")
        self.assertEqual(result.reason, "MERCHANT_MISMATCH")
        self.assertFalse(result.merchant_match)

    def test_missing_merchant_reference(self):
        request = VerificationRequest(
            expected_price_paise=3500,
            requested_amount_paise=3500,
            expected_merchant_vpa=None,
            requested_merchant_vpa=None,
        )

        result = verify_transaction(request)

        self.assertEqual(result.decision, "REVIEW")
        self.assertEqual(
            result.reason, "MERCHANT_REFERENCE_MISSING"
        )

    def test_rupees_to_paise(self):
        self.assertEqual(rupees_to_paise("35"), 3500)
        self.assertEqual(rupees_to_paise("35.50"), 3550)


if __name__ == "__main__":
    unittest.main()
