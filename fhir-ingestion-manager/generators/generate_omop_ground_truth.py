import json
import os
import csv
import random

random.seed(42)

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "output")
BASE_POP_PATH = os.path.join(OUTPUT_DIR, "base_population.json")
OMOP_DIR = os.path.join(OUTPUT_DIR, "omop_ground_truth")

LOINC_TO_CONCEPT = {
    "29463-7": 3025315,   # Body weight
    "18185-9": 3012888,   # Gestational age
    "9272-6": 3020891,    # APGAR 1 min
    "9274-2": 3020892,    # APGAR 5 min
    "89269-5": 3036277,   # Body height at birth
    "9843-4": 3019550,    # Head circumference
    "39156-5": 3038553,   # BMI
    "11977-6": 3003773,   # Parity
    "11996-6": 3003430,   # Gravidity
    "57714-8": 40762499,  # Prenatal visits
}

SNOMED_TO_CONCEPT = {
    "398254007": 4129519,  # Preeclampsia
    "11687002": 4058243,   # Gestational diabetes
    "38341003": 316866,    # Hypertension
    "271737000": 439777,   # Anemia pregnancy
    "282020008": 4218106,  # Preterm labor
    "365981007": 4209423,  # Tobacco use pregnancy
    "414916001": 433736,   # Obesity
    "198903000": 4141454,  # Mental health pregnancy
    "102491009": 40483204, # Substance use
    "48194001": 4129519,   # Gestational hypertension
    "415105001": 4134942,  # Placental abruption
    "36813001": 4015893,   # Placenta previa
    "387712008": 434610,   # Neonatal jaundice
    "46177005": 256722,    # RDS
    "276517002": 4149337,  # Transient tachypnea
    "52767006": 4226263,   # Neonatal hypoglycemia
    "91302008": 132797,    # Neonatal sepsis
    "87476004": 4013643,   # Birth asphyxia
    "13213009": 316139,    # Congenital heart defect
    "67569000": 4169095,   # BPD
    "206596003": 4192765,  # Neonatal withdrawal
    "415297005": 372614,   # ROP
    "276649004": 4098571,  # IVH
    "83330001": 4177243,   # PDA
    "41040004": 4033609,   # Down syndrome
    "87979003": 4047514,   # Cleft palate
    "72892002": 433260,      # Routine pregnancy supervision
}

RACE_TO_CONCEPT = {
    "White": 8527,
    "Black or African American": 8516,
    "Hispanic": 38003563,
    "Other": 8522,
}

GENDER_TO_CONCEPT = {"Male": 8507, "Female": 8532}


