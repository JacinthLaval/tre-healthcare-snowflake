import streamlit as st

st.set_page_config(
    page_title="Precision Advisor",
    page_icon=":material/genetics:",
    layout="wide",
    initial_sidebar_state="expanded"
)

st.sidebar.title(":material/genetics: Precision Advisor")
st.sidebar.caption("CYP2C19 Pharmacogenomics Decision Support")

st.sidebar.divider()
st.sidebar.markdown("""
**Data Sources:**
- Patient Genome Mapping (3,202 patients)
- ClinVar Variant Annotations
- PubMed Research (72M articles)
- ClinicalTrials.gov (5.6M trials)
""")

st.title(":material/genetics: Precision Advisor")
st.markdown("### CYP2C19 Pharmacogenomics Clinical Decision Support")

st.info("""
**Welcome to Precision Advisor**

This tool helps clinicians make evidence-based decisions about antiplatelet therapy 
by analyzing patient genomic variants that affect drug metabolism.

**Navigate using the sidebar:**
- **Patient Browser** - View patient demographics and genomic variants
- **ER Console** - Enter clinical notes for AI-powered pharmacogenomics analysis
""")

col1, col2, col3 = st.columns(3)

with col1:
    st.metric(label="Linked Patients", value="3,202")
    
with col2:
    st.metric(label="ClinVar Variants", value="2.1M+")
    
with col3:
    st.metric(label="Research Articles", value="72M+")

st.divider()

st.markdown("""
#### Key Drug-Gene Interactions

| Gene | Drug | Clinical Impact |
|------|------|-----------------|
| **CYP2C19** | Clopidogrel (Plavix) | Poor metabolizers have reduced efficacy |
| **CYP2C19** | Prasugrel | Not affected by CYP2C19 status |
| **CYP2C19** | Ticagrelor | Not affected by CYP2C19 status |
""")
