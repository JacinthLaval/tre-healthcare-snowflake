# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-04

### Added
- ER Console with CYP2C19 pharmacogenomics clinical decision support
  - Patient selection with genomic profile loading
  - Clinical scenario templates (Stroke, ACS, PCI, Stent Thrombosis)
  - NeoResearchAgent integration with PubMed & ClinicalTrials.gov searches
  - Comprehensive structured recommendations:
    - Genomic Assessment
    - Drug-Therapy Implications
    - Current Medication Review
    - Evidence-Based Alternatives
    - Emerging Therapies
    - Key References
- TRE/OMOP patient cohort explorer
  - Patient search and filtering
  - Clinical profile viewing (conditions, medications, observations)
- Settings screen with Snowflake PAT configuration
- Async query polling for long-running Snowflake agent calls
- Tab navigation: ER Console, TRE/OMOP, Settings

### Technical
- React Native + Expo SDK 52
- TypeScript support
- Snowflake SQL API integration with async polling (code 333334 handling)
- Secure storage for PAT tokens
