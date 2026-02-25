import streamlit as st
import pandas as pd

st.title("Condition Analysis")
st.markdown("### Disease Distribution and Clinical Insights")

@st.cache_resource
def get_connection():
    try:
        from snowflake.snowpark.context import get_active_session
        return get_active_session(), True
    except:
        import snowflake.connector
        import os
        conn = snowflake.connector.connect(
            connection_name=os.getenv('SNOWFLAKE_CONNECTION_NAME', 'default')
        )
        return conn, False

connection, is_sis = get_connection()

def run_query(sql):
    if is_sis:
        return connection.sql(sql).to_pandas()
    else:
        cursor = connection.cursor()
        cursor.execute(sql)
        columns = [desc[0] for desc in cursor.description]
        data = cursor.fetchall()
        cursor.close()
        return pd.DataFrame(data, columns=columns)

current_role = st.session_state.get('current_role', 'CLINICAL_RESEARCHER')
if current_role == 'CLINICAL_RESEARCHER':
    st.success("Full Research Access")
else:
    st.warning("Data Engineer Access - Aggregated views only")

st.markdown("---")

col1, col2, col3 = st.columns(3)

try:
    stats = run_query("""
        SELECT 
            COUNT(*) as TOTAL_CONDITIONS,
            COUNT(DISTINCT person_id) as PATIENTS_WITH_CONDITIONS,
            COUNT(DISTINCT condition_concept_id) as UNIQUE_DIAGNOSES
        FROM TRE_HEALTHCARE_DB.OMOP_CDM.CONDITION_OCCURRENCE
    """)
    
    col1.metric("Total Diagnoses", f"{int(stats['TOTAL_CONDITIONS'].iloc[0]):,}")
    col2.metric("Patients w/ Conditions", f"{int(stats['PATIENTS_WITH_CONDITIONS'].iloc[0]):,}")
    col3.metric("Unique Diagnoses", f"{int(stats['UNIQUE_DIAGNOSES'].iloc[0]):,}")
    
except Exception as e:
    st.error(f"Error loading metrics: {e}")

st.markdown("---")
st.subheader("Top Conditions by Frequency")

try:
    conditions_df = run_query("""
        SELECT 
            condition_source_value as ICD_CODE,
            CASE condition_source_value
                WHEN 'E11' THEN 'Type 2 Diabetes'
                WHEN 'I10' THEN 'Hypertension'
                WHEN 'J06.9' THEN 'Upper Respiratory Infection'
                WHEN 'I25.10' THEN 'Coronary Artery Disease'
                WHEN 'M54.5' THEN 'Low Back Pain'
                WHEN 'F32.9' THEN 'Major Depression'
                WHEN 'E78.5' THEN 'Hyperlipidemia'
                WHEN 'K21.0' THEN 'GERD'
                WHEN 'J45.909' THEN 'Asthma'
                WHEN 'M17.11' THEN 'Knee Osteoarthritis'
                ELSE condition_source_value
            END as CONDITION_NAME,
            COUNT(*) as OCCURRENCES,
            COUNT(DISTINCT person_id) as PATIENTS_AFFECTED
        FROM TRE_HEALTHCARE_DB.OMOP_CDM.CONDITION_OCCURRENCE
        GROUP BY condition_source_value
        ORDER BY OCCURRENCES DESC
    """)
    
    st.bar_chart(conditions_df.set_index('CONDITION_NAME')['OCCURRENCES'])
    
    st.markdown("**Detailed Condition Statistics**")
    st.dataframe(conditions_df, use_container_width=True, hide_index=True)
    
except Exception as e:
    st.error(f"Error loading conditions: {e}")

st.markdown("---")
st.subheader("Conditions by Visit Type")

try:
    visit_conditions_df = run_query("""
        SELECT 
            CASE v.visit_concept_id 
                WHEN 9201 THEN 'Inpatient'
                WHEN 9202 THEN 'Outpatient'
                WHEN 9203 THEN 'Emergency'
                ELSE 'Other'
            END as VISIT_TYPE,
            COUNT(DISTINCT c.condition_occurrence_id) as CONDITIONS,
            COUNT(DISTINCT c.person_id) as PATIENTS
        FROM TRE_HEALTHCARE_DB.OMOP_CDM.CONDITION_OCCURRENCE c
        JOIN TRE_HEALTHCARE_DB.OMOP_CDM.VISIT_OCCURRENCE v 
            ON c.visit_occurrence_id = v.visit_occurrence_id
        GROUP BY v.visit_concept_id
        ORDER BY CONDITIONS DESC
    """)
    
    col1, col2 = st.columns(2)
    col1.markdown("**Conditions by Visit Type**")
    col1.bar_chart(visit_conditions_df.set_index('VISIT_TYPE')['CONDITIONS'])
    
    col2.markdown("**Patients by Visit Type**")
    col2.bar_chart(visit_conditions_df.set_index('VISIT_TYPE')['PATIENTS'])
    
except Exception as e:
    st.error(f"Error loading visit conditions: {e}")

st.markdown("---")
st.subheader("Condition Trends Over Time")

try:
    trend_df = run_query("""
        SELECT 
            DATE_TRUNC('MONTH', condition_start_date) as MONTH,
            COUNT(*) as CONDITIONS
        FROM TRE_HEALTHCARE_DB.OMOP_CDM.CONDITION_OCCURRENCE
        WHERE condition_start_date >= DATEADD('year', -2, CURRENT_DATE())
        GROUP BY MONTH
        ORDER BY MONTH
    """)
    
    if not trend_df.empty:
        st.line_chart(trend_df.set_index('MONTH'))
    else:
        st.info("No trend data available for the selected period")
        
except Exception as e:
    st.error(f"Error loading trends: {e}")
