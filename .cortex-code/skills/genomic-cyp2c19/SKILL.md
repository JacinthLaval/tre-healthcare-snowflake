---
name: genomic-cyp2c19
description: "CYP2C19 pharmacogenomics for blood thinners (Plavix/clopidogrel). Use for drug metabolism, genotype-phenotype, dosing guidance."
---

# CYP2C19 Pharmacogenomics Skill

## Overview
This skill provides guidance on CYP2C19 genetic variants and their impact on clopidogrel (Plavix) metabolism. CYP2C19 is a cytochrome P450 enzyme responsible for converting clopidogrel from a prodrug to its active metabolite.

## Key Concepts

### What is CYP2C19?
- Cytochrome P450 enzyme encoded by the CYP2C19 gene (chromosome 10)
- Metabolizes ~10% of clinically used drugs
- Critical for clopidogrel (Plavix) activation - converts prodrug to active antiplatelet agent

### Why It Matters for Blood Thinners
Clopidogrel is a **prodrug** - it must be metabolized by CYP2C19 to become active. Patients with reduced CYP2C19 function have:
- Lower active drug levels
- Reduced antiplatelet effect
- Higher risk of cardiovascular events (heart attack, stroke, stent thrombosis)

## CYP2C19 Phenotypes

### Metabolizer Categories (CPIC Guidelines)

| Phenotype | Genotype Examples | Enzyme Activity | Clinical Impact |
|-----------|-------------------|-----------------|-----------------|
| **Ultrarapid Metabolizer (UM)** | \*17/\*17 | Increased | Faster drug activation; **may increase bleeding risk** |
| **Rapid Metabolizer (RM)** | \*1/\*17 | Increased | Enhanced response |
| **Normal Metabolizer (NM)** | \*1/\*1 | Normal | Standard response |
| **Intermediate Metabolizer (IM)** | \*1/\*2, \*1/\*3 | Decreased | **Reduced efficacy; increased CV event risk** |
| **Poor Metabolizer (PM)** | \*2/\*2, \*2/\*3, \*3/\*3 | Absent/minimal | **Significantly reduced efficacy; highest CV risk** |

#### Clinical Impact by Phenotype
- **Poor Metabolizers (\*2/\*2, \*2/\*3, \*3/\*3)**: Produce reduced or NO active metabolite → significantly decreased platelet inhibition → **highest risk of stent thrombosis, MI, stroke**
- **Intermediate Metabolizers (\*1/\*2, \*1/\*3)**: Lowered drug response → increased risk of cardiovascular events → **consider alternative therapy**
- **Rapid/Ultrarapid Metabolizers (\*1/\*17, \*17/\*17)**: Increased metabolism → higher active drug levels → **may increase bleeding risk**

### Key Alleles (Primary Variants for Plavix Metabolism)

| Allele | Nucleotide Change | rsID | Function | Enzyme Effect |
|--------|-------------------|------|----------|---------------|
| **\*1** | Wild-type | - | Normal | Normal enzyme activity |
| **\*2** | 681G>A | rs4244285 | **Loss-of-function** | Non-functional enzyme (most common LOF) |
| **\*3** | 636G>A | rs4986893 | **Loss-of-function** | Non-functional enzyme (common in Asians) |
| **\*17** | -806C>T | rs12248560 | **Gain-of-function** | Increased enzyme activity |

#### Variant Details
- **CYP2C19\*2 (rs4244285, 681G>A)**: The most common loss-of-function variant worldwide, causes a splicing defect resulting in a non-functional enzyme
- **CYP2C19\*3 (rs4986893, 636G>A)**: Creates a premature stop codon; primarily found in Asian populations (up to 5-10%)
- **CYP2C19\*17 (rs12248560, -806C>T)**: Promoter variant causing increased transcription and enzyme activity; may increase bleeding risk

### Population Frequencies
Loss-of-function allele frequency varies significantly:
- **East Asian**: ~30-35% carry *2 or *3
- **European**: ~15-20% carry *2 or *3
- **African**: ~15-18% carry *2 or *3
- **South Asian**: ~30-40% carry *2 or *3

## CPIC Treatment Recommendations

> **Guideline recommendations suggest alternative antiplatelet therapies (prasugrel or ticagrelor) for intermediate and poor metabolizers**

### For Cardiovascular Indications (ACS/PCI)

| Phenotype | Recommendation | Rationale |
|-----------|----------------|-----------|
| **UM/RM/NM** | Clopidogrel at standard dose (75mg) | Adequate active metabolite production |
| **IM** | **Use alternative**: prasugrel or ticagrelor | Reduced clopidogrel efficacy |
| **PM** | **Use alternative**: prasugrel or ticagrelor | Minimal/no active metabolite |

### Alternative P2Y12 Inhibitors (Not CYP2C19 Dependent)
When clopidogrel is contraindicated due to CYP2C19 status:
- **Prasugrel (Effient)** - Active drug, not a CYP2C19 prodrug; contraindicated in stroke/TIA history
- **Ticagrelor (Brilinta)** - Reversible P2Y12 inhibitor; not dependent on CYP2C19 activation

## Workflow

### Step 1: Identify CYP2C19 Genotype
Check for key variants:
```sql
-- Example: Query ClinVar for CYP2C19 variants
SELECT GENESYMBOL, NAME, CLNSIG, TYPE
FROM HEALTHCARE_DATABASE.DEFAULT_SCHEMA.CLINVAR
WHERE GENESYMBOL = 'CYP2C19'
ORDER BY CLNSIG
```

### Step 2: Determine Phenotype
Map diplotype to metabolizer status using CPIC activity scoring:
- Two normal function alleles → Normal Metabolizer
- One or two no-function alleles → Intermediate or Poor Metabolizer
- Increased function allele(s) → Rapid or Ultrarapid Metabolizer

### Step 3: Apply Clinical Recommendation
Based on phenotype and indication:
1. For ACS/PCI patients who are IM or PM → Recommend alternative
2. For NM/UM → Standard clopidogrel therapy appropriate

## Example Queries

### Find CYP2C19 variants in dataset
```sql
SELECT * FROM CLINVAR WHERE GENESYMBOL = 'CYP2C19' AND CLNSIG LIKE '%athogenic%'
```

### Link genomic data to patient outcomes
```sql
SELECT p.SUPERPOPULATION, c.DESCRIPTION as condition, COUNT(*) as count
FROM PATIENT_GENOME_MAPPING p
JOIN CONDITIONS c ON p.PATIENT_ID = c.PATIENT_ID
WHERE c.DESCRIPTION ILIKE '%thromb%' OR c.DESCRIPTION ILIKE '%stroke%'
GROUP BY p.SUPERPOPULATION, c.DESCRIPTION
```

## When to Apply
Use this skill when:
- User mentions CYP2C19, clopidogrel, Plavix, or blood thinner metabolism
- Questions about antiplatelet therapy and genetics
- Pharmacogenomics-guided dosing for cardiovascular drugs
- Drug-gene interactions for P2Y12 inhibitors
- Queries about poor/intermediate metabolizers and drug response

## References
- CPIC Guideline for CYP2C19 and Clopidogrel: 2022 Update
- PharmGKB CYP2C19 Drug-Gene Annotations
- FDA Plavix Label (CYP2C19 Poor Metabolizer Warning)
