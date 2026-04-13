import json
import os
import csv
import random
from datetime import datetime, timedelta

random.seed(42)

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "output")
BASE_POP_PATH = os.path.join(OUTPUT_DIR, "base_population.json")
CSV_DIR = os.path.join(OUTPUT_DIR, "csv")

EPIC_PATIENT_HEADERS = [
    "PAT_MRN_ID", "PAT_FIRST_NAME", "PAT_LAST_NAME", "BIRTH_DATE", "SEX",
    "PATIENT_RACE", "ETHNIC_GROUP", "ZIP_CODE", "COUNTY", "DEATH_DATE",
    "PAT_STATUS", "PRIMARY_CARE_PROV_ID", "CUR_PCP_PROV_ID",
]
EPIC_ENCOUNTER_HEADERS = [
    "PAT_ENC_CSN_ID", "PAT_MRN_ID", "CONTACT_DATE", "ENC_TYPE_C", "ENC_TYPE_TITLE",
    "DEPARTMENT_NAME", "DISCH_DISP_C", "ADM_DATE_TIME", "DISCH_DATE_TIME",
    "VISIT_PROV_ID", "LOS_DAYS",
]
EPIC_DIAGNOSIS_HEADERS = [
    "PAT_ENC_CSN_ID", "PAT_MRN_ID", "DX_ID", "DX_NAME", "CURRENT_ICD10_LIST",
    "PRIMARY_DX_YN", "ONSET_DATE", "RESOLVED_DATE", "DX_STATUS",
]
EPIC_FLOWSHEET_HEADERS = [
    "PAT_ENC_CSN_ID", "PAT_MRN_ID", "FLO_MEAS_ID", "FLO_MEAS_NAME",
    "MEAS_VALUE", "MEAS_UNIT", "RECORDED_TIME", "ENTRY_USER_ID",
]

CERNER_PATIENT_HEADERS = [
    "person_id", "name_first", "name_last", "birth_dt_tm", "sex_cd",
    "race_cd", "ethnicity_cd", "zipcode", "county_cd", "deceased_dt_tm",
    "active_status_cd",
]
CERNER_ENCOUNTER_HEADERS = [
    "encntr_id", "person_id", "reg_dt_tm", "encntr_type_cd", "encntr_type_desc",
    "loc_facility_cd", "disch_disposition_cd", "arrive_dt_tm", "depart_dt_tm",
]
CERNER_DIAGNOSIS_HEADERS = [
    "diagnosis_id", "encntr_id", "person_id", "nomenclature_id", "diagnosis_display",
    "source_identifier", "diag_type_cd", "onset_dt_tm", "clinical_diag_priority",
]
CERNER_RESULT_HEADERS = [
    "event_id", "encntr_id", "person_id", "event_cd", "event_title_text",
    "result_val", "result_units_cd", "performed_dt_tm", "result_status_cd",
]

AMBIGUOUS_HEADERS = [
    "ID", "First", "Last", "DOB", "Gender", "Race", "Zip", "County",
    "Enc_ID", "Enc_Date", "Enc_Type", "Dept",
    "Dx_Code", "Dx_Desc", "Primary",
    "Obs_Name", "Obs_Value", "Obs_Unit", "Obs_Date",
    "Death_Date",
]


def epic_date(iso_date):
    if not iso_date:
        return ""
    return iso_date.replace("-", "/")


def cerner_datetime(iso_date):
    if not iso_date:
        return ""
    return iso_date.replace("T", " ") + ".000" if "T" not in str(iso_date) else str(iso_date).replace("T", " ")


