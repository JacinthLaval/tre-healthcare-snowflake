# FDA 510(k) Special Submission Accelerator — Project Summary

**Account:** DS14668-TOA58800 (Snowflake)  
**Database:** FDA_510K_ACCELERATOR  
**Schema:** REFERENCE_DOCS  
**Warehouse:** SNOWFLAKE_LEARNING_WH (X-Small)  
**Primary User:** Todd Crosslin (TODDCROSSLIN)  
**Device Under Assessment:** PIC iX 4.5 (Philips Patient Information Center) — Class II medical device  
**Last Updated:** April 8, 2026

---

## Project Overview

This project builds an FDA 510(k) Special submission accelerator using Snowflake Cortex AI capabilities. It ingests FDA regulatory guidance documents and a device's Design History File (DHF), then uses RAG (Retrieval-Augmented Generation) to auto-generate the Regulatory Impact Assessment (RIA) documents required for a 510(k) Special submission pathway.

The device is the **PIC iX 4.5** (Philips Patient Information Center), a patient monitoring platform. The 4.5 release is a software-only design change to an existing cleared device.

---

## Three-Phase Plan

### Phase 1: MVP FDA Guidance RAG Search — COMPLETED

A Streamlit in Snowflake app that:
- Ingests 8 regulatory PDFs into `PARSED_CHUNKS` table (~572 chunks)
- Indexes them with `FDA_510K_SEARCH` Cortex Search Service
- Provides a chat interface with citations for regulatory Q&A

**Source PDFs (8 files in `@PDF_UPLOADS`):**
| File | Chunks | Description |
|------|--------|-------------|
| FDA guidance Special 510k.pdf | ~112 | FDA Special 510(k) Program guidance |
| A-Q2920-01037.pdf | ~76 | RIA Work Instructions |
| A-Q2920-01037-T1.pdf | ~26 | RIA T1 Main Flowchart Template |
| A-Q2920-01037-T2.pdf | ~90 | RIA T2 Country Guidance Template |
| A-Q2920-01037-T3.pdf | ~5 | RIA T3 Key Market Notification Template |
| A-Q2920-01037-T4.pdf | ~86 | RIA T4 Letter-to-File Template |
| FDA guidance on Content of 510k for device SW functions.pdf | ~142 | Software functions guidance |
| FDA guidance on content and format of bench testing in 510k.pdf | ~35 | Bench testing guidance |

### Phase 2: RIA T1 Main Flowchart Generation — COMPLETED (Steps 1-3), IN PROGRESS (Steps 4-5)

Ingest Chris's PIC iX 4.5 Design History File (64 files), parse all supported files into `DHF_CHUNKS` table, create a DHF-specific Cortex Search Service, then use cross-referencing between DHF content and FDA guidance to generate a completed RIA T1 Main Flowchart.

| Step | Description | Status |
|------|-------------|--------|
| Step 1 | Upload and parse all DHF files into DHF_CHUNKS | COMPLETED (48 of 64 files parsed; ~16 remaining uploads) |
| Step 2 | Create DHF_SEARCH Cortex Search Service | COMPLETED |
| Step 3 | Build RIA T1 generation pipeline (stored procedure) | COMPLETED (33 sections generated) |
| Step 4 | Add "Generate RIA" tab to Streamlit app + Word doc export | NOT STARTED |
| Step 5 | Verification — test search quality, cross-references, T1 accuracy | NOT STARTED |

### Phase 3: Full 510(k) Submission Document Generation — FUTURE

Generate the actual Special 510(k) submission documents using the RIA output to determine the pathway. Includes T2 (Country Guidance), T4 (Letter-to-File), and the full submission package.

---

## Architecture

### Two-Search-Service Design

The system uses **two separate Cortex Search Services** that are intentionally kept apart:

1. **`FDA_510K_SEARCH`** — Contains FDA regulatory guidance documents (the "rules")
   - Source table: `PARSED_CHUNKS` (572 rows)
   - Embedding model: `snowflake-arctic-embed-m-v1.5`
   - Refresh: INCREMENTAL, 1-day target lag

2. **`DHF_SEARCH`** — Contains device Design History File documents (the "evidence")
   - Source table: `DHF_CHUNKS` (5,703 rows, 48 files)
   - Embedding model: `snowflake-arctic-embed-m-v1.5`
   - Refresh: INCREMENTAL, 1-day target lag
   - Additional column: `DOC_CATEGORY` (27 categories)

