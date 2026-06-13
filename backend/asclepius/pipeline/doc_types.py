"""Document-type vocabulary and normalization.

The canonical set of doc-type codes, the fuzzy alias table that maps
legacy / LLM-drifted values back onto those codes, and the normalizer.
Moved verbatim out of :mod:`extractor` so the vocabulary can be a leaf
dependency (no imports from sibling pipeline modules).
"""

import logging

logger = logging.getLogger(__name__)


VALID_DOC_TYPES = {
    "invoice",
    "prescription",
    "specialist_report",
    "surgical_report",
    "discharge",
    "lab_test",
    "vaccination",
    "medical_certificate",
    "imaging_report",
    "other",
}

# Fuzzy mapping for common LLM mistakes and legacy values. Maps any
# old/aliased value to one of the canonical 10 codes in VALID_DOC_TYPES.
_DOC_TYPE_ALIASES = {
    # Lab tests
    "bloodtest": "lab_test",
    "blood test": "lab_test",
    "blood_test": "lab_test",
    "labtest_other": "lab_test",
    "lab": "lab_test",
    "laboratory": "lab_test",
    "labtest": "lab_test",
    # Specialist reports (catch-all for visits, consults, retired specialty types)
    "report": "specialist_report",
    "visit": "specialist_report",
    "consultation": "specialist_report",
    "checkup": "specialist_report",
    "follow-up": "specialist_report",
    "follow_up_report": "specialist_report",
    "specialist": "specialist_report",
    "visit_report": "specialist_report",
    "medical_report": "specialist_report",
    "clinical_report": "specialist_report",
    "referto": "specialist_report",
    "befund": "specialist_report",
    "visita": "specialist_report",
    "controllo": "specialist_report",
    "pathology": "specialist_report",
    "pathology_report": "specialist_report",
    "histology": "specialist_report",
    "er_report": "specialist_report",
    "emergency": "specialist_report",
    "er": "specialist_report",
    "physio_report": "specialist_report",
    "physiotherapy": "specialist_report",
    "dental": "specialist_report",
    "dentistry": "specialist_report",
    "ophthalmology": "specialist_report",
    "mental_health": "specialist_report",
    "psychiatry": "specialist_report",
    "psychology": "specialist_report",
    # Surgical
    "surgery": "surgical_report",
    "operation": "surgical_report",
    "operative_notes": "surgical_report",
    "op_bericht": "surgical_report",
    # Imaging (consolidated to imaging_report)
    "radiology": "imaging_report",
    "radiology_report": "imaging_report",
    "xray": "imaging_report",
    "x-ray": "imaging_report",
    "imaging_dicom": "imaging_report",
    "imaging_other": "imaging_report",
    "imaging": "imaging_report",
    # Invoices (incl. receipts)
    "bill": "invoice",
    "fattura": "invoice",
    "rechnung": "invoice",
    "billing": "invoice",
    "nota": "invoice",
    "conto": "invoice",
    "tarmed": "invoice",
    "honorarnote": "invoice",
    "receipt": "invoice",
    "receipt_payment": "invoice",
    "payment": "invoice",
    "ricevuta": "invoice",
    "quittung": "invoice",
    # Prescriptions (incl. referrals)
    "ricetta": "prescription",
    "rezept": "prescription",
    "referral": "prescription",
    "referral_letter": "prescription",
    "ueberweisung": "prescription",
    "uberweisung": "prescription",
    # Discharge
    "discharge_letter": "discharge",
    "discharge_summary": "discharge",
    # Vaccinations
    "vaccine": "vaccination",
    "immunization": "vaccination",
    "impfung": "vaccination",
    # Medical certificates (incl. sick leave)
    "medical_cert": "medical_certificate",
    "certificate": "medical_certificate",
    "sick_leave": "medical_certificate",
    "sick_note": "medical_certificate",
    "zeugnis": "medical_certificate",
    "arbeitsunfaehigkeit": "medical_certificate",
    # Catch-all for retired types
    "allergy": "other",
    "insurance_claim": "other",
    "insurance_doc": "other",
    "consent": "other",
    "advance_directive": "other",
    "correspondence": "other",
    "letter": "other",
}


def _normalize_doc_type(raw: str | None) -> str:
    """Normalize a doc_type from LLM output to a valid code."""
    if not raw:
        return "other"
    cleaned = raw.strip().lower().replace(" ", "_").replace("-", "_")
    if cleaned in VALID_DOC_TYPES:
        return cleaned
    if cleaned in _DOC_TYPE_ALIASES:
        return _DOC_TYPE_ALIASES[cleaned]
    # Partial match
    for alias, code in _DOC_TYPE_ALIASES.items():
        if alias in cleaned or cleaned in alias:
            return code
    logger.warning("Unknown doc_type '%s', defaulting to 'other'", raw)
    return "other"
