import os
import io
import json
import time
import logging
import tempfile
import threading

import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

MODEL_SIZE = os.environ.get("WHISPER_MODEL", "large-v3")
DEVICE = "cuda" if os.environ.get("USE_GPU", "true").lower() == "true" else "cpu"
COMPUTE_TYPE = "float16" if DEVICE == "cuda" else "int8"

whisper_model = None
model_lock = threading.Lock()


def get_model():
    global whisper_model
    if whisper_model is None:
        with model_lock:
            if whisper_model is None:
                from faster_whisper import WhisperModel
                logger.info(f"Loading faster-whisper model={MODEL_SIZE} device={DEVICE} compute={COMPUTE_TYPE}")
                whisper_model = WhisperModel(
                    MODEL_SIZE,
                    device=DEVICE,
                    compute_type=COMPUTE_TYPE,
                    download_root=os.environ.get("WHISPER_CACHE", "/models/whisper"),
                )
                logger.info("Model loaded")
    return whisper_model


def transcribe_audio_file(file_path, language="en"):
    model = get_model()
    segments, info = model.transcribe(
        file_path,
        language=language,
        beam_size=5,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500, speech_pad_ms=200),
    )
    results = []
    for seg in segments:
        results.append({
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "text": seg.text.strip(),
        })
    return results, info


def generate_clinical_note(transcript, patient_context="", pgx_context=""):
    prompt = f"""You are a clinical documentation specialist. Generate structured clinical documentation from this physician-patient encounter transcript.

ENCOUNTER TRANSCRIPT:
{transcript}

{f"PATIENT CONTEXT (from EHR):{chr(10)}{patient_context}" if patient_context else ""}

{f"PHARMACOGENOMIC CONTEXT:{chr(10)}{pgx_context}" if pgx_context else ""}

Generate the following sections. Use the EXACT section headers shown:

---SOAP_NOTE---
Generate a comprehensive SOAP note:
S (Subjective): Patient's reported symptoms, concerns, history from the conversation
O (Objective): Any vitals, exam findings, or observable data mentioned
A (Assessment): Clinical assessment and differential diagnoses discussed
P (Plan): Treatment plan, follow-ups, referrals, prescriptions discussed

---ICD10_CODES---
Extract likely ICD-10 codes from the encounter. Format each as:
CODE | Description | Confidence (High/Medium/Low)

---MEDICATIONS---
List all medications discussed (new, continued, discontinued, adjusted). Format each as:
Medication | Action (new/continue/discontinue/adjust) | Dose if mentioned | Notes

---PGX_ALERTS---
Based on any medications discussed and the pharmacogenomic context (if available), flag potential drug-gene interactions. Format each as:
Drug | Gene | Risk Level (High/Medium/Low) | Recommendation

---FHIR_SUMMARY---
Generate a brief JSON summary suitable for creating FHIR R4 resources:
- DocumentReference (the note itself)
- Conditions (from ICD-10 codes)
- MedicationRequests (from medications discussed)
Include resource type and key fields only.

Be thorough but concise. Base everything on what was actually discussed in the transcript."""

    import snowflake.connector
    conn = snowflake.connector.connect(
        connection_name=os.environ.get("SNOWFLAKE_CONNECTION_NAME", "HealthcareDemos")
    )
    cur = conn.cursor()
    escaped = prompt.replace("'", "''").replace("\\", "\\\\")
    cur.execute(f"SELECT SNOWFLAKE.CORTEX.COMPLETE('mistral-large2', '{escaped}')")
    result = cur.fetchone()
    note_text = result[0] if result else ""
    cur.close()
    conn.close()

    sections = {}
    section_names = ["SOAP_NOTE", "ICD10_CODES", "MEDICATIONS", "PGX_ALERTS", "FHIR_SUMMARY"]
    for i, section_name in enumerate(section_names):
        pattern = f"---{section_name}---"
        if pattern in note_text:
            start = note_text.index(pattern) + len(pattern)
            end = len(note_text)
            for j in range(i + 1, len(section_names)):
                next_pattern = f"---{section_names[j]}---"
                if next_pattern in note_text[start:]:
                    end = note_text.index(next_pattern, start)
                    break
            sections[section_name.lower()] = note_text[start:end].strip()

    return note_text, sections


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "service": "ambient-scribe",
        "model": MODEL_SIZE,
        "device": DEVICE,
        "model_loaded": whisper_model is not None,
    })


@app.route("/api/transcribe", methods=["POST"])
def transcribe():
    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    audio_file = request.files["audio"]
    language = request.form.get("language", "en")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name

    try:
        segments, info = transcribe_audio_file(tmp_path, language)
        transcript = " ".join(s["text"] for s in segments)
        return jsonify({
            "language": info.language,
            "language_probability": round(info.language_probability, 3),
            "duration": round(info.duration, 1),
            "segments": segments,
            "transcript": transcript,
        })
    finally:
        os.unlink(tmp_path)


