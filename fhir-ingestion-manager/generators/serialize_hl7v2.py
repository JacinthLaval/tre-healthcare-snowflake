import json
import os
import random
from datetime import datetime

random.seed(42)

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "output")
BASE_POP_PATH = os.path.join(OUTPUT_DIR, "base_population.json")
HL7_DIR = os.path.join(OUTPUT_DIR, "hl7v2")

HL7V2_TIERS = {
    "standard": 850,
    "z_segments": 100,
    "malformed": 50,
}

FIELD_SEP = "|"
COMP_SEP = "^"
REP_SEP = "~"
ESC_CHAR = "\\"
SUB_SEP = "&"


def hl7_date(iso_date):
    if not iso_date:
        return ""
    return iso_date.replace("-", "").replace("T", "").replace(":", "")[:14]


def race_code_hl7(label):
    mapping = {
        "White": "2106-3",
        "Black or African American": "2054-5",
        "Hispanic": "2135-2",
        "Other": "2131-1",
    }
    return mapping.get(label, "2131-1")


def gender_hl7(label):
    return "M" if label == "Male" else "F" if label == "Female" else "U"


def build_msh(sending_facility, msg_type, trigger, msg_id):
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    return f"MSH|^~\\&|{sending_facility}|{sending_facility}|FHIR_STAGING|MS_FIMR|{timestamp}||{msg_type}^{trigger}|{msg_id}|P|2.5.1"


def build_pid(person, seq=1):
    pid_3 = person.get("mrn", "")
    name_parts = f"Test{person['person_id']}^Patient{person['person_id']}"
    dob = hl7_date(person.get("birth_date", person.get("dob", "")))
    gender = gender_hl7(person.get("gender_label", "Female"))
    race = race_code_hl7(person.get("race_label", "Other"))
    return f"PID|{seq}||{pid_3}||{name_parts}||{dob}|{gender}|||^^^^{person.get('county_fips', '')}|||||||||||{race}"


def build_obx(seq, obs_id, code, code_system, value, unit, value_type="NM", status="F"):
    return f"OBX|{seq}|{value_type}|{code}^{obs_id}^{code_system}||{value}|{unit}|||{status}"


def build_dg1(seq, code, code_system, description, onset_date=""):
    return f"DG1|{seq}|{code_system}|{code}^{description}||{hl7_date(onset_date)}|A"


def build_pv1(visit_type="I"):
    return f"PV1|1|{visit_type}||||||||||||||||V{random.randint(100000,999999)}"


def build_z_segments(pair):
    segments = []
    segments.append(f"ZMR|1|{pair['county']['svi']:.4f}|{pair['county']['name']}|{pair['county']['fips']}")
    if pair["mother"]["insurance"]:
        segments.append(f"ZIN|1|{pair['mother']['insurance'].upper()}|AUTH-{random.randint(100000,999999)}")
    if pair["mother"]["is_smoker"]:
        segments.append(f"ZSH|1|SMOKER|Y|SELF_REPORTED")
    segments.append(f"ZDS|1|DELIVERY_METHOD|{random.choice(['VAGINAL', 'CSECTION', 'VBAC'])}|PROVIDER_REPORTED")
    return segments


