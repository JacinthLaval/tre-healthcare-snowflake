import os
import sys
import json
import random
import uuid
from datetime import date, datetime, timedelta
from collections import defaultdict

random.seed(42)

N_PAIRS = 1000
MORTALITY_RATE = 0.0163
N_DEATHS = max(1, round(N_PAIRS * MORTALITY_RATE))  # ~16 deaths to match production 16.3/1K

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "output")

COUNTIES = [
    ("Yazoo", "28163", 922, 0.9975), ("Bolivar", "28011", 877, 0.994),
    ("Hinds", "28049", 870, 0.9154), ("Pearl River", "28109", 811, 0.6907),
    ("Wayne", "28153", 811, 0.9119), ("Copiah", "28029", 777, 0.7976),
    ("Rankin", "28121", 775, 0.3732), ("Kemper", "28069", 766, 0.95),
    ("Monroe", "28095", 765, 0.6163), ("Holmes", "28051", 757, 0.992),
    ("Attala", "28007", 735, 0.957), ("Amite", "28005", 730, 0.7894),
    ("Washington", "28151", 724, 0.9971), ("Jackson", "28059", 723, 0.8288),
    ("Madison", "28089", 714, 0.3554), ("Greene", "28041", 713, 0.7776),
    ("Marshall", "28093", 706, 0.8699), ("Lauderdale", "28075", 704, 0.959),
    ("Sunflower", "28133", 698, 0.9303), ("Jones", "28067", 695, 0.791),
    ("Harrison", "28047", 574, 0.9182), ("DeSoto", "28033", 476, 0.3563),
    ("Lee", "28081", 450, 0.7455), ("Forrest", "28035", 466, 0.9497),
    ("Lowndes", "28087", 505, 0.7521), ("Lafayette", "28071", 632, 0.4391),
    ("Adams", "28001", 462, 0.971), ("Pike", "28113", 409, 0.9812),
    ("Lamar", "28073", 497, 0.6032), ("Warren", "28149", 589, 0.8279),
]

RACE_DIST = [
    ("White", 8527, 0.496), ("Black or African American", 8516, 0.443),
    ("Hispanic", 38003563, 0.041), ("Other", 8522, 0.020),
]

GENDER_DIST = [("Male", 8507, 0.51), ("Female", 8532, 0.49)]

MATERNAL_CONDITIONS = {
    "preeclampsia": {"rate": 0.063, "snomed": "398254007", "icd10": "O14.1", "desc": "Preeclampsia"},
    "gestational_diabetes": {"rate": 0.105, "snomed": "11687002", "icd10": "O24.4", "desc": "Gestational diabetes mellitus"},
    "preexisting_hypertension": {"rate": 0.077, "snomed": "38341003", "icd10": "O10.0", "desc": "Pre-existing hypertension"},
    "anemia_pregnancy": {"rate": 0.129, "snomed": "271737000", "icd10": "O99.0", "desc": "Anemia complicating pregnancy"},
    "preterm_labor": {"rate": 0.157, "snomed": "282020008", "icd10": "O60.0", "desc": "Preterm labor"},
    "tobacco_use_pregnancy": {"rate": 0.320, "snomed": "365981007", "icd10": "O99.33", "desc": "Tobacco use during pregnancy"},
    "obesity_pregnancy": {"rate": 0.192, "snomed": "414916001", "icd10": "O99.21", "desc": "Obesity complicating pregnancy"},
    "mental_health_pregnancy": {"rate": 0.101, "snomed": "198903000", "icd10": "O99.34", "desc": "Mental health disorder during pregnancy"},
    "substance_use_pregnancy": {"rate": 0.130, "snomed": "102491009", "icd10": "O99.32", "desc": "Substance use during pregnancy"},
    "gestational_hypertension": {"rate": 0.088, "snomed": "48194001", "icd10": "O13", "desc": "Gestational hypertension"},
    "placental_abruption": {"rate": 0.013, "snomed": "415105001", "icd10": "O45.9", "desc": "Placental abruption"},
    "placenta_previa": {"rate": 0.006, "snomed": "36813001", "icd10": "O44.0", "desc": "Placenta previa"},
}

