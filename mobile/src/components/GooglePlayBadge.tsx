import { Image, Linking, StyleSheet, TouchableOpacity } from 'react-native';

import googlePlayBadge from '../../assets/images/google-play-badge.png';
import { GOOGLE_PLAY_URL } from '../config/storeConfig';
import { trackEvent } from '../services/analyticsService';

type Props = { placement: 'hero' | 'footer' | 'covert-feature' };

export default function GooglePlayBadge({ placement }: Props) {
  const handlePress = async () => {
    // Fired before openURL, defensively — react-native-web's Linking.openURL
    // opens a new tab via window.open(url, '_blank', 'noopener'), so this
    // tab (and the in-flight gtag call) is never torn down by navigation,
    // but there's no reason not to fire the event first anyway.
    trackEvent('google_play_download', { placement, link_url: GOOGLE_PLAY_URL });
    await Linking.openURL(GOOGLE_PLAY_URL);
  };

  return (
    <TouchableOpacity
      activeOpacity={0.84}
      onPress={handlePress}
      accessibilityRole="link"
      accessibilityLabel="Get it on Google Play"
      testID={`landing-google-play-badge-${placement}`}
    >
      <Image source={googlePlayBadge} resizeMode="contain" style={styles.badge} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Explicit width+height (not aspectRatio alone) — an Image with only
  // height+aspectRatio set collapsed to zero width inside a flex row on
  // RN Web. Matches the official asset's actual ratio (646x250, ~2.58:1).
  badge: { height: 56, width: 145 },
});
