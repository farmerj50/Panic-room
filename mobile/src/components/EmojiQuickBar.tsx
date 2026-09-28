import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';

// Curated set spanning the emoji "types" people reach for most in a quick
// message or note — emotion, affection, gesture, safety, and celebration —
// rather than relying on the OS keyboard's emoji panel alone.
const POPULAR_EMOJIS = [
  '😀', '😂', '🥹', '😢', '😡', '😱', '😴', '🙄',
  '❤️', '💜', '🤍', '💔', '🥰', '😍',
  '👍', '👎', '🙏', '✋', '👋', '💪',
  '🆘', '⚠️', '🔒', '👀',
  '🎉', '✨', '🌟', '💯', '🔥', '😮‍💨',
];

export default function EmojiQuickBar({
  value, onChangeText, testID,
}: {
  value: string;
  onChangeText: (text: string) => void;
  testID?: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bar}
      contentContainerStyle={styles.barContent}
      testID={testID}
      keyboardShouldPersistTaps="handled"
    >
      {POPULAR_EMOJIS.map((emoji, index) => (
        <TouchableOpacity
          key={`${emoji}-${index}`}
          activeOpacity={0.7}
          style={styles.emojiButton}
          onPress={() => onChangeText(value + emoji)}
        >
          <Text style={styles.emojiText}>{emoji}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { marginTop: 8 },
  barContent: { gap: 8, paddingVertical: 2 },
  emojiButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  emojiText: { fontSize: 18 },
});
