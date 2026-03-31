import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator, Platform, TextInput, Modal } from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { getMCPClient } from '@/services/mcp-client';

interface ServiceInfo {
  name: string;
  status: string;
  computePool: string;
  currentInstances: number;
  targetInstances: number;
  minInstances: number;
  maxInstances: number;
  autoSuspendSecs: number;
  createdOn: string;
  resumedOn: string;
  suspendedOn: string;
}

interface ComputePoolInfo {
  name: string;
  state: string;
  instanceFamily: string;
  minNodes: number;
  maxNodes: number;
  activeNodes: number;
  idleNodes: number;
  autoSuspendSecs: number;
  autoResume: boolean;
  createdOn: string;
}

interface WarehouseInfo {
  name: string;
  state: string;
  size: string;
  autoSuspend: number;
  autoResume: boolean;
  running: number;
  queued: number;
  comment: string;
}

const TIER_INFO: Record<string, { label: string; color: string; rate: string }> = {
  'GPU_NV_S': { label: 'GPU A10G', color: '#E74C3C', rate: '~$3.19/hr' },
  'GPU_NV_M': { label: 'GPU A100', color: '#E74C3C', rate: '~$8.50/hr' },
  'GPU_NV_L': { label: 'GPU 8xA100', color: '#E74C3C', rate: '~$50/hr' },
  'CPU_X64_XS': { label: 'CPU XS', color: '#27AE60', rate: '~$0.06/hr' },
  'CPU_X64_S': { label: 'CPU S', color: '#27AE60', rate: '~$0.12/hr' },
  'CPU_X64_M': { label: 'CPU M', color: '#F39C12', rate: '~$0.24/hr' },
  'CPU_X64_L': { label: 'CPU L', color: '#F39C12', rate: '~$0.48/hr' },
  'HIGHMEM_X64_S': { label: 'HiMem S', color: '#F39C12', rate: '~$0.32/hr' },
  'HIGHMEM_X64_M': { label: 'HiMem M', color: '#F39C12', rate: '~$0.62/hr' },
  'HIGHMEM_X64_L': { label: 'HiMem L', color: '#F39C12', rate: '~$1.24/hr' },
};

const WH_SIZE_CREDITS: Record<string, number> = {
  'X-Small': 1, 'Small': 2, 'Medium': 4, 'Large': 8, 'X-Large': 16,
  '2X-Large': 32, '3X-Large': 64, '4X-Large': 128, '5X-Large': 256, '6X-Large': 512,
};

const STATUS_COLORS: Record<string, string> = {
  RUNNING: '#27AE60',
  READY: '#27AE60',
  ACTIVE: '#27AE60',
  IDLE: '#27AE60',
  STARTED: '#27AE60',
  SUSPENDED: '#999',
  SUSPENDING: '#F39C12',
  STARTING: '#3498DB',
  RESUMING: '#3498DB',
  RESIZING: '#3498DB',
  FAILED: '#E74C3C',
  UNKNOWN: '#999',
};

const TIMEOUT_PRESETS = [
  { label: 'Off', secs: 0 },
  { label: '1m', secs: 60 },
  { label: '5m', secs: 300 },
  { label: '10m', secs: 600 },
  { label: '30m', secs: 1800 },
  { label: '60m', secs: 3600 },
];

type ResourceKind = 'pool' | 'service' | 'warehouse';

interface TimeoutModalState {
  visible: boolean;
  kind: ResourceKind;
  name: string;
  currentSecs: number;
}