ROUTINE_PREGNANCY_CONDITION = {
    "key": "routine_pregnancy",
    "snomed": "72892002",
    "icd10": "Z34.90",
    "desc": "Encounter for supervision of normal pregnancy, unspecified trimester",
    "omop_concept_id": 433260,
}

INFANT_CONDITIONS = {
    "neonatal_jaundice": {"rate": 0.35, "snomed": "387712008", "icd10": "P59.9", "desc": "Neonatal jaundice"},
    "respiratory_distress_syndrome": {"rate": 0.124, "snomed": "46177005", "icd10": "P22.0", "desc": "Respiratory distress syndrome"},
    "transient_tachypnea": {"rate": 0.088, "snomed": "276517002", "icd10": "P22.1", "desc": "Transient tachypnea of newborn"},
    "neonatal_hypoglycemia": {"rate": 0.085, "snomed": "52767006", "icd10": "P70.4", "desc": "Neonatal hypoglycemia"},
    "neonatal_sepsis": {"rate": 0.035, "snomed": "91302008", "icd10": "P36.9", "desc": "Neonatal sepsis"},
    "birth_asphyxia": {"rate": 0.017, "snomed": "87476004", "icd10": "P21.9", "desc": "Birth asphyxia"},
    "congenital_heart_defect": {"rate": 0.017, "snomed": "13213009", "icd10": "Q24.9", "desc": "Congenital heart defect"},
    "bronchopulmonary_dysplasia": {"rate": 0.018, "snomed": "67569000", "icd10": "P27.1", "desc": "Bronchopulmonary dysplasia"},
    "neonatal_withdrawal": {"rate": 0.019, "snomed": "206596003", "icd10": "P96.1", "desc": "Neonatal withdrawal syndrome"},
    "retinopathy_prematurity": {"rate": 0.014, "snomed": "415297005", "icd10": "H35.1", "desc": "Retinopathy of prematurity"},
    "intraventricular_hemorrhage": {"rate": 0.009, "snomed": "276649004", "icd10": "P52.3", "desc": "Intraventricular hemorrhage"},
    "patent_ductus_arteriosus": {"rate": 0.010, "snomed": "83330001", "icd10": "Q25.0", "desc": "Patent ductus arteriosus"},
    "down_syndrome": {"rate": 0.002, "snomed": "41040004", "icd10": "Q90.9", "desc": "Down syndrome"},
    "cleft_palate": {"rate": 0.004, "snomed": "87979003", "icd10": "Q35.9", "desc": "Cleft palate"},
}


def _gen_infant_weights(birth_weight, birth_date, died, death_date):
    from datetime import timedelta as td
    weights = []
    current_weight = birth_weight
    end_date = death_date if died and death_date else birth_date + td(days=365)
    d = birth_date
    while d <= end_date:
        weights.append({"date": d.isoformat(), "value": round(current_weight)})
        d += td(days=random.randint(14, 45))
        daily_gain = random.gauss(25, 5) if current_weight < 5000 else random.gauss(15, 5)
        days_gap = random.randint(14, 45)
        current_weight += daily_gain * days_gap
        current_weight = max(birth_weight, current_weight)
    return weights


def weighted_choice(items_with_weights):
    total = sum(w for _, _, w in items_with_weights)
    r = random.uniform(0, total)
    cum = 0
    for item, code, w in items_with_weights:
        cum += w
        if r <= cum:
            return item, code
    return items_with_weights[-1][0], items_with_weights[-1][1]


def pick_county():
    total_pop = sum(c[2] for c in COUNTIES)
    r = random.uniform(0, total_pop)
    cum = 0
    for name, fips, pop, svi in COUNTIES:
        cum += pop
        if r <= cum:
            return {"name": name, "fips": fips, "svi": svi}
    return {"name": COUNTIES[-1][0], "fips": COUNTIES[-1][1], "svi": COUNTIES[-1][3]}


