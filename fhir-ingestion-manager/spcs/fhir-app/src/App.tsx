import { useState, useEffect } from 'react';
import type { SQLResult, ViewName } from './types';
import { executeSQL, healthCheck } from './services/snowflake';
import { Activity, AlertTriangle, BookOpen, Settings, BarChart3, Heart } from 'lucide-react';

const NAV_ITEMS: { key: ViewName; label: string; icon: typeof Activity }[] = [
  { key: 'monitor', label: 'Ingestion Monitor', icon: Activity },
  { key: 'quarantine', label: 'Quarantine', icon: AlertTriangle },
  { key: 'vocabulary', label: 'Vocabulary Map', icon: BookOpen },
  { key: 'profiles', label: 'Source Profiles', icon: Settings },
  { key: 'quality', label: 'Quality Dashboard', icon: BarChart3 },
];

function App() {
  const [view, setView] = useState<ViewName>('monitor');
  const [health, setHealth] = useState<{ snowflake: string; postgres: string } | null>(null);

  useEffect(() => {
    healthCheck().then(setHealth).catch(() => setHealth({ snowflake: 'error', postgres: 'error' }));
  }, []);

  return (
    <div className="flex h-screen">
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Heart className="w-6 h-6 text-[#29B5E8]" />
            <div>
              <h1 className="text-lg font-semibold text-gray-900">FHIR Ingestion</h1>
              <p className="text-xs text-gray-500">Clinical Data Manager</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-2">
          {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm mb-0.5 transition-colors ${
                view === key
                  ? 'bg-[#29B5E8]/10 text-[#29B5E8] font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-200 text-xs text-gray-400">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${health?.snowflake === 'ok' ? 'bg-green-400' : 'bg-red-400'}`} />
            SF: {health?.snowflake || '...'}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`w-2 h-2 rounded-full ${health?.postgres === 'ok' ? 'bg-green-400' : 'bg-red-400'}`} />
            PG: {health?.postgres || '...'}
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto bg-gray-50 p-6">
        {view === 'monitor' && <MonitorView />}
        {view === 'quarantine' && <QuarantineView />}
        {view === 'vocabulary' && <VocabularyView />}
        {view === 'profiles' && <ProfilesView />}
        {view === 'quality' && <QualityView />}
      </main>
    </div>
  );
}

function StatCard({ label, value, color = 'text-gray-900' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function DataTable({ result }: { result: SQLResult | null }) {
  if (!result || !result.data.length) return <p className="text-sm text-gray-400 py-4">No data</p>;
  return (
    <div className="overflow-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {result.columns.map((c) => (
              <th key={c} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.data.map((row, i) => (
            <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-gray-700 whitespace-nowrap">{cell ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MonitorView() {
  const [stats, setStats] = useState<SQLResult | null>(null);
  const [tiers, setTiers] = useState<SQLResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      executeSQL(`SELECT COUNT(*) AS TOTAL_BUNDLES, SUM(RESOURCE_COUNT) AS TOTAL_RESOURCES, AVG(RESOURCE_COUNT) AS AVG_RESOURCES FROM TRE_HEALTHCARE_DB.FHIR_STAGING.RAW_BUNDLES`),
      executeSQL(`SELECT QUALITY_TIER, COUNT(*) AS CT, ROUND(AVG(RESOURCE_COUNT),1) AS AVG_RES FROM TRE_HEALTHCARE_DB.FHIR_STAGING.RAW_BUNDLES GROUP BY QUALITY_TIER ORDER BY CT DESC`),
    ]).then(([s, t]) => { setStats(s); setTiers(t); }).finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-400">Loading...</p>;

  const row = stats?.data[0];
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Ingestion Monitor</h2>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Bundles" value={row?.[0] ?? '—'} color="text-[#29B5E8]" />
        <StatCard label="Total Resources" value={Number(row?.[1] ?? 0).toLocaleString()} />
        <StatCard label="Avg Resources/Bundle" value={Number(row?.[2] ?? 0).toFixed(1)} />
      </div>
      <h3 className="text-sm font-medium text-gray-500 mb-2 uppercase">Quality Tier Distribution</h3>
      <DataTable result={tiers} />
    </div>
  );
}

function QuarantineView() {
  const [data, setData] = useState<SQLResult | null>(null);
  useEffect(() => {
    executeSQL(`SELECT QUARANTINE_ID, SOURCE_TYPE, REASON_CATEGORY, SEVERITY, SOURCE_CODE, SOURCE_SYSTEM_NAME, RESOLUTION_STATUS, CREATED_AT FROM TRE_HEALTHCARE_DB.FHIR_STAGING.QUARANTINE ORDER BY CREATED_AT DESC LIMIT 100`).then(setData);
  }, []);
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Quarantine Manager</h2>
      <p className="text-sm text-gray-500 mb-4">Records that failed validation or contain unmapped codes. Resolve to add vocabulary mappings.</p>
      <DataTable result={data} />
      {data && data.data.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <AlertTriangle className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>No quarantined records. Pipeline hasn't run yet.</p>
        </div>
      )}
    </div>
  );
}

function VocabularyView() {
  const [data, setData] = useState<SQLResult | null>(null);
  useEffect(() => {
    executeSQL(`SELECT SOURCE_CODE, SOURCE_CODE_SYSTEM, SOURCE_DISPLAY, TARGET_CONCEPT_ID, TARGET_CONCEPT_NAME, TARGET_VOCABULARY_ID, TARGET_DOMAIN_ID, MAPPING_TYPE FROM TRE_HEALTHCARE_DB.FHIR_STAGING.VOCABULARY_MAP WHERE IS_ACTIVE = TRUE ORDER BY TARGET_DOMAIN_ID, SOURCE_CODE`).then(setData);
  }, []);
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Vocabulary Map</h2>
      <p className="text-sm text-gray-500 mb-4">{data?.data.length ?? 0} active mappings (SNOMED/LOINC → OMOP concept IDs)</p>
      <DataTable result={data} />
    </div>
  );
}

function ProfilesView() {
  const [data, setData] = useState<SQLResult | null>(null);
  useEffect(() => {
    executeSQL(`SELECT SOURCE_SYSTEM, DISPLAY_NAME, SOURCE_TYPE, IS_ACTIVE, DEFAULT_VOCABULARY, EXTENSION_HANDLING FROM TRE_HEALTHCARE_DB.FHIR_STAGING.SOURCE_PROFILES ORDER BY SOURCE_SYSTEM`).then(setData);
  }, []);
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Source Profiles</h2>
      <p className="text-sm text-gray-500 mb-4">Per-facility configuration for vocabulary mapping, extension handling, and known data quality quirks.</p>
      <DataTable result={data} />
    </div>
  );
}

