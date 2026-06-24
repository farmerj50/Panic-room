import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Contact } from '../types/contact';

interface Props {
  contact: Contact;
  onDelete?: () => void;
  onTogglePriority?: () => void;
}

export default function ContactCard({ contact, onDelete, onTogglePriority }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{contact.name.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{contact.name}</Text>
          {contact.isPriority && (
            <View style={styles.priorityBadge}>
              <Text style={styles.priorityText}>⭐ Priority</Text>
            </View>
          )}
        </View>
        <Text style={styles.phone}>{contact.phoneNumber}</Text>
      </View>
      <View style={styles.actions}>
        {onTogglePriority && (
          <TouchableOpacity onPress={onTogglePriority} style={styles.iconBtn}>
            <Text style={styles.iconBtnText}>{contact.isPriority ? '★' : '☆'}</Text>
          </TouchableOpacity>
        )}
        {onDelete && (
          <TouchableOpacity onPress={onDelete} style={styles.iconBtn}>
            <Text style={[styles.iconBtnText, { color: '#e74c3c' }]}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e2235',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 18 },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: '#fff', fontWeight: '600', fontSize: 15 },
  phone: { color: '#888', fontSize: 13, marginTop: 2 },
  priorityBadge: {
    backgroundColor: '#F59E0B22',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  priorityText: { color: '#F59E0B', fontSize: 11, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: { fontSize: 18, color: '#F59E0B' },
});
