import json
import os
import random
import uuid
from datetime import datetime

random.seed(42)

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "output")
BASE_POP_PATH = os.path.join(OUTPUT_DIR, "base_population.json")
FHIR_DIR = os.path.join(OUTPUT_DIR, "fhir")

QUALITY_TIERS = {
    "clean": 800,
    "custom_extensions": 100,
    "missing_required": 50,
    "bad_codes": 50,
}

CUSTOM_EXTENSIONS = [
    {"url": "http://hospitalx.org/fhir/ext/maternal-risk-score", "valueDecimal": None},
    {"url": "http://hospitalx.org/fhir/ext/sdoh-index", "valueDecimal": None},
    {"url": "http://hospitalx.org/fhir/ext/insurance-auth-number", "valueString": None},
    {"url": "http://hospitalx.org/fhir/ext/delivery-method", "valueString": None},
]

LOCAL_CODE_SYSTEMS = [
    "http://hospitalx.org/codes/diagnoses",
    "http://hospitaly.org/internal/conditions",
    "urn:oid:2.16.840.1.113883.6.99999",
]


def make_patient_resource(person, resource_id, mrn):
    return {
        "resourceType": "Patient",
        "id": resource_id,
        "identifier": [
            {"system": "http://hospital.example.org/mrn", "value": mrn}
        ],
        "name": [{"family": f"Test{person['person_id']}", "given": [f"Patient{person['person_id']}"]}],
        "gender": "male" if person["gender_label"] == "Male" else "female" if person["gender_label"] == "Female" else "other",
        "birthDate": person["birth_date"] if "birth_date" in person else person["dob"],
        "extension": [
            {
                "url": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-race",
                "extension": [
                    {"url": "ombCategory", "valueCoding": {"system": "urn:oid:2.16.840.1.113883.6.238", "code": _race_code(person["race_label"]), "display": person["race_label"]}},
                    {"url": "text", "valueString": person["race_label"]}
                ]
            }
        ],
    }


def _race_code(label):
    mapping = {
        "White": "2106-3",
        "Black or African American": "2054-5",
        "Hispanic": "2135-2",
        "Other": "2131-1",
    }
    return mapping.get(label, "2131-1")


def make_condition_resource(condition, patient_ref, resource_id, use_bad_codes=False):
    if use_bad_codes:
        code_system = random.choice(LOCAL_CODE_SYSTEMS)
        code_val = f"LOCAL-{random.randint(1000,9999)}"
        display = condition["desc"]
    else:
        code_system = "http://snomed.info/sct"
        code_val = condition["snomed"]
        display = condition["desc"]

    return {
        "resourceType": "Condition",
        "id": resource_id,
        "subject": {"reference": f"Patient/{patient_ref}"},
        "code": {
            "coding": [{"system": code_system, "code": code_val, "display": display}],
            "text": display,
        },
        "onsetDateTime": condition["onset_date"],
        "clinicalStatus": {
            "coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-clinical", "code": "active"}]
        },
    }


def make_observation_resource(code_text, loinc, value, unit, patient_ref, resource_id, effective_date):
    return {
        "resourceType": "Observation",
        "id": resource_id,
        "status": "final",
        "code": {
            "coding": [{"system": "http://loinc.org", "code": loinc, "display": code_text}],
            "text": code_text,
        },
        "subject": {"reference": f"Patient/{patient_ref}"},
        "effectiveDateTime": effective_date,
        "valueQuantity": {"value": value, "unit": unit, "system": "http://unitsofmeasure.org"},
    }


def make_encounter_resource(patient_ref, resource_id, encounter_date, encounter_type="delivery"):
    type_code = "183460006" if encounter_type == "delivery" else "185349003"
    type_display = "Delivery encounter" if encounter_type == "delivery" else "Prenatal visit"
    return {
        "resourceType": "Encounter",
        "id": resource_id,
        "status": "finished",
        "class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "IMP", "display": "inpatient"},
        "subject": {"reference": f"Patient/{patient_ref}"},
        "type": [{"coding": [{"system": "http://snomed.info/sct", "code": type_code, "display": type_display}]}],
        "period": {"start": encounter_date, "end": encounter_date},
    }