function QualityView() {
  const [gtStats, setGtStats] = useState<SQLResult | null>(null);
  useEffect(() => {
    executeSQL(`SELECT 'PERSON' AS TBL, COUNT(*) AS ROW_CT FROM TRE_HEALTHCARE_DB.FHIR_STAGING.OMOP_GT_PERSON UNION ALL SELECT 'DEATH', COUNT(*) FROM TRE_HEALTHCARE_DB.FHIR_STAGING.OMOP_GT_DEATH UNION ALL SELECT 'CONDITION', COUNT(*) FROM TRE_HEALTHCARE_DB.FHIR_STAGING.OMOP_GT_CONDITION UNION ALL SELECT 'MEASUREMENT', COUNT(*) FROM TRE_HEALTHCARE_DB.FHIR_STAGING.OMOP_GT_MEASUREMENT UNION ALL SELECT 'VISIT', COUNT(*) FROM TRE_HEALTHCARE_DB.FHIR_STAGING.OMOP_GT_VISIT UNION ALL SELECT 'FACT_REL', COUNT(*) FROM TRE_HEALTHCARE_DB.FHIR_STAGING.OMOP_GT_FACT_RELATIONSHIP ORDER BY TBL`).then(setGtStats);
  }, []);
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Quality Dashboard</h2>
      <p className="text-sm text-gray-500 mb-4">Ground truth OMOP tables for transformation accuracy validation.</p>
      <DataTable result={gtStats} />
    </div>
  );
}

export default App;