def introduce_malformation(segments):
    mutation = random.choice(["missing_msh_field", "wrong_delimiter", "duplicate_pid", "truncated"])

    if mutation == "missing_msh_field":
        msh = segments[0]
        parts = msh.split("|")
        if len(parts) > 9:
            parts[9] = ""
            segments[0] = "|".join(parts)

    elif mutation == "wrong_delimiter":
        idx = random.randint(1, len(segments) - 1)
        segments[idx] = segments[idx].replace("|", "!", 2)

    elif mutation == "duplicate_pid":
        for i, s in enumerate(segments):
            if s.startswith("PID"):
                segments.insert(i + 1, s)
                break

    elif mutation == "truncated":
        last = segments[-1]
        segments[-1] = last[:len(last)//2]

    return segments


def serialize_pair_to_hl7(pair, tier):
    messages = []
    infant = pair["infant"]
    mother = pair["mother"]
    infant_with_county = {**infant, "county_fips": pair["county"]["fips"]}
    mother_with_county = {**mother, "county_fips": pair["county"]["fips"]}

    msg_id = f"MSG-{pair['pair_id']:06d}-ADT"
    segments = [
        build_msh("HOSPITAL_X" if tier != "z_segments" else "HOSPITAL_Z", "ADT", "A01", msg_id),
        "EVN|A01|" + datetime.now().strftime("%Y%m%d%H%M%S"),
        build_pid(infant_with_county, 1),
        build_pv1("I"),
    ]

    obx_seq = 1
    measurements = {
        "birth_weight_g": ("29463-7", "Birth weight", "LN", "g"),
        "gestational_age_weeks": ("18185-9", "Gestational age", "LN", "wk"),
        "apgar_1min": ("9272-6", "APGAR 1 minute", "LN", "{score}"),
        "apgar_5min": ("9274-2", "APGAR 5 minute", "LN", "{score}"),
        "birth_length_cm": ("89269-5", "Birth length", "LN", "cm"),
        "head_circumference_cm": ("9843-4", "Head circumference", "LN", "cm"),
    }
    for key, (code, desc, sys, unit) in measurements.items():
        val = infant["measurements"][key]
        segments.append(build_obx(obx_seq, desc, code, sys, val, unit))
        obx_seq += 1

    dg_seq = 1
    for cond in infant["conditions"]:
        segments.append(build_dg1(dg_seq, cond["icd10"], "I10", cond["desc"], cond["onset_date"]))
        dg_seq += 1

    if tier == "z_segments":
        segments.extend(build_z_segments(pair))

    if tier == "malformed":
        segments = introduce_malformation(segments)

    messages.append("\r".join(segments))

    msg_id_mat = f"MSG-{pair['pair_id']:06d}-MAT"
    mat_segments = [
        build_msh("HOSPITAL_X" if tier != "z_segments" else "HOSPITAL_Z", "ADT", "A04", msg_id_mat),
        "EVN|A04|" + datetime.now().strftime("%Y%m%d%H%M%S"),
        build_pid(mother_with_county, 1),
        build_pv1("O"),
    ]

    mat_obx_seq = 1
    mat_obs = {
        "bmi": ("39156-5", "BMI", "LN", "kg/m2"),
        "parity": ("11977-6", "Parity", "LN", "{#}"),
        "gravidity": ("11996-6", "Gravidity", "LN", "{#}"),
        "prenatal_visits": ("57714-8", "Prenatal visits", "LN", "{#}"),
    }
    for key, (code, desc, sys, unit) in mat_obs.items():
        val = mother[key]
        mat_segments.append(build_obx(mat_obx_seq, desc, code, sys, val, unit))
        mat_obx_seq += 1

    for cond in mother["conditions"]:
        mat_segments.append(build_dg1(dg_seq, cond["icd10"], "I10", cond["desc"], cond["onset_date"]))
        dg_seq += 1

    if tier == "z_segments":
        mat_segments.extend(build_z_segments(pair))

    if tier == "malformed":
        mat_segments = introduce_malformation(mat_segments)

    messages.append("\r".join(mat_segments))

    return messages


def main():
    with open(BASE_POP_PATH) as f:
        pairs = json.load(f)

    os.makedirs(HL7_DIR, exist_ok=True)

    tier_assignments = []
    idx = 0
    for tier, count in HL7V2_TIERS.items():
        for _ in range(count):
            if idx < len(pairs):
                tier_assignments.append((idx, tier))
                idx += 1
    random.shuffle(tier_assignments)

    all_messages = []
    tier_counts = {t: 0 for t in HL7V2_TIERS}

    for pair_idx, tier in tier_assignments:
        messages = serialize_pair_to_hl7(pairs[pair_idx], tier)
        for msg in messages:
            all_messages.append((msg, tier))
        tier_counts[tier] += 1

    all_path = os.path.join(HL7_DIR, "hl7v2_messages.txt")
    with open(all_path, "w") as f:
        for msg, _ in all_messages:
            f.write(msg + "\n\x1c\r\n")

    for tier in HL7V2_TIERS:
        tier_msgs = [m for m, t in all_messages if t == tier]
        tier_path = os.path.join(HL7_DIR, f"hl7v2_{tier}.txt")
        with open(tier_path, "w") as f:
            for msg in tier_msgs:
                f.write(msg + "\n\x1c\r\n")

    sample_path = os.path.join(HL7_DIR, "sample_message.txt")
    with open(sample_path, "w") as f:
        f.write(all_messages[0][0].replace("\r", "\n"))

    print(f"\n=== HL7v2 OUTPUT ===")
    print(f"  Total pairs:    {len(tier_assignments)}")
    print(f"  Total messages: {len(all_messages)} (2 per pair: infant ADT + mother ADT)")
    print(f"  Quality tiers:  {dict(tier_counts)}")
    print(f"  All messages:   {all_path}")
    print(f"  Sample:         {sample_path}")
    print(f"  Tier files:     {HL7_DIR}/hl7v2_*.txt")


if __name__ == "__main__":
    main()
