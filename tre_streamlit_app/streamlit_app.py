import streamlit as st
import pandas as pd

st.title("Trusted Research Environment")
st.markdown("### Healthcare Data Explorer - OMOP CDM")

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

def execute_sql(sql):
    if is_sis:
        connection.sql(sql).collect()
    else:
        cursor = connection.cursor()
        cursor.execute(sql)
        cursor.close()

if 'current_role' not in st.session_state:
    st.session_state.current_role = 'CLINICAL_RESEARCHER'

st.sidebar.title("TRE Access Control")
st.sidebar.markdown("---")

role_options = ['CLINICAL_RESEARCHER', 'DATA_ENGINEER']
selected_role = st.sidebar.selectbox(
    "Select Role (Persona)",
    role_options,
    index=role_options.index(st.session_state.current_role),
    help="Switch between roles to see how data masking affects visibility"
)

if selected_role != st.session_state.current_role:
    st.session_state.current_role = selected_role
    try:
        execute_sql(f"USE ROLE {selected_role}")
    except Exception as e:
        st.sidebar.error(f"Could not switch role: {e}")
    st.rerun()

try:
    execute_sql(f"USE ROLE {st.session_state.current_role}")
except Exception as e:
    st.sidebar.error(f"Could not switch to role: {e}")

if st.session_state.current_role == 'CLINICAL_RESEARCHER':
    st.sidebar.success("Full Data Access")
    st.sidebar.markdown("""
    **Role:** Clinical Researcher  
    **Access Level:** Full PII visibility  
    **Purpose:** Healthcare research & analysis
    """)
else:
    st.sidebar.warning("Masked Data Access")
    st.sidebar.markdown("""
    **Role:** Data Engineer  
    **Access Level:** PII is masked  
    **Purpose:** Data pipeline maintenance
    """)

st.sidebar.markdown("---")
st.sidebar.markdown("### Five Safes Framework")
st.sidebar.markdown("""
- **Safe People:** Role-based access
- **Safe Projects:** Scoped to TRE DB
- **Safe Data:** Dynamic masking
- **Safe Settings:** Snowflake secure
- **Safe Outputs:** Controlled views
""")

st.markdown("---")
col1, col2, col3 = st.columns(3)

try:
    patient_count = run_query("SELECT COUNT(*) as CNT FROM TRE_HEALTHCARE_DB.OMOP_CDM.PERSON")['CNT'].iloc[0]
    visit_count = run_query("SELECT COUNT(*) as CNT FROM TRE_HEALTHCARE_DB.OMOP_CDM.VISIT_OCCURRENCE")['CNT'].iloc[0]
    condition_count = run_query("SELECT COUNT(*) as CNT FROM TRE_HEALTHCARE_DB.OMOP_CDM.CONDITION_OCCURRENCE")['CNT'].iloc[0]
    
    col1.metric("Patients", f"{int(patient_count):,}")
    col2.metric("Visits", f"{int(visit_count):,}")
    col3.metric("Conditions", f"{int(condition_count):,}")
except Exception as e:
    st.error(f"Error loading metrics: {e}")

st.markdown("---")
st.subheader("Patient Demographics Sample")

if st.session_state.current_role == 'CLINICAL_RESEARCHER':
    st.info("You have FULL access to patient identifiable information (PII)")
else:
    st.warning("PII columns are MASKED - you see redacted/anonymized data")

try:
    patient_df = run_query("""
        SELECT 
            person_id,
            person_source_value,
            CASE gender_concept_id WHEN 8507 THEN 'Male' ELSE 'Female' END as gender,
            year_of_birth,
            birth_datetime,
            CASE race_concept_id 
                WHEN 8527 THEN 'White'
                WHEN 8516 THEN 'Black'
                WHEN 8515 THEN 'Asian'
                WHEN 8557 THEN 'Native American'
                ELSE 'Other'
            END as race,
            location_id
        FROM TRE_HEALTHCARE_DB.OMOP_CDM.PERSON
        LIMIT 10
    """)
    
    st.dataframe(patient_df, use_container_width=True, hide_index=True)
    
    masked_cols = []
    if len(patient_df) > 0:
        if patient_df['PERSON_SOURCE_VALUE'].iloc[0] == '***REDACTED***':
            masked_cols.append('PERSON_SOURCE_VALUE')
        if patient_df['LOCATION_ID'].isna().all():
            masked_cols.append('LOCATION_ID')
    
    if masked_cols:
        st.caption(f"Masked columns: {', '.join(masked_cols)}")
    
except Exception as e:
    st.error(f"Error loading patient data: {e}")

st.markdown("---")
st.markdown("### Navigation")
st.markdown("""
Use the sidebar to navigate to:
- **Patient Explorer** - Detailed patient demographics
- **Condition Analysis** - Disease distribution and trends
- **Drug Exposure** - Medication utilization patterns
""")
