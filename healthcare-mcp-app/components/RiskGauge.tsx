import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface RiskGaugeProps {
  score: number;
  label: string;
  size?: number;
}

const getRiskColor = (score: number): string => {
  if (score < 0.24) return '#28A745';
  if (score < 0.32) return '#FFC107';
  if (score < 0.36) return '#FD7E14';
  return '#DC3545';
};

const getRiskTier = (score: number): string => {
  if (score < 0.24) return 'Low';
  if (score < 0.32) return 'Moderate';
  if (score < 0.36) return 'High';
  return 'Critical';
};

export default function RiskGauge({ score, label, size = 120 }: RiskGaugeProps) {
  const color = getRiskColor(score);
  const tier = getRiskTier(score);
  const pct = Math.round(score * 100);
  const strokeWidth = size * 0.08;
  const radius = (size - strokeWidth) / 2;
  const barWidth = size * 0.7;
  const barHeight = 8;
  const fillWidth = barWidth * Math.min(score / 0.5, 1);

  return (
    <View style={[styles.container, { width: size }]}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.ring, { width: size * 0.75, height: size * 0.75, borderRadius: (size * 0.75) / 2, borderWidth: strokeWidth, borderColor: color + '30' }]}>
        <Text style={[styles.pct, { fontSize: size * 0.22, color }]}>{pct}%</Text>
      </View>
      <View style={[styles.barTrack, { width: barWidth, height: barHeight }]}>
        <View style={[styles.barFill, { width: fillWidth, height: barHeight, backgroundColor: color }]} />
      </View>
      <View style={[styles.tierBadge, { backgroundColor: color + '20' }]}>
        <Text style={[styles.tierText, { color }]}>{tier}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  label: { fontSize: 12, fontWeight: '600', color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  ring: { alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  pct: { fontWeight: '800' },
  barTrack: { borderRadius: 4, backgroundColor: '#eee', overflow: 'hidden', marginBottom: 6 },
  barFill: { borderRadius: 4 },
  tierBadge: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: 10 },
  tierText: { fontSize: 11, fontWeight: '700' },
});
