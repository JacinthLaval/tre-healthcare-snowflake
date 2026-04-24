import { getMCPClient } from '@/services/mcp-client';
import { Platform } from 'react-native';

const getActiveRole = () => Platform.OS === 'web' ? (localStorage.getItem('snowflake_active_role') || undefined) : undefined;

export async function fetchPopulationCensus() {
  const client = getMCPClient();
  if (!client) throw new Error('MCP client not initialized');
  return client.executeSQL('SELECT * FROM TRE_HEALTHCARE_DB.MS_FIMR.V_POPULATION_CENSUS', 30, getActiveRole());
}

export async function fetchConditionPrevalence() {
  const client = getMCPClient();
  if (!client) throw new Error('MCP client not initialized');
  return client.executeSQL('SELECT * FROM TRE_HEALTHCARE_DB.MS_FIMR.V_CONDITION_PREVALENCE', 30, getActiveRole());
}

export async function fetchMortalityByRegion() {
  const client = getMCPClient();
  if (!client) throw new Error('MCP client not initialized');
  return client.executeSQL('SELECT * FROM TRE_HEALTHCARE_DB.MS_FIMR.V_MORTALITY_BY_REGION', 30, getActiveRole());
}

export async function fetchAgeDistribution() {
  const client = getMCPClient();
  if (!client) throw new Error('MCP client not initialized');
  return client.executeSQL('SELECT * FROM TRE_HEALTHCARE_DB.MS_FIMR.V_AGE_DISTRIBUTION', 30, getActiveRole());
}

export async function fetchCareCoordination(riskFilter?: string) {
  const client = getMCPClient();
  if (!client) throw new Error('MCP client not initialized');
  const filterArg = riskFilter ? `'${riskFilter}'` : 'NULL';
  return client.executeSQL(`CALL TRE_HEALTHCARE_DB.MS_FIMR.GET_CARE_COORDINATION_SUMMARY(${filterArg})`, 30, getActiveRole());
}
