import streamlit as st
from snowflake.snowpark.context import get_active_session
import json

st.set_page_config(
    page_title="ER Console | Precision Advisor",
    page_icon=":material/genetics:",
    layout="wide"
)

st.title(":material/emergency: ER Console")
st.markdown("AI-powered clinical decision support via NeoResearchAgent")

session = get_active_session()

@st.cache_data(ttl=600)
def get_patients():
    df = session.sql("""
        SELECT SAMPLE_ID, PATIENT_ID, PATIENT_NAME, BIRTHDATE, 
               POPULATION, SUPERPOPULATION, RACE, ETHNICITY
        FROM HEALTHCARE_DATABASE.DEFAULT_SCHEMA.PATIENT_GENOME_MAPPING
        ORDER BY PATIENT_NAME
    """).to_pandas()
    return df

def get_patient_clinical_profile(sample_id: str) -> dict:
    """Get patient's conditions, medications, and CYP2C19 variants"""
    result = session.sql(f"""
        CALL HEALTHCARE_DATABASE.DEFAULT_SCHEMA.GET_PATIENT_CLINICAL_PROFILE('{sample_id}')
    """).collect()[0][0]
    
    if isinstance(result, str):
        return json.loads(result)
    return result

def call_neo_research_agent(query: str) -> str:
    """Call the NeoResearchAgent via stored procedure"""
    escaped_query = query.replace("'", "''")
    result = session.sql(f"""
        CALL HEALTHCARE_DATABASE.DEFAULT_SCHEMA.CALL_NEO_RESEARCH_AGENT('{escaped_query}')
    """).collect()[0][0]
    return result

def parse_agent_response(response_json: str) -> dict:
    """Parse the agent response JSON to extract text and citations"""
    try:
        response = json.loads(response_json)
        text_content = ""
        citations = []
        
        for item in response.get("content", []):
            if item.get("type") == "text":
                text_content += item.get("text", "")
            elif item.get("type") == "tool_result":
                tool_content = item.get("tool_result", {}).get("content", [])
                for tc in tool_content:
                    if tc.get("type") == "json":
                        search_results = tc.get("json", {}).get("search_results", [])
                        for sr in search_results[:3]:
                            citations.append(sr.get("text", "")[:500])
        
        return {"text": text_content, "citations": citations}
    except:
        return {"text": response_json, "citations": []}

def filter_clinical_conditions(conditions: list) -> list:
    """Filter out non-clinical findings from conditions list"""
    exclude_keywords = ['employment', 'finding', 'certificate', 'criminal', 'social', 'education']
    clinical = []
    for c in conditions:
        if not any(kw in c.lower() for kw in exclude_keywords):
            clinical.append(c)
    return clinical

def generate_comprehensive_recommendation(patient_info: dict, clinical_profile: dict, clinical_notes: str) -> str:
    """Generate recommendation using patient's actual clinical and genomic data"""
    conditions = clinical_profile.get("conditions", [])
    medications = clinical_profile.get("medications", [])
    cyp2c19 = clinical_profile.get("cyp2c19", {})
    
    clinical_conditions = filter_clinical_conditions(conditions)
    
    # Format CYP2C19 variant info
    cyp2c19_info = f"""
CYP2C19 GENOTYPE RESULTS:
- Phenotype: {cyp2c19.get('phenotype', 'Unknown')}
- Clinical Recommendation: {cyp2c19.get('recommendation', 'N/A')}
"""
    variants = cyp2c19.get('variants', [])
    if variants:
        cyp2c19_info += "- Variants detected:\n"
        for v in variants:
            cyp2c19_info += f"  - {v.get('variant')} ({v.get('rs_id')}): {v.get('allele1')}/{v.get('allele2')} - {v.get('status')}\n"
    
    query = f"""You are a clinical pharmacogenomics advisor with access to PubMed and ClinicalTrials.gov.

PATIENT INFORMATION:
- Name: {patient_info.get('PATIENT_NAME', 'Unknown')}
- Sample ID: {patient_info.get('SAMPLE_ID', 'Unknown')}
- Ancestry: {patient_info.get('SUPERPOPULATION', 'Unknown')} ({patient_info.get('POPULATION', 'Unknown')})

PATIENT'S GENOMIC DATA:
{cyp2c19_info}

PATIENT'S CURRENT CONDITIONS (from EHR):
{chr(10).join(['- ' + c for c in clinical_conditions[:10]])}

PATIENT'S CURRENT MEDICATIONS (from EHR):
{chr(10).join(['- ' + m for m in medications[:10]])}

CLINICAL NOTES (ER presentation):
{clinical_notes}

Based on this patient's ACTUAL genomic profile and clinical data:
1. Search ClinicalTrials.gov for relevant trials given their CYP2C19 status
2. Search PubMed for pharmacogenomics guidance specific to their genotype

Provide a structured recommendation:

## Genomic Assessment
(Interpret the patient's CYP2C19 genotype in clinical context)

## Drug-Therapy Implications
(Specific guidance based on their {cyp2c19.get('phenotype', 'Unknown')} status)

## Current Medication Review
(Flag any current medications affected by CYP2C19 status)

## Emerging Therapies
(Relevant clinical trials for their genotype and conditions)

## Recommendation
(Specific actionable guidance based on genomic data)

## Key References"""
    
    return call_neo_research_agent(query)