def make_related_person(mother_ref, infant_ref, resource_id):
    return {
        "resourceType": "RelatedPerson",
        "id": resource_id,
        "patient": {"reference": f"Patient/{infant_ref}"},
        "relationship": [
            {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-RoleCode", "code": "MTH", "display": "Mother"}]}
        ],
        "name": [{"family": f"Mother{resource_id}"}],
    }


def add_custom_extensions(resource, pair):
    exts = []
    ext_template = random.choice(CUSTOM_EXTENSIONS)
    ext = {"url": ext_template["url"]}
    if "valueDecimal" in ext_template:
        ext["valueDecimal"] = round(random.uniform(0, 1), 3) if "risk" in ext_template["url"] else round(pair["county"]["svi"], 4)
    elif "valueString" in ext_template:
        ext["valueString"] = random.choice(["C-Section", "Vaginal", "VBAC"]) if "delivery" in ext_template["url"] else f"AUTH-{random.randint(100000,999999)}"
    exts.append(ext)
    resource.setdefault("extension", []).extend(exts)
    return resource


def strip_required_fields(resource):
    rtype = resource.get("resourceType")
    if rtype == "Patient":
        fields_to_remove = random.choice([["birthDate"], ["gender"], ["identifier"], ["name"]])
    elif rtype == "Condition":
        fields_to_remove = random.choice([["code"], ["subject"]])
    elif rtype == "Observation":
        fields_to_remove = random.choice([["valueQuantity"], ["code"], ["status"]])
    else:
        fields_to_remove = []

    for f in fields_to_remove:
        resource.pop(f, None)
    resource.setdefault("meta", {})["tag"] = [{"system": "http://test.org/quality", "code": "missing-required"}]
    return resource


def serialize_pair_to_bundle(pair, quality_tier):
    entries = []
    infant = pair["infant"]
    mother = pair["mother"]
    use_bad_codes = quality_tier == "bad_codes"

    infant_patient = make_patient_resource(infant, infant["uuid"], infant["mrn"])
    mother_patient = make_patient_resource(
        {**mother, "gender_label": "Female", "birth_date": mother["dob"]},
        mother["uuid"], mother["mrn"]
    )

    if quality_tier == "custom_extensions":
        infant_patient = add_custom_extensions(infant_patient, pair)
        mother_patient = add_custom_extensions(mother_patient, pair)

    if quality_tier == "missing_required":
        target = random.choice(["infant", "mother"])
        if target == "infant":
            infant_patient = strip_required_fields(infant_patient)
        else:
            mother_patient = strip_required_fields(mother_patient)

    entries.append({"fullUrl": f"urn:uuid:{infant['uuid']}", "resource": infant_patient})
    entries.append({"fullUrl": f"urn:uuid:{mother['uuid']}", "resource": mother_patient})

    related = make_related_person(mother["uuid"], infant["uuid"], str(uuid.uuid4()))
    entries.append({"fullUrl": f"urn:uuid:{related['id']}", "resource": related})

    encounter_id = str(uuid.uuid4())
    encounter = make_encounter_resource(infant["uuid"], encounter_id, infant["birth_date"])
    entries.append({"fullUrl": f"urn:uuid:{encounter_id}", "resource": encounter})

    measurements = {
        "Birth weight": ("29463-7", infant["measurements"]["birth_weight_g"], "g"),
        "Gestational age": ("18185-9", infant["measurements"]["gestational_age_weeks"], "wk"),
        "APGAR 1 minute": ("9272-6", infant["measurements"]["apgar_1min"], "{score}"),
        "APGAR 5 minute": ("9274-2", infant["measurements"]["apgar_5min"], "{score}"),
        "Birth length": ("89269-5", infant["measurements"]["birth_length_cm"], "cm"),
        "Head circumference": ("9843-4", infant["measurements"]["head_circumference_cm"], "cm"),
    }
    for name, (loinc, val, unit) in measurements.items():
        obs_id = str(uuid.uuid4())
        obs = make_observation_resource(name, loinc, val, unit, infant["uuid"], obs_id, infant["birth_date"])
        if quality_tier == "missing_required" and random.random() < 0.3:
            obs = strip_required_fields(obs)
        entries.append({"fullUrl": f"urn:uuid:{obs_id}", "resource": obs})

    for wt_point in infant["measurements"].get("infant_weight_trajectory", []):
        obs_id = str(uuid.uuid4())
        obs = make_observation_resource("Infant weight", "29463-7", wt_point["value"], "g", infant["uuid"], obs_id, wt_point["date"])
        entries.append({"fullUrl": f"urn:uuid:{obs_id}", "resource": obs})

    for cond in infant["conditions"]:
        cond_id = str(uuid.uuid4())
        cond_res = make_condition_resource(cond, infant["uuid"], cond_id, use_bad_codes)
        entries.append({"fullUrl": f"urn:uuid:{cond_id}", "resource": cond_res})

    for cond in mother["conditions"]:
        cond_id = str(uuid.uuid4())
        cond_res = make_condition_resource(cond, mother["uuid"], cond_id, use_bad_codes)
        entries.append({"fullUrl": f"urn:uuid:{cond_id}", "resource": cond_res})

    mother_obs = [
        ("BMI", "39156-5", mother["bmi"], "kg/m2"),
        ("Parity", "11977-6", mother["parity"], "{#}"),
        ("Gravidity", "11996-6", mother["gravidity"], "{#}"),
        ("Prenatal visits", "57714-8", mother["prenatal_visits"], "{#}"),
    ]
    for name, loinc, val, unit in mother_obs:
        obs_id = str(uuid.uuid4())
        obs = make_observation_resource(name, loinc, val, unit, mother["uuid"], obs_id, infant["birth_date"])
        entries.append({"fullUrl": f"urn:uuid:{obs_id}", "resource": obs})

    bundle = {
        "resourceType": "Bundle",
        "id": str(uuid.uuid4()),
        "type": "collection",
        "timestamp": datetime.now().isoformat(),
        "meta": {
            "tag": [{"system": "http://test.org/quality-tier", "code": quality_tier}]
        },
        "entry": entries,
    }
    return bundle


def main():
    with open(BASE_POP_PATH) as f:
        pairs = json.load(f)

    os.makedirs(FHIR_DIR, exist_ok=True)

    tier_assignments = []
    idx = 0
    for tier, count in QUALITY_TIERS.items():
        for _ in range(count):
            if idx < len(pairs):
                tier_assignments.append((idx, tier))
                idx += 1
    random.shuffle(tier_assignments)

    bundles = []
    tier_counts = {t: 0 for t in QUALITY_TIERS}
    resource_counts = {t: 0 for t in ["Patient", "Condition", "Observation", "Encounter", "RelatedPerson"]}

    for pair_idx, tier in tier_assignments:
        bundle = serialize_pair_to_bundle(pairs[pair_idx], tier)
        bundles.append(bundle)
        tier_counts[tier] += 1
        for entry in bundle["entry"]:
            rtype = entry["resource"]["resourceType"]
            resource_counts[rtype] = resource_counts.get(rtype, 0) + 1

    ndjson_path = os.path.join(FHIR_DIR, "fhir_bundles.ndjson")
    with open(ndjson_path, "w") as f:
        for b in bundles:
            f.write(json.dumps(b, default=str) + "\n")

    for tier in QUALITY_TIERS:
        tier_bundles = [b for b in bundles if b["meta"]["tag"][0]["code"] == tier]
        tier_path = os.path.join(FHIR_DIR, f"fhir_{tier}.ndjson")
        with open(tier_path, "w") as f:
            for b in tier_bundles:
                f.write(json.dumps(b, default=str) + "\n")

    sample_path = os.path.join(FHIR_DIR, "sample_bundle.json")
    with open(sample_path, "w") as f:
        json.dump(bundles[0], f, indent=2, default=str)

    print(f"\n=== FHIR R4 OUTPUT ===")
    print(f"  Total bundles:  {len(bundles)}")
    print(f"  Quality tiers:  {dict(tier_counts)}")
    print(f"  Resources:      {dict(resource_counts)}")
    print(f"  NDJSON:         {ndjson_path}")
    print(f"  Sample:         {sample_path}")
    print(f"  Tier files:     {FHIR_DIR}/fhir_*.ndjson")


if __name__ == "__main__":
    main()
