# Healthcare MCP Mobile App

React Native (Expo) mobile app that connects to Snowflake's managed MCP server for healthcare data analytics.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Mobile App (Expo)                        │
├─────────────────────────────────────────────────────────────┤
│  Login Screen                                               │
│  - PAT token authentication                                 │
│  - Secure storage                                           │
├─────────────────────────────────────────────────────────────┤
│  Tab Navigation                                             │
│  ┌─────────────┬─────────────┬─────────────┐               │
│  │   CIBMTR    │   TRE/OMOP  │  Settings   │               │
│  │   Chat      │   Chat      │             │               │
│  └─────────────┴─────────────┴─────────────┘               │
├─────────────────────────────────────────────────────────────┤
│  MCP Client (services/mcp-client.ts)                        │
│  - JSON-RPC 2.0 protocol                                    │
│  - tools/list, tools/call methods                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│        Snowflake MCP Server (HEALTHCARE_MCP_SERVER)         │
├─────────────────────────────────────────────────────────────┤
│  Tools:                                                     │
│  - cibmtr-analyst (CIBMTR_SEMANTIC_VIEW)                   │
│  - tre-omop-analyst (TRE_OMOP_SEMANTIC_VIEW)               │
└─────────────────────────────────────────────────────────────┘
```

## Snowflake Objects Created

- **Semantic Views:**
  - `TRE_HEALTHCARE_DB.OMOP_CDM.CIBMTR_SEMANTIC_VIEW`
  - `TRE_HEALTHCARE_DB.OMOP_CDM.TRE_OMOP_SEMANTIC_VIEW`

- **MCP Server:**
  - `TRE_HEALTHCARE_DB.OMOP_CDM.HEALTHCARE_MCP_SERVER`

## Setup

### Prerequisites
1. Node.js 18+ and npm
2. Expo CLI: `npm install -g expo-cli`
3. Expo Go app on your iOS/Android device
4. Snowflake PAT token

### Generate PAT Token
1. Go to Snowsight
2. Navigate to Settings → Developer → Personal Access Tokens
3. Generate a new token with appropriate permissions
4. Copy and save the token securely

### Install & Run
```bash
cd healthcare-mcp-app
npm install
npx expo start
```

Scan the QR code with Expo Go (iOS) or the Expo app (Android).

## MCP Server Endpoint

```
POST https://sfsehol-si_industry_demos_healthcare_lmszks.snowflakecomputing.com/api/v2/databases/TRE_HEALTHCARE_DB/schemas/OMOP_CDM/mcp-servers/HEALTHCARE_MCP_SERVER
```

### Headers
```
Authorization: Bearer <PAT_TOKEN>
Content-Type: application/json
```

### List Tools
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

### Call Tool
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "cibmtr-analyst",
    "arguments": {
      "message": "What is the survival rate by conditioning intensity?"
    }
  }
}
```

## Sample Questions

### CIBMTR Analyst
- "What is the overall survival rate for haploidentical transplants?"
- "Compare TMA incidence by donor type"
- "What are the average CD34+ yields by collection year?"

### TRE/OMOP Analyst  
- "How many unique patients are in the database?"
- "What are the top 10 conditions by frequency?"
- "Show visit counts by type"