def generate_epic_csvs(pairs):
    os.makedirs(os.path.join(CSV_DIR, "epic"), exist_ok=True)

    patients, encounters, diagnoses, flowsheets = [], [], [], []

    for pair in pairs:
        infant = pair["infant"]
        mother = pair["mother"]

        patients.append([
            infant["mrn"], f"Patient{infant['person_id']}", f"Test{infant['person_id']}",
            epic_date(infant["birth_date"]),
            "Male" if infant["gender_label"] == "Male" else "Female",
            infant["race_label"], "Non-Hispanic", pair["county"]["fips"][-3:],
            pair["county"]["name"],
            epic_date(infant.get("death_date", "")) if infant["died"] else "",
            "Deceased" if infant["died"] else "Active", f"PROV{random.randint(1000,9999)}",
            f"PCP{random.randint(1000,9999)}",
        ])
        patients.append([
            mother["mrn"], f"Mother{mother['person_id']}", f"Test{mother['person_id']}",
            epic_date(mother["dob"]), "Female", mother["race_label"], "Non-Hispanic",
            pair["county"]["fips"][-3:], pair["county"]["name"], "", "Active",
            f"PROV{random.randint(1000,9999)}", f"PCP{random.randint(1000,9999)}",
        ])

        enc_csn = f"CSN{pair['pair_id']:08d}"
        encounters.append([
            enc_csn, infant["mrn"], epic_date(infant["birth_date"]),
            "3", "Hospital Encounter", "Labor and Delivery",
            "1", infant["birth_datetime"], infant["birth_datetime"],
            f"PROV{random.randint(1000,9999)}", "1",
        ])

        for j, cond in enumerate(infant["conditions"]):
            diagnoses.append([
                enc_csn, infant["mrn"], f"DX{pair['pair_id']:06d}{j:02d}",
                cond["desc"], cond["icd10"],
                "Y" if j == 0 else "N",
                epic_date(cond["onset_date"]), "", "Active",
            ])
        for j, cond in enumerate(mother["conditions"]):
            diagnoses.append([
                enc_csn, mother["mrn"], f"DX{pair['pair_id']:06d}{j+50:02d}",
                cond["desc"], cond["icd10"],
                "Y" if j == 0 else "N",
                epic_date(cond["onset_date"]), "", "Active",
            ])

        meas_map = {
            "birth_weight_g": ("5001", "Birth Weight", "g"),
            "gestational_age_weeks": ("5002", "Gestational Age", "wk"),
            "apgar_1min": ("5003", "APGAR 1 Min", "{score}"),
            "apgar_5min": ("5004", "APGAR 5 Min", "{score}"),
            "birth_length_cm": ("5005", "Birth Length", "cm"),
            "head_circumference_cm": ("5006", "Head Circ", "cm"),
        }
        for key, (flo_id, flo_name, unit) in meas_map.items():
            flowsheets.append([
                enc_csn, infant["mrn"], flo_id, flo_name,
                infant["measurements"][key], unit,
                infant["birth_datetime"], f"USR{random.randint(1000,9999)}",
            ])

    _write_csv(os.path.join(CSV_DIR, "epic", "patients.csv"), EPIC_PATIENT_HEADERS, patients)
    _write_csv(os.path.join(CSV_DIR, "epic", "encounters.csv"), EPIC_ENCOUNTER_HEADERS, encounters)
    _write_csv(os.path.join(CSV_DIR, "epic", "diagnoses.csv"), EPIC_DIAGNOSIS_HEADERS, diagnoses)
    _write_csv(os.path.join(CSV_DIR, "epic", "flowsheets.csv"), EPIC_FLOWSHEET_HEADERS, flowsheets)

    return len(patients), len(encounters), len(diagnoses), len(flowsheets)


def generate_cerner_csvs(pairs):
    os.makedirs(os.path.join(CSV_DIR, "cerner"), exist_ok=True)

    persons, encounters, diagnoses, results = [], [], [], []

    for pair in pairs:
        infant = pair["infant"]
        mother = pair["mother"]

        persons.append([
            infant["person_id"], f"Patient{infant['person_id']}", f"Test{infant['person_id']}",
            cerner_datetime(infant["birth_date"]),
            "362" if infant["gender_label"] == "Male" else "363",
            infant["race_label"], "Not Hispanic", pair["county"]["fips"],
            cerner_datetime(infant.get("death_date", "")) if infant["died"] else "",
            "0" if infant["died"] else "1",
        ])
        persons.append([
            mother["person_id"], f"Mother{mother['person_id']}", f"Test{mother['person_id']}",
            cerner_datetime(mother["dob"]), "363", mother["race_label"], "Not Hispanic",
            pair["county"]["fips"], "", "1",
        ])

        enc_id = 800000 + pair["pair_id"]
        encounters.append([
            enc_id, infant["person_id"], cerner_datetime(infant["birth_date"]),
            "309308", "Inpatient", "Labor and Delivery", "1",
            cerner_datetime(infant["birth_datetime"]), cerner_datetime(infant["birth_datetime"]),
        ])

        for j, cond in enumerate(infant["conditions"]):
            diagnoses.append([
                f"DG{pair['pair_id']:06d}{j}", enc_id, infant["person_id"],
                cond["icd10"], cond["desc"], cond["snomed"],
                "FINAL" if j == 0 else "SECONDARY",
                cerner_datetime(cond["onset_date"]), j + 1,
            ])

        meas_map = {
            "birth_weight_g": ("703558", "Birth Weight", "g"),
            "gestational_age_weeks": ("703559", "Gestational Age", "wk"),
            "apgar_1min": ("703560", "APGAR 1 Min", "{score}"),
            "apgar_5min": ("703561", "APGAR 5 Min", "{score}"),
            "birth_length_cm": ("703562", "Birth Length", "cm"),
            "head_circumference_cm": ("703563", "Head Circumference", "cm"),
        }
        for key, (event_cd, title, unit) in meas_map.items():
            results.append([
                f"EVT{pair['pair_id']:06d}{key[:4]}", enc_id, infant["person_id"],
                event_cd, title, infant["measurements"][key], unit,
                cerner_datetime(infant["birth_datetime"]), "AUTH",
            ])

    _write_csv(os.path.join(CSV_DIR, "cerner", "persons.csv"), CERNER_PATIENT_HEADERS, persons)
    _write_csv(os.path.join(CSV_DIR, "cerner", "encounters.csv"), CERNER_ENCOUNTER_HEADERS, encounters)
    _write_csv(os.path.join(CSV_DIR, "cerner", "diagnoses.csv"), CERNER_DIAGNOSIS_HEADERS, diagnoses)
    _write_csv(os.path.join(CSV_DIR, "cerner", "results.csv"), CERNER_RESULT_HEADERS, results)

    return len(persons), len(encounters), len(diagnoses), len(results)