patients_df = get_patients()

col1, col2 = st.columns([1, 2])

with col1:
    st.subheader(":material/person: Select Patient")
    
    ancestry_filter = st.selectbox(
        "Filter by Ancestry",
        options=["All"] + sorted(patients_df["SUPERPOPULATION"].unique().tolist())
    )
    
    if ancestry_filter != "All":
        filtered_df = patients_df[patients_df["SUPERPOPULATION"] == ancestry_filter]
    else:
        filtered_df = patients_df
    
    patient_options = filtered_df.apply(
        lambda x: f"{x['PATIENT_NAME']} ({x['SAMPLE_ID']})", axis=1
    ).tolist()
    
    selected_patient = st.selectbox(
        "Patient",
        options=patient_options,
        index=0 if patient_options else None,
        label_visibility="collapsed"
    )
    
    if selected_patient:
        sample_id = selected_patient.split("(")[-1].replace(")", "")
        patient_row = patients_df[patients_df["SAMPLE_ID"] == sample_id].iloc[0].to_dict()
        
        st.markdown(f"""
        **Ancestry:** {patient_row['SUPERPOPULATION']} ({patient_row['POPULATION']})  
        **Race:** {patient_row['RACE']}  
        **Ethnicity:** {patient_row['ETHNICITY']}
        """)

with col2:
    st.subheader(":material/edit_note: Clinical Notes")
    
    clinical_notes = st.text_area(
        "Enter clinical notes",
        placeholder="Describe the patient's condition and what therapy you're considering...",
        height=100,
        label_visibility="collapsed"
    )
    
    st.caption("Examples: stroke prevention, post-stent antiplatelet, statin therapy, pain management")
    
    condition_pills = st.pills(
        "Common Scenarios",
        options=[
            "Stroke - antiplatelet",
            "ACS/Stent - DAPT",
            "Atrial Fib - anticoagulation",
            "High cholesterol - statins",
            "Chronic pain - opioids"
        ],
        selection_mode="single"
    )
    
    if condition_pills == "Stroke - antiplatelet":
        clinical_notes = "Patient had ischemic stroke, now stable. Need antiplatelet therapy for secondary prevention. Considering clopidogrel vs alternatives."
    elif condition_pills == "ACS/Stent - DAPT":
        clinical_notes = "Patient with acute coronary syndrome, underwent PCI with drug-eluting stent. Need dual antiplatelet therapy (DAPT). Evaluating P2Y12 inhibitor options."
    elif condition_pills == "Atrial Fib - anticoagulation":
        clinical_notes = "Patient with atrial fibrillation, CHA2DS2-VASc score indicates anticoagulation needed. Considering warfarin vs DOACs."
    elif condition_pills == "High cholesterol - statins":
        clinical_notes = "Patient with hyperlipidemia and elevated cardiovascular risk. Need statin therapy. Concerned about myopathy risk."
    elif condition_pills == "Chronic pain - opioids":
        clinical_notes = "Patient with chronic pain requiring opioid therapy. Need to assess CYP2D6 status for codeine/tramadol metabolism."

st.divider()