**Why separate:** The RIA generation cross-references BOTH services — searching the DHF for device evidence, and searching FDA guidance for regulatory requirements. Mixing them would pollute search results.

### LLM

- Model: `mistral-large2` via `SNOWFLAKE.CORTEX.COMPLETE()`
- Used for RAG answer generation (chat) and RIA T1 section generation

### Streamlit App

- Name: `FDA_510K_GUIDANCE_SEARCH`
- Runtime: Streamlit 1.22.0 (Snowflake-hosted — much older than current Streamlit)
- Location: `@STREAMLIT_STAGE/streamlit_app.py`
- Dependencies: `@STREAMLIT_STAGE/environment.yml` (snowflake.core)
- Current tabs: "Search" (RAG Q&A), "Upload Documents"
- Planned: "Generate RIA" tab (Step 4)

---

## Database Objects

### Tables

| Table | Rows | Description |
|-------|------|-------------|
| `PARSED_CHUNKS` | 572 | FDA guidance document chunks |
| `DHF_CHUNKS` | 5,703 | Device DHF document chunks |
| `RIA_T1_GENERATED` | 33 | Generated RIA T1 flowchart sections |
| `TEMP_DHF_PARSED` | — | Temporary table used during DHF parsing |

#### PARSED_CHUNKS Schema
```
CHUNK_TEXT VARCHAR, FILE_NAME VARCHAR, FILE_TYPE VARCHAR, PAGE_INDEX NUMBER, CHUNK_INDEX NUMBER
```

#### DHF_CHUNKS Schema
```
CHUNK_TEXT VARCHAR, FILE_NAME VARCHAR, FILE_TYPE VARCHAR, PAGE_INDEX NUMBER, CHUNK_INDEX NUMBER, DOC_CATEGORY VARCHAR
```

#### RIA_T1_GENERATED Schema
```
SECTION_ID VARCHAR(20)
SECTION_NAME VARCHAR(200)
QUESTION_TEXT VARCHAR(4000)
ANSWER_SELECTION VARCHAR(16000)
RATIONALE VARCHAR(16000)
DHF_EVIDENCE VARCHAR(16000)
GUIDANCE_EVIDENCE VARCHAR(16000)
GENERATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
GENERATION_MODEL VARCHAR(100) DEFAULT 'mistral-large2'
```

### Stages

| Stage | Contents | Directory Enabled |
|-------|----------|-------------------|
| `PDF_UPLOADS` | 8 FDA guidance PDFs | Yes |
| `DHF_UPLOADS` | 48+ DHF files (docx, pptx, pdf, xlsx, xlsm) | Yes |
| `STREAMLIT_STAGE` | streamlit_app.py, environment.yml | Yes |
| `CHRIS_PDF` | Original DHF zip file | Yes |

### Cortex Search Services

| Service | Status | Source | Rows | Refresh |
|---------|--------|--------|------|---------|
| `FDA_510K_SEARCH` | ACTIVE | PARSED_CHUNKS | 572 | INCREMENTAL |
| `DHF_SEARCH` | ACTIVE | DHF_CHUNKS | 5,703 | INCREMENTAL |

### Stored Procedures

| Procedure | Language | Description |
|-----------|----------|-------------|
| `GENERATE_RIA_T1()` | SQL | Cross-references both search services to generate 33 RIA T1 sections |
| `PARSE_DHF_FILES()` | SQL | Iterates `@DHF_UPLOADS` via DIRECTORY(), parses docx/pptx/pdf, chunks, inserts into DHF_CHUNKS |
| `PARSE_XLSX_FILE(SCOPED_URL, FILE_NAME, DOC_CATEGORY)` | Python | Parses xlsx/xlsm files using openpyxl + SnowflakeFile |

---

## RIA T1 Generated Sections (33 Total)

All 33 sections have been generated and stored in `RIA_T1_GENERATED`:

### Section 1: Product/Change Summary (6 sections)
| ID | Name |
|----|------|
| 1.1 | Product Name(s) and Part Number(s) |
| 1.2 | Device Description / Intended Use |
| 1.3 | Description of Changes |
| 1.4 | Reason for Change |
| 1.5 | Project Type |
| 1.6 | Risk-based Assessment |