def generate_ambiguous_csvs(pairs):
    os.makedirs(os.path.join(CSV_DIR, "ambiguous"), exist_ok=True)

    rows = []
    for pair in pairs:
        infant = pair["infant"]
        mother = pair["mother"]

        base_row = [
            infant["mrn"], f"Patient{infant['person_id']}", f"Test{infant['person_id']}",
            infant["birth_date"],
            "M" if infant["gender_label"] == "Male" else "F",
            infant["race_label"], pair["county"]["fips"][-3:], pair["county"]["name"],
        ]

        if infant["conditions"]:
            cond = infant["conditions"][0]
            enc_row = [
                f"E{pair['pair_id']:06d}", infant["birth_date"], "Delivery", "L&D",
                cond["icd10"], cond["desc"], "Y",
            ]
        else:
            enc_row = [f"E{pair['pair_id']:06d}", infant["birth_date"], "Delivery", "L&D", "", "", ""]

        meas_key = random.choice(list(infant["measurements"].keys()))
        meas_val = infant["measurements"][meas_key]
        meas_name_map = {
            "birth_weight_g": "Wt", "gestational_age_weeks": "GA",
            "apgar_1min": "AP1", "apgar_5min": "AP5",
            "birth_length_cm": "Len", "head_circumference_cm": "HC",
        }
        obs_row = [
            meas_name_map.get(meas_key, meas_key), meas_val, "",
            infant["birth_date"],
        ]

        death_row = [infant["death_date"] if infant["died"] else ""]

        rows.append(base_row + enc_row + obs_row + death_row)

    _write_csv(os.path.join(CSV_DIR, "ambiguous", "clinical_export.csv"), AMBIGUOUS_HEADERS, rows)
    return len(rows)


def _write_csv(path, headers, rows):
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)


def main():
    with open(BASE_POP_PATH) as f:
        pairs = json.load(f)

    os.makedirs(CSV_DIR, exist_ok=True)

    ep, ee, ed, ef = generate_epic_csvs(pairs)
    print(f"\n=== EHR CSV OUTPUT ===")
    print(f"  Epic-style:")
    print(f"    patients.csv:     {ep} rows")
    print(f"    encounters.csv:   {ee} rows")
    print(f"    diagnoses.csv:    {ed} rows")
    print(f"    flowsheets.csv:   {ef} rows")

    cp, ce, cd, cr = generate_cerner_csvs(pairs)
    print(f"  Cerner-style:")
    print(f"    persons.csv:      {cp} rows")
    print(f"    encounters.csv:   {ce} rows")
    print(f"    diagnoses.csv:    {cd} rows")
    print(f"    results.csv:      {cr} rows")

    ar = generate_ambiguous_csvs(pairs)
    print(f"  Ambiguous-header:")
    print(f"    clinical_export.csv: {ar} rows")

    print(f"\n  Output: {CSV_DIR}/")


if __name__ == "__main__":
    main()
