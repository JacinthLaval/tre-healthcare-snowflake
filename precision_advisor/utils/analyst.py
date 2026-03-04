from snowflake.snowpark.context import get_active_session

SEMANTIC_VIEW = "HEALTHCARE_DATABASE.DEFAULT_SCHEMA.CLINICAL_GENOMICS_VIEW"

def query_semantic_view(question: str) -> dict:
    session = get_active_session()
    
    prompt = f"""Answer this question using the CLINICAL_GENOMICS_VIEW semantic view:
    
Question: {question}

The semantic view contains:
- PATIENT_GENOME_MAPPING: Links patients to 1000 Genomes samples (ancestry, demographics)
- CONDITIONS: Patient diagnoses from Synthea
- MEDICATIONS: Patient prescriptions from Synthea
- PANEL: Genomic sample demographics

Generate a SQL query using SEMANTIC_VIEW() syntax if needed."""
    
    result = session.sql(f"""
        SELECT SNOWFLAKE.CORTEX.COMPLETE(
            'claude-3-5-sonnet',
            '{prompt.replace("'", "''")}'
        ) as response
    """).collect()[0]["RESPONSE"]
    
    return {"question": question, "response": result}


def get_patient_conditions(patient_id: int) -> list:
    session = get_active_session()
    
    results = session.sql(f"""
        SELECT c.DESCRIPTION, c.CODE, c.CONDITION_START
        FROM SYNTHETIC_HEALTHCARE_DATA__CLINICAL_AND_CLAIMS.SILVER.CONDITIONS c
        WHERE c.PATIENT_ID = {patient_id}
        ORDER BY c.CONDITION_START DESC
        LIMIT 20
    """).to_pandas()
    
    return results.to_dict('records')


def get_patient_medications(patient_id: int) -> list:
    session = get_active_session()
    
    results = session.sql(f"""
        SELECT m.DESCRIPTION, m.CODE, m.MED_START, m.BASE_COST
        FROM SYNTHETIC_HEALTHCARE_DATA__CLINICAL_AND_CLAIMS.SILVER.MEDICATIONS m
        WHERE m.PATIENT_ID = {patient_id}
        ORDER BY m.MED_START DESC
        LIMIT 20
    """).to_pandas()
    
    return results.to_dict('records')
