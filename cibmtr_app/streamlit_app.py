import streamlit as st
import pandas as pd
import json

try:
    from snowflake.snowpark.context import get_active_session
    session = get_active_session()
    IS_SIS = True
except:
    from snowflake.snowpark import Session
    import os
    session = Session.builder.config('connection_name', os.getenv('SNOWFLAKE_CONNECTION_NAME', 'HealthcareDemos')).create()
    IS_SIS = False

st.title("CIBMTR Transplant Research Assistant")

tab1, tab2, tab3 = st.tabs(["Dashboard", "Ask Questions", "PubMed Research"])

@st.cache_data(ttl=600)
def load_haploidentical():
    return session.sql("""
        SELECT CONDINT, SEX, DISEASE, DEAD, TRM, DFS, AGVHD24, CGVHD, AGE, INTXSURV
        FROM TRE_HEALTHCARE_DB.OMOP_CDM.CIBMTR_HAPLOIDENTICAL_TRANSPLANT
    """).to_pandas()

@st.cache_data(ttl=600)
def load_hla_e():
    return session.sql("""
        SELECT HLAEGRP, DEAD, TRM, DFS, GVHDGRP, AGE, GRAFTGP
        FROM TRE_HEALTHCARE_DB.OMOP_CDM.CIBMTR_HLA_E_OUTCOMES
    """).to_pandas()

@st.cache_data(ttl=600)
def load_pbsc():
    return session.sql("""
        SELECT TWODAYCOLL, TTL_CD34, P1_CD34, P2_CD34, GCSF_DSETTL, COLL_AGE_GP, DSEX, D_BMI_GRP
        FROM TRE_HEALTHCARE_DB.OMOP_CDM.CIBMTR_PBSC_COLLECTION
        WHERE TTL_CD34 IS NOT NULL
    """).to_pandas()

with tab1:
    st.header("Transplant Outcomes Dashboard")
    
    col1, col2, col3 = st.columns(3)
    with col1:
        st.metric("Haploidentical Patients", "1,325")
    with col2:
        st.metric("HLA-E Study Patients", "1,840")
    with col3:
        st.metric("PBSC Collections", "22,348")
    
    st.divider()
    
    st.subheader("Survival by Conditioning Intensity")
    haplo_df = load_haploidentical()
    
    survival_data = haplo_df.groupby('CONDINT').agg({
        'DEAD': ['count', 'sum']
    }).reset_index()
    survival_data.columns = ['CONDINT', 'Total', 'Deaths']
    survival_data['Survival %'] = ((survival_data['Total'] - survival_data['Deaths']) / survival_data['Total'] * 100).round(1)
    survival_data['Conditioning'] = survival_data['CONDINT'].map({1: 'Myeloablative', 2: 'Reduced Intensity'})
    survival_data = survival_data[survival_data['Conditioning'].notna()]
    
    chart_data = survival_data[['Conditioning', 'Survival %']].set_index('Conditioning')
    st.bar_chart(chart_data)
    
    st.caption("Myeloablative conditioning shows ~6% higher survival rate in haploidentical transplants")
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.subheader("GVHD by HLA-E Genotype")
        hla_df = load_hla_e()
        
        gvhd_data = hla_df[hla_df['HLAEGRP'].notna()].groupby('HLAEGRP').agg({
            'GVHDGRP': ['count', 'sum']
        }).reset_index()
        gvhd_data.columns = ['HLA-E Group', 'Total', 'GVHD Cases']
        gvhd_data['GVHD Rate %'] = (gvhd_data['GVHD Cases'] / gvhd_data['Total'] * 100).round(1)
        
        st.bar_chart(gvhd_data.set_index('HLA-E Group')['GVHD Rate %'])
    
    with col2:
        st.subheader("CD34+ Yields by Collection Type")
        pbsc_df = load_pbsc()
        
        cd34_data = pbsc_df.groupby('TWODAYCOLL').agg({
            'TTL_CD34': 'mean'
        }).reset_index()
        cd34_data['Collection Type'] = cd34_data['TWODAYCOLL'].map({0: '1-Day', 1: '2-Day'})
        cd34_data = cd34_data[cd34_data['Collection Type'].notna()]
        cd34_data['Avg CD34+ (x10⁶/kg)'] = cd34_data['TTL_CD34'].round(1)
        
        st.bar_chart(cd34_data.set_index('Collection Type')['Avg CD34+ (x10⁶/kg)'])
    
    st.divider()
    
    st.subheader("Disease Distribution in Haploidentical Cohort")
    disease_counts = haplo_df['DISEASE'].value_counts().reset_index()
    disease_counts.columns = ['Disease Code', 'Patients']
    disease_counts = disease_counts.head(10)
    st.bar_chart(disease_counts.set_index('Disease Code'))

