---
name: cibmtr-genomics
description: "Domain knowledge for Center for International Blood and Marrow Transplant Research (CIBMTR) work. Use when: analyzing HLA matching, stem cell transplant data, GVHD outcomes, donor selection, MMUD studies. Triggers: HLA, stem cell transplant, bone marrow, GVHD, donor matching, PBSC, CIBMTR."
---

# CIBMTR Genomics & Transplant Domain Skill

## Domain Terminology

### HLA (Human Leukocyte Antigen)
Proteins found on most cells that help the immune system recognize self from non-self. HLA matching is crucial for finding a compatible stem cell donor.

**Key HLA loci for matching:**
- HLA-A, HLA-B, HLA-C (Class I)
- HLA-DRB1, HLA-DQB1 (Class II)

**Matching levels:**
- 10/10 match: All 5 loci matched at allele level
- 9/10 match: Single mismatch
- 8/10 match: Two mismatches (often MMUD threshold)

### MMUD (Mismatched Unrelated Donor)
A stem cell donor who is not related to the patient and does not fully match the patient's HLA types. Often used in studies focusing on transplant access for diverse populations.

**Clinical context:**
- Used when matched unrelated donor (MUD) unavailable
- Higher GVHD risk requires careful management
- Critical for patients from underrepresented ethnic backgrounds with limited donor pool

### PBSC (Peripheral Blood Stem Cells)
Stem cells collected from circulating blood (rather than bone marrow) for transplants.

**Collection process:**
- Donor receives G-CSF (growth factor) to mobilize stem cells
- Apheresis collects cells from blood
- Often preferred for adult patients due to faster engraftment

**Comparison to bone marrow:**
| Factor | PBSC | Bone Marrow |
|--------|------|-------------|
| Collection | Apheresis | Surgical harvest |
| Engraftment | Faster | Slower |
| Chronic GVHD | Higher risk | Lower risk |
| CD34+ yield | Higher | Lower |

### GVHD (Graft-versus-Host Disease)
Condition where transplanted immune cells (the graft) attack the recipient's body (the host).

**Types:**
- **Acute GVHD**: Occurs within 100 days post-transplant; affects skin, liver, GI tract
- **Chronic GVHD**: Occurs after 100 days; can affect multiple organ systems

**Grading (acute):**
- Grade I: Skin only, mild
- Grade II: Skin + mild liver/GI
- Grade III: Moderate multi-organ
- Grade IV: Severe, life-threatening

**Risk factors:**
- HLA mismatch degree
- Donor/recipient age and sex mismatch
- Stem cell source (PBSC vs bone marrow)
- Conditioning regimen intensity

## Workflow

### Step 1: Identify Analysis Type

**Ask** user what type of analysis:
1. HLA matching analysis
2. Donor selection optimization
3. GVHD outcome prediction
4. Transplant access/equity analysis

### Step 2: Data Requirements

**For HLA analysis:**
- Patient HLA typing (high-resolution preferred)
- Donor registry data with HLA types
- Population frequencies if available

**For outcomes analysis:**
- Transplant date, conditioning regimen
- GVHD incidence and grade
- Survival/relapse data
- Donor characteristics (age, sex, CMV status)

### Step 3: Connect to Genomic Data

**Use Snowflake genomic tables:**
```sql
-- Example: Find variants in HLA region (chr6: 28-34 Mb)
SELECT sample_id, chrom, pos, ref, allele1, allele2
FROM HEALTHCARE_DATABASE.DEFAULT_SCHEMA.GENOME_DATA_FILTERED
WHERE chrom = '6' AND pos BETWEEN 28000000 AND 34000000
LIMIT 100;
```

**Join with clinical data:**
```sql
-- Link genomic samples to patient records
SELECT g.sample_id, g.nhs_number, p.family_id
FROM HEALTHCARE_DATABASE.DEFAULT_SCHEMA.GENOME_DATA_FILTERED g
JOIN HEALTHCARE_DATABASE.DEFAULT_SCHEMA.PANEL p 
  ON g.sample_id = p.sample_id;
```

## Output

Analysis results with:
- HLA matching summaries
- GVHD risk stratification
- Donor selection recommendations
- Population-level statistics for equity analysis
