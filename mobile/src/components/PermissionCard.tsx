import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
  icon: string;
  title: string;
  description: string;
  granted: boolean;
  onRequest: () => void;
}

export default function PermissionCard({ icon, title, description, granted, onRequest }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.icon}>{icon}</Text>
      <View style={styles.info}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.desc}>{description}</Text>
      </View>
      {granted ? (
        <View style={styles.grantedBadge}>
          <Text style={styles.grantedText}>✓</Text>
        </View>
      ) : (
        <TouchableOpacity style={styles.btn} onPress={onRequest}>
          <Text style={styles.btnText}>Allow</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e2235',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  icon: { fontSize: 28, marginRight: 14 },
  info: { flex: 1 },
  title: { color: '#fff', fontWeight: '600', fontSize: 15 },
  desc: { color: '#888', fontSize: 12, marginTop: 2 },
  grantedBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#10B98122',
    alignItems: 'center',
    justifyContent: 'center',
  },
  grantedText: { color: '#10B981', fontWeight: '700', fontSize: 16 },
  btn: {
    backgroundColor: '#7C3AED',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