def generate_omop(pairs):
    os.makedirs(OMOP_DIR, exist_ok=True)

    persons = []
    deaths = []
    conditions = []
    measurements = []
    visits = []
    fact_rels = []

    condition_id = 1
    measurement_id = 1
    visit_id = 1

    for pair in pairs:
        infant = pair["infant"]
        mother = pair["mother"]

        persons.append({
            "person_id": infant["person_id"],
            "gender_concept_id": GENDER_TO_CONCEPT.get(infant["gender_label"], 0),
            "year_of_birth": int(infant["birth_date"][:4]),
            "month_of_birth": int(infant["birth_date"][5:7]),
            "day_of_birth": int(infant["birth_date"][8:10]),
            "birth_datetime": infant["birth_datetime"],
            "race_concept_id": RACE_TO_CONCEPT.get(infant["race_label"], 0),
            "ethnicity_concept_id": 0,
            "location_id": int(pair["county"]["fips"]),
            "person_source_value": infant["mrn"],
            "gender_source_value": infant["gender_label"],
            "race_source_value": infant["race_label"],
        })
        persons.append({
            "person_id": mother["person_id"],
            "gender_concept_id": 8532,
            "year_of_birth": int(mother["dob"][:4]),
            "month_of_birth": int(mother["dob"][5:7]),
            "day_of_birth": int(mother["dob"][8:10]),
            "birth_datetime": mother["dob"] + "T00:00:00",
            "race_concept_id": RACE_TO_CONCEPT.get(mother["race_label"], 0),
            "ethnicity_concept_id": 0,
            "location_id": int(pair["county"]["fips"]),
            "person_source_value": mother["mrn"],
            "gender_source_value": "Female",
            "race_source_value": mother["race_label"],
        })

        if infant["died"]:
            deaths.append({
                "person_id": infant["person_id"],
                "death_date": infant["death_date"],
                "death_datetime": infant["death_date"] + "T00:00:00",
                "death_type_concept_id": 32817,
                "cause_concept_id": 0,
                "cause_source_value": "",
            })

        infant_visit_id = visit_id
        visits.append({
            "visit_occurrence_id": visit_id,
            "person_id": infant["person_id"],
            "visit_concept_id": 9201,
            "visit_start_date": infant["birth_date"],
            "visit_start_datetime": infant["birth_datetime"],
            "visit_end_date": infant["birth_date"],
            "visit_end_datetime": infant["birth_datetime"],
            "visit_type_concept_id": 32817,
            "visit_source_value": f"ENC-{pair['pair_id']:06d}",
        })
        visit_id += 1

        mother_visit_id = visit_id
        visits.append({
            "visit_occurrence_id": visit_id,
            "person_id": mother["person_id"],
            "visit_concept_id": 9201,
            "visit_start_date": infant["birth_date"],
            "visit_start_datetime": infant["birth_datetime"],
            "visit_end_date": infant["birth_date"],
            "visit_end_datetime": infant["birth_datetime"],
            "visit_type_concept_id": 32817,
            "visit_source_value": f"ENC-MAT-{pair['pair_id']:06d}",
        })
        visit_id += 1

        for cond in infant["conditions"]:
            concept_id = SNOMED_TO_CONCEPT.get(cond["snomed"], 0)
            conditions.append({
                "condition_occurrence_id": condition_id,
                "person_id": infant["person_id"],
                "condition_concept_id": concept_id,
                "condition_start_date": cond["onset_date"],
                "condition_start_datetime": cond["onset_date"] + "T00:00:00",
                "condition_type_concept_id": 32817,
                "condition_source_value": cond["snomed"],
                "condition_source_concept_id": 0,
                "visit_occurrence_id": infant_visit_id,
            })
            condition_id += 1

        for cond in mother["conditions"]:
            concept_id = SNOMED_TO_CONCEPT.get(cond["snomed"], 0)
            conditions.append({
                "condition_occurrence_id": condition_id,
                "person_id": mother["person_id"],
                "condition_concept_id": concept_id,
                "condition_start_date": cond["onset_date"],
                "condition_start_datetime": cond["onset_date"] + "T00:00:00",
                "condition_type_concept_id": 32817,
                "condition_source_value": cond["snomed"],
                "condition_source_concept_id": 0,
                "visit_occurrence_id": mother_visit_id,
            })
            condition_id += 1

        infant_meas = {
            "birth_weight_g": ("29463-7", infant["measurements"]["birth_weight_g"], "g", 8876),
            "gestational_age_weeks": ("18185-9", infant["measurements"]["gestational_age_weeks"], "wk", 8511),
            "apgar_1min": ("9272-6", infant["measurements"]["apgar_1min"], "{score}", 0),
            "apgar_5min": ("9274-2", infant["measurements"]["apgar_5min"], "{score}", 0),
            "birth_length_cm": ("89269-5", infant["measurements"]["birth_length_cm"], "cm", 8582),
            "head_circumference_cm": ("9843-4", infant["measurements"]["head_circumference_cm"], "cm", 8582),
        }
        for key, (loinc, val, unit, unit_concept) in infant_meas.items():
            measurements.append({
                "measurement_id": measurement_id,
                "person_id": infant["person_id"],
                "measurement_concept_id": LOINC_TO_CONCEPT.get(loinc, 0),
                "measurement_date": infant["birth_date"],
                "measurement_datetime": infant["birth_datetime"],
                "measurement_type_concept_id": 32817,
                "value_as_number": val,
                "unit_concept_id": unit_concept,
                "unit_source_value": unit,
                "measurement_source_value": loinc,
                "visit_occurrence_id": infant_visit_id,
            })
            measurement_id += 1

        for wt_point in infant["measurements"].get("infant_weight_trajectory", []):
            measurements.append({
                "measurement_id": measurement_id,
                "person_id": infant["person_id"],
                "measurement_concept_id": 3013762,
                "measurement_date": wt_point["date"] if isinstance(wt_point["date"], str) else wt_point["date"],
                "measurement_datetime": (wt_point["date"] if isinstance(wt_point["date"], str) else wt_point["date"]) + "T00:00:00",
                "measurement_type_concept_id": 32817,
                "value_as_number": wt_point["value"],
                "unit_concept_id": 8876,
                "unit_source_value": "g",
                "measurement_source_value": "29463-7",
                "visit_occurrence_id": infant_visit_id,
            })
            measurement_id += 1

        mother_meas = {
            "bmi": ("39156-5", mother["bmi"], "kg/m2", 9531),
            "parity": ("11977-6", mother["parity"], "{#}", 0),
            "gravidity": ("11996-6", mother["gravidity"], "{#}", 0),
            "prenatal_visits": ("57714-8", mother["prenatal_visits"], "{#}", 0),
        }
        for key, (loinc, val, unit, unit_concept) in mother_meas.items():
            measurements.append({
                "measurement_id": measurement_id,
                "person_id": mother["person_id"],
                "measurement_concept_id": LOINC_TO_CONCEPT.get(loinc, 0),
                "measurement_date": infant["birth_date"],
                "measurement_datetime": infant["birth_datetime"],
                "measurement_type_concept_id": 32817,
                "value_as_number": val,
                "unit_concept_id": unit_concept,
                "unit_source_value": unit,
                "measurement_source_value": loinc,
                "visit_occurrence_id": mother_visit_id,
            })
            measurement_id += 1

        fact_rels.append({
            "domain_concept_id_1": 1147314,
            "fact_id_1": infant["person_id"],
            "domain_concept_id_2": 1147314,
            "fact_id_2": mother["person_id"],
            "relationship_concept_id": 4326300,
        })

    _write_csv_from_dicts(os.path.join(OMOP_DIR, "person.csv"), persons)
    _write_csv_from_dicts(os.path.join(OMOP_DIR, "death.csv"), deaths)
    _write_csv_from_dicts(os.path.join(OMOP_DIR, "condition_occurrence.csv"), conditions)
    _write_csv_from_dicts(os.path.join(OMOP_DIR, "measurement.csv"), measurements)
    _write_csv_from_dicts(os.path.join(OMOP_DIR, "visit_occurrence.csv"), visits)
    _write_csv_from_dicts(os.path.join(OMOP_DIR, "fact_relationship.csv"), fact_rels)

    return {
        "person": len(persons),
        "death": len(deaths),
        "condition_occurrence": len(conditions),
        "measurement": len(measurements),
        "visit_occurrence": len(visits),
        "fact_relationship": len(fact_rels),
    }


def _write_csv_from_dicts(path, data):
    if not data:
        return
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=data[0].keys())
        writer.writeheader()
        writer.writerows(data)


def main():
    with open(BASE_POP_PATH) as f:
        pairs = json.load(f)

    counts = generate_omop(pairs)

    print(f"\n=== OMOP GROUND TRUTH ===")
    for table, count in counts.items():
        print(f"  {table:30s} {count:>6} rows")
    print(f"\n  Output: {OMOP_DIR}/")


if __name__ == "__main__":
    main()