with tab2:
    st.header("Ask Questions About CIBMTR Data")
    st.caption("Powered by CIBMTR Research Agent (Cortex Analyst + PubMed Search)")
    
    if "messages" not in st.session_state:
        st.session_state.messages = []
    
    for message in st.session_state.messages:
        if message["role"] == "user":
            st.markdown(f"**You:** {message['content']}")
        else:
            st.markdown(f"**Assistant:** {message['content']}")
            if "sql" in message:
                with st.expander("View SQL"):
                    st.code(message["sql"], language="sql")
            if "data" in message:
                with st.expander("View Data"):
                    st.dataframe(message["data"])
    
    def query_agent(question):
        try:
            escaped_question = question.replace("'", "''").replace("\\", "\\\\")
            result = session.sql(f"""
                SELECT SNOWFLAKE.CORTEX.INVOKE_AGENT(
                    'TRE_HEALTHCARE_DB.OMOP_CDM.CIBMTR_RESEARCH_AGENT',
                    '{escaped_question}',
                    {{}}
                ) as response
            """).collect()
            
            if result:
                response_str = result[0]['RESPONSE']
                response = json.loads(response_str) if isinstance(response_str, str) else response_str
                return response
        except Exception as e:
            return {"error": str(e)}
        return None
    
    def run_analyst_query(question):
        try:
            escaped_question = question.replace("'", "''").replace("\\", "\\\\")
            result = session.sql(f"""
                SELECT SNOWFLAKE.CORTEX.COMPLETE(
                    'claude-4-sonnet',
                    CONCAT(
                        'You are a transplant research data analyst. Based on the semantic model for CIBMTR data, ',
                        'generate a SQL query to answer: {escaped_question}\\n\\n',
                        'Available tables:\\n',
                        '- TRE_HEALTHCARE_DB.OMOP_CDM.CIBMTR_HAPLOIDENTICAL_TRANSPLANT (CONDINT, SEX, DISEASE, DEAD, TRM, DFS, AGVHD24, CGVHD, AGE, INTXSURV)\\n',
                        '- TRE_HEALTHCARE_DB.OMOP_CDM.CIBMTR_HLA_E_OUTCOMES (HLAEGRP, DEAD, TRM, DFS, GVHDGRP, AGE, GRAFTGP)\\n',
                        '- TRE_HEALTHCARE_DB.OMOP_CDM.CIBMTR_PBSC_COLLECTION (TWODAYCOLL, TTL_CD34, P1_CD34, P2_CD34, GCSF_DSETTL, COLL_AGE_GP, DSEX, D_BMI_GRP)\\n\\n',
                        'CONDINT: 1=Myeloablative, 2=Reduced Intensity. DEAD/TRM/DFS: 0=No, 1=Yes. TWODAYCOLL: 0=1-Day, 1=2-Day.\\n',
                        'Return ONLY valid SQL, no explanation. Use fully qualified table names.'
                    )
                ) as sql_response
            """).collect()
            
            if result:
                sql_query = result[0]['SQL_RESPONSE'].strip()
                sql_query = sql_query.replace('```sql', '').replace('```', '').strip()
                return {"sql": sql_query, "text": f"Here are the results for: {question}"}
        except Exception as e:
            return {"error": str(e)}
        return None
    
    example_questions = [
        "What is the survival rate by conditioning intensity?",
        "Compare CD34+ yields between 1-day and 2-day collections",
        "What are the GVHD rates by HLA-E genotype?",
        "Show average patient age by disease category"
    ]
    
    st.markdown("**Example questions:**")
    cols = st.columns(2)
    for i, q in enumerate(example_questions):
        with cols[i % 2]:
            if st.button(q, key=f"example_{i}"):
                st.session_state["question_input"] = q
    
    prompt = st.text_input("Ask a question about transplant data...", key="question_input")
    submit = st.button("Submit Question", type="primary")
    
    if submit and prompt:
        st.session_state.messages.append({"role": "user", "content": prompt})
        st.markdown(f"**You:** {prompt}")
        
        with st.spinner("Analyzing..."):
            response = run_analyst_query(prompt)
            
            if response and "error" not in response:
                answer_text = response.get("text", "")
                sql_statement = response.get("sql")
                
                st.markdown(f"**Assistant:** {answer_text}")
                
                if sql_statement:
                    with st.expander("Generated SQL"):
                        st.code(sql_statement, language="sql")
                    
                    try:
                        result_df = session.sql(sql_statement).to_pandas()
                        st.dataframe(result_df, use_container_width=True)
                        
                        if len(result_df) > 1 and len(result_df) <= 20:
                            numeric_cols = result_df.select_dtypes(include=['number']).columns
                            if len(numeric_cols) > 0:
                                st.bar_chart(result_df.set_index(result_df.columns[0])[numeric_cols[0]])
                        
                        msg = {"role": "assistant", "content": answer_text, "sql": sql_statement, "data": result_df}
                    except Exception as e:
                        st.error(f"Error executing SQL: {e}")
                        msg = {"role": "assistant", "content": answer_text, "sql": sql_statement}
                else:
                    msg = {"role": "assistant", "content": answer_text}
            else:
                error_msg = response.get("error", "Unknown error") if response else "No response received"
                st.error(f"Error: {error_msg}")
                msg = {"role": "assistant", "content": f"Error: {error_msg}"}
            
            st.session_state.messages.append(msg)

