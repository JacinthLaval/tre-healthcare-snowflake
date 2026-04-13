import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

export interface TimelineEvent {
  date: string;
  type: 'visit' | 'condition' | 'medication' | 'procedure' | 'measurement';
  title: string;
  detail?: string;
  codes?: string[];
}

interface PatientTimelineProps {
  events: TimelineEvent[];
  maxHeight?: number;
}

const TYPE_COLORS: Record<string, string> = {
  visit: '#29B5E8',
  condition: '#FD7E14',
  medication: '#28A745',
  procedure: '#6C5CE7',
  measurement: '#17A2B8',
};

const TYPE_LABELS: Record<string, string> = {
  visit: 'Visit',
  condition: 'Condition',
  medication: 'Medication',
  procedure: 'Procedure',
  measurement: 'Measurement',
};

export default function PatientTimeline({ events, maxHeight = 400 }: PatientTimelineProps) {
  const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date));

  if (sorted.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No clinical events</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.scroll, { maxHeight }]} nestedScrollEnabled>
      {sorted.map((event, i) => {
        const color = TYPE_COLORS[event.type] || '#999';
        return (
          <View key={i} style={styles.row}>
            <View style={styles.left}>
              <Text style={styles.date}>{event.date}</Text>
              <View style={[styles.typeBadge, { backgroundColor: color + '18' }]}>
                <Text style={[styles.typeLabel, { color }]}>{TYPE_LABELS[event.type] || event.type}</Text>
              </View>
            </View>
            <View style={styles.lineCol}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              {i < sorted.length - 1 && <View style={styles.line} />}
            </View>
            <View style={styles.right}>
              <Text style={styles.title}>{event.title}</Text>
              {event.detail ? <Text style={styles.detail}>{event.detail}</Text> : null}
              {event.codes && event.codes.length > 0 && (
                <View style={styles.codesRow}>
                  {event.codes.map((c, ci) => (
                    <View key={ci} style={styles.codeBadge}>
                      <Text style={styles.codeText}>{c}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {},
  empty: { padding: 20, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#999', fontStyle: 'italic' },
  row: { flexDirection: 'row', marginBottom: 2 },
  left: { width: 80, alignItems: 'flex-end', paddingRight: 8, paddingTop: 2 },
  date: { fontSize: 11, color: '#888', fontWeight: '500' },
  typeBadge: { marginTop: 3, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  typeLabel: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  lineCol: { width: 20, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  line: { width: 2, flex: 1, backgroundColor: '#e0e0e0', marginVertical: 2 },
  right: { flex: 1, paddingLeft: 8, paddingBottom: 14 },
  title: { fontSize: 13, fontWeight: '600', color: '#333' },
  detail: { fontSize: 12, color: '#666', marginTop: 2, lineHeight: 17 },
  codesRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  codeBadge: { backgroundColor: '#f0f0f0', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, marginRight: 4, marginBottom: 2 },
  codeText: { fontSize: 10, color: '#666', fontWeight: '500' },
});
