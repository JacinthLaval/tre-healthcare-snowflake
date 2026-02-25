import streamlit as st
import pandas as pd

st.title("Drug Exposure Analysis")
st.markdown("### Medication Utilization Patterns")

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
    st.success("Full Research Access - Patient-level medication data")
else:
    st.warning("Data Engineer Access - Aggregated medication statistics")

st.markdown("---")

col1, col2, col3, col4 = st.columns(4)

try:
    stats = run_query("""
        SELECT 
            COUNT(*) as TOTAL_PRESCRIPTIONS,
            COUNT(DISTINCT person_id) as PATIENTS_WITH_MEDS,
            COUNT(DISTINCT drug_concept_id) as UNIQUE_MEDICATIONS,
            ROUND(AVG(days_supply), 1) as AVG_DAYS_SUPPLY
        FROM TRE_HEALTHCARE_DB.OMOP_CDM.DRUG_EXPOSURE
    """)
    
    col1.metric("Total Prescriptions", f"{int(stats['TOTAL_PRESCRIPTIONS'].iloc[0]):,}")
    col2.metric("Patients w/ Meds", f"{int(stats['PATIENTS_WITH_MEDS'].iloc[0]):,}")
    col3.metric("Unique Medications", f"{int(stats['UNIQUE_MEDICATIONS'].iloc[0]):,}")
    col4.metric("Avg Days Supply", f"{stats['AVG_DAYS_SUPPLY'].iloc[0]}")
    
except Exception as e:
    st.error(f"Error loading metrics: {e}")

st.markdown("---")
st.subheader("Top Medications by Prescription Volume")

try:
    drugs_df = run_query("""
        SELECT 
            drug_source_value as RXNORM_CODE,
            CASE drug_source_value
                WHEN '860975' THEN 'Metformin 500mg'
                WHEN '197361' THEN 'Lisinopril 10mg'
                WHEN '312961' THEN 'Atorvastatin 20mg'
                WHEN '197381' THEN 'Omeprazole 20mg'
                WHEN '849727' THEN 'Amlodipine 5mg'
                WHEN '1049621' THEN 'Metoprolol 25mg'
                WHEN '977430' THEN 'Levothyroxine 50mcg'
                WHEN '198211' THEN 'Losartan 50mg'
                WHEN '310798' THEN 'Acetaminophen 500mg'
                WHEN '311027' THEN 'Ibuprofen 200mg'
                ELSE drug_source_value
            END as MEDICATION_NAME,
            COUNT(*) as PRESCRIPTIONS,
            COUNT(DISTINCT person_id) as PATIENTS,
            ROUND(AVG(days_supply), 1) as AVG_DAYS,
            ROUND(AVG(quantity), 1) as AVG_QUANTITY
        FROM TRE_HEALTHCARE_DB.OMOP_CDM.DRUG_EXPOSURE
        GROUP BY drug_source_value
        ORDER BY PRESCRIPTIONS DESC
    """)
    
    st.bar_chart(drugs_df.set_index('MEDICATION_NAME')['PRESCRIPTIONS'])
    
    st.markdown("**Detailed Medication Statistics**")
    st.dataframe(drugs_df, use_container_width=True, hide_index=True)
    
except Exception as e:
    st.error(f"Error loading medications: {e}")

st.markdown("---")
st.subheader("Medication Categories")

try:
    category_df = run_query("""
        SELECT 
            CASE drug_source_value
                WHEN '860975' THEN 'Diabetes'
                WHEN '197361' THEN 'Cardiovascular'
                WHEN '312961' THEN 'Cardiovascular'
                WHEN '197381' THEN 'Gastrointestinal'
                WHEN '849727' THEN 'Cardiovascular'
                WHEN '1049621' THEN 'Cardiovascular'
                WHEN '977430' THEN 'Endocrine'
                WHEN '198211' THEN 'Cardiovascular'
                WHEN '310798' THEN 'Pain/Analgesic'
                WHEN '311027' THEN 'Pain/Analgesic'
                ELSE 'Other'
            END as DRUG_CATEGORY,
            COUNT(*) as PRESCRIPTIONS,
            COUNT(DISTINCT person_id) as PATIENTS
        FROM TRE_HEALTHCARE_DB.OMOP_CDM.DRUG_EXPOSURE
        GROUP BY DRUG_CATEGORY
        ORDER BY PRESCRIPTIONS DESC
    """)
    
    col1, col2 = st.columns(2)
    col1.markdown("**Prescriptions by Category**")
    col1.bar_chart(category_df.set_index('DRUG_CATEGORY')['PRESCRIPTIONS'])
    
    col2.markdown("**Patients by Category**")
    col2.bar_chart(category_df.set_index('DRUG_CATEGORY')['PATIENTS'])
    
except Exception as e:
    st.error(f"Error loading categories: {e}")

st.markdown("---")
st.subheader("Prescription Trends")

try:
    trend_df = run_query("""
        SELECT 
            DATE_TRUNC('MONTH', drug_exposure_start_date) as MONTH,
            COUNT(*) as PRESCRIPTIONS
        FROM TRE_HEALTHCARE_DB.OMOP_CDM.DRUG_EXPOSURE
        WHERE drug_exposure_start_date >= DATEADD('year', -2, CURRENT_DATE())
        GROUP BY MONTH
        ORDER BY MONTH
    """)
    
    if not trend_df.empty:
        st.line_chart(trend_df.set_index('MONTH'))
    else:
        st.info("No trend data available")
        
except Exception as e:
    st.error(f"Error loading trends: {e}")