### Section 2: US FDA (7 sections)
| ID | Name |
|----|------|
| 2.1 | US Market Clearance |
| 2.2 | Pre-market Notification |
| 2.3 | Intent to Improve Safety/Effectiveness |
| 2.4 | Labeling Change |
| 2.5 | Technology/Engineering/Performance |
| 2.6 | Materials Change |
| 2.7 | Software Change |

### Section 3: Health Canada (12 sections)
| ID | Name |
|----|------|
| 3.0 | Canadian License |
| 3.0a | HC Device Class |
| 3.2A–3.2J | 10 individual HC assessment questions |

### Section 4: EU MDR (7 sections)
| ID | Name |
|----|------|
| 4.0 | EU Market Clearance |
| 4.0a | EU: Medical Device? |
| 4A–4D | 4 individual EU assessment questions |
| 4X | EU: Corrective action? |

### Section 5: International (1 section)
| ID | Name |
|----|------|
| 5.0 | International Impact |

**Known Issue:** Section 2.7 (Software Change) was manually corrected. The LLM originally answered "No" due to search results returning SOUP assessment documentation rather than actual change descriptions. This was fixed with a manual UPDATE. Verification step should check for similar issues in other sections.

---

## Remaining Work

### Step 4: Add "Generate RIA" Tab to Streamlit App

**Goal:** Add a third tab to the Streamlit app that:
1. Displays the generated RIA T1 content in a structured, readable format
2. Allows re-running `GENERATE_RIA_T1()` from the UI
3. Generates a downloadable Word document (.docx) of the completed T1 flowchart

**Implementation notes:**
- The current app is at `@STREAMLIT_STAGE/streamlit_app.py`
- Runtime is Streamlit 1.22.0 — many newer APIs are NOT available (no `st.pills`, `st.chat_input`, `st.file_uploader` with certain params)
- For Word doc generation: `python-docx` may need to be added to `environment.yml`; verify availability in Snowflake conda channel
- The `RIA_T1_GENERATED` table already has all 33 sections ready to display
- Use `session.sql()` to call the stored procedure and query the table

### Step 5: Verification

**Goal:** Validate the quality of the end-to-end pipeline:
1. Test DHF_SEARCH returns relevant results for various device queries
2. Verify cross-reference quality — do the right DHF chunks get matched to the right regulatory questions?
3. Review all 33 generated T1 sections for accuracy (especially sections that use LLM cross-referencing)
4. Check for issues similar to section 2.7 where search result quality led to wrong answers

### Ongoing: Complete DHF File Upload

- 48 of ~64 DHF files have been parsed
- ~16 files remain to be uploaded by the user
- Once uploaded, re-run `CALL PARSE_DHF_FILES()` to parse new files (it skips already-parsed files)
- `DHF_SEARCH` will auto-refresh on next cycle (1-day target lag) or can be manually refreshed
- After new files are ingested, consider re-running `CALL GENERATE_RIA_T1()` for potentially improved answers

---

## Key Technical Patterns and Gotchas

### Cortex Search SEARCH_PREVIEW (SQL)

The correct syntax for querying a Cortex Search Service from SQL:

```sql
SELECT LISTAGG(r.value:CHUNK_TEXT::VARCHAR, '\n---\n') WITHIN GROUP (ORDER BY r.index)
FROM (
    SELECT PARSE_JSON(SNOWFLAKE.CORTEX.SEARCH_PREVIEW(
        'FDA_510K_ACCELERATOR.REFERENCE_DOCS.DHF_SEARCH',
        '{"query": "your search query here", "columns": ["CHUNK_TEXT"], "limit": 5}'
    )) AS res
), LATERAL FLATTEN(input => res:results) r
```

Key points:
- First argument is the **fully qualified service name** as a string
- Second argument is a **JSON string** (not a plain query string)
- Returns a **JSON VARCHAR** that must be parsed with `PARSE_JSON`
- Use `LATERAL FLATTEN(input => res:results)` to extract individual results
- Access fields via `r.value:COLUMN_NAME::VARCHAR`

### Cortex Search (Python / Streamlit)

```python
from snowflake.core import Root
root = Root(session)
search_svc = (
    root.databases["FDA_510K_ACCELERATOR"]
    .schemas["REFERENCE_DOCS"]
    .cortex_search_services["SERVICE_NAME"]
)
resp = search_svc.search(
    query="search query",
    columns=["CHUNK_TEXT", "FILE_NAME", "PAGE_INDEX"],
    limit=5,
)
results = resp.results  # list of dicts
```