if selected_patient:
    with st.spinner("Loading patient genomic and clinical data..."):
        clinical_profile = get_patient_clinical_profile(sample_id)
    
    cyp2c19 = clinical_profile.get("cyp2c19", {})
    phenotype = cyp2c19.get("phenotype", "Unknown")
    
    # CYP2C19 Genotype Alert Box
    st.subheader(":material/biotech: CYP2C19 Pharmacogenomics Profile")
    
    geno_col1, geno_col2 = st.columns([2, 1])
    
    with geno_col1:
        if phenotype in ["Poor Metabolizer", "Intermediate Metabolizer"]:
            st.error(f"""
            **:material/warning: CYP2C19 {phenotype.upper()}**
            
            {cyp2c19.get('recommendation', '')}
            """)
        elif phenotype in ["Rapid Metabolizer", "Ultrarapid Metabolizer"]:
            st.warning(f"""
            **:material/info: CYP2C19 {phenotype}**
            
            {cyp2c19.get('recommendation', '')}
            """)
        else:
            st.success(f"""
            **:material/check_circle: CYP2C19 {phenotype}**
            
            {cyp2c19.get('recommendation', '')}
            """)
    
    with geno_col2:
        st.metric("CYP2C19 Phenotype", phenotype)
    
    # Show variant details
    variants = cyp2c19.get("variants", [])
    if variants:
        with st.expander(":material/dna: View CYP2C19 Variant Details", expanded=False):
            for v in variants:
                status_icon = ":red_circle:" if v["status"] != "Homozygous REF" else ":green_circle:"
                st.markdown(f"""
                {status_icon} **{v['variant']}** ({v['rs_id']})  
                Genotype: `{v['allele1']}/{v['allele2']}` | Status: {v['status']}
                """)
    else:
        st.info("No CYP2C19 variants detected in this patient's genome data (wild-type assumed)")
    
    st.divider()
    
    # Clinical Profile
    with st.expander(":material/medical_information: Patient Clinical Profile (EHR)", expanded=False):
        profile_col1, profile_col2 = st.columns(2)
        
        with profile_col1:
            st.markdown("**Conditions:**")
            conditions = clinical_profile.get("conditions", [])
            clinical_conditions = filter_clinical_conditions(conditions)
            if clinical_conditions:
                for c in clinical_conditions[:8]:
                    st.markdown(f"- {c}")
                if len(clinical_conditions) > 8:
                    st.caption(f"...and {len(clinical_conditions) - 8} more")
            else:
                st.caption("No conditions on record")
        
        with profile_col2:
            st.markdown("**Current Medications:**")
            medications = clinical_profile.get("medications", [])
            if medications:
                for m in medications[:8]:
                    st.markdown(f"- {m}")
                if len(medications) > 8:
                    st.caption(f"...and {len(medications) - 8} more")
            else:
                st.caption("No medications on record")

st.divider()

analyze_btn = st.button(
    ":material/smart_toy: Analyze with NeoResearchAgent",
    type="primary",
    use_container_width=True,
    disabled=not clinical_notes
)

if analyze_btn and clinical_notes and selected_patient:
    with st.status("NeoResearchAgent analyzing genomic and clinical data...", expanded=True) as status:
        
        st.write(":material/biotech: Loading patient CYP2C19 genotype...")
        st.write(f"  → Phenotype: **{phenotype}**")
        
        st.write(":material/psychology: Querying NeoResearchAgent...")
        st.write("  - Searching ClinicalTrials.gov for genotype-specific trials")
        st.write("  - Searching PubMed for pharmacogenomics guidance")
        
        recommendation_response = generate_comprehensive_recommendation(
            patient_row, clinical_profile, clinical_notes
        )
        recommendation_parsed = parse_agent_response(recommendation_response)
        
        status.update(label="Analysis complete!", state="complete")
    
    st.subheader(":material/lightbulb: Clinical Decision Support")
    
    # Phenotype-based alert
    if phenotype in ["Poor Metabolizer", "Intermediate Metabolizer"]:
        st.error(f"""
        **:material/warning: ACTION REQUIRED - CYP2C19 {phenotype}**
        
        This patient has reduced CYP2C19 function. If considering clopidogrel therapy:
        - **AVOID** clopidogrel for stroke/ACS
        - **USE** prasugrel or ticagrelor instead
        - Document pharmacogenomic decision in medical record
        """)
    
    st.markdown("---")
    st.markdown(recommendation_parsed["text"])
    
    if recommendation_parsed["citations"]:
        st.divider()
        with st.expander(":material/source: View Source Documents"):
            for i, citation in enumerate(recommendation_parsed["citations"], 1):
                st.markdown(f"**Source {i}:** {citation}...")
        st.caption("Sources: PubMed & ClinicalTrials.gov via NeoResearchAgent")

st.sidebar.markdown("---")
st.sidebar.subheader("About This Console")
st.sidebar.markdown("""
**Data Sources Integrated:**

:material/biotech: **Genomic Data**
- CYP2C19 genotypes from VCF
- *1, *2, *3, *17 variant calling

:material/medical_information: **EHR Data**
- Conditions & diagnoses
- Current medications

:material/article: **Research (via Agent)**
- PubMed (72M+ articles)
- ClinicalTrials.gov (5.6M+ trials)

**Workflow:**
1. Load patient's CYP2C19 genotype
2. Determine metabolizer phenotype
3. Generate CPIC-guided recommendation
4. Search for relevant research
""")

st.sidebar.markdown("---")
st.sidebar.subheader("CYP2C19 Quick Reference")
st.sidebar.markdown("""
| Phenotype | Variants | Clopidogrel |
|-----------|----------|-------------|
| Poor | *2/*2, *2/*3 | **AVOID** |
| Intermediate | *1/*2, *1/*3 | Consider alt |
| Normal | *1/*1 | Standard |
| Rapid | *1/*17 | Standard |
| Ultrarapid | *17/*17 | Standard |
""")
