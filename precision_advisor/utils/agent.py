from snowflake.snowpark.context import get_active_session

PUBMED_SEARCH_SERVICE = "PUBMED_BIOMEDICAL_RESEARCH.OA_COMM.PUBMED_OA_CKE_SEARCH_SERVICE"
CLINICAL_TRIALS_SEARCH_SERVICE = "CLINICAL_TRIALS_RESEARCH_DATABASE.CT.CLINICAL_TRIALS_SEARCH_SERVICE"


def search_pubmed(query: str, limit: int = 5) -> list:
    session = get_active_session()
    
    results = session.sql(f"""
        SELECT ARTICLE_CITATION, PMID, CHUNK, ARTICLE_URL
        FROM TABLE(
            SNOWFLAKE.CORTEX.SEARCH_PREVIEW(
                '{PUBMED_SEARCH_SERVICE}',
                '{query.replace("'", "''")}',
                {{
                    'columns': ['ARTICLE_CITATION', 'PMID', 'CHUNK', 'ARTICLE_URL'],
                    'limit': {limit}
                }}
            )
        )
    """).to_pandas()
    
    return results.to_dict('records')


def search_clinical_trials(query: str, limit: int = 5) -> list:
    session = get_active_session()
    
    results = session.sql(f"""
        SELECT NCT_ID, BRIEF_TITLE, STUDY_URL, PHASES, CONDITIONS, OVERALL_STATUS
        FROM TABLE(
            SNOWFLAKE.CORTEX.SEARCH_PREVIEW(
                '{CLINICAL_TRIALS_SEARCH_SERVICE}',
                '{query.replace("'", "''")}',
                {{
                    'columns': ['NCT_ID', 'BRIEF_TITLE', 'STUDY_URL', 'PHASES', 'CONDITIONS', 'OVERALL_STATUS'],
                    'limit': {limit}
                }}
            )
        )
    """).to_pandas()
    
    return results.to_dict('records')


def call_neo_research_agent(patient_context: str, clinical_question: str) -> str:
    session = get_active_session()
    
    agent_prompt = f"""You are a clinical pharmacogenomics advisor helping with antiplatelet therapy decisions.

PATIENT CONTEXT:
{patient_context}

CLINICAL QUESTION:
{clinical_question}

INSTRUCTIONS:
1. Analyze the patient's ancestry for CYP2C19 variant risk
2. Consider the clinical scenario (stroke, ACS, PCI, etc.)
3. Provide evidence-based recommendations for antiplatelet therapy
4. Cite relevant guidelines (CPIC, AHA) and research

CYP2C19 PHARMACOGENOMICS REFERENCE:
- *2 (rs4244285, 681G>A): Loss-of-function, most common
- *3 (rs4986893, 636G>A): Loss-of-function, common in Asians
- *17 (rs12248560, -806C>T): Gain-of-function, increased activity

POPULATION FREQUENCIES (LOF alleles):
- East Asian: 30-35%
- South Asian: 30-40%
- European: 15-20%
- African: 15-18%
- Americas: 10-15%

RECOMMENDATIONS BY PHENOTYPE:
- Poor Metabolizer (*2/*2, *2/*3, *3/*3): Use prasugrel or ticagrelor
- Intermediate Metabolizer (*1/*2, *1/*3): Use prasugrel or ticagrelor
- Normal Metabolizer (*1/*1): Standard clopidogrel appropriate
- Rapid/Ultrarapid (*1/*17, *17/*17): Monitor for bleeding risk

Provide a clear, actionable recommendation with supporting evidence."""

    result = session.sql(f"""
        SELECT SNOWFLAKE.CORTEX.COMPLETE(
            'claude-3-5-sonnet',
            '{agent_prompt.replace("'", "''")}'
        ) as response
    """).collect()[0]["RESPONSE"]
    
    return result
