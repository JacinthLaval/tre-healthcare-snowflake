import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

interface FlowStep {
  label: string;
  icon: string;
  checkpoints: string[];
  color: string;
}

const FLOW_STEPS: FlowStep[] = [
  {
    label: 'Patient Presents',
    icon: 'P',
    checkpoints: ['PAT Auth', 'RBAC Check', 'Audit Logged'],
    color: '#29B5E8',
  },
  {
    label: 'Clinical Query',
    icon: 'Q',
    checkpoints: ['SQL Guardrails', 'Masking Applied', 'PII Protected'],
    color: '#3498DB',
  },
  {
    label: 'PGx Analysis',
    icon: 'G',
    checkpoints: ['Encrypted at Rest', 'Column Masking', 'Role Verified'],
    color: '#8E44AD',
  },
  {
    label: 'Risk Scoring',
    icon: 'R',
    checkpoints: ['Model Sandboxed', 'Data Encrypted', 'No PHI Leakage'],
    color: '#E67E22',
  },
  {
    label: 'Encounter Saved',
    icon: 'S',
    checkpoints: ['Write Audit', 'Row Access Policy', 'Consent Verified'],
    color: '#27AE60',
  },
  {
    label: 'Population View',
    icon: 'V',
    checkpoints: ['Aggregated Only', 'De-identified', 'Network Policy'],
    color: '#2ECC71',
  },
];

export default function DataFlowDiagram() {
  const [activeStep, setActiveStep] = useState(0);
  const pulseAnims = useRef(FLOW_STEPS.map(() => new Animated.Value(0.3))).current;
  const connectorAnims = useRef(FLOW_STEPS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep(prev => (prev + 1) % FLOW_STEPS.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    pulseAnims.forEach((anim, i) => {
      Animated.timing(anim, {
        toValue: i === activeStep ? 1 : 0.3,
        duration: 400,
        useNativeDriver: false,
      }).start();
    });
    connectorAnims.forEach((anim, i) => {
      Animated.timing(anim, {
        toValue: i < activeStep ? 1 : i === activeStep ? 0.6 : 0,
        duration: 300,
        useNativeDriver: false,
      }).start();
    });
  }, [activeStep]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>DATA FLOW &mdash; SECURITY CHECKPOINTS</Text>
      <View style={styles.flowRow}>
        {FLOW_STEPS.map((step, i) => {
          const isActive = i === activeStep;
          const isPast = i < activeStep;
          return (
            <View key={i} style={styles.stepWrapper}>
              {i > 0 && (
                <Animated.View
                  style={[
                    styles.connector,
                    {
                      backgroundColor: connectorAnims[i].interpolate({
                        inputRange: [0, 0.6, 1],
                        outputRange: ['#ddd', step.color + '60', step.color],
                      }),
                    },
                  ]}
                />
              )}
              <Animated.View
                style={[
                  styles.stepCircle,
                  {
                    backgroundColor: isActive ? step.color : isPast ? step.color + 'CC' : '#e0e0e0',
                    transform: [
                      {
                        scale: pulseAnims[i].interpolate({
                          inputRange: [0.3, 1],
                          outputRange: [0.85, 1.1],
                        }),
                      },
                    ],
                    shadowOpacity: isActive ? 0.4 : 0,
                    shadowColor: step.color,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 2 },
                  },
                ]}
              >
                <Text style={styles.stepIcon}>{step.icon}</Text>
              </Animated.View>
              <Text style={[styles.stepLabel, isActive && { color: step.color, fontWeight: '700' }]} numberOfLines={2}>
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={[styles.checkpointPanel, { borderLeftColor: FLOW_STEPS[activeStep].color }]}>
        <View style={styles.checkpointHeader}>
          <View style={[styles.activeDot, { backgroundColor: FLOW_STEPS[activeStep].color }]} />
          <Text style={[styles.checkpointTitle, { color: FLOW_STEPS[activeStep].color }]}>
            {FLOW_STEPS[activeStep].label}
          </Text>
        </View>
        {FLOW_STEPS[activeStep].checkpoints.map((cp, j) => (
          <View key={j} style={styles.checkpointRow}>
            <Text style={styles.checkMark}>&#10003;</Text>
            <Text style={styles.checkpointText}>{cp}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  title: {
    fontSize: 11,
    fontWeight: '700',
    color: '#999',
    letterSpacing: 1,
    marginBottom: 16,
    textAlign: 'center',
  },
  flowRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  stepWrapper: {
    alignItems: 'center',
    flex: 1,
    position: 'relative',
  },
  connector: {
    position: 'absolute',
    top: 18,
    left: -12,
    right: '50%' as any,
    height: 3,
    borderRadius: 2,
    width: 24,
    alignSelf: 'center',
  },
  stepCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  stepIcon: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  stepLabel: {
    fontSize: 9,
    color: '#999',
    textAlign: 'center',
    fontWeight: '500',
    lineHeight: 12,
  },
  checkpointPanel: {
    backgroundColor: '#fafbfc',
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 4,
  },
  checkpointHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  checkpointTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  checkpointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    gap: 8,
  },
  checkMark: {
    color: '#27AE60',
    fontSize: 14,
    fontWeight: '700',
  },
  checkpointText: {
    fontSize: 12,
    color: '#555',
    fontWeight: '500',
  },
});