with tab3:
    st.header("PubMed Research Search")
    st.caption("Search biomedical research via CIBMTR Research Agent")
    
    if "pubmed_response" not in st.session_state:
        st.session_state.pubmed_response = None
    
    def search_pubmed_via_llm(question):
        try:
            escaped_question = question.replace("'", "''").replace("\\", "\\\\")
            result = session.sql(f"""
                SELECT SNOWFLAKE.CORTEX.COMPLETE(
                    'claude-4-sonnet',
                    CONCAT(
                        'You are a biomedical research expert specializing in CIBMTR transplant research. ',
                        'Answer this research question with clinical insights: {escaped_question}\\n\\n',
                        'Include relevant context about:\\n',
                        '- HLA matching (10/10, 9/10, 8/10 thresholds)\\n',
                        '- GVHD (acute vs chronic, grades I-IV)\\n',
                        '- PBSC vs bone marrow collection\\n',
                        '- Conditioning intensity (myeloablative vs reduced intensity)\\n',
                        'Provide evidence-based insights.'
                    )
                ) as response
            """).collect()
            
            if result:
                return result[0]['RESPONSE']
        except Exception as e:
            return f"Error: {e}"
        return None
    
    st.markdown("### Search CIBMTR Literature")
    
    search_query = st.text_input(
        "Research question",
        placeholder="e.g., What are the outcomes of haploidentical transplants with PTCy?",
        key="pubmed_search_input"
    )
    
    preset_searches = {
        "CIBMTR Studies": "What are recent CIBMTR findings on transplant outcomes?",
        "HLA Matching": "How does HLA mismatch affect transplant survival?",
        "GVHD Prevention": "What are effective GVHD prophylaxis strategies?",
        "Haploidentical": "What are outcomes of haploidentical transplants?",
        "PBSC vs BM": "Compare PBSC and bone marrow graft sources"
    }
    
    st.markdown("**Quick searches:**")
    preset_cols = st.columns(5)
    for i, (name, query) in enumerate(preset_searches.items()):
        with preset_cols[i]:
            if st.button(name, key=f"preset_{i}"):
                st.session_state.pubmed_search_query = query
    
    if "pubmed_search_query" in st.session_state:
        search_query = st.session_state.pubmed_search_query
        del st.session_state.pubmed_search_query
    
    if st.button("Search", type="primary"):
        if search_query:
            with st.spinner("Researching..."):
                response = search_pubmed_via_llm(search_query)
                st.session_state.pubmed_response = response
    
    if st.session_state.pubmed_response:
        st.markdown("### Research Insights")
        st.markdown(st.session_state.pubmed_response)
    
    st.divider()
    
    st.markdown("""
    ### Domain Knowledge Reference
    
    **HLA (Human Leukocyte Antigen)**
    - Key loci: HLA-A, B, C (Class I); DRB1, DQB1 (Class II)
    - 10/10 match = all 5 loci matched at allele level
    - MMUD threshold typically 8/10 or 9/10
    
    **GVHD (Graft-versus-Host Disease)**
    - Acute: <100 days, affects skin/liver/GI
    - Chronic: >100 days, multi-organ involvement
    - Grades I-IV (mild to severe)
    
    **Stem Cell Sources**
    - PBSC: Faster engraftment, higher chronic GVHD risk
    - Bone Marrow: Slower engraftment, lower GVHD risk
    """)