### SQL Scripting Variables in Stored Procedures

- Declare variables in the `DECLARE` block
- Use `:variable` prefix when referencing variables inside SQL statements (SELECT, INSERT, UPDATE)
- Use `variable := value` for reassignment (NOT `LET variable := value` which re-declares)
- `LET` in the procedure body creates a new variable — only use it once per variable name

### PARSE_DOCUMENT Limitations

- Supports: `.pdf`, `.docx`, `.pptx`, `.txt`, `.html`, `.jpeg`, `.jpg`, `.png`, `.tif`, `.tiff`
- Does NOT support: `.zip`, `.xlsx`, `.xlsm`
- For Excel files, use the `PARSE_XLSX_FILE()` Python stored procedure with `openpyxl`

### Chunking Strategy

- Chunk size: 1000 characters
- Stride: 800 characters (200 char overlap)
- Minimum chunk threshold: 50 characters

### Streamlit in Snowflake (SiS) Constraints

- Actual runtime is **Streamlit 1.22.0** (not the latest version)
- `st.chat_input`, `st.pills`, `st.file_uploader` (with drag-and-drop) — NOT available
- Use `st.form` for text input submission
- Use `st.session_state` for button-triggered queries
- Dependencies declared in `environment.yml` at stage root

---

## PIC iX 4.5 Device Details

- **Classification:** Class II (US FDA), Class III (Health Canada), Class IIb (EU MDR Rule 11)
- **Regulation Numbers:** 870.1025, 870.2800, 870.2300, 880.6310
- **Product Codes:** MHX, DSI, MLD, DSH, MSX, OUG
- **Configurations:**
  - Essentials (Ordering #867093)
  - Express (Ordering #866389)
  - Enterprise (Ordering #866389)
  - Plus expansion/upgrade variants
- **Change Type:** Software-only design change (4.5 release)
- **Key Features in 4.5:** Remote Software Distribution (RSM), increased bed/host count (2550/350), Care Assist mobility server support, Alarm UI enhancements, Caliper UI updates, HSPMP device registration, Centralized Cache Service, Surveillance DLS alignment, patchable upgrade from 4.1-4.4

### DHF Document Categories (27)

The 5,703 DHF chunks are categorized into 27 document categories. Top categories by chunk count:
- general (1,251), traceability (1,178), soup_assessment (588), risk_assessment (561), sbom (360), usability (267), verification (264), security_analysis (161), risk_evaluation (131), design_validation (126), design_fmea (97), mds2 (92), product_requirements (85), regulatory_plan (81)

---

## Quick Reference: How to Re-run Key Operations

```sql
-- Parse any newly uploaded DHF files (skips already-parsed)
CALL FDA_510K_ACCELERATOR.REFERENCE_DOCS.PARSE_DHF_FILES();

-- Parse a specific Excel file
CALL FDA_510K_ACCELERATOR.REFERENCE_DOCS.PARSE_XLSX_FILE(
    BUILD_SCOPED_FILE_URL(@DHF_UPLOADS, 'filename.xlsx'),
    'filename.xlsx',
    'category_name'
);

-- Re-generate all RIA T1 sections (deletes existing, regenerates all 33)
CALL FDA_510K_ACCELERATOR.REFERENCE_DOCS.GENERATE_RIA_T1();

-- View generated T1 sections
SELECT SECTION_ID, SECTION_NAME, ANSWER_SELECTION 
FROM FDA_510K_ACCELERATOR.REFERENCE_DOCS.RIA_T1_GENERATED 
ORDER BY SECTION_ID;

-- Search DHF content
SELECT SNOWFLAKE.CORTEX.SEARCH_PREVIEW(
    'FDA_510K_ACCELERATOR.REFERENCE_DOCS.DHF_SEARCH',
    '{"query": "your query", "columns": ["CHUNK_TEXT", "FILE_NAME", "DOC_CATEGORY"], "limit": 5}'
);

-- Search FDA guidance
SELECT SNOWFLAKE.CORTEX.SEARCH_PREVIEW(
    'FDA_510K_ACCELERATOR.REFERENCE_DOCS.FDA_510K_SEARCH',
    '{"query": "your query", "columns": ["CHUNK_TEXT", "FILE_NAME"], "limit": 5}'
);
```
