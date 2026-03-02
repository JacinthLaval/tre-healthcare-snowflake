import streamlit as st
import pandas as pd
from snowflake.snowpark.context import get_active_session

st.title("Patient Explorer")
st.markdown("### Detailed Patient Demographics")

@st.cache_resource
def get_session():
    return get_active_session()

session = get_session()

def run_query(sql):
    return session.sql(sql).to_pandas()

current_role = st.session_state.get('current_role', 'CLINICAL_RESEARCHER')

if current_role == 'CLINICAL_RESEARCHER':
    st.success("Full PII Access - All patient identifiers visible")
else:
    st.warning("Masked Access - PII columns show '***REDACTED***' or NULL")

st.markdown("---")
st.subheader("Patient Demographics")

try:
    patients_df = run_query("""
        SELECT 
            p.person_id,
            p.person_source_value as patient_id,
            CASE p.gender_concept_id WHEN 8507 THEN 'Male' ELSE 'Female' END as gender,
            p.year_of_birth,
            p.birth_datetime,
            CASE p.race_concept_id 
                WHEN 8527 THEN 'White'
                WHEN 8516 THEN 'Black or African American'
                WHEN 8515 THEN 'Asian'
                WHEN 8557 THEN 'American Indian'
                ELSE 'Other'
            END as race,
            CASE WHEN p.ethnicity_concept_id = 38003563 THEN 'Hispanic' ELSE 'Non-Hispanic' END as ethnicity,
            p.location_id,
            COUNT(DISTINCT v.visit_occurrence_id) as total_visits,
            COUNT(DISTINCT c.condition_occurrence_id) as total_conditions
        FROM TRE_HEALTHCARE_DB.OMOP_CDM.PERSON p
        LEFT JOIN TRE_HEALTHCARE_DB.OMOP_CDM.VISIT_OCCURRENCE v ON p.person_id = v.person_id
        LEFT JOIN TRE_HEALTHCARE_DB.OMOP_CDM.CONDITION_OCCURRENCE c ON p.person_id = c.person_id
        GROUP BY p.person_id, p.person_source_value, p.gender_concept_id, 
                 p.year_of_birth, p.birth_datetime, p.race_concept_id, 
                 p.ethnicity_concept_id, p.location_id
        ORDER BY p.person_id
    """)
    
    st.dataframe(patients_df, use_container_width=True)
    
except Exception as e:
    st.error(f"Error loading patient data: {e}")

st.markdown("---")
st.subheader("Demographics Distribution")

col1, col2 = st.columns(2)

try:
    gender_df = run_query("""
        SELECT 
            CASE gender_concept_id WHEN 8507 THEN 'Male' ELSE 'Female' END as gender,
            COUNT(*) as count
        FROM TRE_HEALTHCARE_DB.OMOP_CDM.PERSON
        GROUP BY gender_concept_id
    """)
    
    col1.markdown("**Gender Distribution**")
    col1.bar_chart(gender_df.set_index('GENDER'))
    
except Exception as e:
    col1.error(f"Error: {e}")

try:
    race_df = run_query("""
        SELECT 
            CASE race_concept_id 
                WHEN 8527 THEN 'White'
                WHEN 8516 THEN 'Black'
                WHEN 8515 THEN 'Asian'
                WHEN 8557 THEN 'Native Am.'
                ELSE 'Other'
            END as race,
            COUNT(*) as count
        FROM TRE_HEALTHCARE_DB.OMOP_CDM.PERSON
        GROUP BY race_concept_id
    """)
    
    col2.markdown("**Race Distribution**")
    col2.bar_chart(race_df.set_index('RACE'))
    
except Exception as e:
    col2.error(f"Error: {e}")

st.markdown("---")
st.subheader("Age Distribution")

try:
    age_df = run_query("""
        SELECT 
            CASE 
                WHEN YEAR(CURRENT_DATE()) - year_of_birth < 30 THEN '18-29'
                WHEN YEAR(CURRENT_DATE()) - year_of_birth < 40 THEN '30-39'
                WHEN YEAR(CURRENT_DATE()) - year_of_birth < 50 THEN '40-49'
                WHEN YEAR(CURRENT_DATE()) - year_of_birth < 60 THEN '50-59'
                WHEN YEAR(CURRENT_DATE()) - year_of_birth < 70 THEN '60-69'
                WHEN YEAR(CURRENT_DATE()) - year_of_birth < 80 THEN '70-79'
                ELSE '80+'
            END as age_group,
            COUNT(*) as count
        FROM TRE_HEALTHCARE_DB.OMOP_CDM.PERSON
        GROUP BY age_group
        ORDER BY age_group
    """)
    
    st.bar_chart(age_df.set_index('AGE_GROUP'))
    
except Exception as e:
    st.error(f"Error loading age data: {e}")
