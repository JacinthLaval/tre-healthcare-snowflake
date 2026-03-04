CYP2C19_ALLELES = {
    "*1": {
        "rsid": None,
        "nucleotide_change": "Wild-type",
        "function": "Normal",
        "activity_score": 1.0
    },
    "*2": {
        "rsid": "rs4244285",
        "nucleotide_change": "681G>A",
        "function": "No function",
        "activity_score": 0.0,
        "description": "Splicing defect resulting in non-functional enzyme"
    },
    "*3": {
        "rsid": "rs4986893",
        "nucleotide_change": "636G>A",
        "function": "No function",
        "activity_score": 0.0,
        "description": "Premature stop codon, common in Asian populations"
    },
    "*17": {
        "rsid": "rs12248560",
        "nucleotide_change": "-806C>T",
        "function": "Increased",
        "activity_score": 1.5,
        "description": "Promoter variant causing increased transcription"
    }
}

DIPLOTYPE_PHENOTYPES = {
    ("*1", "*1"): {"phenotype": "Normal Metabolizer", "abbreviation": "NM", "activity_score": 2.0},
    ("*1", "*2"): {"phenotype": "Intermediate Metabolizer", "abbreviation": "IM", "activity_score": 1.0},
    ("*1", "*3"): {"phenotype": "Intermediate Metabolizer", "abbreviation": "IM", "activity_score": 1.0},
    ("*1", "*17"): {"phenotype": "Rapid Metabolizer", "abbreviation": "RM", "activity_score": 2.5},
    ("*2", "*2"): {"phenotype": "Poor Metabolizer", "abbreviation": "PM", "activity_score": 0.0},
    ("*2", "*3"): {"phenotype": "Poor Metabolizer", "abbreviation": "PM", "activity_score": 0.0},
    ("*2", "*17"): {"phenotype": "Intermediate Metabolizer", "abbreviation": "IM", "activity_score": 1.5},
    ("*3", "*3"): {"phenotype": "Poor Metabolizer", "abbreviation": "PM", "activity_score": 0.0},
    ("*3", "*17"): {"phenotype": "Intermediate Metabolizer", "abbreviation": "IM", "activity_score": 1.5},
    ("*17", "*17"): {"phenotype": "Ultrarapid Metabolizer", "abbreviation": "UM", "activity_score": 3.0},
}

POPULATION_LOF_FREQUENCIES = {
    "EAS": {"frequency": 0.35, "risk": "High", "note": "East Asian - 30-35% carry *2 or *3"},
    "SAS": {"frequency": 0.35, "risk": "High", "note": "South Asian - 30-40% carry *2 or *3"},
    "EUR": {"frequency": 0.18, "risk": "Moderate", "note": "European - 15-20% carry *2 or *3"},
    "AFR": {"frequency": 0.17, "risk": "Moderate", "note": "African - 15-18% carry *2 or *3"},
    "AMR": {"frequency": 0.12, "risk": "Low-Moderate", "note": "Americas - 10-15% carry *2 or *3"},
}

RECOMMENDATIONS = {
    "PM": {
        "clopidogrel": "NOT RECOMMENDED",
        "alternative": "Use prasugrel or ticagrelor",
        "rationale": "Minimal/no active metabolite production",
        "evidence": "CPIC Strong Recommendation"
    },
    "IM": {
        "clopidogrel": "NOT RECOMMENDED",
        "alternative": "Use prasugrel or ticagrelor",
        "rationale": "Reduced active metabolite, increased CV risk",
        "evidence": "CPIC Strong Recommendation"
    },
    "NM": {
        "clopidogrel": "APPROPRIATE",
        "alternative": None,
        "rationale": "Normal metabolism expected",
        "evidence": "Standard of care"
    },
    "RM": {
        "clopidogrel": "APPROPRIATE - monitor bleeding",
        "alternative": None,
        "rationale": "Enhanced metabolism, potential bleeding risk",
        "evidence": "CPIC recommendation with monitoring"
    },
    "UM": {
        "clopidogrel": "APPROPRIATE - monitor bleeding closely",
        "alternative": None,
        "rationale": "Increased metabolism may increase bleeding risk",
        "evidence": "CPIC recommendation with close monitoring"
    }
}


def get_phenotype(allele1: str, allele2: str) -> dict:
    key = tuple(sorted([allele1, allele2]))
    return DIPLOTYPE_PHENOTYPES.get(key, {"phenotype": "Unknown", "abbreviation": "UNK"})


def get_recommendation(phenotype_abbrev: str) -> dict:
    return RECOMMENDATIONS.get(phenotype_abbrev, {"clopidogrel": "Consult pharmacogenomics specialist"})


def get_population_risk(superpopulation: str) -> dict:
    return POPULATION_LOF_FREQUENCIES.get(superpopulation, {
        "frequency": 0.2,
        "risk": "Unknown",
        "note": "Population frequency data not available"
    })


def format_alert(superpopulation: str) -> str:
    risk_info = get_population_risk(superpopulation)
    
    if risk_info["risk"] == "High":
        return f"""⚠️ **HIGH RISK POPULATION**
        
{risk_info['note']}

**Recommendation:** Consider CYP2C19 genotyping before initiating clopidogrel.
Alternative P2Y12 inhibitors (prasugrel, ticagrelor) may be preferred."""
    
    elif risk_info["risk"] == "Moderate":
        return f"""ℹ️ **MODERATE RISK POPULATION**
        
{risk_info['note']}

**Recommendation:** CYP2C19 genotyping recommended for high-risk patients (ACS, PCI)."""
    
    else:
        return f"""✓ **LOWER RISK POPULATION**
        
{risk_info['note']}

**Recommendation:** Standard clopidogrel may be appropriate. Consider genotyping for high-risk cases."""
