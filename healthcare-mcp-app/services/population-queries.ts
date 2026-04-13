import { getMCPClient } from '@/services/mcp-client';

export async function fetchPopulationCensus() {
  const client = getMCPClient();
  if (!client) throw new Error('MCP client not initialized');
  return client.executeSQL('SELECT * FROM TRE_HEALTHCARE_DB.MS_FIMR.V_POPULATION_CENSUS');
}

export async function fetchConditionPrevalence() {
  const client = getMCPClient();
  if (!client) throw new Error('MCP client not initialized');
  return client.executeSQL('SELECT * FROM TRE_HEALTHCARE_DB.MS_FIMR.V_CONDITION_PREVALENCE');
}

export async function fetchMortalityByRegion() {
  const client = getMCPClient();
  if (!client) throw new Error('MCP client not initialized');
  return client.executeSQL('SELECT * FROM TRE_HEALTHCARE_DB.MS_FIMR.V_MORTALITY_BY_REGION');
}

export async function fetchAgeDistribution() {
  const client = getMCPClient();
  if (!client) throw new Error('MCP client not initialized');
  return client.executeSQL('SELECT * FROM TRE_HEALTHCARE_DB.MS_FIMR.V_AGE_DISTRIBUTION');
}

export async function fetchCareCoordination(riskFilter?: string) {
  const client = getMCPClient();
  if (!client) throw new Error('MCP client not initialized');
  const filterArg = riskFilter ? `'${riskFilter}'` : 'NULL';
  return client.executeSQL(`CALL TRE_HEALTHCARE_DB.MS_FIMR.GET_CARE_COORDINATION_SUMMARY(${filterArg})`);
}