def generate_base_population():
    pairs = []
    death_indices = set(random.sample(range(N_PAIRS), N_DEATHS))

    for i in range(N_PAIRS):
        county = pick_county()
        infant_id = 200000 + i
        mother_id = 300000 + i
        mrn_infant = f"MS-INF-{infant_id}"
        mrn_mother = f"MS-MAT-{mother_id}"

        race_label, race_concept, _ = random.choices(
            [(r[0], r[1], r[2]) for r in RACE_DIST],
            weights=[r[2] for r in RACE_DIST], k=1
        )[0]
        gender_label, gender_concept, _ = random.choices(
            [(g[0], g[1], g[2]) for g in GENDER_DIST],
            weights=[g[2] for g in GENDER_DIST], k=1
        )[0]

        mother_age = int(random.triangular(16, 44, 27))
        birth_year = random.choice([2022, 2023, 2024])
        birth_month = random.randint(1, 12)
        birth_day = random.randint(1, 28)
        birth_date = date(birth_year, birth_month, birth_day)
        mother_dob = date(birth_year - mother_age, random.randint(1, 12), random.randint(1, 28))

        is_preterm = random.random() < 0.12
        if is_preterm:
            gest_age = round(random.gauss(33, 3), 1)
            gest_age = max(24, min(36, gest_age))
        else:
            gest_age = round(random.gauss(39.2, 1.2), 1)
            gest_age = max(37, min(42, gest_age))

        if is_preterm:
            birth_weight = round(random.gauss(1800, 500))
            birth_weight = max(500, min(3500, birth_weight))
        else:
            birth_weight = round(random.gauss(3200, 450))
            birth_weight = max(2500, min(5000, birth_weight))

        birth_length = round(random.gauss(49, 3), 1)
        birth_length = max(35, min(56, birth_length))
        head_circ = round(random.gauss(34, 1.5), 1)
        head_circ = max(28, min(40, head_circ))

        if i in death_indices:
            apgar_1 = max(0, min(10, round(random.gauss(4, 2))))
            apgar_5 = max(0, min(10, round(random.gauss(5, 2))))
        else:
            apgar_1 = max(0, min(10, round(random.gauss(7, 1.5))))
            apgar_5 = max(0, min(10, round(random.gauss(8, 1))))

        died = i in death_indices
        if died:
            days_to_death = random.choices(
                [random.randint(0, 28), random.randint(29, 90), random.randint(91, 365)],
                weights=[0.5, 0.3, 0.2], k=1
            )[0]
            death_date = birth_date + timedelta(days=days_to_death)
        else:
            death_date = None

        mat_conditions = []
        mat_conditions.append({
            "key": ROUTINE_PREGNANCY_CONDITION["key"],
            "snomed": ROUTINE_PREGNANCY_CONDITION["snomed"],
            "icd10": ROUTINE_PREGNANCY_CONDITION["icd10"],
            "desc": ROUTINE_PREGNANCY_CONDITION["desc"],
            "onset_date": (birth_date - timedelta(days=random.randint(180, 270))).isoformat(),
        })
        for cond_key, cond_info in MATERNAL_CONDITIONS.items():
            risk = cond_info["rate"]
            if county["svi"] > 0.8:
                risk *= 1.3
            if died:
                risk *= 1.5
            risk = min(risk, 0.9)
            if random.random() < risk:
                mat_conditions.append({
                    "key": cond_key,
                    "snomed": cond_info["snomed"],
                    "icd10": cond_info["icd10"],
                    "desc": cond_info["desc"],
                    "onset_date": (birth_date - timedelta(days=random.randint(30, 200))).isoformat(),
                })

        inf_conditions = []
        for cond_key, cond_info in INFANT_CONDITIONS.items():
            risk = cond_info["rate"]
            if is_preterm:
                risk *= 2.0
            if died:
                risk *= 2.0
            risk = min(risk, 0.95)
            if random.random() < risk:
                inf_conditions.append({
                    "key": cond_key,
                    "snomed": cond_info["snomed"],
                    "icd10": cond_info["icd10"],
                    "desc": cond_info["desc"],
                    "onset_date": (birth_date + timedelta(days=random.randint(0, 14))).isoformat(),
                })

        prenatal_visits = max(0, round(random.gauss(10.5, 3)))
        mother_bmi = round(random.gauss(26.3, 5), 1)
        mother_bmi = max(16, min(55, mother_bmi))
        is_smoker = random.random() < 0.121
        ins_type = random.choices(
            ["medicaid", "private", "uninsured"], weights=[0.596, 0.334, 0.05], k=1
        )[0]
        parity = max(0, round(random.gauss(1.9, 1.2)))
        gravidity = max(parity + 1, round(random.gauss(2.8, 1.3)))

        pair = {
            "pair_id": i,
            "infant": {
                "person_id": infant_id,
                "mrn": mrn_infant,
                "uuid": str(uuid.uuid4()),
                "gender_label": gender_label,
                "gender_concept_id": gender_concept,
                "race_label": race_label,
                "race_concept_id": race_concept,
                "birth_date": birth_date.isoformat(),
                "birth_datetime": f"{birth_date.isoformat()}T{random.randint(0,23):02d}:{random.randint(0,59):02d}:00",
                "measurements": {
                    "birth_weight_g": birth_weight,
                    "gestational_age_weeks": gest_age,
                    "apgar_1min": apgar_1,
                    "apgar_5min": apgar_5,
                    "birth_length_cm": birth_length,
                    "head_circumference_cm": head_circ,
                    "infant_weight_trajectory": _gen_infant_weights(birth_weight, birth_date, died, death_date),
                },
                "conditions": inf_conditions,
                "died": died,
                "death_date": death_date.isoformat() if death_date else None,
                "is_preterm": is_preterm,
            },
            "mother": {
                "person_id": mother_id,
                "mrn": mrn_mother,
                "uuid": str(uuid.uuid4()),
                "age_at_birth": mother_age,
                "dob": mother_dob.isoformat(),
                "race_label": race_label,
                "race_concept_id": race_concept,
                "conditions": mat_conditions,
                "bmi": mother_bmi,
                "is_smoker": is_smoker,
                "insurance": ins_type,
                "parity": parity,
                "gravidity": gravidity,
                "prenatal_visits": prenatal_visits,
            },
            "county": county,
        }
        pairs.append(pair)

    return pairs


