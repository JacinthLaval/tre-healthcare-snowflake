import streamlit as st
from snowflake.snowpark.context import get_active_session
import pandas as pd

st.set_page_config(
    page_title="Patient Browser | Precision Advisor",
    page_icon=":material/genetics:",
    layout="wide"
)

st.title(":material/person_search: Patient Browser")
st.markdown("Browse patient demographics and genomic variants")

session = get_active_session()

@st.cache_data(ttl=600)
def get_patients():
    df = session.sql("""
        SELECT SAMPLE_ID, PATIENT_ID, PATIENT_NAME, BIRTHDATE, 
               POPULATION, SUPERPOPULATION, RACE, ETHNICITY, CITY, STATE
        FROM HEALTHCARE_DATABASE.DEFAULT_SCHEMA.PATIENT_GENOME_MAPPING
        ORDER BY PATIENT_NAME
    """).to_pandas()
    return df

@st.cache_data(ttl=600)
def get_cyp2c19_variants():
    df = session.sql("""
        SELECT CHROM, POS, REF, ALT, GENESYMBOL, NAME, CLNSIG, TYPE
        FROM HEALTHCARE_DATABASE.DEFAULT_SCHEMA.CLINVAR
        WHERE GENESYMBOL = 'CYP2C19'
        ORDER BY CLNSIG DESC
        LIMIT 100
    """).to_pandas()
    return df

patients_df = get_patients()

col1, col2 = st.columns([1, 2])

with col1:
    st.subheader("Select Patient")
    
    ancestry_filter = st.selectbox(
        "Filter by Ancestry",
        options=["All"] + sorted(patients_df["SUPERPOPULATION"].unique().tolist()),
        index=0
    )
    
    if ancestry_filter != "All":
        filtered_df = patients_df[patients_df["SUPERPOPULATION"] == ancestry_filter]
    else:
        filtered_df = patients_df
    
    patient_options = filtered_df.apply(
        lambda x: f"{x['PATIENT_NAME']} ({x['SAMPLE_ID']})", axis=1
    ).tolist()
    
    selected_patient = st.selectbox(
        "Select Patient",
        options=patient_options,
        index=0 if patient_options else None
    )

with col2:
    if selected_patient:
        sample_id = selected_patient.split("(")[-1].replace(")", "")
        patient_row = patients_df[patients_df["SAMPLE_ID"] == sample_id].iloc[0]
        
        st.subheader(f":material/person: {patient_row['PATIENT_NAME']}")
        
        demo_col1, demo_col2, demo_col3 = st.columns(3)
        
        with demo_col1:
            st.metric("Sample ID", patient_row["SAMPLE_ID"])
            st.metric("Birthdate", str(patient_row["BIRTHDATE"])[:10])
        
        with demo_col2:
            st.metric("Population", patient_row["POPULATION"])
            st.metric("Superpopulation", patient_row["SUPERPOPULATION"])
        
        with demo_col3:
            st.metric("Race", patient_row["RACE"])
            st.metric("Ethnicity", patient_row["ETHNICITY"])
        
        st.markdown(f"**Location:** {patient_row['CITY']}, {patient_row['STATE']}")

st.divider()

st.subheader(":material/biotech: CYP2C19 Variants (ClinVar)")

cyp_variants = get_cyp2c19_variants()

key_variants = st.pills(
    "Filter by Key Variants",
    options=["All", "Pathogenic", "Likely pathogenic", "*2 (rs4244285)", "*3 (rs4986893)", "*17 (rs12248560)"],
    default="All"
)

if key_variants == "Pathogenic":
    display_df = cyp_variants[cyp_variants["CLNSIG"].str.contains("Pathogenic", case=False, na=False)]
elif key_variants == "Likely pathogenic":
    display_df = cyp_variants[cyp_variants["CLNSIG"].str.contains("Likely pathogenic", case=False, na=False)]
elif key_variants == "*2 (rs4244285)":
    display_df = cyp_variants[cyp_variants["NAME"].str.contains("rs4244285|681G>A", case=False, na=False)]
elif key_variants == "*3 (rs4986893)":
    display_df = cyp_variants[cyp_variants["NAME"].str.contains("rs4986893|636G>A", case=False, na=False)]
elif key_variants == "*17 (rs12248560)":
    display_df = cyp_variants[cyp_variants["NAME"].str.contains("rs12248560|-806C>T", case=False, na=False)]
else:
    display_df = cyp_variants

st.dataframe(
    display_df,
    use_container_width=True,
    hide_index=True,
    column_config={
        "CHROM": st.column_config.TextColumn("Chr"),
        "POS": st.column_config.NumberColumn("Position", format="%d"),
        "REF": st.column_config.TextColumn("Ref"),
        "ALT": st.column_config.TextColumn("Alt"),
        "GENESYMBOL": st.column_config.TextColumn("Gene"),
        "NAME": st.column_config.TextColumn("Variant Name"),
        "CLNSIG": st.column_config.TextColumn("Clinical Significance"),
        "TYPE": st.column_config.TextColumn("Type")
    }
)

st.caption(f"Showing {len(display_df)} variants")