export default function SettingsScreen() {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [pools, setPools] = useState<ComputePoolInfo[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeSection, setActiveSection] = useState<'monitor' | 'connection'>('monitor');
  const [timeoutModal, setTimeoutModal] = useState<TimeoutModalState>({ visible: false, kind: 'pool', name: '', currentSecs: 0 });
  const [customTimeout, setCustomTimeout] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    const client = getMCPClient();
    if (!client) return;

    try {
      const [svcRows, poolRows, whRows] = await Promise.all([
        client.executeSQL('SHOW SERVICES IN SCHEMA HEALTHCARE_DATABASE.DEFAULT_SCHEMA'),
        client.executeSQL('SHOW COMPUTE POOLS'),
        client.executeSQL('SHOW WAREHOUSES'),
      ]);

      const svcList: ServiceInfo[] = (svcRows || []).map((r: any) => ({
        name: r.name || r.NAME || '',
        status: r.status || r.STATUS || 'UNKNOWN',
        computePool: r.compute_pool || r.COMPUTE_POOL || '',
        currentInstances: parseInt(r.current_instances || r.CURRENT_INSTANCES || '0'),
        targetInstances: parseInt(r.target_instances || r.TARGET_INSTANCES || '0'),
        minInstances: parseInt(r.min_instances || r.MIN_INSTANCES || '0'),
        maxInstances: parseInt(r.max_instances || r.MAX_INSTANCES || '0'),
        autoSuspendSecs: parseInt(r.auto_suspend_secs || r.AUTO_SUSPEND_SECS || '0'),
        createdOn: r.created_on || r.CREATED_ON || '',
        resumedOn: r.resumed_on || r.RESUMED_ON || '',
        suspendedOn: r.suspended_on || r.SUSPENDED_ON || '',
      }));

      const poolList: ComputePoolInfo[] = (poolRows || []).map((r: any) => ({
        name: r.name || r.NAME || '',
        state: r.state || r.STATE || 'UNKNOWN',
        instanceFamily: r.instance_family || r.INSTANCE_FAMILY || '',
        minNodes: parseInt(r.min_nodes || r.MIN_NODES || '0'),
        maxNodes: parseInt(r.max_nodes || r.MAX_NODES || '0'),
        activeNodes: parseInt(r.active_nodes || r.ACTIVE_NODES || '0'),
        idleNodes: parseInt(r.idle_nodes || r.IDLE_NODES || '0'),
        autoSuspendSecs: parseInt(r.auto_suspend_secs || r.AUTO_SUSPEND_SECS || '0'),
        autoResume: (r.auto_resume || r.AUTO_RESUME || 'false') === 'true',
        createdOn: r.created_on || r.CREATED_ON || '',
      }));

      const whList: WarehouseInfo[] = (whRows || []).map((r: any) => ({
        name: r.name || r.NAME || '',
        state: r.state || r.STATE || 'UNKNOWN',
        size: r.size || r.SIZE || '',
        autoSuspend: parseInt(r.auto_suspend || r.AUTO_SUSPEND || '0'),
        autoResume: (r.auto_resume || r.AUTO_RESUME || 'false') === 'true',
        running: parseInt(r.running || r.RUNNING || '0'),
        queued: parseInt(r.queued || r.QUEUED || '0'),
        comment: r.comment || r.COMMENT || '',
      }));

      setServices(svcList);
      setPools(poolList);
      setWarehouses(whList);
      setLastRefresh(new Date());
    } catch (e: any) {
      console.warn('[SPCS Monitor] fetch failed:', e);
    }
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    await fetchStatus();
    setLoading(false);
  }, [fetchStatus]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchStatus, 15000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchStatus]);

  const runAction = async (sql: string, label: string) => {
    const client = getMCPClient();
    if (!client) return;
    setActionLoading(label);
    try {
      await client.executeSQL(sql, 60);
      await new Promise(r => setTimeout(r, 2000));
      await fetchStatus();
    } catch (e: any) {
      if (Platform.OS === 'web') {
        alert(`Action failed: ${e.message}`);
      } else {
        Alert.alert('Error', e.message);
      }
    } finally {
      setActionLoading(null);
    }
  };

  const toggleService = (svc: ServiceInfo) => {
    const fqn = `HEALTHCARE_DATABASE.DEFAULT_SCHEMA.${svc.name}`;
    if (isRunning(svc.status)) {
      runAction(`ALTER SERVICE ${fqn} SUSPEND`, `svc-${svc.name}`);
    } else {
      runAction(`ALTER SERVICE ${fqn} RESUME`, `svc-${svc.name}`);
    }
  };

  const togglePool = (pool: ComputePoolInfo) => {
    if (isRunning(pool.state)) {
      runAction(`ALTER COMPUTE POOL ${pool.name} SUSPEND`, `pool-${pool.name}`);
    } else {
      runAction(`ALTER COMPUTE POOL ${pool.name} RESUME`, `pool-${pool.name}`);
    }
  };

  const toggleWarehouse = (wh: WarehouseInfo) => {
    if (isRunning(wh.state)) {
      runAction(`ALTER WAREHOUSE ${wh.name} SUSPEND`, `wh-${wh.name}`);
    } else {
      runAction(`ALTER WAREHOUSE ${wh.name} RESUME`, `wh-${wh.name}`);
    }
  };

  const applyTimeout = async (secs: number) => {
    const { kind, name } = timeoutModal;
    let sql = '';
    if (kind === 'pool') {
      sql = `ALTER COMPUTE POOL ${name} SET AUTO_SUSPEND_SECS = ${secs}`;
    } else if (kind === 'service') {
      const fqn = `HEALTHCARE_DATABASE.DEFAULT_SCHEMA.${name}`;
      sql = `ALTER SERVICE ${fqn} SET AUTO_SUSPEND_SECS = ${secs}`;
    } else {
      sql = `ALTER WAREHOUSE ${name} SET AUTO_SUSPEND = ${secs}`;
    }
    setTimeoutModal(m => ({ ...m, visible: false }));
    await runAction(sql, `timeout-${name}`);
  };

  const isRunning = (status: string) => ['RUNNING', 'READY', 'ACTIVE', 'IDLE', 'STARTED'].includes(status);

  const getTierInfo = (family: string) => TIER_INFO[family] || { label: family, color: '#999', rate: '' };

  const formatTimeout = (secs: number) => {
    if (secs === 0) return 'Never';
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.round(secs / 60)}min`;
    const h = Math.floor(secs / 3600);
    const m = Math.round((secs % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const totalRunningCost = () => {
    let cost = 0;
    for (const pool of pools) {
      if (isRunning(pool.state)) {
        const tier = TIER_INFO[pool.instanceFamily];
        if (tier) {
          const rate = parseFloat(tier.rate.replace(/[^0-9.]/g, ''));
          cost += rate * pool.activeNodes;
        }
      }
    }
    for (const wh of warehouses) {
      if (isRunning(wh.state)) {
        const credits = WH_SIZE_CREDITS[wh.size] || 1;
        cost += credits * 2;
      }
    }
    return cost;
  };

  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      if (confirm('Disconnect from Snowflake?')) {
        await SecureStore.deleteItemAsync('snowflake_pat');
        router.replace('/');
      }
    } else {
      Alert.alert('Disconnect', 'Are you sure you want to disconnect from Snowflake?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: async () => {
          await SecureStore.deleteItemAsync('snowflake_pat');
          router.replace('/');
        }},
      ]);
    }
  };

  const openTimeoutModal = (kind: ResourceKind, name: string, currentSecs: number) => {
    setCustomTimeout(String(Math.round(currentSecs / 60)));
    setTimeoutModal({ visible: true, kind, name, currentSecs });
  };

  const runningCost = totalRunningCost();
  const runningServices = services.filter(s => isRunning(s.status)).length;
  const runningPools = pools.filter(p => isRunning(p.state)).length;
  const runningWhs = warehouses.filter(w => isRunning(w.state)).length;

  const renderTimeoutBadge = (secs: number, kind: ResourceKind, name: string) => (
    <TouchableOpacity
      style={styles.timeoutBadge}
      onPress={() => openTimeoutModal(kind, name, secs)}
    >
      <Text style={styles.timeoutBadgeIcon}>&#9202;</Text>
      <Text style={styles.timeoutBadgeText}>{formatTimeout(secs)}</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container}>
      <View style={styles.sectionTabs}>
        <TouchableOpacity
          style={[styles.sectionTab, activeSection === 'monitor' && styles.sectionTabActive]}
          onPress={() => setActiveSection('monitor')}
        >
          <Text style={[styles.sectionTabText, activeSection === 'monitor' && styles.sectionTabTextActive]}>
            SPCS Monitor
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sectionTab, activeSection === 'connection' && styles.sectionTabActive]}
          onPress={() => setActiveSection('connection')}
        >
          <Text style={[styles.sectionTabText, activeSection === 'connection' && styles.sectionTabTextActive]}>
            Connection
          </Text>
        </TouchableOpacity>
      </View>

      {activeSection === 'monitor' && (
        <>
          <View style={styles.summaryBar}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: runningServices > 0 ? '#27AE60' : '#999' }]}>{runningServices}</Text>
              <Text style={styles.summaryLabel}>Services Up</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: runningPools > 0 ? '#27AE60' : '#999' }]}>{runningPools}</Text>
              <Text style={styles.summaryLabel}>Pools Active</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: runningWhs > 0 ? '#3498DB' : '#999' }]}>{runningWhs}</Text>
              <Text style={styles.summaryLabel}>Warehouses</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: runningCost > 0 ? '#E74C3C' : '#999' }]}>
                ${runningCost.toFixed(2)}
              </Text>
              <Text style={styles.summaryLabel}>Est. $/hr</Text>
            </View>
          </View>

          <View style={styles.refreshRow}>
            <TouchableOpacity
              style={[styles.autoRefreshBtn, autoRefresh && styles.autoRefreshBtnActive]}
              onPress={() => setAutoRefresh(!autoRefresh)}
            >
              <Text style={[styles.autoRefreshText, autoRefresh && styles.autoRefreshTextActive]}>
                Auto-Refresh {autoRefresh ? 'ON' : 'OFF'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.refreshBtn} onPress={loadInitial}>
              {loading ? <ActivityIndicator size="small" color="#29B5E8" /> : (
                <Text style={styles.refreshBtnText}>Refresh Now</Text>
              )}
            </TouchableOpacity>
            {lastRefresh && (
              <Text style={styles.lastRefreshText}>
                {lastRefresh.toLocaleTimeString()}
              </Text>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Compute Pools ({pools.length})</Text>
            {pools.length === 0 && !loading && (
              <Text style={styles.emptyText}>No compute pools found</Text>
            )}
            {pools.map(pool => {
              const tier = getTierInfo(pool.instanceFamily);
              const active = isRunning(pool.state);
              const isActioning = actionLoading === `pool-${pool.name}`;
              return (
                <View key={pool.name} style={[styles.card, active && styles.cardActive]}>
                  <View style={styles.cardHeader}>
                    <View style={styles.cardTitleRow}>
                      <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[pool.state] || '#999' }]} />
                      <Text style={styles.cardName}>{pool.name}</Text>
                    </View>
                    {renderTimeoutBadge(pool.autoSuspendSecs, 'pool', pool.name)}
                    <TouchableOpacity
                      style={[styles.toggleBtn, active ? styles.toggleBtnStop : styles.toggleBtnStart]}
                      onPress={() => togglePool(pool)}
                      disabled={isActioning}
                    >
                      {isActioning ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.toggleBtnText}>{active ? 'Suspend' : 'Resume'}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  <View style={styles.cardDetails}>
                    <View style={styles.cardDetail}>
                      <Text style={styles.detailLabel}>Type</Text>
                      <Text style={[styles.detailValue, { color: tier.color }]}>{tier.label}</Text>
                    </View>
                    <View style={styles.cardDetail}>
                      <Text style={styles.detailLabel}>Cost</Text>
                      <Text style={[styles.detailValue, { color: tier.color }]}>{tier.rate}</Text>
                    </View>
                    <View style={styles.cardDetail}>
                      <Text style={styles.detailLabel}>Nodes</Text>
                      <Text style={styles.detailValue}>{pool.activeNodes}/{pool.maxNodes}</Text>
                    </View>
                    <View style={styles.cardDetail}>
                      <Text style={styles.detailLabel}>State</Text>
                      <Text style={[styles.detailValue, { color: STATUS_COLORS[pool.state] || '#999' }]}>{pool.state}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Services ({services.length})</Text>
            {services.length === 0 && !loading && (
              <Text style={styles.emptyText}>No services found</Text>
            )}
            {services.map(svc => {
              const pool = pools.find(p => p.name === svc.computePool);
              const tier = pool ? getTierInfo(pool.instanceFamily) : { label: '\u2014', color: '#999', rate: '' };
              const active = isRunning(svc.status);
              const isActioning = actionLoading === `svc-${svc.name}`;
              return (
                <View key={svc.name} style={[styles.card, active && styles.cardActive]}>
                  <View style={styles.cardHeader}>
                    <View style={styles.cardTitleRow}>
                      <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[svc.status] || '#999' }]} />
                      <Text style={styles.cardName}>{svc.name}</Text>
                    </View>
                    {renderTimeoutBadge(svc.autoSuspendSecs, 'service', svc.name)}
                    <TouchableOpacity
                      style={[styles.toggleBtn, active ? styles.toggleBtnStop : styles.toggleBtnStart]}
                      onPress={() => toggleService(svc)}
                      disabled={isActioning}
                    >
                      {isActioning ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.toggleBtnText}>{active ? 'Suspend' : 'Resume'}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  <View style={styles.cardDetails}>
                    <View style={styles.cardDetail}>
                      <Text style={styles.detailLabel}>Pool</Text>
                      <Text style={styles.detailValue}>{svc.computePool}</Text>
                    </View>
                    <View style={styles.cardDetail}>
                      <Text style={styles.detailLabel}>Tier</Text>
                      <Text style={[styles.detailValue, { color: tier.color }]}>{tier.label}</Text>
                    </View>
                    <View style={styles.cardDetail}>
                      <Text style={styles.detailLabel}>Instances</Text>
                      <Text style={styles.detailValue}>{svc.currentInstances}/{svc.maxInstances}</Text>
                    </View>
                    <View style={styles.cardDetail}>
                      <Text style={styles.detailLabel}>Status</Text>
                      <Text style={[styles.detailValue, { color: STATUS_COLORS[svc.status] || '#999' }]}>{svc.status}</Text>
                    </View>
                  </View>
                  {svc.suspendedOn && svc.status === 'SUSPENDED' && (
                    <Text style={styles.autoSuspendNote}>Suspended: {new Date(svc.suspendedOn).toLocaleString()}</Text>
                  )}
                </View>
              );
            })}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Warehouses ({warehouses.length})</Text>
            {warehouses.length === 0 && !loading && (
              <Text style={styles.emptyText}>No warehouses found</Text>
            )}
            {warehouses.map(wh => {
              const active = isRunning(wh.state);
              const credits = WH_SIZE_CREDITS[wh.size] || 1;
              const isActioning = actionLoading === `wh-${wh.name}`;
              return (
                <View key={wh.name} style={[styles.card, active && styles.cardActive]}>
                  <View style={styles.cardHeader}>
                    <View style={styles.cardTitleRow}>
                      <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[wh.state] || '#999' }]} />
                      <Text style={styles.cardName}>{wh.name}</Text>
                    </View>
                    {renderTimeoutBadge(wh.autoSuspend, 'warehouse', wh.name)}
                    <TouchableOpacity
                      style={[styles.toggleBtn, active ? styles.toggleBtnStop : styles.toggleBtnStart]}
                      onPress={() => toggleWarehouse(wh)}
                      disabled={isActioning}
                    >
                      {isActioning ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.toggleBtnText}>{active ? 'Suspend' : 'Resume'}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  <View style={styles.cardDetails}>
                    <View style={styles.cardDetail}>
                      <Text style={styles.detailLabel}>Size</Text>
                      <Text style={styles.detailValue}>{wh.size}</Text>
                    </View>
                    <View style={styles.cardDetail}>
                      <Text style={styles.detailLabel}>Credits/hr</Text>
                      <Text style={styles.detailValue}>{credits}</Text>
                    </View>
                    <View style={styles.cardDetail}>
                      <Text style={styles.detailLabel}>Running</Text>
                      <Text style={styles.detailValue}>{wh.running}</Text>
                    </View>
                    <View style={styles.cardDetail}>
                      <Text style={styles.detailLabel}>State</Text>
                      <Text style={[styles.detailValue, { color: STATUS_COLORS[wh.state] || '#999' }]}>{wh.state}</Text>
                    </View>
                  </View>
                  {wh.comment ? <Text style={styles.autoSuspendNote}>{wh.comment}</Text> : null}
                </View>
              );
            })}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Bulk Actions</Text>
            <View style={styles.bulkRow}>
              <TouchableOpacity
                style={[styles.bulkBtn, styles.bulkBtnDanger]}
                onPress={async () => {
                  const running = services.filter(s => isRunning(s.status));
                  if (running.length === 0) { alert('No running services'); return; }
                  for (const svc of running) {
                    await runAction(
                      `ALTER SERVICE HEALTHCARE_DATABASE.DEFAULT_SCHEMA.${svc.name} SUSPEND`,
                      `svc-${svc.name}`
                    );
                  }
                }}
              >
                <Text style={styles.bulkBtnText}>Suspend All Services</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bulkBtn, styles.bulkBtnDanger]}
                onPress={async () => {
                  const active = pools.filter(p => isRunning(p.state));
                  if (active.length === 0) { alert('No active pools'); return; }
                  for (const pool of active) {
                    await runAction(`ALTER COMPUTE POOL ${pool.name} SUSPEND`, `pool-${pool.name}`);
                  }
                }}
              >
                <Text style={styles.bulkBtnText}>Suspend All Pools</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.bulkRow, { marginTop: 8 }]}>
              <TouchableOpacity
                style={[styles.bulkBtn, styles.bulkBtnDanger]}
                onPress={async () => {
                  const active = warehouses.filter(w => isRunning(w.state));
                  if (active.length === 0) { alert('No running warehouses'); return; }
                  for (const wh of active) {
                    await runAction(`ALTER WAREHOUSE ${wh.name} SUSPEND`, `wh-${wh.name}`);
                  }
                }}
              >
                <Text style={styles.bulkBtnText}>Suspend All Warehouses</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bulkBtn, { backgroundColor: '#FDEDEC' }]}
                onPress={async () => {
                  const runningSvc = services.filter(s => isRunning(s.status));
                  const activePools = pools.filter(p => isRunning(p.state));
                  const activeWhs = warehouses.filter(w => isRunning(w.state));
                  if (runningSvc.length + activePools.length + activeWhs.length === 0) {
                    alert('Everything is already suspended'); return;
                  }
                  for (const svc of runningSvc) {
                    await runAction(`ALTER SERVICE HEALTHCARE_DATABASE.DEFAULT_SCHEMA.${svc.name} SUSPEND`, `svc-${svc.name}`);
                  }
                  for (const pool of activePools) {
                    await runAction(`ALTER COMPUTE POOL ${pool.name} SUSPEND`, `pool-${pool.name}`);
                  }
                  for (const wh of activeWhs) {
                    await runAction(`ALTER WAREHOUSE ${wh.name} SUSPEND`, `wh-${wh.name}`);
                  }
                }}
              >
                <Text style={[styles.bulkBtnText, { fontWeight: '800' }]}>SUSPEND EVERYTHING</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}

      {activeSection === 'connection' && (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Connection</Text>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Account</Text>
              <Text style={styles.value}>SFSEHOL-SI_INDUSTRY_DEMOS_HEALTHCARE_LMSZKS</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Database</Text>
              <Text style={styles.value}>TRE_HEALTHCARE_DB</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Schema</Text>
              <Text style={styles.value}>OMOP_CDM</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.label}>MCP Server</Text>
              <Text style={styles.value}>HEALTHCARE_MCP_SERVER</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Available Tools</Text>
            <View style={styles.toolCard}>
              <Text style={styles.toolName}>cibmtr-analyst</Text>
              <Text style={styles.toolDesc}>CIBMTR Transplant data analysis</Text>
            </View>
            <View style={styles.toolCard}>
              <Text style={styles.toolName}>tre-omop-analyst</Text>
              <Text style={styles.toolDesc}>TRE OMOP CDM healthcare analytics</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutText}>Disconnect</Text>
          </TouchableOpacity>
        </>
      )}

      <View style={{ height: 40 }} />

      <Modal
        visible={timeoutModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setTimeoutModal(m => ({ ...m, visible: false }))}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setTimeoutModal(m => ({ ...m, visible: false }))}
        >
          <TouchableOpacity activeOpacity={1} style={styles.modalContent}>
            <Text style={styles.modalTitle}>Auto-Suspend Timeout</Text>
            <Text style={styles.modalSubtitle}>{timeoutModal.name}</Text>
            <Text style={styles.modalCurrent}>
              Current: {formatTimeout(timeoutModal.currentSecs)}
            </Text>
            <View style={styles.presetRow}>
              {TIMEOUT_PRESETS.map(p => (
                <TouchableOpacity
                  key={p.label}
                  style={[
                    styles.presetBtn,
                    timeoutModal.currentSecs === p.secs && styles.presetBtnActive,
                  ]}
                  onPress={() => applyTimeout(p.secs)}
                >
                  <Text style={[
                    styles.presetBtnText,
                    timeoutModal.currentSecs === p.secs && styles.presetBtnTextActive,
                  ]}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.customRow}>
              <TextInput
                style={styles.customInput}
                value={customTimeout}
                onChangeText={setCustomTimeout}
                keyboardType="numeric"
                placeholder="minutes"
                placeholderTextColor="#bbb"
              />
              <TouchableOpacity
                style={styles.customApplyBtn}
                onPress={() => {
                  const mins = parseInt(customTimeout);
                  if (!isNaN(mins) && mins >= 0) {
                    applyTimeout(mins * 60);
                  }
                }}
              >
                <Text style={styles.customApplyText}>Set (min)</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => setTimeoutModal(m => ({ ...m, visible: false }))}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  sectionTabs: {
    flexDirection: 'row',
    backgroundColor: '#e8e8e8',
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
  },
  sectionTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  sectionTabActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
  },
  sectionTabTextActive: {
    color: '#29B5E8',
  },
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    justifyContent: 'space-around',
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '700',
  },
  summaryLabel: {
    fontSize: 10,
    color: '#999',
    marginTop: 2,
  },
  refreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  autoRefreshBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#e8e8e8',
  },
  autoRefreshBtnActive: {
    backgroundColor: '#d4efdf',
  },
  autoRefreshText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
  },
  autoRefreshTextActive: {
    color: '#27AE60',
  },
  refreshBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#e8f4fd',
  },
  refreshBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#29B5E8',
  },
  lastRefreshText: {
    fontSize: 11,
    color: '#999',
    marginLeft: 'auto' as any,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  emptyText: {
    fontSize: 13,
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 12,
  },
  card: {
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#ddd',
  },
  cardActive: {
    borderLeftColor: '#27AE60',
    backgroundColor: '#f0faf3',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  cardName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
    flex: 1,
  },
  toggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 6,
    minWidth: 80,
    alignItems: 'center',
  },
  toggleBtnStart: {
    backgroundColor: '#27AE60',
  },
  toggleBtnStop: {
    backgroundColor: '#E74C3C',
  },
  toggleBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  cardDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  cardDetail: {
    minWidth: '22%' as any,
    marginBottom: 4,
  },
  detailLabel: {
    fontSize: 10,
    color: '#999',
    textTransform: 'uppercase',
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  autoSuspendNote: {
    fontSize: 11,
    color: '#999',
    fontStyle: 'italic',
    marginTop: 6,
  },
  timeoutBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eef6fb',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d0e8f5',
    gap: 3,
  },
  timeoutBadgeIcon: {
    fontSize: 12,
  },
  timeoutBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2980B9',
  },
  bulkRow: {
    flexDirection: 'row',
    gap: 10,
  },
  bulkBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  bulkBtnDanger: {
    backgroundColor: '#fdedec',
  },
  bulkBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E74C3C',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: 340,
    maxWidth: '90%' as any,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#29B5E8',
    fontWeight: '600',
    marginBottom: 12,
  },
  modalCurrent: {
    fontSize: 13,
    color: '#999',
    marginBottom: 16,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  presetBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  presetBtnActive: {
    backgroundColor: '#29B5E8',
  },
  presetBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  presetBtnTextActive: {
    color: '#fff',
  },
  customRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  customInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#333',
  },
  customApplyBtn: {
    backgroundColor: '#29B5E8',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    justifyContent: 'center',
  },
  customApplyText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  modalCancelBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  modalCancelText: {
    fontSize: 14,
    color: '#999',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  label: {
    fontSize: 14,
    color: '#666',
  },
  value: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
    marginLeft: 16,
  },
  toolCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  toolName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#29B5E8',
    marginBottom: 4,
  },
  toolDesc: {
    fontSize: 12,
    color: '#666',
  },
  logoutButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  logoutText: {
    fontSize: 16,
    color: '#e74c3c',
    fontWeight: '600',
  },
});