def main():
    print(f"Generating {N_PAIRS} mother-infant pairs...")
    pairs = generate_base_population()

    deaths = sum(1 for p in pairs if p["infant"]["died"])
    preterm = sum(1 for p in pairs if p["infant"]["is_preterm"])
    avg_bw = sum(p["infant"]["measurements"]["birth_weight_g"] for p in pairs) / len(pairs)
    avg_ga = sum(p["infant"]["measurements"]["gestational_age_weeks"] for p in pairs) / len(pairs)

    print(f"\n=== BASE POPULATION STATS ===")
    print(f"  Total pairs:    {len(pairs)}")
    print(f"  Deaths:         {deaths} ({deaths/len(pairs)*1000:.1f}/1000)")
    print(f"  Preterm:        {preterm} ({preterm/len(pairs)*100:.1f}%)")
    print(f"  Avg birth wt:   {avg_bw:.0f}g")
    print(f"  Avg gest age:   {avg_ga:.1f} wk")

    race_counts = defaultdict(int)
    for p in pairs:
        race_counts[p["infant"]["race_label"]] += 1
    print(f"  Race dist:      {dict(race_counts)}")

    county_counts = defaultdict(int)
    for p in pairs:
        county_counts[p["county"]["name"]] += 1
    top_counties = sorted(county_counts.items(), key=lambda x: -x[1])[:5]
    print(f"  Top counties:   {top_counties}")

    mat_cond_counts = defaultdict(int)
    for p in pairs:
        for c in p["mother"]["conditions"]:
            mat_cond_counts[c["key"]] += 1
    print(f"\n  Maternal conditions (top 5):")
    for k, v in sorted(mat_cond_counts.items(), key=lambda x: -x[1])[:5]:
        print(f"    {k}: {v} ({v/len(pairs)*100:.1f}%)")

    base_path = os.path.join(OUTPUT_DIR, "base_population.json")
    os.makedirs(os.path.dirname(base_path), exist_ok=True)
    with open(base_path, "w") as f:
        json.dump(pairs, f, indent=2, default=str)
    print(f"\n  Base population saved: {base_path}")

    return pairs


if __name__ == "__main__":
    pairs = main()