@app.route("/api/transcribe-and-note", methods=["POST"])
def transcribe_and_note():
    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    audio_file = request.files["audio"]
    language = request.form.get("language", "en")
    patient_context = request.form.get("patient_context", "")
    pgx_context = request.form.get("pgx_context", "")
    encounter_id = request.form.get("encounter_id", f"enc_{int(time.time())}")
    patient_id = request.form.get("patient_id", "")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name

    try:
        logger.info(f"Transcribing encounter {encounter_id}...")
        segments, info = transcribe_audio_file(tmp_path, language)
        transcript = " ".join(s["text"] for s in segments)

        if not transcript.strip():
            return jsonify({
                "encounter_id": encounter_id,
                "error": "No speech detected in audio",
                "duration": round(info.duration, 1),
            }), 400

        logger.info(f"Generating clinical note for {encounter_id} ({len(segments)} segments)...")
        raw_note, sections = generate_clinical_note(transcript, patient_context, pgx_context)

        return jsonify({
            "encounter_id": encounter_id,
            "patient_id": patient_id,
            "duration_seconds": round(info.duration, 1),
            "segment_count": len(segments),
            "segments": segments,
            "transcript": transcript,
            "raw_note": raw_note,
            "sections": sections,
        })
    except Exception as e:
        logger.error(f"Error processing encounter {encounter_id}: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        os.unlink(tmp_path)


risk_engine = None
risk_engine_lock = threading.Lock()

def get_risk_engine():
    global risk_engine
    if risk_engine is None:
        with risk_engine_lock:
            if risk_engine is None:
                import sys
                model_dir = os.environ.get("ALLAGE_MODEL_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "fimr-dashboard"))
                if model_dir not in sys.path:
                    sys.path.insert(0, model_dir)
                from model.inference import AllAgeInferenceEngine
                risk_engine = AllAgeInferenceEngine()
    return risk_engine


def fetch_patient_features(person_id):
    import snowflake.connector
    conn = snowflake.connector.connect(
        connection_name=os.environ.get("SNOWFLAKE_CONNECTION_NAME", "HealthcareDemos")
    )
    cur = conn.cursor()

    condition_concepts = {
        433260: 0, 4029098: 1, 4058284: 2, 433736: 3, 4128331: 4,
        439777: 5, 4209423: 6, 256722: 7, 4129361: 8, 440383: 9,
        4188539: 10, 4134010: 11, 4228112: 12, 316866: 13, 4307295: 14,
        4057757: 15, 440069: 16, 4128099: 17, 4272240: 18, 4144111: 19,
        198584: 20, 436665: 21, 254061: 22, 441465: 23, 317576: 24,
        377849: 25, 4108952: 26, 4344042: 27, 4046360: 28, 4014852: 29,
        434869: 30, 4067515: 31, 4048640: 32, 4034964: 33,
    }
    measurement_concepts = {
        3013762: 0, 3023540: 1, 4260747: 2, 4005809: 3,
        4003556: 4, 3038553: 5, 3025315: 6, 3036277: 7,
    }

    patient_features = [0.0] * 49

    cur.execute(f"""
        SELECT year_of_birth, gender_concept_id, race_concept_id, location_id
        FROM TRE_HEALTHCARE_DB.MS_FIMR.PERSON WHERE person_id = {int(person_id)}
    """)
    row = cur.fetchone()
    if not row:
        cur.close(); conn.close()
        return None, None, None
    age = 2026 - (row[0] or 2000)
    patient_features[0] = float(age)
    patient_features[1] = float(row[1] or 0)
    patient_features[2] = float(row[2] or 0)
    location_id = row[3]

    cur.execute(f"""
        SELECT condition_concept_id FROM TRE_HEALTHCARE_DB.MS_FIMR.CONDITION_OCCURRENCE
        WHERE person_id = {int(person_id)}
    """)
    for r in cur.fetchall():
        idx = condition_concepts.get(r[0])
        if idx is not None:
            patient_features[3 + idx] = 1.0

    cur.execute(f"""
        SELECT measurement_concept_id, value_as_number
        FROM TRE_HEALTHCARE_DB.MS_FIMR.MEASUREMENT
        WHERE person_id = {int(person_id)} AND value_as_number IS NOT NULL
        QUALIFY ROW_NUMBER() OVER (PARTITION BY measurement_concept_id ORDER BY measurement_date DESC) = 1
    """)
    for r in cur.fetchall():
        idx = measurement_concepts.get(r[0])
        if idx is not None:
            patient_features[37 + idx] = float(r[1] or 0)

    cur.execute(f"""
        SELECT COUNT(DISTINCT visit_occurrence_id) FROM TRE_HEALTHCARE_DB.MS_FIMR.VISIT_OCCURRENCE
        WHERE person_id = {int(person_id)}
    """)
    patient_features[45] = float(cur.fetchone()[0] or 0)
    cur.execute(f"""
        SELECT COUNT(*) FROM TRE_HEALTHCARE_DB.MS_FIMR.DRUG_EXPOSURE
        WHERE person_id = {int(person_id)}
    """)
    patient_features[46] = float(cur.fetchone()[0] or 0)
    cur.execute(f"""
        SELECT COUNT(DISTINCT condition_concept_id) FROM TRE_HEALTHCARE_DB.MS_FIMR.CONDITION_OCCURRENCE
        WHERE person_id = {int(person_id)}
    """)
    patient_features[47] = float(cur.fetchone()[0] or 0)
    patient_features[48] = float(age)

    pgx_features = [0.0] * 7

    sdoh_features = [0.0] * 30
    if location_id:
        cur.execute(f"""
            SELECT s.RPL_THEMES, s.RPL_THEME1, s.RPL_THEME2, s.RPL_THEME3, s.RPL_THEME4,
                   s.EP_POV150, s.EP_UNEMP, s.EP_UNINSUR, s.EP_NOHSDP, s.EP_SNGPNT,
                   s.EP_MINRTY, s.EP_MOBILE, s.EP_NOVEH, s.EP_NOINT, s.EP_AGE65,
                   s.EP_AGE17, s.EP_DISABL, s.EP_LIMENG,
                   f.PCT_LILA_TRACTS, f.PCT_LOW_INCOME_TRACTS, f.PCT_LA_POP,
                   f.AVG_POVERTY_RATE, f.AVG_MEDIAN_FAMILY_INCOME,
                   h.HPSA_SCORE_PRIMARY, h.HPSA_SCORE_DENTAL, h.HPSA_SCORE_MENTAL,
                   h.PRIMARY_CARE_PROVIDERS_NEEDED, h.DENTAL_PROVIDERS_NEEDED,
                   h.MENTAL_HEALTH_PROVIDERS_NEEDED, h.MUA_DESIGNATION
            FROM TRE_HEALTHCARE_DB.MS_FIMR.LOCATION l
            LEFT JOIN TRE_HEALTHCARE_DB.MS_FIMR.CDC_SVI_2022 s ON UPPER(l.county) = UPPER(s.COUNTY_NAME)
            LEFT JOIN TRE_HEALTHCARE_DB.MS_FIMR.USDA_FOOD_ACCESS f ON UPPER(l.county) = UPPER(f.COUNTY_NAME)
            LEFT JOIN TRE_HEALTHCARE_DB.MS_FIMR.HRSA_SHORTAGE_AREAS h ON UPPER(l.county) = UPPER(h.COUNTY_NAME)
            WHERE l.location_id = {int(location_id)}
        """)
        srow = cur.fetchone()
        if srow:
            for i in range(30):
                sdoh_features[i] = float(srow[i] or 0)

    cur.close()
    conn.close()
    return patient_features, pgx_features, sdoh_features


@app.route("/api/risk-score", methods=["POST"])
def risk_score():
    data = request.get_json()
    person_id = data.get("person_id")
    sample_id = data.get("sample_id")

    try:
        engine = get_risk_engine()

        if person_id:
            patient_f, pgx_f, sdoh_f = fetch_patient_features(person_id)
            if patient_f is None:
                return jsonify({"error": f"Patient {person_id} not found"}), 404
        elif sample_id:
            import snowflake.connector
            conn = snowflake.connector.connect(
                connection_name=os.environ.get("SNOWFLAKE_CONNECTION_NAME", "HealthcareDemos")
            )
            cur = conn.cursor()
            cur.execute("SELECT person_id FROM TRE_HEALTHCARE_DB.MS_FIMR.PERSON ORDER BY RANDOM() LIMIT 1")
            row = cur.fetchone()
            cur.close(); conn.close()
            if not row:
                return jsonify({"error": "No patients in MS_FIMR"}), 404
            patient_f, pgx_f, sdoh_f = fetch_patient_features(row[0])
            if patient_f is None:
                return jsonify({"error": "Feature extraction failed"}), 500
        else:
            return jsonify({"error": "person_id or sample_id required"}), 400

        results = engine.predict(patient_f, pgx_f, sdoh_f)
        return jsonify({"person_id": person_id or "representative", "scores": results})
    except Exception as e:
        logger.error(f"Risk scoring error: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    logger.info("Pre-loading whisper model...")
    get_model()
    app.run(host="0.0.0.0", port=8080)
